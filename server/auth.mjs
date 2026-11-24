import crypto from "node:crypto";
import {
  DEVICE_COOKIE_NAME,
  hmacHash,
  signDeviceCookie,
  verifyDeviceCookie,
} from "./crypto.mjs";

function parseCookies(cookieHeader) {
  const result = {};
  const raw = String(cookieHeader || "");
  if (!raw) return result;
  for (const part of raw.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

function normalizeIp(rawIp) {
  let ip = String(rawIp || "").trim();
  if (!ip) return "unknown";
  if (ip.startsWith("::ffff:")) {
    ip = ip.slice("::ffff:".length);
  }
  return ip;
}

function deriveIpPrefix(ip) {
  if (!ip || ip === "unknown") return "";
  if (ip.includes(".")) {
    const parts = ip.split(".");
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return `${parts.slice(0, 4).join(":")}::/64`;
  }
  return ip;
}

/**
 * Extracts anti-abuse signals (hashed IP, IP subnet prefix, coarse geo,
 * client device fingerprint hash, and signed HttpOnly device cookie).
 */
export function extractRequestSignals(req) {
  const headers = req.headers || {};
  const trustProxy = process.env.TRUST_PROXY !== "false";

  let rawIp = req.socket?.remoteAddress || "127.0.0.1";
  if (trustProxy) {
    const cfIp = headers["cf-connecting-ip"];
    const xff = headers["x-forwarded-for"];
    const xRealIp = headers["x-real-ip"];
    if (typeof cfIp === "string" && cfIp.trim()) {
      rawIp = cfIp.trim();
    } else if (typeof xff === "string" && xff.trim()) {
      rawIp = xff.split(",")[0].trim();
    } else if (typeof xRealIp === "string" && xRealIp.trim()) {
      rawIp = xRealIp.trim();
    }
  }

  const ip = normalizeIp(rawIp);
  const ipPrefix = deriveIpPrefix(ip);
  const ipHash = hmacHash(ip, "ip");
  const ipPrefixHash = ipPrefix ? hmacHash(ipPrefix, "ip_prefix") : "";

  const country =
    String(
      headers["cf-ipcountry"] ||
        headers["x-vercel-ip-country"] ||
        headers["x-appengine-country"] ||
        headers["x-geo-country"] ||
        ""
    )
      .trim()
      .toUpperCase() || null;

  const city =
    String(
      headers["cf-ipcity"] ||
        headers["x-vercel-ip-city"] ||
        headers["x-appengine-city"] ||
        headers["x-geo-city"] ||
        ""
    ).trim() || null;

  const geo = country || city ? { country, city } : null;

  const rawFingerprint = String(headers["x-device-fingerprint"] || "").trim().slice(0, 128);
  const deviceFingerprintHash = rawFingerprint ? hmacHash(rawFingerprint, "device_fp") : "";

  const cookies = parseCookies(headers.cookie);
  let deviceCookieId = verifyDeviceCookie(cookies[DEVICE_COOKIE_NAME]);
  let setCookieHeader = null;
  if (!deviceCookieId) {
    deviceCookieId = crypto.randomUUID();
    const signed = signDeviceCookie(deviceCookieId);
    const secureFlag =
      process.env.NODE_ENV === "production" || headers["x-forwarded-proto"] === "https"
        ? "; Secure"
        : "";
    setCookieHeader = `${DEVICE_COOKIE_NAME}=${encodeURIComponent(
      signed
    )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secureFlag}`;
  }

  const deviceCookieHash = hmacHash(deviceCookieId, "device_cookie");
  const userAgent = String(headers["user-agent"] || "").slice(0, 300);

  return {
    ip,
    ipHash,
    ipPrefixHash,
    geo,
    deviceFingerprintHash,
    deviceCookieId,
    deviceCookieHash,
    userAgent,
    setCookieHeader,
  };
}

export function getAdminEmailsSet() {
  const raw = String(process.env.ADMIN_EMAILS || "");
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function decodeDevToken(token) {
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEV_AUTH === "false") {
    return null;
  }
  if (!token.startsWith("dev:")) return null;
  try {
    const payloadJson = Buffer.from(token.slice(4), "base64url").toString("utf8");
    const parsed = JSON.parse(payloadJson);
    if (!parsed || typeof parsed.uid !== "string" || !parsed.uid.trim()) return null;
    const cleanUid = parsed.uid.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
    if (!cleanUid) return null;
    return {
      uid: cleanUid,
      email: typeof parsed.email === "string" ? parsed.email.trim().toLowerCase() : "",
      displayName: typeof parsed.displayName === "string" ? parsed.displayName.trim() : "",
      photoURL: typeof parsed.photoURL === "string" ? parsed.photoURL.trim() : "",
      emailVerified: Boolean(parsed.emailVerified),
      providers: Array.isArray(parsed.providers) ? parsed.providers : ["password"],
      isAdminClaim: Boolean(parsed.isAdmin),
      isDevToken: true,
    };
  } catch {
    return null;
  }
}

/**
 * Verifies the Bearer token (Firebase ID token or dev-mode test token) and returns
 * `{ authenticated, uid, email, ... , user, isAdmin }`.
 */
export async function verifyAuthRequest(req, db, signals = null) {
  const authHeader = String(req.headers?.authorization || "").trim();
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return { authenticated: false, uid: null, user: null, isAdmin: false };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return { authenticated: false, uid: null, user: null, isAdmin: false };
  }

  let claims = null;
  const firebaseAuth = db.getFirebaseAuth?.();

  if (firebaseAuth && !token.startsWith("dev:")) {
    const decoded = await firebaseAuth.verifyIdToken(token);
    const signInProvider = decoded.firebase?.sign_in_provider;
    const providers = signInProvider ? [signInProvider] : [];
    claims = {
      uid: decoded.uid,
      email: String(decoded.email || "").trim().toLowerCase(),
      displayName: String(decoded.name || "").trim(),
      photoURL: String(decoded.picture || "").trim(),
      emailVerified: Boolean(decoded.email_verified),
      providers,
      isAdminClaim: decoded.role === "admin" || decoded.admin === true,
      isDevToken: false,
    };
  } else {
    claims = decodeDevToken(token);
  }

  if (!claims) {
    const err = new Error("Invalid or expired authentication token.");
    err.statusCode = 401;
    throw err;
  }

  const adminEmails = getAdminEmailsSet();
  const isAdminEmail = Boolean(claims.email && adminEmails.has(claims.email));
  const existing = await db.getUser(claims.uid);

  const shouldPromoteAdmin =
    isAdminEmail || (claims.isDevToken && claims.isAdminClaim);

  const now = new Date().toISOString();
  const userPatch = {
    email: claims.email || existing?.email || "",
    displayName: claims.displayName || existing?.displayName || "",
    photoURL: claims.photoURL || existing?.photoURL || "",
    emailVerified: claims.emailVerified || Boolean(existing?.emailVerified),
    providers:
      claims.providers.length > 0
        ? Array.from(new Set([...(existing?.providers || []), ...claims.providers]))
        : existing?.providers || [],
    lastSeenAt: now,
  };

  if (shouldPromoteAdmin) {
    userPatch.role = "admin";
  }
  if (signals) {
    if (signals.ipHash) userPatch.lastIpHash = signals.ipHash;
    if (signals.ipPrefixHash) userPatch.lastIpPrefixHash = signals.ipPrefixHash;
    if (signals.deviceFingerprintHash) userPatch.lastDeviceHash = signals.deviceFingerprintHash;
    if (signals.geo) userPatch.lastGeo = signals.geo;
  }

  const user = await db.upsertUser(claims.uid, userPatch);
  const isAdmin = user.role === "admin" || isAdminEmail;

  return {
    authenticated: true,
    uid: claims.uid,
    claims,
    user,
    isAdmin,
  };
}
