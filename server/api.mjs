import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const MAX_BODY_BYTES = 35 * 1024 * 1024; // Allows ~25MB binary payload after base64 overhead
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".zip": "application/zip",
};

function sanitizeMapId(rawId) {
  const cleaned = String(rawId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  return cleaned.slice(0, 120);
}

function sanitizeFilename(rawName) {
  const base = path.basename(String(rawName || "file"));
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
  return cleaned.slice(0, 120) || "file";
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      const err = new Error("Payload too large");
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function extractBase64FromDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+)?(?:;[^,]+)*;base64,(.*)$/i);
  if (!match) return null;
  return {
    mimeType: match[1] || "application/octet-stream",
    base64: match[2] || "",
  };
}

function buildFileSummaryText(file) {
  const sizeKb = Math.max(1, Math.round((Number(file.size) || 0) / 1024));
  const header = `[Attached file: ${file.name} | type: ${file.mimeType || "application/octet-stream"} | size: ${sizeKb} KB | url: ${file.url || ""}]`;
  if (file.textContent) {
    const trimmed =
      file.textContent.length > 60000
        ? `${file.textContent.slice(0, 60000)}\n...(truncated)`
        : file.textContent;
    return `${header}\n\`\`\`\n${trimmed}\n\`\`\``;
  }
  return header;
}

function extractApiErrorMessage(rawText, fallbackStatusText) {
  if (!rawText) return fallbackStatusText || "Unknown API error";
  try {
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed) && parsed[0]?.error?.message) {
      return String(parsed[0].error.message);
    }
    if (parsed?.error?.message) return String(parsed.error.message);
    if (typeof parsed?.error === "string") return parsed.error;
    if (parsed?.message) return String(parsed.message);
    if (parsed?.detail) return String(parsed.detail);
  } catch {
    // Non-JSON error body
  }
  return rawText.slice(0, 1000);
}

/**
 * Creates a Connect/HTTP middleware providing map persistence and file uploads
 * backed by the local filesystem / mounted Docker volume.
 */
