import crypto from "node:crypto";
import net from "node:net";

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "burnermail.io",
  "crazymailing.com",
  "discard.email",
  "dispostable.com",
  "dropmail.me",
  "emailondeck.com",
  "fakeinbox.com",
  "fakemailgenerator.com",
  "getairmail.com",
  "getnada.com",
  "guerrillamail.biz",
  "guerrillamail.com",
  "guerrillamail.de",
  "guerrillamail.info",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "harakirimail.com",
  "inboxbear.com",
  "jetable.org",
  "mailcatch.com",
  "maildrop.cc",
  "mailinator.com",
  "mailinator.net",
  "mailinator2.com",
  "mailnesia.com",
  "mintemail.com",
  "moakt.com",
  "mohmal.com",
  "mytemp.email",
  "nada.email",
  "pokemail.net",
  "sharklasers.com",
  "spam4.me",
  "spamgourmet.com",
  "temp-mail.io",
  "temp-mail.org",
  "tempail.com",
  "tempmail.com",
  "tempmail.net",
  "tempmailo.com",
  "tempr.email",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.de",
  "trashmail.me",
  "trashmail.net",
  "wegwerfmail.de",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
]);

let warnedDevFallbackKey = false;

/**
 * Derives a 32-byte AES-256 / HMAC secret from BYOK_ENCRYPTION_KEY.
 * In non-production dev/test environments, falls back to a deterministic local key
 * with a one-time warning if BYOK_ENCRYPTION_KEY is unset.
 */
export function getEncryptionKey() {
  const raw = String(process.env.BYOK_ENCRYPTION_KEY || "").trim();
  if (raw) {
    if (/^[0-9a-f]{64}$/i.test(raw)) {
      return Buffer.from(raw, "hex");
    }
    try {
      const b64 = Buffer.from(raw, "base64");
      if (b64.length === 32 && b64.toString("base64").replace(/=+$/, "") === raw.replace(/=+$/, "")) {
        return b64;
      }
    } catch {
      // Fall through to SHA-256 derivation
    }
    return crypto.createHash("sha256").update(raw, "utf8").digest();
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("BYOK_ENCRYPTION_KEY environment variable must be set in production.");
  }

  if (!warnedDevFallbackKey) {
    warnedDevFallbackKey = true;
    console.warn(
      "[security] BYOK_ENCRYPTION_KEY is not set; using deterministic local development key."
    );
  }
  return crypto
    .createHash("sha256")
    .update(`lazymindmap-local-dev-secret:${process.cwd()}`, "utf8")
    .digest();
}

/**
 * Encrypts a secret string with AES-256-GCM bound to optional AAD (e.g. `byok:<uid>`).
 */
export function encryptSecret(plaintext, aad = "") {
  const value = String(plaintext ?? "");
  if (!value) {
    throw new Error("Cannot encrypt empty secret");
  }
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  if (aad) {
    cipher.setAAD(Buffer.from(String(aad), "utf8"));
  }
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
}

/**
 * Decrypts an AES-256-GCM envelope produced by `encryptSecret`.
 */
