import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { initializeApp, cert, getApps, getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { loadServerEnv } from "./env.mjs";

export const CURATED_GEMINI_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
];

export const DEFAULT_AI_CONFIG = {
  managedProvider: "gemini",
  managedModel: "gemini-3.1-flash-lite",
  trialModel: "gemini-3.1-flash-lite",
  monthlyQuota: 150,
  dailyQuota: 15,
  monthlyPriceMmk: 1000,
  yearlyPriceMmk: 10000,
  maxTrialCount: 3,
  managedApiKeyEnc: null,
  managedKeyHint: "",
  trialApiKeyEnc: null,
  trialKeyHint: "",
  updatedAt: null,
  updatedBy: null,
};

function sanitizeId(raw) {
  return String(raw || "").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 128);
}

function getExtFromMime(mimeType) {
  const m = String(mimeType || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  return "jpg";
}

function normalizeUserRecord(uid, raw = {}) {
  const now = new Date().toISOString();
  const sub = raw.subscription && typeof raw.subscription === "object" ? raw.subscription : {};
  const trial = raw.trial && typeof raw.trial === "object" ? raw.trial : {};
  const quota = raw.quota && typeof raw.quota === "object" ? raw.quota : {};

  return {
    uid,
    email: typeof raw.email === "string" ? raw.email : "",
    displayName: typeof raw.displayName === "string" ? raw.displayName : "",
    photoURL: typeof raw.photoURL === "string" ? raw.photoURL : "",
    emailVerified: Boolean(raw.emailVerified),
    providers: Array.isArray(raw.providers) ? raw.providers.filter((p) => typeof p === "string") : [],
    role: raw.role === "admin" ? "admin" : "user",
    status: raw.status === "suspended" ? "suspended" : "active",
    subscription: {
      plan: sub.plan === "monthly" || sub.plan === "yearly" ? sub.plan : "free",
      status: ["none", "pending", "active", "expired", "revoked"].includes(sub.status)
        ? sub.status
        : "none",
      startedAt: sub.startedAt || null,
      expiresAt: sub.expiresAt || null,
      paymentId: sub.paymentId || null,
    },
    trial: {
      used: Number.isFinite(Number(trial.used)) ? Math.max(0, Number(trial.used)) : 0,
      lastUsedAt: trial.lastUsedAt || null,
    },
    quota: {
      dailyUsed: Number.isFinite(Number(quota.dailyUsed)) ? Math.max(0, Number(quota.dailyUsed)) : 0,
      dailyResetKey: typeof quota.dailyResetKey === "string" ? quota.dailyResetKey : "",
      monthlyUsed: Number.isFinite(Number(quota.monthlyUsed))
        ? Math.max(0, Number(quota.monthlyUsed))
        : 0,
      monthlyResetKey: typeof quota.monthlyResetKey === "string" ? quota.monthlyResetKey : "",
    },
    lastIpHash: typeof raw.lastIpHash === "string" ? raw.lastIpHash : "",
    lastIpPrefixHash: typeof raw.lastIpPrefixHash === "string" ? raw.lastIpPrefixHash : "",
    lastDeviceHash: typeof raw.lastDeviceHash === "string" ? raw.lastDeviceHash : "",
    lastGeo: raw.lastGeo && typeof raw.lastGeo === "object" ? raw.lastGeo : null,
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
    lastSeenAt: raw.lastSeenAt || now,
  };
}

function paginateItems(items, pageRaw, pageSizeRaw) {
  const pageSize = Math.min(100, Math.max(1, Number(pageSizeRaw) || 20));
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number(pageRaw) || 1));
  const start = (page - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);
  return {
    items: slice,
    page,
    pageSize,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

function parseFirebaseAdminConfig() {
  const jsonStr = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  const credsPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  const projectId = String(process.env.FIREBASE_PROJECT_ID || "").trim();
  const storageBucket = String(process.env.FIREBASE_STORAGE_BUCKET || "").trim();

  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      return {
        credential: cert(parsed),
        projectId: projectId || parsed.project_id,
        storageBucket: storageBucket || (parsed.project_id ? `${parsed.project_id}.firebasestorage.app` : undefined),
      };
    } catch (err) {
      console.error("[firebase-admin] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:", err);
      return null;
    }
  }

  if (credsPath && projectId) {
    return {
      projectId,
      storageBucket: storageBucket || `${projectId}.firebasestorage.app`,
    };
  }

  return null;
}

let cachedFirebase = null;

function getFirebaseAdminServices() {
  if (cachedFirebase !== null) return cachedFirebase;
  const cfg = parseFirebaseAdminConfig();
  if (!cfg) {
    cachedFirebase = { enabled: false, app: null, auth: null, firestore: null, bucket: null };
    return cachedFirebase;
  }

  const app = getApps().length > 0 ? getApp() : initializeApp(cfg);
  const auth = getAuth(app);
  const firestore = getFirestore(app);
  let bucket = null;
  try {
    const storage = getStorage(app);
    bucket = cfg.storageBucket ? storage.bucket(cfg.storageBucket) : storage.bucket();
  } catch {
    bucket = null;
  }

  cachedFirebase = { enabled: true, app, auth, firestore, bucket };
  return cachedFirebase;
}