export function createApiMiddleware(
  dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), "data")
) {
  const resolvedDataDir = path.resolve(dataDir);
  const mapsDir = path.join(resolvedDataDir, "maps");
  const uploadsDir = path.join(resolvedDataDir, "uploads");

  let initPromise = null;
  function ensureDirs() {
    if (!initPromise) {
      initPromise = Promise.all([
        fs.mkdir(mapsDir, { recursive: true }),
        fs.mkdir(uploadsDir, { recursive: true }),
      ]);
    }
    return initPromise;
  }

  return async function apiMiddleware(req, res, next) {
    const reqUrl = new URL(req.url || "/", "http://localhost");
    const pathname = reqUrl.pathname;

    if (!pathname.startsWith("/api/") && !pathname.startsWith("/uploads/")) {
      return next();
    }

    try {
      await ensureDirs();

      // Health check endpoint
      if (req.method === "GET" && pathname === "/api/health") {
        return sendJson(res, 200, {
          status: "ok",
          storageDir: resolvedDataDir,
          timestamp: new Date().toISOString(),
        });
      }

      // List all saved maps
      if (req.method === "GET" && pathname === "/api/maps") {
        const entries = await fs.readdir(mapsDir, { withFileTypes: true });
        const summaries = [];
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
          try {
            const fullPath = path.join(mapsDir, entry.name);
            const raw = await fs.readFile(fullPath, "utf8");
            const doc = JSON.parse(raw);
            summaries.push({
              id: doc.id || entry.name.replace(/\.json$/, ""),
              title: doc.title || "Untitled Mind Map",
              updatedAt: doc.updatedAt || new Date().toISOString(),
              nodeCount: doc.nodes ? Object.keys(doc.nodes).length : 0,
            });
          } catch {
            // Skip malformed JSON files instead of failing the listing
          }
        }
        summaries.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        return sendJson(res, 200, summaries);
      }

      // Create or overwrite map via POST /api/maps
      if (req.method === "POST" && pathname === "/api/maps") {
        const doc = await readJsonBody(req);
        const mapId = sanitizeMapId(doc.id) || `map-${crypto.randomUUID().slice(0, 8)}`;
        const now = new Date().toISOString();
        const savedDoc = { ...doc, id: mapId, updatedAt: now };
        await fs.writeFile(
          path.join(mapsDir, `${mapId}.json`),
          JSON.stringify(savedDoc, null, 2),
          "utf8"
        );
        return sendJson(res, 200, { ok: true, id: mapId, updatedAt: now });
      }

      // Single map operations: GET / PUT / DELETE /api/maps/:id
      if (pathname.startsWith("/api/maps/")) {
        const rawId = decodeURIComponent(pathname.slice("/api/maps/".length));
        const mapId = sanitizeMapId(rawId);
        if (!mapId) {
          return sendJson(res, 400, { error: "Invalid map id" });
        }
        const filePath = path.join(mapsDir, `${mapId}.json`);

        if (req.method === "GET") {
          try {
            const content = await fs.readFile(filePath, "utf8");
            res.writeHead(200, {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
            });
            return res.end(content);
          } catch (err) {
            if (err && err.code === "ENOENT") {
              return sendJson(res, 404, { error: "Map not found" });
            }
            throw err;
          }
        }

        if (req.method === "PUT") {
          const doc = await readJsonBody(req);
          const now = new Date().toISOString();
          const savedDoc = { ...doc, id: mapId, updatedAt: now };
          await fs.writeFile(filePath, JSON.stringify(savedDoc, null, 2), "utf8");
          return sendJson(res, 200, { ok: true, id: mapId, updatedAt: now });
        }

        if (req.method === "DELETE") {
          try {
            await fs.unlink(filePath);
            return sendJson(res, 200, { ok: true, id: mapId });
          } catch (err) {
            if (err && err.code === "ENOENT") {
              return sendJson(res, 404, { error: "Map not found" });
            }
            throw err;
          }
        }
      }

      // Upload image or attachment: POST /api/uploads
      if (req.method === "POST" && pathname === "/api/uploads") {
        const body = await readJsonBody(req);
        const safeName = sanitizeFilename(body.name || "attachment");
        const dataUrl = String(body.dataUrl || "");
        const parsedDataUrl = extractBase64FromDataUrl(dataUrl);
        if (!parsedDataUrl) {
          return sendJson(res, 400, { error: "Expected base64 dataUrl" });
        }

        const mimeType = body.mimeType || parsedDataUrl.mimeType || "application/octet-stream";
        const buffer = Buffer.from(parsedDataUrl.base64, "base64");
        if (buffer.length > MAX_UPLOAD_BYTES) {
          return sendJson(res, 413, { error: "Uploaded file exceeds 25MB limit" });
        }

        const safeId = crypto.randomUUID().slice(0, 8);
        const storedName = `${safeId}-${safeName}`;
        const destPath = path.join(uploadsDir, storedName);
        await fs.writeFile(destPath, buffer);

        return sendJson(res, 200, {
          url: `/uploads/${storedName}`,
          name: safeName,
          size: buffer.length,
          mimeType,
        });
      }

      // Proxy LLM Mind Map requests: POST /api/llm/chat
      if (req.method === "POST" && pathname === "/api/llm/chat") {
        const body = await readJsonBody(req);
        const provider = String(body.provider || "openai").toLowerCase();
        const apiKey = String(body.apiKey || "").trim();
        const model = String(body.model || "").trim();
        const baseUrl = String(body.baseUrl || "").trim();
        const systemPrompt = String(body.systemPrompt || "");
        const rawMessages = Array.isArray(body.messages) ? body.messages : [];

        if (!apiKey) {
          return sendJson(res, 400, {
            error: "Missing LLM provider API key. Please add your API key in the chat settings.",
          });
        }

        const conversation = rawMessages.filter(
          (m) => m && (m.role === "user" || m.role === "assistant")
        );

        let upstreamRes;
        try {
          if (provider === "gemini") {
            const targetModel = model || "gemini-2.5-flash";
            const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
            const contents = [];
            for (const msg of conversation) {
              const role = msg.role === "assistant" ? "model" : "user";
              if (contents.length === 0 && role !== "user") continue;
              const parts = [];
              const files = Array.isArray(msg.files) ? msg.files : [];
              const textSegments = [];
              if (msg.content) textSegments.push(String(msg.content));
              for (const f of files) {
                const parsed = f.dataUrl ? extractBase64FromDataUrl(f.dataUrl) : null;
                const mime = (f.mimeType || parsed?.mimeType || "").toLowerCase();
                const isGeminiInline =
                  parsed &&
                  parsed.base64 &&
                  (mime.startsWith("image/") ||
                    mime === "application/pdf" ||
                    mime.startsWith("audio/") ||
                    mime.startsWith("video/"));
                if (isGeminiInline) {
                  parts.push({
                    inlineData: {
                      mimeType: mime,
                      data: parsed.base64,
                    },
                  });
                }
                textSegments.push(buildFileSummaryText(f));
              }
              parts.unshift({
                text: textSegments.join("\n\n") || "Analyze the attached files.",
              });
              if (contents.length > 0 && contents[contents.length - 1].role === role) {
                contents[contents.length - 1].parts.push(...parts);
              } else {
                contents.push({ role, parts });
              }
            }

            upstreamRes = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents,
                generationConfig: { temperature: 0.2 },
              }),
            });

            const rawText = await upstreamRes.text();
            if (!upstreamRes.ok) {
              return sendJson(res, upstreamRes.status, {
                error: extractApiErrorMessage(rawText, upstreamRes.statusText),
                providerStatus: upstreamRes.status,
                rawError: rawText,
              });
            }
            const data = JSON.parse(rawText);
            const replyText = (data?.candidates?.[0]?.content?.parts || [])
              .map((p) => p?.text || "")
              .join("")
              .trim();
            return sendJson(res, 200, { ok: true, text: replyText });
          }

          if (provider === "anthropic") {
            const targetModel = model || "claude-3-5-sonnet-latest";
            const messages = [];
            for (const msg of conversation) {
              const role = msg.role === "assistant" ? "assistant" : "user";
              if (messages.length === 0 && role !== "user") continue;
              const blocks = [];
              const textSegments = [];
              if (msg.content) textSegments.push(String(msg.content));
              const files = Array.isArray(msg.files) ? msg.files : [];
              for (const f of files) {
                const parsed = f.dataUrl ? extractBase64FromDataUrl(f.dataUrl) : null;
                const mime = (f.mimeType || parsed?.mimeType || "").toLowerCase();
                if (
                  parsed &&
                  parsed.base64 &&
                  ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mime)
                ) {
                  blocks.push({
                    type: "image",
                    source: { type: "base64", media_type: mime, data: parsed.base64 },
                  });
                } else if (parsed && parsed.base64 && mime === "application/pdf") {
                  blocks.push({
                    type: "document",
                    source: {
                      type: "base64",
                      media_type: "application/pdf",
                      data: parsed.base64,
                    },
                  });
                }
                textSegments.push(buildFileSummaryText(f));
              }
              blocks.push({
                type: "text",
                text: textSegments.join("\n\n") || "Analyze the attached files.",
              });
              if (messages.length > 0 && messages[messages.length - 1].role === role) {
                messages[messages.length - 1].content.push(...blocks);
              } else {
                messages.push({ role, content: blocks });
              }
            }

            upstreamRes = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({
                model: targetModel,
                max_tokens: 4096,
                system: systemPrompt,
                messages,
              }),
            });

            const rawText = await upstreamRes.text();
            if (!upstreamRes.ok) {
              return sendJson(res, upstreamRes.status, {
                error: extractApiErrorMessage(rawText, upstreamRes.statusText),
                providerStatus: upstreamRes.status,
                rawError: rawText,
              });
            }
            const data = JSON.parse(rawText);
            const replyText = (data?.content || [])
              .filter((c) => c?.type === "text")
              .map((c) => c.text || "")
              .join("")
              .trim();
            return sendJson(res, 200, { ok: true, text: replyText });
          }

          // Default: OpenAI or OpenAI-compatible custom endpoint
          const cleanBase = (
            provider === "custom" && baseUrl ? baseUrl : "https://api.openai.com/v1"
          ).replace(/\/+$/, "");
          const endpoint = cleanBase.endsWith("/chat/completions")
            ? cleanBase
            : `${cleanBase}/chat/completions`;
          const targetModel = model || "gpt-4o-mini";

          const messages = [{ role: "system", content: systemPrompt }];
          for (const msg of conversation) {
            const files = Array.isArray(msg.files) ? msg.files : [];
            const imageParts = [];
            const textSegments = [];
            if (msg.content) textSegments.push(String(msg.content));
            for (const f of files) {
              const mime = (f.mimeType || "").toLowerCase();
              if (f.dataUrl && mime.startsWith("image/")) {
                imageParts.push({ type: "image_url", image_url: { url: f.dataUrl } });
              }
              textSegments.push(buildFileSummaryText(f));
            }
            const combinedText = textSegments.join("\n\n") || "Analyze the attached files.";
            if (imageParts.length > 0 && msg.role === "user") {
              messages.push({
                role: "user",
                content: [{ type: "text", text: combinedText }, ...imageParts],
              });
            } else {
              messages.push({
                role: msg.role === "assistant" ? "assistant" : "user",
                content: combinedText,
              });
            }
          }

          upstreamRes = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: targetModel,
              messages,
              temperature: 0.2,
            }),
          });

          const rawText = await upstreamRes.text();
          if (!upstreamRes.ok) {
            return sendJson(res, upstreamRes.status, {
              error: extractApiErrorMessage(rawText, upstreamRes.statusText),
              providerStatus: upstreamRes.status,
              rawError: rawText,
            });
          }
          const data = JSON.parse(rawText);
          const replyText = String(data?.choices?.[0]?.message?.content || "").trim();
          return sendJson(res, 200, { ok: true, text: replyText });
        } catch (fetchErr) {
          return sendJson(res, 502, {
            error:
              fetchErr instanceof Error
                ? fetchErr.message
                : "Failed to communicate with LLM provider API",
          });
        }
      }

      // Serve uploaded files: GET /uploads/:filename
      if (req.method === "GET" && pathname.startsWith("/uploads/")) {
        const requested = decodeURIComponent(pathname.slice("/uploads/".length));
        const safeFile = path.basename(requested);
        if (!safeFile || safeFile !== requested) {
          return sendJson(res, 400, { error: "Invalid filename" });
        }
        const filePath = path.join(uploadsDir, safeFile);
        try {
          const buf = await fs.readFile(filePath);
          const ext = path.extname(safeFile).toLowerCase();
          const contentType = MIME_TYPES[ext] || "application/octet-stream";
          const headers = {
            "Content-Type": contentType,
            "Content-Length": buf.length,
            "Cache-Control": "public, max-age=31536000, immutable",
          };
          if (ext === ".svg") {
            headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'";
          }
          res.writeHead(200, headers);
          return res.end(buf);
        } catch (err) {
          if (err && err.code === "ENOENT") {
            return sendJson(res, 404, { error: "File not found" });
          }
          throw err;
        }
      }

      return sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      const status = err && typeof err.statusCode === "number" ? err.statusCode : 500;
      return sendJson(res, status, {
        error: err instanceof Error ? err.message : "Internal server error",
      });
    }
  };
}
