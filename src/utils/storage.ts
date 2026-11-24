import type { MapSummary, MindMapDocument } from "../types/mindmap";
import { getDeviceFingerprint } from "./deviceFingerprint";

const BASE_DB_NAME = "lazymindmap_db";
const DB_VERSION = 1;
const STORE_NAME = "maps";
const BASE_LAST_MAP_KEY = "lazymindmap:lastMapId";

let activeUserScope: string | null = null;
let authTokenProvider: (() => Promise<string | null>) | null = null;

export function setStorageUserScope(uid: string | null): void {
  activeUserScope = uid && uid.trim() ? uid.trim() : null;
}

export function setStorageAuthTokenProvider(fn: (() => Promise<string | null>) | null): void {
  authTokenProvider = fn;
}

function getDbName(): string {
  return activeUserScope ? `${BASE_DB_NAME}_${activeUserScope}` : BASE_DB_NAME;
}

function getLastMapKey(): string {
  return activeUserScope ? `${BASE_LAST_MAP_KEY}:${activeUserScope}` : BASE_LAST_MAP_KEY;
}

function getLsMapKey(id: string): string {
  return activeUserScope ? `lazymindmap:map:${activeUserScope}:${id}` : `lazymindmap:map:${id}`;
}

async function buildApiHeaders(includeJson = false): Promise<{
  headers: Record<string, string>;
  hasAuth: boolean;
}> {
  const headers: Record<string, string> = {};
  if (includeJson) headers["Content-Type"] = "application/json";
  let token: string | null = null;
  if (authTokenProvider) {
    try {
      token = await authTokenProvider();
    } catch {
      token = null;
    }
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  try {
    const fp = await getDeviceFingerprint();
    if (fp) headers["X-Device-Fingerprint"] = fp;
  } catch {}
  return { headers, hasAuth: Boolean(token) };
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(getDbName(), DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSaveMap(doc: MindMapDocument): Promise<{ localSaved: boolean; error?: string }> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(doc);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    try {
      localStorage.setItem(getLastMapKey(), doc.id);
    } catch {}
    return { localSaved: true };
  } catch (idbErr) {
    // Fallback to localStorage if IndexedDB fails in private browsing
    try {
      localStorage.setItem(getLsMapKey(doc.id), JSON.stringify(doc));
      localStorage.setItem(getLastMapKey(), doc.id);
      return { localSaved: true };
    } catch (lsErr) {
      const msg =
        lsErr instanceof Error
          ? lsErr.message
          : idbErr instanceof Error
          ? idbErr.message
          : "Local browser storage failed";
      return { localSaved: false, error: msg };
    }
  }
}

export async function idbGetMap(id: string): Promise<MindMapDocument | null> {
  try {
    const db = await openIdb();
    return await new Promise<MindMapDocument | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve((req.result as MindMapDocument) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    try {
      const raw = localStorage.getItem(getLsMapKey(id));
      return raw ? (JSON.parse(raw) as MindMapDocument) : null;
    } catch {
      return null;
    }
  }
}

export async function idbListMaps(): Promise<MapSummary[]> {
  try {
    const db = await openIdb();
    const docs = await new Promise<MindMapDocument[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as MindMapDocument[]) || []);
      req.onerror = () => reject(req.error);
    });
    return docs
      .map((d) => ({
        id: d.id,
        title: d.title,
        updatedAt: d.updatedAt,
        nodeCount: Object.keys(d.nodes || {}).length,
      }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  } catch {
    return [];
  }
}

export async function idbDeleteMap(id: string): Promise<void> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
  try {
    localStorage.removeItem(getLsMapKey(id));
  } catch {}
}

export function getLastOpenedMapId(): string | null {
  try {
    return localStorage.getItem(getLastMapKey());
  } catch {
    return null;
  }
}

export interface DualSaveResult {
  ok: boolean;
  backendSynced: boolean;
  localSaved: boolean;
  error?: string;
}

