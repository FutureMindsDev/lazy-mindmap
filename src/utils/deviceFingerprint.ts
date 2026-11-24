const DEVICE_IDB_NAME = "lazymindmap_device";
const DEVICE_IDB_STORE = "meta";
const DEVICE_IDB_KEY = "device_token";
const DEVICE_LS_KEY = "lazymindmap:deviceToken";

let cachedFingerprintPromise: Promise<string> | null = null;

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle && typeof TextEncoder !== "undefined") {
    const bytes = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Lightweight non-crypto fallback for minimal test DOMs lacking crypto.subtle
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv_${(hash >>> 0).toString(16)}`;
}

async function getOrCreatePersistentDeviceToken(): Promise<string> {
  if (typeof window === "undefined") return "ssr";

  const makeToken = () =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

  // 1. Check IndexedDB
  if (typeof indexedDB !== "undefined") {
    try {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DEVICE_IDB_NAME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(DEVICE_IDB_STORE)) {
            req.result.createObjectStore(DEVICE_IDB_STORE);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      const existing = await new Promise<string | null>((resolve) => {
        const tx = db.transaction(DEVICE_IDB_STORE, "readonly");
        const req = tx.objectStore(DEVICE_IDB_STORE).get(DEVICE_IDB_KEY);
        req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : null);
        req.onerror = () => resolve(null);
      });

      if (existing) return existing;

      let seed = "";
      try {
        seed = localStorage.getItem(DEVICE_LS_KEY) || "";
      } catch {}
      const token = seed || makeToken();

      await new Promise<void>((resolve) => {
        const tx = db.transaction(DEVICE_IDB_STORE, "readwrite");
        tx.objectStore(DEVICE_IDB_STORE).put(token, DEVICE_IDB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      try {
        localStorage.setItem(DEVICE_LS_KEY, token);
      } catch {}
      return token;
    } catch {
      // Fallback to localStorage below
    }
  }

  try {
    const existing = localStorage.getItem(DEVICE_LS_KEY);
    if (existing) return existing;
    const token = makeToken();
    localStorage.setItem(DEVICE_LS_KEY, token);
    return token;
  } catch {
    return "ephemeral";
  }
}

function getCanvasSignal(): string {
  try {
    if (typeof document === "undefined") return "no-doc";
    const canvas = document.createElement("canvas");
    canvas.width = 180;
    canvas.height = 40;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "no-2d";
    ctx.textBaseline = "top";
    ctx.font = "14px Arial, sans-serif";
    ctx.fillStyle = "#f60";
    ctx.fillRect(10, 4, 50, 20);
    ctx.fillStyle = "#069";
    ctx.fillText("LazyMindmap-FP", 4, 8);
    return canvas.toDataURL().slice(-64);
  } catch {
    return "canvas-err";
  }
}

function getWebGlSignal(): string {
  try {
    if (typeof document === "undefined") return "no-doc";
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return "no-webgl";
    const webgl = gl as WebGLRenderingContext;
    const dbg = webgl.getExtension("WEBGL_debug_renderer_info");
    if (!dbg) return String(webgl.getParameter(webgl.RENDERER) || "webgl");
    const vendor = webgl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
    const renderer = webgl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
    return `${vendor || ""}|${renderer || ""}`;
  } catch {
    return "webgl-err";
  }
}

/**
 * Computes a deterministic client device fingerprint hash combining hardware/browser
 * signals and a persistent IndexedDB device token to help block multi-account trial abuse.
 */
export function getDeviceFingerprint(): Promise<string> {
  if (typeof window === "undefined") return Promise.resolve("");
  if (cachedFingerprintPromise) return cachedFingerprintPromise;

  cachedFingerprintPromise = (async () => {
    const persistentToken = await getOrCreatePersistentDeviceToken();
    const tz =
      typeof Intl !== "undefined"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone || ""
        : "";
    const screenSig =
      typeof screen !== "undefined"
        ? `${screen.width}x${screen.height}x${screen.colorDepth}@${window.devicePixelRatio || 1}`
        : "";
    const navSig =
      typeof navigator !== "undefined"
        ? `${navigator.platform || ""}|${navigator.language || ""}|${
            navigator.hardwareConcurrency || 0
          }|${navigator.maxTouchPoints || 0}`
        : "";

    const raw = [
      persistentToken,
      tz,
      screenSig,
      navSig,
      getCanvasSignal(),
      getWebGlSignal(),
    ].join("::");
    return sha256Hex(raw);
  })();

  return cachedFingerprintPromise;
}