/**
 * Creates a unified async database & receipt storage adapter.
 * Uses Cloud Firestore + Firebase Storage when Admin credentials are configured,
 * and falls back cleanly to local filesystem JSON collections in `dataDir/db` for
 * local dev and automated Vitest runs.
 */
export function createDatabase(
  dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), "data"),
  options = {}
) {
  loadServerEnv();
  const forceLocal = Boolean(options.forceLocal);
  const fb = forceLocal
    ? { enabled: false, app: null, auth: null, firestore: null, bucket: null }
    : getFirebaseAdminServices();

  const resolvedDataDir = path.resolve(dataDir);
  const dbDir = path.join(resolvedDataDir, "db");
  const userMapsDir = path.join(dbDir, "user_maps");
  const receiptsDir = path.join(resolvedDataDir, "receipts");

  let dirsPromise = null;
  function ensureLocalDirs() {
    if (!dirsPromise) {
      dirsPromise = Promise.all([
        fs.mkdir(dbDir, { recursive: true }),
        fs.mkdir(userMapsDir, { recursive: true }),
        fs.mkdir(receiptsDir, { recursive: true }),
      ]);
    }
    return dirsPromise;
  }

  // Serialized per-file write queue for local JSON mode to prevent concurrent write corruption
  const writeQueues = new Map();
  function withFileLock(key, fn) {
    const prev = writeQueues.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    writeQueues.set(
      key,
      next.catch(() => {})
    );
    return next;
  }

  async function readCollectionMap(name) {
    await ensureLocalDirs();
    const filePath = path.join(dbDir, `${name}.json`);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      if (err && err.code === "ENOENT") return {};
      throw err;
    }
  }

  async function writeCollectionMap(name, data) {
    await ensureLocalDirs();
    const filePath = path.join(dbDir, `${name}.json`);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  }

  async function mutateCollectionMap(name, mutator) {
    return withFileLock(`col:${name}`, async () => {
      const data = await readCollectionMap(name);
      const result = await mutator(data);
      await writeCollectionMap(name, data);
      return result;
    });
  }

  async function readCollectionList(name) {
    await ensureLocalDirs();
    const filePath = path.join(dbDir, `${name}.json`);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if (err && err.code === "ENOENT") return [];
      throw err;
    }
  }

  async function mutateCollectionList(name, mutator) {
    return withFileLock(`list:${name}`, async () => {
      const list = await readCollectionList(name);
      const result = await mutator(list);
      await ensureLocalDirs();
      await fs.writeFile(path.join(dbDir, `${name}.json`), JSON.stringify(list, null, 2), "utf8");
      return result;
    });
  }

  // ---------------------------------------------------------------------------
  // Firestore implementation
  // ---------------------------------------------------------------------------
  if (fb.enabled && fb.firestore) {
    const fsDb = fb.firestore;

    return {
      isFirebaseEnabled: true,
      getFirebaseAuth: () => fb.auth,

      async getUser(uid) {
        const cleanUid = sanitizeId(uid);
        if (!cleanUid) return null;
        const snap = await fsDb.collection("users").doc(cleanUid).get();
        return snap.exists ? normalizeUserRecord(cleanUid, snap.data()) : null;
      },

      async upsertUser(uid, patch = {}) {
        const cleanUid = sanitizeId(uid);
        const ref = fsDb.collection("users").doc(cleanUid);
        const now = new Date().toISOString();
        return fsDb.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const existing = snap.exists ? normalizeUserRecord(cleanUid, snap.data()) : null;
          const merged = normalizeUserRecord(cleanUid, {
            ...(existing || {}),
            ...patch,
            subscription: patch.subscription
              ? { ...(existing?.subscription || {}), ...patch.subscription }
              : existing?.subscription,
            trial: patch.trial ? { ...(existing?.trial || {}), ...patch.trial } : existing?.trial,
            quota: patch.quota ? { ...(existing?.quota || {}), ...patch.quota } : existing?.quota,
            role:
              patch.role === "admin" || existing?.role === "admin"
                ? "admin"
                : patch.role || existing?.role || "user",
            createdAt: existing?.createdAt || now,
            updatedAt: now,
            lastSeenAt: patch.lastSeenAt || now,
          });
          tx.set(ref, merged);
          return merged;
        });
      },

      async updateUserAdmin(uid, patch = {}) {
        const cleanUid = sanitizeId(uid);
        const ref = fsDb.collection("users").doc(cleanUid);
        const now = new Date().toISOString();
        return fsDb.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return null;
          const existing = normalizeUserRecord(cleanUid, snap.data());
          const merged = normalizeUserRecord(cleanUid, {
            ...existing,
            ...patch,
            subscription: patch.subscription
              ? { ...existing.subscription, ...patch.subscription }
              : existing.subscription,
            trial: patch.trial ? { ...existing.trial, ...patch.trial } : existing.trial,
            quota: patch.quota ? { ...existing.quota, ...patch.quota } : existing.quota,
            updatedAt: now,
          });
          tx.set(ref, merged);
          return merged;
        });
      },

      async listUsersPaginated({
        page = 1,
        pageSize = 20,
        search = "",
        planFilter = "all",
        statusFilter = "all",
        sortBy = "updatedAt",
        sortDir = "desc",
      } = {}) {
        const cleanPageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
        const cleanPage = Math.max(1, Number(page) || 1);
        const q = String(search || "").trim().toLowerCase();
        const dir = sortDir === "asc" ? "asc" : "desc";

        // Fast pure Firestore server-side pagination when no in-memory text search or nested filter
        if (!q && planFilter === "all" && statusFilter === "all" && sortBy === "updatedAt") {
          const col = fsDb.collection("users");
          const countSnap = await col.count().get();
          const total = countSnap.data().count || 0;
          const totalPages = Math.max(1, Math.ceil(total / cleanPageSize));
          const safePage = Math.min(totalPages, cleanPage);
          const offset = (safePage - 1) * cleanPageSize;
          const docsSnap = await col
            .orderBy("updatedAt", dir)
            .offset(offset)
            .limit(cleanPageSize)
            .get();
          return {
            items: docsSnap.docs.map((d) => normalizeUserRecord(d.id, d.data())),
            page: safePage,
            pageSize: cleanPageSize,
            total,
            totalPages,
            hasNextPage: safePage < totalPages,
            hasPrevPage: safePage > 1,
          };
        }

        const snap = await fsDb.collection("users").orderBy("updatedAt", "desc").limit(2000).get();
        let rows = snap.docs.map((d) => normalizeUserRecord(d.id, d.data()));
        rows = filterAndSortUsers(rows, { search: q, planFilter, statusFilter, sortBy, sortDir });
        return paginateItems(rows, cleanPage, cleanPageSize);
      },

      async listUserMaps(uid) {
        const cleanUid = sanitizeId(uid);
        const snap = await fsDb.collection("users").doc(cleanUid).collection("maps").get();
        const summaries = snap.docs.map((d) => {
          const doc = d.data();
          return {
            id: doc.id || d.id,
            title: doc.title || "Untitled Mind Map",
            updatedAt: doc.updatedAt || new Date().toISOString(),
            nodeCount: doc.nodes ? Object.keys(doc.nodes).length : 0,
          };
        });
        summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        return summaries;
      },

      async getUserMap(uid, mapId) {
        const cleanUid = sanitizeId(uid);
        const cleanMapId = sanitizeId(mapId);
        const snap = await fsDb
          .collection("users")
          .doc(cleanUid)
          .collection("maps")
          .doc(cleanMapId)
          .get();
        return snap.exists ? snap.data() : null;
      },

      async saveUserMap(uid, mapId, doc) {
        const cleanUid = sanitizeId(uid);
        const cleanMapId = sanitizeId(mapId);
        const now = new Date().toISOString();
        const savedDoc = { ...doc, id: cleanMapId, updatedAt: now };
        await fsDb
          .collection("users")
          .doc(cleanUid)
          .collection("maps")
          .doc(cleanMapId)
          .set(savedDoc);
        return { ok: true, id: cleanMapId, updatedAt: now };
      },

      async deleteUserMap(uid, mapId) {
        const cleanUid = sanitizeId(uid);
        const cleanMapId = sanitizeId(mapId);
        const ref = fsDb.collection("users").doc(cleanUid).collection("maps").doc(cleanMapId);
        const snap = await ref.get();
        if (!snap.exists) return false;
        await ref.delete();
        return true;
      },

      async getByokVault(uid) {
        const cleanUid = sanitizeId(uid);
        const snap = await fsDb.collection("byok_vault").doc(cleanUid).get();
        return snap.exists ? snap.data() : null;
      },

      async saveByokVault(uid, record) {
        const cleanUid = sanitizeId(uid);
        await fsDb.collection("byok_vault").doc(cleanUid).set(record);
        return record;
      },

      async deleteByokVault(uid) {
        const cleanUid = sanitizeId(uid);
        await fsDb.collection("byok_vault").doc(cleanUid).delete();
      },

      async recordTrialUse(entry) {
        const id = entry.id || `trl_${crypto.randomUUID()}`;
        const full = { ...entry, id };
        await fsDb.collection("trial_ledger").doc(id).set(full);
        return full;
      },

      async getTrialUsageCounts({
        uid,
        normalizedEmailHash,
        deviceFingerprintHash,
        deviceCookieHash,
        ipHash,
        since24hIso,
        since30dIso,
      }) {
        const col = fsDb.collection("trial_ledger");
        const countWhere = async (field, value) => {
          if (!value) return 0;
          const snap = await col.where(field, "==", value).count().get();
          return snap.data().count || 0;
        };
        const countIpSince = async (sinceIso) => {
          if (!ipHash) return 0;
          const snap = await col
            .where("ipHash", "==", ipHash)
            .where("createdAt", ">=", sinceIso)
            .count()
            .get();
          return snap.data().count || 0;
        };

        const [
          uidCount,
          normalizedEmailCount,
          deviceFingerprintCount,
          deviceCookieCount,
          ip24hCount,
          ip30dCount,
        ] = await Promise.all([
          countWhere("uid", uid),
          countWhere("normalizedEmailHash", normalizedEmailHash),
          countWhere("deviceFingerprintHash", deviceFingerprintHash),
          countWhere("deviceCookieHash", deviceCookieHash),
          countIpSince(since24hIso),
          countIpSince(since30dIso),
        ]);

        return {
          uidCount,
          normalizedEmailCount,
          deviceFingerprintCount,
          deviceCookieCount,
          ip24hCount,
          ip30dCount,
        };
      },

      async findPaymentByTransactionId(txIdNorm) {
        const snap = await fsDb
          .collection("payment_submissions")
          .where("transactionIdNorm", "==", txIdNorm)
          .limit(10)
          .get();
        const active = snap.docs
          .map((d) => d.data())
          .find((p) => p.status === "pending" || p.status === "approved");
        return active || null;
      },

      async createPaymentSubmission(record) {
        await fsDb.collection("payment_submissions").doc(record.id).set(record);
        return record;
      },

      async listUserPayments(uid) {
        const snap = await fsDb
          .collection("payment_submissions")
          .where("uid", "==", uid)
          .orderBy("createdAt", "desc")
          .limit(30)
          .get();
        return snap.docs.map((d) => d.data());
      },

      async getPaymentSubmission(id) {
        const snap = await fsDb.collection("payment_submissions").doc(sanitizeId(id)).get();
        return snap.exists ? snap.data() : null;
      },

      async reviewPaymentSubmission(id, { action, reviewedBy, reviewNote = "" }) {
        const payRef = fsDb.collection("payment_submissions").doc(sanitizeId(id));
        const now = new Date();
        const nowIso = now.toISOString();

        return fsDb.runTransaction(async (tx) => {
          const paySnap = await tx.get(payRef);
          if (!paySnap.exists) return { error: "not_found" };
          const payment = paySnap.data();
          if (payment.status !== "pending") {
            return { error: "already_reviewed", payment };
          }

          const userRef = fsDb.collection("users").doc(payment.uid);
          const userSnap = await tx.get(userRef);
          const user = userSnap.exists ? normalizeUserRecord(payment.uid, userSnap.data()) : null;

          const updatedPayment = {
            ...payment,
            status: action === "approve" ? "approved" : "rejected",
            reviewedBy,
            reviewedAt: nowIso,
            reviewNote: String(reviewNote || "").trim(),
          };
          tx.set(payRef, updatedPayment);

          let updatedUser = user;
          if (user) {
            if (action === "approve") {
              const days = payment.plan === "yearly" ? 365 : 30;
              const existingEnd = user.subscription?.expiresAt
                ? new Date(user.subscription.expiresAt).getTime()
                : 0;
              const baseMs = Math.max(now.getTime(), Number.isFinite(existingEnd) ? existingEnd : 0);
              const nextExpires = new Date(baseMs + days * 24 * 60 * 60 * 1000).toISOString();
              updatedUser = normalizeUserRecord(payment.uid, {
                ...user,
                subscription: {
                  plan: payment.plan,
                  status: "active",
                  startedAt: user.subscription?.startedAt || nowIso,
                  expiresAt: nextExpires,
                  paymentId: payment.id,
                },
                updatedAt: nowIso,
              });
              tx.set(userRef, updatedUser);
            } else if (user.subscription?.status === "pending") {
              updatedUser = normalizeUserRecord(payment.uid, {
                ...user,
                subscription: {
                  ...user.subscription,
                  status: "none",
                },
                updatedAt: nowIso,
              });
              tx.set(userRef, updatedUser);
            }
          }

          return { payment: updatedPayment, user: updatedUser };
        });
      },

      async listPaymentsPaginated({
        page = 1,
        pageSize = 20,
        statusFilter = "all",
        search = "",
      } = {}) {
        const cleanPageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
        const cleanPage = Math.max(1, Number(page) || 1);
        const q = String(search || "").trim().toLowerCase();

        if (!q) {
          let baseQuery = fsDb.collection("payment_submissions");
          if (statusFilter !== "all") {
            baseQuery = baseQuery.where("status", "==", statusFilter);
          }
          const countSnap = await baseQuery.count().get();
          const total = countSnap.data().count || 0;
          const totalPages = Math.max(1, Math.ceil(total / cleanPageSize));
          const safePage = Math.min(totalPages, cleanPage);
          const offset = (safePage - 1) * cleanPageSize;
          const snap = await baseQuery
            .orderBy("createdAt", "desc")
            .offset(offset)
            .limit(cleanPageSize)
            .get();
          return {
            items: snap.docs.map((d) => d.data()),
            page: safePage,
            pageSize: cleanPageSize,
            total,
            totalPages,
            hasNextPage: safePage < totalPages,
            hasPrevPage: safePage > 1,
          };
        }

        let snapQuery = fsDb.collection("payment_submissions").orderBy("createdAt", "desc").limit(1000);
        const snap = await snapQuery.get();
        let rows = snap.docs.map((d) => d.data());
        rows = filterPayments(rows, { statusFilter, search: q });
        return paginateItems(rows, cleanPage, cleanPageSize);
      },

      async saveReceiptImage(paymentId, buffer, mimeType) {
        const ext = getExtFromMime(mimeType);
        const filename = `${sanitizeId(paymentId)}.${ext}`;
        if (fb.bucket) {
          const objectPath = `receipts/${filename}`;
          await fb.bucket.file(objectPath).save(buffer, {
            resumable: false,
            metadata: {
              contentType: mimeType || "image/jpeg",
              cacheControl: "private, max-age=0, no-store",
            },
          });
          return { storagePath: `gs://${objectPath}`, size: buffer.length, mimeType };
        }
        await ensureLocalDirs();
        await fs.writeFile(path.join(receiptsDir, filename), buffer);
        return { storagePath: `local:${filename}`, size: buffer.length, mimeType };
      },

      async readReceiptImage(storagePath) {
        const raw = String(storagePath || "");
        if (raw.startsWith("gs://") && fb.bucket) {
          const objectPath = raw.slice("gs://".length);
          const file = fb.bucket.file(objectPath);
          const [exists] = await file.exists();
          if (!exists) return null;
          const [buffer] = await file.download();
          const [meta] = await file.getMetadata();
          return { buffer, mimeType: meta?.contentType || "image/jpeg" };
        }
        const safeName = path.basename(raw.replace(/^local:/, ""));
        if (!safeName) return null;
        try {
          const buffer = await fs.readFile(path.join(receiptsDir, safeName));
          return { buffer, mimeType: safeName.endsWith(".png") ? "image/png" : "image/jpeg" };
        } catch {
          return null;
        }
      },

      async getAdminAiConfig() {
        const snap = await fsDb.collection("admin_config").doc("ai").get();
        return { ...DEFAULT_AI_CONFIG, ...(snap.exists ? snap.data() : {}) };
      },

      async saveAdminAiConfig(patch) {
        const ref = fsDb.collection("admin_config").doc("ai");
        const current = await this.getAdminAiConfig();
        const next = {
          ...current,
          ...patch,
          updatedAt: new Date().toISOString(),
        };
        await ref.set(next);
        return next;
      },

      async recordAiUsageLog(entry) {
        const id = entry.id || `use_${crypto.randomUUID()}`;
        await fsDb.collection("ai_usage_logs").doc(id).set({ ...entry, id });
      },

      async getAdminOverview() {
        const nowIso = new Date().toISOString();
        const monthKey = nowIso.slice(0, 7);
        const dayKey = nowIso.slice(0, 10);
        const [usersSnap, pendingSnap, trialsSnap] = await Promise.all([
          fsDb.collection("users").get(),
          fsDb.collection("payment_submissions").where("status", "==", "pending").count().get(),
          fsDb.collection("trial_ledger").count().get(),
        ]);
        let activeSubscribers = 0;
        let monthlyManagedCalls = 0;
        let dailyManagedCalls = 0;
        for (const doc of usersSnap.docs) {
          const u = normalizeUserRecord(doc.id, doc.data());
          if (
            u.subscription.status === "active" &&
            u.subscription.expiresAt &&
            u.subscription.expiresAt > nowIso
          ) {
            activeSubscribers += 1;
          }
          if (u.quota.monthlyResetKey === monthKey) {
            monthlyManagedCalls += u.quota.monthlyUsed || 0;
          }
          if (u.quota.dailyResetKey === dayKey) {
            dailyManagedCalls += u.quota.dailyUsed || 0;
          }
        }
        return {
          totalUsers: usersSnap.size,
          activeSubscribers,
          pendingPayments: pendingSnap.data().count || 0,
          totalTrialsUsed: trialsSnap.data().count || 0,
          monthlyManagedCalls,
          dailyManagedCalls,
        };
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Local Filesystem JSON Adapter (Dev & Vitest fallback)
  // ---------------------------------------------------------------------------
  return {
    isFirebaseEnabled: false,
    getFirebaseAuth: () => null,

    async getUser(uid) {
      const cleanUid = sanitizeId(uid);
      if (!cleanUid) return null;
      const users = await readCollectionMap("users");
      return users[cleanUid] ? normalizeUserRecord(cleanUid, users[cleanUid]) : null;
    },

    async upsertUser(uid, patch = {}) {
      const cleanUid = sanitizeId(uid);
      const now = new Date().toISOString();
      return mutateCollectionMap("users", (users) => {
        const existing = users[cleanUid] ? normalizeUserRecord(cleanUid, users[cleanUid]) : null;
        const merged = normalizeUserRecord(cleanUid, {
          ...(existing || {}),
          ...patch,
          subscription: patch.subscription
            ? { ...(existing?.subscription || {}), ...patch.subscription }
            : existing?.subscription,
          trial: patch.trial ? { ...(existing?.trial || {}), ...patch.trial } : existing?.trial,
          quota: patch.quota ? { ...(existing?.quota || {}), ...patch.quota } : existing?.quota,
          role:
            patch.role === "admin" || existing?.role === "admin"
              ? "admin"
              : patch.role || existing?.role || "user",
          createdAt: existing?.createdAt || now,
          updatedAt: now,
          lastSeenAt: patch.lastSeenAt || now,
        });
        users[cleanUid] = merged;
        return merged;
      });
    },

    async updateUserAdmin(uid, patch = {}) {
      const cleanUid = sanitizeId(uid);
      const now = new Date().toISOString();
      return mutateCollectionMap("users", (users) => {
        if (!users[cleanUid]) return null;
        const existing = normalizeUserRecord(cleanUid, users[cleanUid]);
        const merged = normalizeUserRecord(cleanUid, {
          ...existing,
          ...patch,
          subscription: patch.subscription
            ? { ...existing.subscription, ...patch.subscription }
            : existing.subscription,
          trial: patch.trial ? { ...existing.trial, ...patch.trial } : existing.trial,
          quota: patch.quota ? { ...existing.quota, ...patch.quota } : existing.quota,
          updatedAt: now,
        });
        users[cleanUid] = merged;
        return merged;
      });
    },

    async listUsersPaginated({
      page = 1,
      pageSize = 20,
      search = "",
      planFilter = "all",
      statusFilter = "all",
      sortBy = "updatedAt",
      sortDir = "desc",
    } = {}) {
      const usersMap = await readCollectionMap("users");
      const all = Object.entries(usersMap).map(([id, raw]) => normalizeUserRecord(id, raw));
      const filtered = filterAndSortUsers(all, {
        search: String(search || "").trim().toLowerCase(),
        planFilter,
        statusFilter,
        sortBy,
        sortDir,
      });
      return paginateItems(filtered, page, pageSize);
    },

    async listUserMaps(uid) {
      await ensureLocalDirs();
      const cleanUid = sanitizeId(uid);
      const dir = path.join(userMapsDir, cleanUid);
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const summaries = [];
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
          try {
            const raw = await fs.readFile(path.join(dir, entry.name), "utf8");
            const doc = JSON.parse(raw);
            summaries.push({
              id: doc.id || entry.name.replace(/\.json$/, ""),
              title: doc.title || "Untitled Mind Map",
              updatedAt: doc.updatedAt || new Date().toISOString(),
              nodeCount: doc.nodes ? Object.keys(doc.nodes).length : 0,
            });
          } catch {
            // Skip malformed JSON
          }
        }
        summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        return summaries;
      } catch (err) {
        if (err && err.code === "ENOENT") return [];
        throw err;
      }
    },

    async getUserMap(uid, mapId) {
      await ensureLocalDirs();
      const cleanUid = sanitizeId(uid);
      const cleanMapId = sanitizeId(mapId);
      const filePath = path.join(userMapsDir, cleanUid, `${cleanMapId}.json`);
      try {
        const raw = await fs.readFile(filePath, "utf8");
        return JSON.parse(raw);
      } catch (err) {
        if (err && err.code === "ENOENT") return null;
        throw err;
      }
    },

    async saveUserMap(uid, mapId, doc) {
      await ensureLocalDirs();
      const cleanUid = sanitizeId(uid);
      const cleanMapId = sanitizeId(mapId);
      const dir = path.join(userMapsDir, cleanUid);
      await fs.mkdir(dir, { recursive: true });
      const now = new Date().toISOString();
      const savedDoc = { ...doc, id: cleanMapId, updatedAt: now };
      await fs.writeFile(
        path.join(dir, `${cleanMapId}.json`),
        JSON.stringify(savedDoc, null, 2),
        "utf8"
      );
      return { ok: true, id: cleanMapId, updatedAt: now };
    },

    async deleteUserMap(uid, mapId) {
      await ensureLocalDirs();
      const cleanUid = sanitizeId(uid);
      const cleanMapId = sanitizeId(mapId);
      const filePath = path.join(userMapsDir, cleanUid, `${cleanMapId}.json`);
      try {
        await fs.unlink(filePath);
        return true;
      } catch (err) {
        if (err && err.code === "ENOENT") return false;
        throw err;
      }
    },

    async getByokVault(uid) {
      const cleanUid = sanitizeId(uid);
      const vault = await readCollectionMap("byok_vault");
      return vault[cleanUid] || null;
    },

    async saveByokVault(uid, record) {
      const cleanUid = sanitizeId(uid);
      return mutateCollectionMap("byok_vault", (vault) => {
        vault[cleanUid] = record;
        return record;
      });
    },

    async deleteByokVault(uid) {
      const cleanUid = sanitizeId(uid);
      return mutateCollectionMap("byok_vault", (vault) => {
        delete vault[cleanUid];
      });
    },

    async recordTrialUse(entry) {
      const id = entry.id || `trl_${crypto.randomUUID()}`;
      const full = { ...entry, id };
      return mutateCollectionList("trial_ledger", (list) => {
        list.push(full);
        return full;
      });
    },

    async getTrialUsageCounts({
      uid,
      normalizedEmailHash,
      deviceFingerprintHash,
      deviceCookieHash,
      ipHash,
      since24hIso,
      since30dIso,
    }) {
      const list = await readCollectionList("trial_ledger");
      let uidCount = 0;
      let normalizedEmailCount = 0;
      let deviceFingerprintCount = 0;
      let deviceCookieCount = 0;
      let ip24hCount = 0;
      let ip30dCount = 0;

      for (const row of list) {
        if (uid && row.uid === uid) uidCount += 1;
        if (normalizedEmailHash && row.normalizedEmailHash === normalizedEmailHash) {
          normalizedEmailCount += 1;
        }
        if (deviceFingerprintHash && row.deviceFingerprintHash === deviceFingerprintHash) {
          deviceFingerprintCount += 1;
        }
        if (deviceCookieHash && row.deviceCookieHash === deviceCookieHash) {
          deviceCookieCount += 1;
        }
        if (ipHash && row.ipHash === ipHash) {
          if (row.createdAt >= since24hIso) ip24hCount += 1;
          if (row.createdAt >= since30dIso) ip30dCount += 1;
        }
      }

      return {
        uidCount,
        normalizedEmailCount,
        deviceFingerprintCount,
        deviceCookieCount,
        ip24hCount,
        ip30dCount,
      };
    },

    async findPaymentByTransactionId(txIdNorm) {
      const list = await readCollectionList("payment_submissions");
      return (
        list.find(
          (p) =>
            p.transactionIdNorm === txIdNorm &&
            (p.status === "pending" || p.status === "approved")
        ) || null
      );
    },

    async createPaymentSubmission(record) {
      return mutateCollectionList("payment_submissions", (list) => {
        list.unshift(record);
        return record;
      });
    },

    async listUserPayments(uid) {
      const list = await readCollectionList("payment_submissions");
      return list
        .filter((p) => p.uid === uid)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },

    async getPaymentSubmission(id) {
      const list = await readCollectionList("payment_submissions");
      return list.find((p) => p.id === id) || null;
    },

    async reviewPaymentSubmission(id, { action, reviewedBy, reviewNote = "" }) {
      const now = new Date();
      const nowIso = now.toISOString();

      return withFileLock("review-payment", async () => {
        const list = await readCollectionList("payment_submissions");
        const idx = list.findIndex((p) => p.id === id);
        if (idx < 0) return { error: "not_found" };
        const payment = list[idx];
        if (payment.status !== "pending") {
          return { error: "already_reviewed", payment };
        }

        const updatedPayment = {
          ...payment,
          status: action === "approve" ? "approved" : "rejected",
          reviewedBy,
          reviewedAt: nowIso,
          reviewNote: String(reviewNote || "").trim(),
        };
        list[idx] = updatedPayment;
        await ensureLocalDirs();
        await fs.writeFile(
          path.join(dbDir, "payment_submissions.json"),
          JSON.stringify(list, null, 2),
          "utf8"
        );

        const updatedUser = await mutateCollectionMap("users", (users) => {
          const existing = users[payment.uid]
            ? normalizeUserRecord(payment.uid, users[payment.uid])
            : null;
          if (!existing) return null;

          if (action === "approve") {
            const days = payment.plan === "yearly" ? 365 : 30;
            const existingEnd = existing.subscription?.expiresAt
              ? new Date(existing.subscription.expiresAt).getTime()
              : 0;
            const baseMs = Math.max(now.getTime(), Number.isFinite(existingEnd) ? existingEnd : 0);
            const nextExpires = new Date(baseMs + days * 24 * 60 * 60 * 1000).toISOString();
            const nextUser = normalizeUserRecord(payment.uid, {
              ...existing,
              subscription: {
                plan: payment.plan,
                status: "active",
                startedAt: existing.subscription?.startedAt || nowIso,
                expiresAt: nextExpires,
                paymentId: payment.id,
              },
              updatedAt: nowIso,
            });
            users[payment.uid] = nextUser;
            return nextUser;
          }

          if (existing.subscription?.status === "pending") {
            const nextUser = normalizeUserRecord(payment.uid, {
              ...existing,
              subscription: {
                ...existing.subscription,
                status: "none",
              },
              updatedAt: nowIso,
            });
            users[payment.uid] = nextUser;
            return nextUser;
          }
          return existing;
        });

        return { payment: updatedPayment, user: updatedUser };
      });
    },

    async listPaymentsPaginated({
      page = 1,
      pageSize = 20,
      statusFilter = "all",
      search = "",
    } = {}) {
      const list = await readCollectionList("payment_submissions");
      const sorted = [...list].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      const filtered = filterPayments(sorted, {
        statusFilter,
        search: String(search || "").trim().toLowerCase(),
      });
      return paginateItems(filtered, page, pageSize);
    },

    async saveReceiptImage(paymentId, buffer, mimeType) {
      await ensureLocalDirs();
      const ext = getExtFromMime(mimeType);
      const filename = `${sanitizeId(paymentId)}.${ext}`;
      await fs.writeFile(path.join(receiptsDir, filename), buffer);
      return { storagePath: `local:${filename}`, size: buffer.length, mimeType };
    },

    async readReceiptImage(storagePath) {
      await ensureLocalDirs();
      const safeName = path.basename(String(storagePath || "").replace(/^local:/, ""));
      if (!safeName) return null;
      try {
        const buffer = await fs.readFile(path.join(receiptsDir, safeName));
        const ext = path.extname(safeName).toLowerCase();
        const mimeType =
          ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
        return { buffer, mimeType };
      } catch (err) {
        if (err && err.code === "ENOENT") return null;
        throw err;
      }
    },

    async getAdminAiConfig() {
      const map = await readCollectionMap("admin_config");
      return { ...DEFAULT_AI_CONFIG, ...(map.ai || {}) };
    },

    async saveAdminAiConfig(patch) {
      return mutateCollectionMap("admin_config", (map) => {
        const current = { ...DEFAULT_AI_CONFIG, ...(map.ai || {}) };
        const next = {
          ...current,
          ...patch,
          updatedAt: new Date().toISOString(),
        };
        map.ai = next;
        return next;
      });
    },

    async recordAiUsageLog(entry) {
      const id = entry.id || `use_${crypto.randomUUID()}`;
      return mutateCollectionList("ai_usage_logs", (list) => {
        list.push({ ...entry, id });
        if (list.length > 5000) list.splice(0, list.length - 5000);
      });
    },

    async getAdminOverview() {
      const nowIso = new Date().toISOString();
      const monthKey = nowIso.slice(0, 7);
      const dayKey = nowIso.slice(0, 10);
      const [usersMap, payments, trials] = await Promise.all([
        readCollectionMap("users"),
        readCollectionList("payment_submissions"),
        readCollectionList("trial_ledger"),
      ]);
      const users = Object.entries(usersMap).map(([id, raw]) => normalizeUserRecord(id, raw));
      let activeSubscribers = 0;
      let monthlyManagedCalls = 0;
      let dailyManagedCalls = 0;
      for (const u of users) {
        if (
          u.subscription.status === "active" &&
          u.subscription.expiresAt &&
          u.subscription.expiresAt > nowIso
        ) {
          activeSubscribers += 1;
        }
        if (u.quota.monthlyResetKey === monthKey) {
          monthlyManagedCalls += u.quota.monthlyUsed || 0;
        }
        if (u.quota.dailyResetKey === dayKey) {
          dailyManagedCalls += u.quota.dailyUsed || 0;
        }
      }
      return {
        totalUsers: users.length,
        activeSubscribers,
        pendingPayments: payments.filter((p) => p.status === "pending").length,
        totalTrialsUsed: trials.length,
        monthlyManagedCalls,
        dailyManagedCalls,
      };
    },
  };
}