export async function saveMapDual(doc: MindMapDocument): Promise<DualSaveResult> {
  const localRes = await idbSaveMap(doc);
  try {
    const { headers, hasAuth } = await buildApiHeaders(true);
    const res = await fetch(`/api/maps/${encodeURIComponent(doc.id)}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(doc),
    });

    // Guests in Firebase cloud mode save 100% locally in browser for free without error banners
    if (!hasAuth && res.status === 401) {
      return {
        ok: localRes.localSaved,
        backendSynced: false,
        localSaved: localRes.localSaved,
        error: localRes.localSaved ? undefined : localRes.error,
      };
    }

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) detail = body.error;
      } catch {}
      return {
        ok: false,
        backendSynced: false,
        localSaved: localRes.localSaved,
        error: localRes.localSaved
          ? `Server save failed (${detail}); cached locally in browser.`
          : `Save failed on server (${detail}) and browser storage (${localRes.error || "unavailable"}).`,
      };
    }
    if (!localRes.localSaved) {
      return {
        ok: true,
        backendSynced: true,
        localSaved: false,
        error: `Saved to server, but local cache failed (${localRes.error || "unavailable"}).`,
      };
    }
    return { ok: true, backendSynced: true, localSaved: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Server unreachable";
    return {
      ok: false,
      backendSynced: false,
      localSaved: localRes.localSaved,
      error: localRes.localSaved
        ? `Server unreachable (${detail}); changes cached locally.`
        : `Save failed completely: server unreachable (${detail}) and local storage failed.`,
    };
  }
}

export async function listMapsDual(): Promise<{ summaries: MapSummary[]; backendOnline: boolean }> {
  const local = await idbListMaps();
  try {
    const { headers, hasAuth } = await buildApiHeaders(false);
    const res = await fetch("/api/maps", { headers });
    if (!hasAuth && res.status === 401) {
      return { summaries: local, backendOnline: false };
    }
    if (!res.ok) throw new Error("API error");
    const remote = (await res.json()) as MapSummary[];

    const merged = new Map<string, MapSummary>();
    for (const item of local) merged.set(item.id, item);
    for (const item of remote) {
      const existing = merged.get(item.id);
      if (
        !existing ||
        new Date(item.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()
      ) {
        merged.set(item.id, item);
      }
    }

    const sorted = Array.from(merged.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    return { summaries: sorted, backendOnline: true };
  } catch {
    return { summaries: local, backendOnline: false };
  }
}

export async function loadMapDual(id: string): Promise<MindMapDocument | null> {
  const local = await idbGetMap(id);
  try {
    const { headers } = await buildApiHeaders(false);
    const res = await fetch(`/api/maps/${encodeURIComponent(id)}`, { headers });
    if (!res.ok) return local;
    const remote = (await res.json()) as MindMapDocument;
    if (!local || new Date(remote.updatedAt).getTime() >= new Date(local.updatedAt).getTime()) {
      await idbSaveMap(remote);
      return remote;
    }
    return local;
  } catch {
    return local;
  }
}

export async function deleteMapDual(id: string): Promise<void> {
  await idbDeleteMap(id);
  try {
    const { headers } = await buildApiHeaders(false);
    await fetch(`/api/maps/${encodeURIComponent(id)}`, { method: "DELETE", headers });
  } catch {}
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Uploads a photo or attachment to the Docker backend volume (/api/uploads)
 * and gracefully falls back to an inline data URL when running offline.
 */
export async function uploadFileDual(file: File): Promise<{
  url: string;
  name: string;
  mimeType: string;
  size: number;
  storedOnServer: boolean;
}> {
  const dataUrl = await fileToDataUrl(file);
  try {
    const res = await fetch("/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: file.name || "pasted-file",
        mimeType: file.type || "application/octet-stream",
        dataUrl,
      }),
    });
    if (!res.ok) throw new Error("Upload rejected");
    const json = (await res.json()) as {
      url: string;
      name: string;
      size: number;
      mimeType: string;
    };
    return {
      url: json.url,
      name: json.name,
      mimeType: json.mimeType,
      size: json.size,
      storedOnServer: true,
    };
  } catch {
    return {
      url: dataUrl,
      name: file.name || "pasted-file",
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      storedOnServer: false,
    };
  }
}
