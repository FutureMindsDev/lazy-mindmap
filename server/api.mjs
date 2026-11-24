import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { loadServerEnv } from "./env.mjs";
import {
  decryptSecret,
  encryptSecret,
  generatePaymentRefCode,
  hmacHash,
  isDisposableEmail,
  maskApiKey,
  normalizeEmailForAntiAbuse,
  validateExternalBaseUrl,
} from "./crypto.mjs";
import { createDatabase, CURATED_GEMINI_MODELS } from "./db.mjs";
import { extractRequestSignals, verifyAuthRequest } from "./auth.mjs";

const MAX_BODY_BYTES = 35 * 1024 * 1024; // Allows ~25MB binary payload after base64 overhead
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_MANAGED_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const ALLOWED_PROVIDERS = new Set(["openai", "gemini", "anthropic", "custom"]);
const ALLOWED_RECEIPT_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

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

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...extraHeaders,
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

function estimateAttachmentBytes(messages) {
  let total = 0;
  for (const msg of messages) {
    const files = Array.isArray(msg?.files) ? msg.files : [];
    for (const f of files) {
      if (f?.size && Number.isFinite(Number(f.size))) {
        total += Number(f.size);
      } else if (typeof f?.dataUrl === "string") {
        total += Math.floor((f.dataUrl.length * 3) / 4);
      }
    }
  }
  return total;
}

function getEffectiveQuotaUsage(user, aiConfig, nowIso = new Date().toISOString()) {
  const dayKey = nowIso.slice(0, 10);
  const monthKey = nowIso.slice(0, 7);
  const dailyUsed = user.quota?.dailyResetKey === dayKey ? user.quota.dailyUsed || 0 : 0;
  const monthlyUsed = user.quota?.monthlyResetKey === monthKey ? user.quota.monthlyUsed || 0 : 0;
  return {
    dayKey,
    monthKey,
    dailyUsed,
    dailyLimit: aiConfig.dailyQuota,
    dailyRemaining: Math.max(0, aiConfig.dailyQuota - dailyUsed),
    monthlyUsed,
    monthlyLimit: aiConfig.monthlyQuota,
    monthlyRemaining: Math.max(0, aiConfig.monthlyQuota - monthlyUsed),
  };
}

function getEffectiveSubscriptionStatus(user, nowIso = new Date().toISOString()) {
  const sub = user.subscription || { plan: "free", status: "none", startedAt: null, expiresAt: null };
  if (sub.status === "active" && sub.expiresAt && sub.expiresAt <= nowIso) {
    return "expired";
  }
  return sub.status || "none";
}

function buildPublicAccountState(auth, aiConfig, byokVault, db) {
  const nowIso = new Date().toISOString();
  const user = auth.user;
  const subStatus = getEffectiveSubscriptionStatus(user, nowIso);
  const quota = getEffectiveQuotaUsage(user, aiConfig, nowIso);
  const trialUsed = user.trial?.used || 0;
  const trialLimit = aiConfig.maxTrialCount || 3;

  return {
    authenticated: true,
    firebaseConfigured: db.isFirebaseEnabled,
    isAdmin: auth.isAdmin,
    user: {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      emailVerified: Boolean(user.emailVerified),
      providers: user.providers || [],
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
    },
    subscription: {
      plan: user.subscription?.plan || "free",
      status: subStatus,
      startedAt: user.subscription?.startedAt || null,
      expiresAt: user.subscription?.expiresAt || null,
    },
    trial: {
      used: trialUsed,
      limit: trialLimit,
      remaining: Math.max(0, trialLimit - trialUsed),
      lastUsedAt: user.trial?.lastUsedAt || null,
    },
    quota,
    byok: byokVault
      ? {
          configured: true,
          provider: byokVault.provider,
          model: byokVault.model,
          baseUrl: byokVault.baseUrl || "",
          keyHint: byokVault.keyHint || "",
          updatedAt: byokVault.updatedAt || null,
        }
      : { configured: false },
    billing: {
      referenceCode: generatePaymentRefCode(user.uid),
      monthlyPriceMmk: aiConfig.monthlyPriceMmk,
      yearlyPriceMmk: aiConfig.yearlyPriceMmk,
      managedModel: aiConfig.managedModel,
      trialModel: aiConfig.trialModel,
      dailyQuota: aiConfig.dailyQuota,
      monthlyQuota: aiConfig.monthlyQuota,
      maxTrialCount: trialLimit,
    },
  };
}

function sanitizePaymentSubmission(sub, includeAdminFields = false) {
  const base = {
    id: sub.id,
    uid: sub.uid,
    userEmail: sub.userEmail || "",
    userDisplayName: sub.userDisplayName || "",
    plan: sub.plan,
    amountMmk: sub.amountMmk,
    transactionId: sub.transactionId,
    referenceCode: sub.referenceCode,
    note: sub.note || "",
    status: sub.status,
    createdAt: sub.createdAt,
    reviewedAt: sub.reviewedAt || null,
    reviewNote: sub.reviewNote || "",
    hasReceipt: Boolean(sub.storagePath),
  };
  if (includeAdminFields) {
    base.reviewedBy = sub.reviewedBy || null;
    base.receiptUrl = sub.storagePath ? `/api/admin/receipts/${encodeURIComponent(sub.id)}` : null;
  }
  return base;
}