export function decryptSecret(payload, aad = "") {
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.iv !== "string" ||
    typeof payload.authTag !== "string" ||
    typeof payload.ciphertext !== "string"
  ) {
    throw new Error("Invalid encrypted secret payload");
  }
  const key = getEncryptionKey();
  const iv = Buffer.from(payload.iv, "base64");
  const authTag = Buffer.from(payload.authTag, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  if (aad) {
    decipher.setAAD(Buffer.from(String(aad), "utf8"));
  }
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Returns a non-reversible masked key hint like `AIza••••9a2f`.
 */
export function maskApiKey(key) {
  const trimmed = String(key || "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) {
    return `••••${trimmed.slice(-2)}`;
  }
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

/**
 * Computes a keyed HMAC-SHA256 hex digest for storing privacy-preserving anti-abuse signals.
 */
export function hmacHash(value, purpose = "generic") {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  return crypto
    .createHmac("sha256", getEncryptionKey())
    .update(`${purpose}:${normalized}`)
    .digest("hex");
}

/**
 * Normalizes email addresses to detect +alias and Gmail dot-trick duplicates.
 */
export function normalizeEmailForAntiAbuse(email) {
  const raw = String(email || "").trim().toLowerCase();
  const atIdx = raw.lastIndexOf("@");
  if (atIdx <= 0) return raw;
  let local = raw.slice(0, atIdx);
  let domain = raw.slice(atIdx + 1);

  if (domain === "googlemail.com") {
    domain = "gmail.com";
  }

  const plusIdx = local.indexOf("+");
  if (plusIdx >= 0) {
    local = local.slice(0, plusIdx);
  }

  if (domain === "gmail.com") {
    local = local.replace(/\./g, "");
  }

  return `${local}@${domain}`;
}

/**
 * Rejects common throwaway / disposable temporary email domains for free trial abuse prevention.
 */
export function isDisposableEmail(email) {
  const raw = String(email || "").trim().toLowerCase();
  const atIdx = raw.lastIndexOf("@");
  if (atIdx <= 0) return false;
  const domain = raw.slice(atIdx + 1);
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return true;
  const parts = domain.split(".");
  if (parts.length > 2) {
    const parentDomain = parts.slice(-2).join(".");
    if (DISPOSABLE_EMAIL_DOMAINS.has(parentDomain)) return true;
  }
  return false;
}

function isPrivateOrBlockedIpv4(ip) {
  const parts = ip.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24
  if (a >= 224) return true; // multicast & reserved
  return false;
}

function isPrivateOrBlockedIpv6(ip) {
  const lower = ip.toLowerCase().split("%")[0];
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("::ffff:")) {
    const mapped = lower.slice("::ffff:".length);
    if (net.isIPv4(mapped)) {
      return isPrivateOrBlockedIpv4(mapped);
    }
    return true;
  }
  // Unique local addresses fc00::/7 (fc.. or fd..)
  if (/^f[cd][0-9a-f]{2}:/i.test(lower) || /^f[cd][0-9a-f]{0,2}$/i.test(lower)) return true;
  // Link-local fe80::/10 (fe8., fe9., fea., feb.)
  if (/^fe[89ab][0-9a-f]:/i.test(lower)) return true;
  return false;
}

/**
 * Validates user-supplied custom LLM Base URLs to prevent Server-Side Request Forgery (SSRF).
 * Returns the normalized URL string or throws an Error with `.statusCode = 400`.
 */
export function validateExternalBaseUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) {
    const err = new Error("Custom LLM base URL is required.");
    err.statusCode = 400;
    throw err;
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    const err = new Error("Invalid custom LLM base URL.");
    err.statusCode = 400;
    throw err;
  }

  if (parsed.username || parsed.password) {
    const err = new Error("Custom LLM base URL must not contain embedded credentials.");
    err.statusCode = 400;
    throw err;
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const allowLocal = process.env.ALLOW_LOCAL_LLM_URL === "true";

  if (parsed.protocol !== "https:") {
    const isLocalhost = host === "localhost" || host === "127.0.0.1";
    if (!(allowLocal && parsed.protocol === "http:" && isLocalhost)) {
      const err = new Error("Custom LLM base URL must use https://.");
      err.statusCode = 400;
      throw err;
    }
    return parsed.toString().replace(/\/+$/, "");
  }

  if (
    !host ||
    host === "localhost" ||
    host === "ip6-localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localdomain")
  ) {
    const err = new Error("Blocked private or internal hostname in custom LLM base URL.");
    err.statusCode = 400;
    throw err;
  }

  // Reject raw integer/hex IP encodings or single-label intranet hostnames
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host) || !host.includes(".")) {
    if (net.isIP(host) === 0) {
      const err = new Error("Custom LLM base URL must use a valid public domain name.");
      err.statusCode = 400;
      throw err;
    }
  }

  const ipType = net.isIP(host);
  if (ipType === 4 && isPrivateOrBlockedIpv4(host)) {
    const err = new Error("Blocked private or metadata IPv4 address in custom LLM base URL.");
    err.statusCode = 400;
    throw err;
  }
  if (ipType === 6 && isPrivateOrBlockedIpv6(host)) {
    const err = new Error("Blocked private or loopback IPv6 address in custom LLM base URL.");
    err.statusCode = 400;
    throw err;
  }

  return parsed.toString().replace(/\/+$/, "");
}

export const DEVICE_COOKIE_NAME = "lm_device_id";

export function signDeviceCookie(deviceId) {
  const cleanId = String(deviceId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  const sig = crypto
    .createHmac("sha256", getEncryptionKey())
    .update(`device-cookie:${cleanId}`)
    .digest("base64url");
  return `${cleanId}.${sig}`;
}

export function verifyDeviceCookie(cookieValue) {
  const raw = String(cookieValue || "").trim();
  const dotIdx = raw.lastIndexOf(".");
  if (dotIdx <= 0) return null;
  const deviceId = raw.slice(0, dotIdx);
  const sig = raw.slice(dotIdx + 1);
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(deviceId) || !sig) return null;

  const expected = crypto
    .createHmac("sha256", getEncryptionKey())
    .update(`device-cookie:${deviceId}`)
    .digest("base64url");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return deviceId;
}

export function generatePaymentRefCode(uid) {
  const digest = crypto
    .createHash("sha256")
    .update(`lm-ref:${String(uid || "guest")}`)
    .digest("hex")
    .toUpperCase();
  return `LM-${digest.slice(0, 6)}`;
}
