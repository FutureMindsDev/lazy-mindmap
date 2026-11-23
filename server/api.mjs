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
        const match = dataUrl.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i);
        if (!match) {
          return sendJson(res, 400, { error: "Expected base64 dataUrl" });
        }

        const mimeType = body.mimeType || match[1] || "application/octet-stream";
        const buffer = Buffer.from(match[2], "base64");
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