function sanitizeAdminUserRow(u, aiConfig) {
  const nowIso = new Date().toISOString();
  const quota = getEffectiveQuotaUsage(u, aiConfig, nowIso);
  return {
    uid: u.uid,
    email: u.email,
    displayName: u.displayName,
    emailVerified: Boolean(u.emailVerified),
    providers: u.providers || [],
    role: u.role,
    status: u.status,
    subscription: {
      plan: u.subscription?.plan || "free",
      status: getEffectiveSubscriptionStatus(u, nowIso),
      startedAt: u.subscription?.startedAt || null,
      expiresAt: u.subscription?.expiresAt || null,
    },
    trial: {
      used: u.trial?.used || 0,
      limit: aiConfig.maxTrialCount || 3,
      lastUsedAt: u.trial?.lastUsedAt || null,
    },
    quota: {
      dailyUsed: quota.dailyUsed,
      dailyLimit: quota.dailyLimit,
      monthlyUsed: quota.monthlyUsed,
      monthlyLimit: quota.monthlyLimit,
    },
    lastGeo: u.lastGeo || null,
    hasDeviceSignal: Boolean(u.lastDeviceHash),
    lastIpHashPrefix: u.lastIpHash ? u.lastIpHash.slice(0, 8) : "",
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    lastSeenAt: u.lastSeenAt,
  };
}

function resolveAdminSecretKey(aiConfig, kind) {
  const enc = kind === "trial" ? aiConfig.trialApiKeyEnc : aiConfig.managedApiKeyEnc;
  const aad = kind === "trial" ? "admin:trial" : "admin:managed";
  if (enc) {
    try {
      const decrypted = decryptSecret(enc, aad);
      if (decrypted) return decrypted;
    } catch {
      // Fall back to env vars if key rotation/corruption occurred
    }
  }
  if (kind === "trial") {
    const envTrial = String(process.env.GEMINI_TRIAL_API_KEY || "").trim();
    if (envTrial) return envTrial;
    if (aiConfig.managedApiKeyEnc) {
      try {
        const fallbackManaged = decryptSecret(aiConfig.managedApiKeyEnc, "admin:managed");
        if (fallbackManaged) return fallbackManaged;
      } catch {}
    }
    return String(process.env.GEMINI_MANAGED_API_KEY || "").trim();
  }
  return String(process.env.GEMINI_MANAGED_API_KEY || "").trim();
}

function buildAdminAiConfigResponse(aiConfig) {
  const managedEnvSet = Boolean(String(process.env.GEMINI_MANAGED_API_KEY || "").trim());
  const trialEnvSet = Boolean(String(process.env.GEMINI_TRIAL_API_KEY || "").trim());
  const managedEnvHint = managedEnvSet
    ? maskApiKey(process.env.GEMINI_MANAGED_API_KEY)
    : "";
  const trialEnvHint = trialEnvSet ? maskApiKey(process.env.GEMINI_TRIAL_API_KEY) : "";

  return {
    managedProvider: aiConfig.managedProvider || "gemini",
    managedModel: aiConfig.managedModel || "gemini-3.1-flash-lite",
    trialModel: aiConfig.trialModel || "gemini-3.1-flash-lite",
    monthlyQuota: aiConfig.monthlyQuota,
    dailyQuota: aiConfig.dailyQuota,
    monthlyPriceMmk: aiConfig.monthlyPriceMmk,
    yearlyPriceMmk: aiConfig.yearlyPriceMmk,
    maxTrialCount: aiConfig.maxTrialCount,
    hasManagedKey: Boolean(aiConfig.managedApiKeyEnc || managedEnvSet),
    managedKeyHint: aiConfig.managedKeyHint || managedEnvHint,
    managedKeySource: aiConfig.managedApiKeyEnc
      ? "vault"
      : managedEnvSet
      ? "env"
      : "none",
    hasTrialKey: Boolean(aiConfig.trialApiKeyEnc || trialEnvSet),
    trialKeyHint: aiConfig.trialKeyHint || trialEnvHint,
    trialKeySource: aiConfig.trialApiKeyEnc ? "vault" : trialEnvSet ? "env" : "none",
    curatedModels: CURATED_GEMINI_MODELS,
    updatedAt: aiConfig.updatedAt || null,
    updatedBy: aiConfig.updatedBy || null,
  };
}

async function callUpstreamLlm({
  provider,
  apiKey,
  model,
  baseUrl,
  systemPrompt,
  conversation,
  maxOutputTokens,
  fetchImpl,
}) {
  if (provider === "gemini") {
    const targetModel = model || "gemini-3.1-flash-lite";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      targetModel
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;
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

    const generationConfig = { temperature: 0.2 };
    if (maxOutputTokens) generationConfig.maxOutputTokens = maxOutputTokens;

    const upstreamRes = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig,
      }),
    });

    const rawText = await upstreamRes.text();
    if (!upstreamRes.ok) {
      return {
        ok: false,
        status: upstreamRes.status,
        error: extractApiErrorMessage(rawText, upstreamRes.statusText),
        rawError: rawText,
      };
    }
    const data = JSON.parse(rawText);
    const replyText = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => p?.text || "")
      .join("")
      .trim();
    return { ok: true, text: replyText };
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

    const upstreamRes = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: targetModel,
        max_tokens: maxOutputTokens || 4096,
        system: systemPrompt,
        messages,
      }),
    });

    const rawText = await upstreamRes.text();
    if (!upstreamRes.ok) {
      return {
        ok: false,
        status: upstreamRes.status,
        error: extractApiErrorMessage(rawText, upstreamRes.statusText),
        rawError: rawText,
      };
    }
    const data = JSON.parse(rawText);
    const replyText = (data?.content || [])
      .filter((c) => c?.type === "text")
      .map((c) => c.text || "")
      .join("")
      .trim();
    return { ok: true, text: replyText };
  }

  // OpenAI or OpenAI-compatible custom endpoint (with SSRF check already enforced for custom)
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

  const upstreamRes = await fetchImpl(endpoint, {
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
    return {
      ok: false,
      status: upstreamRes.status,
      error: extractApiErrorMessage(rawText, upstreamRes.statusText),
      rawError: rawText,
    };
  }
  const data = JSON.parse(rawText);
  const replyText = String(data?.choices?.[0]?.message?.content || "").trim();
  return { ok: true, text: replyText };
}