function filterAndSortUsers(rows, { search, planFilter, statusFilter, sortBy, sortDir }) {
  const filtered = rows.filter((u) => {
    if (planFilter && planFilter !== "all") {
      if (planFilter === "admin") {
        if (u.role !== "admin") return false;
      } else if (u.subscription.plan !== planFilter) {
        return false;
      }
    }
    if (statusFilter && statusFilter !== "all") {
      if (statusFilter === "suspended" || statusFilter === "active_account") {
        const want = statusFilter === "suspended" ? "suspended" : "active";
        if (u.status !== want) return false;
      } else if (u.subscription.status !== statusFilter) {
        return false;
      }
    }
    if (search) {
      const hay = `${u.uid} ${u.email} ${u.displayName}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const dirMult = sortDir === "asc" ? 1 : -1;
  filtered.sort((a, b) => {
    if (sortBy === "email") return a.email.localeCompare(b.email) * dirMult;
    if (sortBy === "trialUsed") return ((a.trial.used || 0) - (b.trial.used || 0)) * dirMult;
    if (sortBy === "monthlyUsed") {
      return ((a.quota.monthlyUsed || 0) - (b.quota.monthlyUsed || 0)) * dirMult;
    }
    return (
      (new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime()) * dirMult
    );
  });
  return filtered;
}

function filterPayments(rows, { statusFilter, search }) {
  return rows.filter((p) => {
    if (statusFilter && statusFilter !== "all" && p.status !== statusFilter) return false;
    if (search) {
      const hay = `${p.id} ${p.uid} ${p.userEmail || ""} ${p.transactionId || ""} ${
        p.referenceCode || ""
      }`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}