/**
 * Creates Connect/HTTP middleware providing:
 * - Multi-user Firebase Auth + local dev test auth
 * - Cloud-synced per-user mind maps (plus local fallback for single-user Docker mode)
 * - Hybrid BYOK security (AES-256-GCM Encrypted Cloud Vault & Session-only RAM proxy)
 * - 3-try Free AI Trial with anti-abuse (normalized email, disposable block, device FP + cookie, IP/geo)
 * - KBZPay subscription submissions, receipt storage, and fair-use managed quotas
 * - Server-side paginated Admin Dashboard API
 */
export function createApiMiddleware(
  dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), "data"),
  options = {}
) {
  loadServerEnv();
  const resolvedDataDir = path.resolve(dataDir);
  const mapsDir = path.join(resolvedDataDir, "maps");
  const uploadsDir = path.join(resolvedDataDir, "uploads");
  const db = createDatabase(resolvedDataDir, { forceLocal: Boolean(options.forceLocal) });
  const llmFetch = options.llmFetch || globalThis.fetch;

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
          firebaseConfigured: db.isFirebaseEnabled,
          timestamp: new Date().toISOString(),
        });
      }

      const signals = extractRequestSignals(req);
      const cookieHeaderObj = signals.setCookieHeader
        ? { "Set-Cookie": signals.setCookieHeader }
        : {};

      const requireAuth = async () => {
        const auth = await verifyAuthRequest(req, db, signals);
        if (!auth.authenticated) {
          const err = new Error("Authentication required.");
          err.statusCode = 401;
          err.code = "AUTH_REQUIRED";
          throw err;
        }
        return auth;
      };

      const requireAdmin = async () => {
        const auth = await requireAuth();
        if (!auth.isAdmin) {
          const err = new Error("Admin access required.");
          err.statusCode = 403;
          err.code = "ADMIN_REQUIRED";
          throw err;
        }
        return auth;
      };

      // -----------------------------------------------------------------------
      // Auth & Account Endpoints
      // -----------------------------------------------------------------------
      if (req.method === "GET" && pathname === "/api/auth/me") {
        const auth = await verifyAuthRequest(req, db, signals);
        const aiConfig = await db.getAdminAiConfig();
        if (!auth.authenticated) {
          return sendJson(
            res,
            200,
            {
              authenticated: false,
              firebaseConfigured: db.isFirebaseEnabled,
              isAdmin: false,
              billing: {
                monthlyPriceMmk: aiConfig.monthlyPriceMmk,
                yearlyPriceMmk: aiConfig.yearlyPriceMmk,
                managedModel: aiConfig.managedModel,
                trialModel: aiConfig.trialModel,
                dailyQuota: aiConfig.dailyQuota,
                monthlyQuota: aiConfig.monthlyQuota,
                maxTrialCount: aiConfig.maxTrialCount,
              },
            },
            cookieHeaderObj
          );
        }
        const byokVault = await db.getByokVault(auth.uid);
        return sendJson(
          res,
          200,
          buildPublicAccountState(auth, aiConfig, byokVault, db),
          cookieHeaderObj
        );
      }

      if (req.method === "POST" && pathname === "/api/auth/sync-profile") {
        const auth = await requireAuth();
        const body = await readJsonBody(req);
        const patch = {};
        if (typeof body.displayName === "string" && body.displayName.trim()) {
          patch.displayName = body.displayName.trim().slice(0, 120);
        }
        if (typeof body.photoURL === "string" && body.photoURL.trim()) {
          patch.photoURL = body.photoURL.trim().slice(0, 500);
        }
        if (Object.keys(patch).length > 0) {
          auth.user = await db.upsertUser(auth.uid, patch);
        }
        const [aiConfig, byokVault] = await Promise.all([
          db.getAdminAiConfig(),
          db.getByokVault(auth.uid),
        ]);
        return sendJson(
          res,
          200,
          buildPublicAccountState(auth, aiConfig, byokVault, db),
          cookieHeaderObj
        );
      }

      // -----------------------------------------------------------------------
      // BYOK Encrypted Cloud Vault Endpoints
      // -----------------------------------------------------------------------
      if (pathname === "/api/ai/byok") {
        const auth = await requireAuth();

        if (req.method === "GET") {
          const vault = await db.getByokVault(auth.uid);
          if (!vault) {
            return sendJson(res, 200, { configured: false });
          }
          return sendJson(res, 200, {
            configured: true,
            provider: vault.provider,
            model: vault.model,
            baseUrl: vault.baseUrl || "",
            keyHint: vault.keyHint || "",
            updatedAt: vault.updatedAt || null,
          });
        }

        if (req.method === "PUT") {
          const body = await readJsonBody(req);
          const provider = String(body.provider || "openai").toLowerCase().trim();
          if (!ALLOWED_PROVIDERS.has(provider)) {
            return sendJson(res, 400, { error: "Unsupported LLM provider." });
          }
          const model = String(body.model || "").trim().slice(0, 120);
          let baseUrl = "";
          if (provider === "custom") {
            baseUrl = validateExternalBaseUrl(body.baseUrl);
          }

          const rawKey = String(body.apiKey || "").trim();
          const existing = await db.getByokVault(auth.uid);
          if (!rawKey && !existing?.encryptedKey) {
            return sendJson(res, 400, { error: "API key is required to save in the vault." });
          }

          const now = new Date().toISOString();
          const encryptedKey = rawKey
            ? encryptSecret(rawKey, `byok:${auth.uid}`)
            : existing.encryptedKey;
          const keyHint = rawKey ? maskApiKey(rawKey) : existing.keyHint;

          const record = {
            uid: auth.uid,
            provider,
            model,
            baseUrl,
            encryptedKey,
            keyHint,
            updatedAt: now,
          };
          await db.saveByokVault(auth.uid, record);
          return sendJson(res, 200, {
            ok: true,
            configured: true,
            provider: record.provider,
            model: record.model,
            baseUrl: record.baseUrl,
            keyHint: record.keyHint,
            updatedAt: record.updatedAt,
          });
        }

        if (req.method === "DELETE") {
          await db.deleteByokVault(auth.uid);
          return sendJson(res, 200, { ok: true, configured: false });
        }
      }

      // -----------------------------------------------------------------------
      // KBZPay Billing & Subscription Endpoints
      // -----------------------------------------------------------------------
      if (req.method === "GET" && pathname === "/api/billing/status") {
        const auth = await requireAuth();
        const [aiConfig, submissions] = await Promise.all([
          db.getAdminAiConfig(),
          db.listUserPayments(auth.uid),
        ]);
        const state = buildPublicAccountState(auth, aiConfig, null, db);
        return sendJson(res, 200, {
          subscription: state.subscription,
          trial: state.trial,
          quota: state.quota,
          billing: state.billing,
          submissions: submissions.map((s) => sanitizePaymentSubmission(s, false)),
        });
      }

      if (req.method === "POST" && pathname === "/api/billing/kbzpay") {
        const auth = await requireAuth();
        const body = await readJsonBody(req);
        const plan = body.plan === "yearly" ? "yearly" : body.plan === "monthly" ? "monthly" : "";
        if (!plan) {
          return sendJson(res, 400, { error: "Plan must be 'monthly' or 'yearly'." });
        }

        const transactionId = String(body.transactionId || "").trim();
        if (!/^[A-Za-z0-9_-]{6,40}$/.test(transactionId)) {
          return sendJson(res, 400, {
            error: "Please enter a valid KBZPay Transaction ID (6–40 letters or digits).",
          });
        }

        const txIdNorm = transactionId.toUpperCase();
        const existingTx = await db.findPaymentByTransactionId(txIdNorm);
        if (existingTx) {
          return sendJson(res, 409, {
            error: "This KBZPay Transaction ID has already been submitted.",
          });
        }

        const parsedScreenshot = extractBase64FromDataUrl(body.screenshotDataUrl);
        if (!parsedScreenshot || !parsedScreenshot.base64) {
          return sendJson(res, 400, {
            error: "Please attach or capture your KBZPay payment screenshot.",
          });
        }
        const mime = String(parsedScreenshot.mimeType || "").toLowerCase();
        if (!ALLOWED_RECEIPT_MIMES.has(mime)) {
          return sendJson(res, 400, {
            error: "Receipt screenshot must be a PNG, JPEG, or WebP image.",
          });
        }
        const buffer = Buffer.from(parsedScreenshot.base64, "base64");
        if (buffer.length === 0 || buffer.length > MAX_RECEIPT_BYTES) {
          return sendJson(res, 413, {
            error: "Receipt screenshot must be under 5 MB.",
          });
        }

        const aiConfig = await db.getAdminAiConfig();
        const amountMmk = plan === "yearly" ? aiConfig.yearlyPriceMmk : aiConfig.monthlyPriceMmk;
        const paymentId = `pay_${crypto.randomUUID().slice(0, 12)}`;
        const storedReceipt = await db.saveReceiptImage(paymentId, buffer, mime);
        const nowIso = new Date().toISOString();

        const record = {
          id: paymentId,
          uid: auth.uid,
          userEmail: auth.user.email,
          userDisplayName: auth.user.displayName,
          plan,
          amountMmk,
          transactionId,
          transactionIdNorm: txIdNorm,
          referenceCode: generatePaymentRefCode(auth.uid),
          note: String(body.note || "").trim().slice(0, 300),
          storagePath: storedReceipt.storagePath,
          receiptMimeType: mime,
          receiptSize: storedReceipt.size,
          status: "pending",
          ipHash: signals.ipHash,
          geo: signals.geo,
          createdAt: nowIso,
          reviewedAt: null,
          reviewedBy: null,
          reviewNote: "",
        };

        await db.createPaymentSubmission(record);

        if (getEffectiveSubscriptionStatus(auth.user, nowIso) !== "active") {
          await db.upsertUser(auth.uid, {
            subscription: {
              ...auth.user.subscription,
              plan,
              status: "pending",
            },
          });
        }

        return sendJson(res, 201, {
          ok: true,
          submission: sanitizePaymentSubmission(record, false),
        });
      }

      // -----------------------------------------------------------------------
      // Admin Dashboard Endpoints (Strictly Admin-Only, Server-Side Paginated)
      // -----------------------------------------------------------------------
      if (req.method === "GET" && pathname === "/api/admin/overview") {
        await requireAdmin();
        const overview = await db.getAdminOverview();
        return sendJson(res, 200, overview);
      }

      if (req.method === "GET" && pathname === "/api/admin/users") {
        await requireAdmin();
        const page = Number(reqUrl.searchParams.get("page") || "1");
        const pageSize = Number(reqUrl.searchParams.get("pageSize") || "20");
        const search = reqUrl.searchParams.get("search") || "";
        const planFilter = reqUrl.searchParams.get("plan") || "all";
        const statusFilter = reqUrl.searchParams.get("status") || "all";
        const sortBy = reqUrl.searchParams.get("sortBy") || "updatedAt";
        const sortDir = reqUrl.searchParams.get("sortDir") || "desc";

        const [result, aiConfig] = await Promise.all([
          db.listUsersPaginated({
            page,
            pageSize,
            search,
            planFilter,
            statusFilter,
            sortBy,
            sortDir,
          }),
          db.getAdminAiConfig(),
        ]);

        return sendJson(res, 200, {
          ...result,
          items: result.items.map((u) => sanitizeAdminUserRow(u, aiConfig)),
        });
      }

      if (req.method === "PATCH" && pathname.startsWith("/api/admin/users/")) {
        const adminAuth = await requireAdmin();
        const targetUid = decodeURIComponent(pathname.slice("/api/admin/users/".length));
        const existing = await db.getUser(targetUid);
        if (!existing) {
          return sendJson(res, 404, { error: "User not found." });
        }

        const body = await readJsonBody(req);
        const patch = {};
        const now = new Date();
        const nowIso = now.toISOString();

        if (body.role === "admin" || body.role === "user") {
          patch.role = body.role;
        }
        if (body.status === "active" || body.status === "suspended") {
          patch.status = body.status;
        }
        if (body.resetTrials === true) {
          patch.trial = { used: 0, lastUsedAt: null };
        }
        if (body.resetQuota === true) {
          patch.quota = {
            dailyUsed: 0,
            dailyResetKey: nowIso.slice(0, 10),
            monthlyUsed: 0,
            monthlyResetKey: nowIso.slice(0, 7),
          };
        }
        if (body.grantPlan === "monthly" || body.grantPlan === "yearly") {
          const days = body.grantPlan === "yearly" ? 365 : 30;
          const existingEnd = existing.subscription?.expiresAt
            ? new Date(existing.subscription.expiresAt).getTime()
            : 0;
          const baseMs = Math.max(now.getTime(), Number.isFinite(existingEnd) ? existingEnd : 0);
          patch.subscription = {
            plan: body.grantPlan,
            status: "active",
            startedAt: existing.subscription?.startedAt || nowIso,
            expiresAt: new Date(baseMs + days * 24 * 60 * 60 * 1000).toISOString(),
            paymentId: `admin:${adminAuth.uid}`,
          };
        } else if (body.revokeSubscription === true) {
          patch.subscription = {
            ...existing.subscription,
            status: "revoked",
          };
        }

        const updated = await db.updateUserAdmin(targetUid, patch);
        const aiConfig = await db.getAdminAiConfig();
        return sendJson(res, 200, {
          ok: true,
          user: sanitizeAdminUserRow(updated, aiConfig),
        });
      }

      if (req.method === "GET" && pathname === "/api/admin/payments") {
        await requireAdmin();
        const page = Number(reqUrl.searchParams.get("page") || "1");
        const pageSize = Number(reqUrl.searchParams.get("pageSize") || "20");
        const statusFilter = reqUrl.searchParams.get("status") || "all";
        const search = reqUrl.searchParams.get("search") || "";

        const result = await db.listPaymentsPaginated({
          page,
          pageSize,
          statusFilter,
          search,
        });
        return sendJson(res, 200, {
          ...result,
          items: result.items.map((p) => sanitizePaymentSubmission(p, true)),
        });
      }

      if (
        req.method === "POST" &&
        pathname.startsWith("/api/admin/payments/") &&
        pathname.endsWith("/review")
      ) {
        const adminAuth = await requireAdmin();
        const paymentId = decodeURIComponent(
          pathname.slice("/api/admin/payments/".length, -"/review".length)
        );
        const body = await readJsonBody(req);
        const action = body.action === "approve" ? "approve" : body.action === "reject" ? "reject" : "";
        if (!action) {
          return sendJson(res, 400, { error: "Action must be 'approve' or 'reject'." });
        }

        const result = await db.reviewPaymentSubmission(paymentId, {
          action,
          reviewedBy: adminAuth.user.email || adminAuth.uid,
          reviewNote: String(body.reviewNote || "").slice(0, 300),
        });

        if (result.error === "not_found") {
          return sendJson(res, 404, { error: "Payment submission not found." });
        }
        if (result.error === "already_reviewed") {
          return sendJson(res, 409, { error: "Payment submission has already been reviewed." });
        }

        const aiConfig = await db.getAdminAiConfig();
        return sendJson(res, 200, {
          ok: true,
          payment: sanitizePaymentSubmission(result.payment, true),
          user: result.user ? sanitizeAdminUserRow(result.user, aiConfig) : null,
        });
      }

      if (req.method === "GET" && pathname.startsWith("/api/admin/receipts/")) {
        await requireAdmin();
        const paymentId = decodeURIComponent(pathname.slice("/api/admin/receipts/".length));
        const sub = await db.getPaymentSubmission(paymentId);
        if (!sub || !sub.storagePath) {
          return sendJson(res, 404, { error: "Receipt not found." });
        }
        const img = await db.readReceiptImage(sub.storagePath);
        if (!img) {
          return sendJson(res, 404, { error: "Receipt image missing from storage." });
        }
        res.writeHead(200, {
          "Content-Type": img.mimeType || sub.receiptMimeType || "image/jpeg",
          "Content-Length": img.buffer.length,
          "Cache-Control": "private, no-store",
        });
        return res.end(img.buffer);
      }

      if (pathname === "/api/admin/ai-config") {
        const adminAuth = await requireAdmin();

        if (req.method === "GET") {
          const aiConfig = await db.getAdminAiConfig();
          return sendJson(res, 200, buildAdminAiConfigResponse(aiConfig));
        }

        if (req.method === "PUT") {
          const body = await readJsonBody(req);
          const patch = {
            updatedBy: adminAuth.user.email || adminAuth.uid,
          };

          if (typeof body.managedModel === "string" && body.managedModel.trim()) {
            patch.managedModel = body.managedModel.trim().slice(0, 120);
          }
          if (typeof body.trialModel === "string" && body.trialModel.trim()) {
            patch.trialModel = body.trialModel.trim().slice(0, 120);
          }
          if (body.monthlyQuota !== undefined) {
            patch.monthlyQuota = Math.max(1, Math.min(10000, Math.round(Number(body.monthlyQuota) || 150)));
          }
          if (body.dailyQuota !== undefined) {
            patch.dailyQuota = Math.max(1, Math.min(2000, Math.round(Number(body.dailyQuota) || 15)));
          }
          if (body.monthlyPriceMmk !== undefined) {
            patch.monthlyPriceMmk = Math.max(100, Math.round(Number(body.monthlyPriceMmk) || 1000));
          }
          if (body.yearlyPriceMmk !== undefined) {
            patch.yearlyPriceMmk = Math.max(100, Math.round(Number(body.yearlyPriceMmk) || 10000));
          }
          if (body.maxTrialCount !== undefined) {
            patch.maxTrialCount = Math.max(0, Math.min(20, Math.round(Number(body.maxTrialCount) || 3)));
          }

          if (body.clearManagedKey === true) {
            patch.managedApiKeyEnc = null;
            patch.managedKeyHint = "";
          } else if (typeof body.managedApiKey === "string" && body.managedApiKey.trim()) {
            const key = body.managedApiKey.trim();
            patch.managedApiKeyEnc = encryptSecret(key, "admin:managed");
            patch.managedKeyHint = maskApiKey(key);
          }

          if (body.clearTrialKey === true) {
            patch.trialApiKeyEnc = null;
            patch.trialKeyHint = "";
          } else if (typeof body.trialApiKey === "string" && body.trialApiKey.trim()) {
            const key = body.trialApiKey.trim();
            patch.trialApiKeyEnc = encryptSecret(key, "admin:trial");
            patch.trialKeyHint = maskApiKey(key);
          }

          const updated = await db.saveAdminAiConfig(patch);
          return sendJson(res, 200, {
            ok: true,
            config: buildAdminAiConfigResponse(updated),
          });
        }
      }

      if (req.method === "POST" && pathname === "/api/admin/ai-config/test") {
        await requireAdmin();
        const body = await readJsonBody(req);
        const target = body.target === "trial" ? "trial" : "managed";
        const aiConfig = await db.getAdminAiConfig();
        const apiKey =
          (typeof body.apiKey === "string" && body.apiKey.trim()) ||
          resolveAdminSecretKey(aiConfig, target);
        const model =
          (typeof body.model === "string" && body.model.trim()) ||
          (target === "trial" ? aiConfig.trialModel : aiConfig.managedModel) ||
          "gemini-3.1-flash-lite";

        if (!apiKey) {
          return sendJson(res, 400, {
            error: `No ${target} Gemini API key configured yet.`,
          });
        }

        const result = await callUpstreamLlm({
          provider: "gemini",
          apiKey,
          model,
          baseUrl: "",
          systemPrompt: "Respond with OK.",
          conversation: [{ role: "user", content: "Ping" }],
          maxOutputTokens: 32,
          fetchImpl: llmFetch,
        });
        if (!result.ok) {
          return sendJson(res, result.status || 502, {
            ok: false,
            error: result.error,
          });
        }
        return sendJson(res, 200, {
          ok: true,
          model,
          target,
          reply: result.text || "OK",
        });
      }

      // -----------------------------------------------------------------------
      // Mind Map Endpoints (Multi-user Cloud Scoped when Authenticated)
      // -----------------------------------------------------------------------
      if (req.method === "GET" && pathname === "/api/maps") {
        const auth = await verifyAuthRequest(req, db, signals);
        if (auth.authenticated) {
          const summaries = await db.listUserMaps(auth.uid);
          return sendJson(res, 200, summaries);
        }
        if (db.isFirebaseEnabled || options.requireAuthForCloudMaps) {
          return sendJson(res, 401, {
            error: "Sign in to sync cloud maps. Guest maps are saved locally in your browser.",
          });
        }

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

      if (req.method === "POST" && pathname === "/api/maps") {
        const auth = await verifyAuthRequest(req, db, signals);
        if (!auth.authenticated && (db.isFirebaseEnabled || options.requireAuthForCloudMaps)) {
          return sendJson(res, 401, { error: "Sign in required for cloud map sync." });
        }

        const doc = await readJsonBody(req);
        const mapId = sanitizeMapId(doc.id) || `map-${crypto.randomUUID().slice(0, 8)}`;

        if (auth.authenticated) {
          const saved = await db.saveUserMap(auth.uid, mapId, doc);
          return sendJson(res, 200, saved);
        }

        const now = new Date().toISOString();
        const savedDoc = { ...doc, id: mapId, updatedAt: now };
        await fs.writeFile(
          path.join(mapsDir, `${mapId}.json`),
          JSON.stringify(savedDoc, null, 2),
          "utf8"
        );
        return sendJson(res, 200, { ok: true, id: mapId, updatedAt: now });
      }

      if (pathname.startsWith("/api/maps/")) {
        const auth = await verifyAuthRequest(req, db, signals);
        if (!auth.authenticated && (db.isFirebaseEnabled || options.requireAuthForCloudMaps)) {
          return sendJson(res, 401, { error: "Sign in required for cloud map sync." });
        }

        const rawId = decodeURIComponent(pathname.slice("/api/maps/".length));
        const mapId = sanitizeMapId(rawId);
        if (!mapId) {
          return sendJson(res, 400, { error: "Invalid map id" });
        }

        if (auth.authenticated) {
          if (req.method === "GET") {
            const doc = await db.getUserMap(auth.uid, mapId);
            if (!doc) return sendJson(res, 404, { error: "Map not found" });
            return sendJson(res, 200, doc);
          }
          if (req.method === "PUT") {
            const doc = await readJsonBody(req);
            const saved = await db.saveUserMap(auth.uid, mapId, doc);
            return sendJson(res, 200, saved);
          }
          if (req.method === "DELETE") {
            const deleted = await db.deleteUserMap(auth.uid, mapId);
            if (!deleted) return sendJson(res, 404, { error: "Map not found" });
            return sendJson(res, 200, { ok: true, id: mapId });
          }
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

      // -----------------------------------------------------------------------
      // Proxy LLM Mind Map requests: POST /api/llm/chat
      // Modes: "managed" | "trial" | "byok_vault" | "byok_session"
      // -----------------------------------------------------------------------
      if (req.method === "POST" && pathname === "/api/llm/chat") {
        const body = await readJsonBody(req);
        const headerByokKey = String(req.headers["x-byok-key"] || "").trim();
        const bodyApiKey = String(body.apiKey || "").trim();

        let mode = String(body.mode || "").trim().toLowerCase();
        if (!mode) {
          mode = headerByokKey || bodyApiKey ? "byok_session" : "trial";
        }
        if (!["managed", "trial", "byok_vault", "byok_session"].includes(mode)) {
          return sendJson(res, 400, { error: "Unsupported AI mode." });
        }

        const systemPrompt = String(body.systemPrompt || "");
        const rawMessages = Array.isArray(body.messages) ? body.messages : [];
        const conversation = rawMessages.filter(
          (m) => m && (m.role === "user" || m.role === "assistant")
        );

        let provider = String(body.provider || "openai").toLowerCase();
        let apiKey = "";
        let model = String(body.model || "").trim();
        let baseUrl = String(body.baseUrl || "").trim();
        let maxOutputTokens;
        let auth = { authenticated: false, uid: null, user: null, isAdmin: false };

        if (mode === "byok_session") {
          apiKey = headerByokKey || bodyApiKey;
          if (!apiKey) {
            return sendJson(res, 400, {
              error:
                "Missing LLM provider API key. Please add your API key in the chat settings.",
            });
          }
          if (!ALLOWED_PROVIDERS.has(provider)) {
            return sendJson(res, 400, { error: "Unsupported LLM provider." });
          }
          if (provider === "custom") {
            baseUrl = validateExternalBaseUrl(baseUrl);
          }
        } else if (mode === "byok_vault") {
          auth = await requireAuth();
          if (auth.user.status === "suspended") {
            return sendJson(res, 403, { error: "Account is suspended." });
          }
          const vault = await db.getByokVault(auth.uid);
          if (!vault || !vault.encryptedKey) {
            return sendJson(res, 400, {
              error: "No BYOK API key is saved in your Encrypted Cloud Vault.",
              code: "BYOK_NOT_CONFIGURED",
            });
          }
          apiKey = decryptSecret(vault.encryptedKey, `byok:${auth.uid}`);
          provider = String(body.provider || vault.provider || "openai").toLowerCase();
          model = model || vault.model || "";
          baseUrl = String(body.baseUrl || vault.baseUrl || "").trim();
          if (provider === "custom") {
            baseUrl = validateExternalBaseUrl(baseUrl);
          }
        } else if (mode === "trial") {
          auth = await requireAuth();
          if (auth.user.status === "suspended") {
            return sendJson(res, 403, { error: "Account is suspended." });
          }
          if (!auth.user.emailVerified) {
            return sendJson(
              res,
              403,
              {
                error:
                  "Please verify your email address before using your 3 free AI trials (or use BYOK).",
                code: "EMAIL_NOT_VERIFIED",
              },
              cookieHeaderObj
            );
          }
          if (isDisposableEmail(auth.user.email)) {
            return sendJson(
              res,
              403,
              {
                error:
                  "Disposable temporary email addresses are not eligible for free AI trials. Please sign in with a permanent email or use BYOK.",
                code: "DISPOSABLE_EMAIL",
              },
              cookieHeaderObj
            );
          }
          if (estimateAttachmentBytes(conversation) > MAX_MANAGED_ATTACHMENT_BYTES) {
            return sendJson(res, 413, {
              error: "Attachments exceed the 5 MB limit for trial AI requests.",
            });
          }

          const aiConfig = await db.getAdminAiConfig();
          const maxTrials = aiConfig.maxTrialCount ?? 3;
          const normalizedEmail = normalizeEmailForAntiAbuse(auth.user.email);
          const normalizedEmailHash = normalizedEmail ? hmacHash(normalizedEmail, "email") : "";
          const nowMs = Date.now();
          const since24hIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
          const since30dIso = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();

          const counts = await db.getTrialUsageCounts({
            uid: auth.uid,
            normalizedEmailHash,
            deviceFingerprintHash: signals.deviceFingerprintHash,
            deviceCookieHash: signals.deviceCookieHash,
            ipHash: signals.ipHash,
            since24hIso,
            since30dIso,
          });

          if ((auth.user.trial?.used || 0) >= maxTrials || counts.uidCount >= maxTrials) {
            return sendJson(
              res,
              403,
              {
                error: `You have used all ${maxTrials} free AI trials. Subscribe with KBZPay (${aiConfig.monthlyPriceMmk.toLocaleString()} MMK/mo) or switch to free BYOK.`,
                code: "TRIAL_EXHAUSTED",
              },
              cookieHeaderObj
            );
          }

          if (normalizedEmailHash && counts.normalizedEmailCount >= maxTrials) {
            return sendJson(
              res,
              403,
              {
                error:
                  "Free trial limit reached for this email address. Please subscribe or use your own BYOK key.",
                code: "TRIAL_ABUSE_EMAIL",
              },
              cookieHeaderObj
            );
          }

          if (
            (signals.deviceFingerprintHash && counts.deviceFingerprintCount >= maxTrials) ||
            (signals.deviceCookieHash && counts.deviceCookieCount >= maxTrials)
          ) {
            return sendJson(
              res,
              403,
              {
                error:
                  "Free trial limit reached on this device. Multi-account trial reuse is blocked; subscribe with KBZPay or use BYOK.",
                code: "TRIAL_ABUSE_DEVICE",
              },
              cookieHeaderObj
            );
          }

          if (counts.ip24hCount >= maxTrials || counts.ip30dCount >= maxTrials * 2) {
            return sendJson(
              res,
              429,
              {
                error:
                  "Too many free trial requests from this network/IP. Please subscribe with KBZPay or use BYOK.",
                code: "TRIAL_ABUSE_IP",
              },
              cookieHeaderObj
            );
          }

          apiKey = resolveAdminSecretKey(aiConfig, "trial");
          if (!apiKey) {
            return sendJson(res, 503, {
              error:
                "Free trial AI is temporarily unavailable (server Gemini key not configured yet). You can still use BYOK for free!",
              code: "SERVER_AI_NOT_CONFIGURED",
            });
          }

          provider = "gemini";
          model = aiConfig.trialModel || "gemini-3.1-flash-lite";
          maxOutputTokens = 4096;

          const upstreamResult = await callUpstreamLlm({
            provider,
            apiKey,
            model,
            baseUrl: "",
            systemPrompt,
            conversation,
            maxOutputTokens,
            fetchImpl: llmFetch,
          });
          if (!upstreamResult.ok) {
            return sendJson(res, upstreamResult.status || 502, {
              error: upstreamResult.error,
              providerStatus: upstreamResult.status,
              rawError: upstreamResult.rawError,
            });
          }

          const nowIso = new Date().toISOString();
          await db.recordTrialUse({
            uid: auth.uid,
            normalizedEmailHash,
            deviceFingerprintHash: signals.deviceFingerprintHash,
            deviceCookieHash: signals.deviceCookieHash,
            ipHash: signals.ipHash,
            ipPrefixHash: signals.ipPrefixHash,
            geo: signals.geo,
            model,
            createdAt: nowIso,
          });
          const nextTrialUsed = Math.max(auth.user.trial?.used || 0, counts.uidCount) + 1;
          await db.upsertUser(auth.uid, {
            trial: { used: nextTrialUsed, lastUsedAt: nowIso },
          });
          await db.recordAiUsageLog({
            uid: auth.uid,
            mode: "trial",
            provider,
            model,
            geo: signals.geo,
            createdAt: nowIso,
          });

          return sendJson(
            res,
            200,
            {
              ok: true,
              text: upstreamResult.text,
              usage: {
                mode: "trial",
                model,
                trialRemaining: Math.max(0, maxTrials - nextTrialUsed),
              },
            },
            cookieHeaderObj
          );
        } else if (mode === "managed") {
          auth = await requireAuth();
          if (auth.user.status === "suspended") {
            return sendJson(res, 403, { error: "Account is suspended." });
          }

          const aiConfig = await db.getAdminAiConfig();
          const nowIso = new Date().toISOString();
          const effectiveSubStatus = getEffectiveSubscriptionStatus(auth.user, nowIso);
          if (effectiveSubStatus !== "active") {
            return sendJson(res, 402, {
              error:
                "Active AI subscription required. Upgrade via KBZPay or use your 3 free trials / BYOK.",
              code: "SUBSCRIPTION_REQUIRED",
            });
          }

          const quota = getEffectiveQuotaUsage(auth.user, aiConfig, nowIso);
          if (quota.dailyUsed >= quota.dailyLimit) {
            return sendJson(res, 429, {
              error: `Daily fair-use limit reached (${quota.dailyLimit} messages/day). Resets at 00:00 UTC, or switch to BYOK.`,
              code: "QUOTA_EXCEEDED",
            });
          }
          if (quota.monthlyUsed >= quota.monthlyLimit) {
            return sendJson(res, 429, {
              error: `Monthly fair-use limit reached (${quota.monthlyLimit} messages/month). Switch to BYOK until next cycle.`,
              code: "QUOTA_EXCEEDED",
            });
          }

          if (estimateAttachmentBytes(conversation) > MAX_MANAGED_ATTACHMENT_BYTES) {
            return sendJson(res, 413, {
              error: "Attachments exceed the 5 MB limit for managed AI requests.",
            });
          }

          apiKey = resolveAdminSecretKey(aiConfig, "managed");
          if (!apiKey) {
            return sendJson(res, 503, {
              error: "Managed AI service key is not configured by the administrator yet.",
              code: "SERVER_AI_NOT_CONFIGURED",
            });
          }

          provider = aiConfig.managedProvider || "gemini";
          model = aiConfig.managedModel || "gemini-3.1-flash-lite";
          maxOutputTokens = 4096;

          const upstreamResult = await callUpstreamLlm({
            provider,
            apiKey,
            model,
            baseUrl: "",
            systemPrompt,
            conversation,
            maxOutputTokens,
            fetchImpl: llmFetch,
          });
          if (!upstreamResult.ok) {
            return sendJson(res, upstreamResult.status || 502, {
              error: upstreamResult.error,
              providerStatus: upstreamResult.status,
              rawError: upstreamResult.rawError,
            });
          }

          const nextDailyUsed = quota.dailyUsed + 1;
          const nextMonthlyUsed = quota.monthlyUsed + 1;
          await db.upsertUser(auth.uid, {
            quota: {
              dailyUsed: nextDailyUsed,
              dailyResetKey: quota.dayKey,
              monthlyUsed: nextMonthlyUsed,
              monthlyResetKey: quota.monthKey,
            },
          });
          await db.recordAiUsageLog({
            uid: auth.uid,
            mode: "managed",
            provider,
            model,
            geo: signals.geo,
            createdAt: nowIso,
          });

          return sendJson(
            res,
            200,
            {
              ok: true,
              text: upstreamResult.text,
              usage: {
                mode: "managed",
                model,
                dailyRemaining: Math.max(0, quota.dailyLimit - nextDailyUsed),
                monthlyRemaining: Math.max(0, quota.monthlyLimit - nextMonthlyUsed),
              },
            },
            cookieHeaderObj
          );
        }

        // BYOK execution path (byok_session & byok_vault)
        try {
          const upstreamResult = await callUpstreamLlm({
            provider,
            apiKey,
            model,
            baseUrl,
            systemPrompt,
            conversation,
            maxOutputTokens,
            fetchImpl: llmFetch,
          });
          if (!upstreamResult.ok) {
            return sendJson(res, upstreamResult.status || 502, {
              error: upstreamResult.error,
              providerStatus: upstreamResult.status,
              rawError: upstreamResult.rawError,
            });
          }
          return sendJson(
            res,
            200,
            {
              ok: true,
              text: upstreamResult.text,
              usage: { mode },
            },
            cookieHeaderObj
          );
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
        ...(err && typeof err === "object" && "code" in err && err.code ? { code: err.code } : {}),
      });
    }
  };
}
