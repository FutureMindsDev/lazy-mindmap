import crypto from "node:crypto";
import { Binary, MongoClient } from "mongodb";
import { DEFAULT_AI_CONFIG, normalizeUserRecord, sanitizeId } from "./db.mjs";

const clientCache = new Map();

function escapeRegex(str) {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripMongoId(doc) {
  if (!doc || typeof doc !== "object") return doc;
  const { _id, ...rest } = doc;
  return rest;
}

function getOrCreateMongoClient(uri) {
  let entry = clientCache.get(uri);
  if (!entry) {
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
    });
    entry = {
      client,
      connectPromise: null,
      indexesReady: false,
      indexPromise: null,
    };
    clientCache.set(uri, entry);
  }
  return entry;
}

/**
 * Creates an async database & receipt storage adapter backed by MongoDB Atlas (M0 free tier)
 * paired with Firebase Auth token verification.
 */
export function createMongoDatabase({
  uri,
  dbName = "lazymindmap",
  firebaseAuth = null,
  client: injectedClient = null,
} = {}) {
  let localEntry = injectedClient
    ? {
        client: injectedClient,
        connectPromise: Promise.resolve(injectedClient),
        indexesReady: false,
        indexPromise: null,
      }
    : null;

  async function getDb() {
    const entry = localEntry || getOrCreateMongoClient(uri);
    if (!entry.connectPromise) {
      entry.connectPromise = entry.client.connect().catch((err) => {
        entry.connectPromise = null;
        throw err;
      });
    }
    await entry.connectPromise;
    const db = entry.client.db(dbName);

    if (!entry.indexesReady) {
      if (!entry.indexPromise) {
        entry.indexPromise = ensureIndexes(db)
          .then(() => {
            entry.indexesReady = true;
          })
          .catch(() => {
            // Allow retry on transient startup error without crashing requests
            entry.indexPromise = null;
          });
      }
      await entry.indexPromise;
    }

    return db;
  }

  async function ensureIndexes(db) {
    await Promise.all([
      db.collection("users").createIndex({ uid: 1 }, { unique: true }),
      db.collection("users").createIndex({ email: 1 }),
      db.collection("users").createIndex({ status: 1, updatedAt: -1 }),
      db.collection("user_maps").createIndex({ uid: 1, id: 1 }, { unique: true }),
      db.collection("user_maps").createIndex({ uid: 1, updatedAt: -1 }),
      db.collection("byok_vault").createIndex({ uid: 1 }, { unique: true }),
      db.collection("trial_ledger").createIndex({ uid: 1 }),
      db.collection("trial_ledger").createIndex({ normalizedEmailHash: 1 }),
      db.collection("trial_ledger").createIndex({ deviceFingerprintHash: 1 }),
      db.collection("trial_ledger").createIndex({ deviceCookieHash: 1 }),
      db.collection("trial_ledger").createIndex({ ipHash: 1, createdAt: -1 }),
      db.collection("payment_submissions").createIndex({ id: 1 }, { unique: true }),
      db.collection("payment_submissions").createIndex({ transactionIdNorm: 1 }),
      db.collection("payment_submissions").createIndex({ status: 1, createdAt: -1 }),
      db.collection("payment_submissions").createIndex({ uid: 1, createdAt: -1 }),
      db.collection("payment_receipts").createIndex({ paymentId: 1 }, { unique: true }),
      db
        .collection("payment_receipts")
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection("admin_config").createIndex({ key: 1 }, { unique: true }),
      db
        .collection("ai_usage_logs")
        .createIndex({ createdAtDate: 1 }, { expireAfterSeconds: 7776000 }),
    ]);
  }

  return {
    dbBackend: "mongodb",
    isFirebaseEnabled: Boolean(firebaseAuth),
    getFirebaseAuth: () => firebaseAuth || null,

    async getUser(uid) {
      const cleanUid = sanitizeId(uid);
      if (!cleanUid) return null;
      const db = await getDb();
      const doc = await db.collection("users").findOne({ uid: cleanUid });
      return doc ? normalizeUserRecord(cleanUid, stripMongoId(doc)) : null;
    },

    async upsertUser(uid, patch = {}) {
      const cleanUid = sanitizeId(uid);
      const db = await getDb();
      const col = db.collection("users");
      const now = new Date().toISOString();
      const existingRaw = await col.findOne({ uid: cleanUid });
      const existing = existingRaw ? normalizeUserRecord(cleanUid, stripMongoId(existingRaw)) : null;

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

      await col.updateOne({ uid: cleanUid }, { $set: merged }, { upsert: true });
      return merged;
    },

    async updateUserAdmin(uid, patch = {}) {
      const cleanUid = sanitizeId(uid);
      const db = await getDb();
      const col = db.collection("users");
      const existingRaw = await col.findOne({ uid: cleanUid });
      if (!existingRaw) return null;
      const existing = normalizeUserRecord(cleanUid, stripMongoId(existingRaw));
      const now = new Date().toISOString();

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

      await col.updateOne({ uid: cleanUid }, { $set: merged });
      return merged;
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
      const db = await getDb();
      const col = db.collection("users");
      const cleanPageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
      const cleanPage = Math.max(1, Number(page) || 1);

      const query = {};
      if (planFilter && planFilter !== "all") {
        if (planFilter === "admin") {
          query.role = "admin";
        } else {
          query["subscription.plan"] = planFilter;
        }
      }
      if (statusFilter && statusFilter !== "all") {
        if (statusFilter === "suspended" || statusFilter === "active_account") {
          query.status = statusFilter === "suspended" ? "suspended" : "active";
        } else {
          query["subscription.status"] = statusFilter;
        }
      }
      const q = String(search || "").trim();
      if (q) {
        const rx = new RegExp(escapeRegex(q), "i");
        query.$or = [{ uid: rx }, { email: rx }, { displayName: rx }];
      }

      const dir = sortDir === "asc" ? 1 : -1;
      const sortField =
        sortBy === "email"
          ? "email"
          : sortBy === "trialUsed"
          ? "trial.used"
          : sortBy === "monthlyUsed"
          ? "quota.monthlyUsed"
          : "updatedAt";

      const total = await col.countDocuments(query);
      const totalPages = Math.max(1, Math.ceil(total / cleanPageSize));
      const safePage = Math.min(totalPages, cleanPage);
      const skip = (safePage - 1) * cleanPageSize;

      const docs = await col
        .find(query)
        .sort({ [sortField]: dir })
        .skip(skip)
        .limit(cleanPageSize)
        .toArray();

      return {
        items: docs.map((d) => normalizeUserRecord(d.uid, stripMongoId(d))),
        page: safePage,
        pageSize: cleanPageSize,
        total,
        totalPages,
        hasNextPage: safePage < totalPages,
        hasPrevPage: safePage > 1,
      };
    },

    async listUserMaps(uid) {
      const cleanUid = sanitizeId(uid);
      const db = await getDb();
      const docs = await db
        .collection("user_maps")
        .find({ uid: cleanUid })
        .sort({ updatedAt: -1 })
        .toArray();
      return docs.map((doc) => ({
        id: doc.id,
        title: doc.title || "Untitled Mind Map",
        updatedAt: doc.updatedAt || new Date().toISOString(),
        nodeCount: doc.nodes ? Object.keys(doc.nodes).length : 0,
      }));
    },

    async getUserMap(uid, mapId) {
      const cleanUid = sanitizeId(uid);
      const cleanMapId = sanitizeId(mapId);
      const db = await getDb();
      const doc = await db.collection("user_maps").findOne({ uid: cleanUid, id: cleanMapId });
      if (!doc) return null;
      const cleaned = stripMongoId(doc);
      delete cleaned.uid;
      return cleaned;
    },

    async saveUserMap(uid, mapId, doc) {
      const cleanUid = sanitizeId(uid);
      const cleanMapId = sanitizeId(mapId);
      const db = await getDb();
      const now = new Date().toISOString();
      const savedDoc = { ...doc, id: cleanMapId, uid: cleanUid, updatedAt: now };
      await db
        .collection("user_maps")
        .updateOne({ uid: cleanUid, id: cleanMapId }, { $set: savedDoc }, { upsert: true });
      return { ok: true, id: cleanMapId, updatedAt: now };
    },

    async deleteUserMap(uid, mapId) {
      const cleanUid = sanitizeId(uid);
      const cleanMapId = sanitizeId(mapId);
      const db = await getDb();
      const res = await db.collection("user_maps").deleteOne({ uid: cleanUid, id: cleanMapId });
      return (res.deletedCount || 0) > 0;
    },

    async getByokVault(uid) {
      const cleanUid = sanitizeId(uid);
      const db = await getDb();
      const doc = await db.collection("byok_vault").findOne({ uid: cleanUid });
      return doc ? stripMongoId(doc) : null;
    },

    async saveByokVault(uid, record) {
      const cleanUid = sanitizeId(uid);
      const db = await getDb();
      await db
        .collection("byok_vault")
        .updateOne({ uid: cleanUid }, { $set: { ...record, uid: cleanUid } }, { upsert: true });
      return record;
    },

    async deleteByokVault(uid) {
      const cleanUid = sanitizeId(uid);
      const db = await getDb();
      await db.collection("byok_vault").deleteOne({ uid: cleanUid });
    },

    async recordTrialUse(entry) {
      const id = entry.id || `trl_${crypto.randomUUID()}`;
      const full = { ...entry, id };
      const db = await getDb();
      await db.collection("trial_ledger").insertOne({ ...full });
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
      const db = await getDb();
      const col = db.collection("trial_ledger");
      const countField = (field, val) => (val ? col.countDocuments({ [field]: val }) : Promise.resolve(0));

      const [
        uidCount,
        normalizedEmailCount,
        deviceFingerprintCount,
        deviceCookieCount,
        ip24hCount,
        ip30dCount,
      ] = await Promise.all([
        countField("uid", uid),
        countField("normalizedEmailHash", normalizedEmailHash),
        countField("deviceFingerprintHash", deviceFingerprintHash),
        countField("deviceCookieHash", deviceCookieHash),
        ipHash ? col.countDocuments({ ipHash, createdAt: { $gte: since24hIso } }) : Promise.resolve(0),
        ipHash ? col.countDocuments({ ipHash, createdAt: { $gte: since30dIso } }) : Promise.resolve(0),
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
      const db = await getDb();
      const doc = await db.collection("payment_submissions").findOne({
        transactionIdNorm: txIdNorm,
        status: { $in: ["pending", "approved"] },
      });
      return doc ? stripMongoId(doc) : null;
    },

    async createPaymentSubmission(record) {
      const db = await getDb();
      await db.collection("payment_submissions").insertOne({ ...record });
      return record;
    },

    async listUserPayments(uid) {
      const db = await getDb();
      const docs = await db
        .collection("payment_submissions")
        .find({ uid })
        .sort({ createdAt: -1 })
        .limit(30)
        .toArray();
      return docs.map(stripMongoId);
    },

    async getPaymentSubmission(id) {
      const cleanId = sanitizeId(id);
      const db = await getDb();
      const doc = await db.collection("payment_submissions").findOne({ id: cleanId });
      return doc ? stripMongoId(doc) : null;
    },

    async reviewPaymentSubmission(id, { action, reviewedBy, reviewNote = "" }) {
      const cleanId = sanitizeId(id);
      const db = await getDb();
      const payCol = db.collection("payment_submissions");
      const existing = await payCol.findOne({ id: cleanId });
      if (!existing) return { error: "not_found" };
      if (existing.status !== "pending") {
        return { error: "already_reviewed", payment: stripMongoId(existing) };
      }

      const now = new Date();
      const nowIso = now.toISOString();
      const nextStatus = action === "approve" ? "approved" : "rejected";
      const cleanNote = String(reviewNote || "").trim();

      const res = await payCol.findOneAndUpdate(
        { id: cleanId, status: "pending" },
        {
          $set: {
            status: nextStatus,
            reviewedBy,
            reviewedAt: nowIso,
            reviewNote: cleanNote,
          },
        },
        { returnDocument: "after" }
      );
      const updatedDoc = res && typeof res === "object" && "value" in res ? res.value : res;
      if (!updatedDoc) {
        return { error: "already_reviewed" };
      }
      const updatedPayment = stripMongoId(updatedDoc);

      const userCol = db.collection("users");
      const userRaw = await userCol.findOne({ uid: updatedPayment.uid });
      let updatedUser = userRaw ? normalizeUserRecord(updatedPayment.uid, stripMongoId(userRaw)) : null;

      if (updatedUser) {
        if (action === "approve") {
          const days = updatedPayment.plan === "yearly" ? 365 : 30;
          const existingEnd = updatedUser.subscription?.expiresAt
            ? new Date(updatedUser.subscription.expiresAt).getTime()
            : 0;
          const baseMs = Math.max(now.getTime(), Number.isFinite(existingEnd) ? existingEnd : 0);
          const nextExpires = new Date(baseMs + days * 24 * 60 * 60 * 1000).toISOString();
          updatedUser = normalizeUserRecord(updatedPayment.uid, {
            ...updatedUser,
            subscription: {
              plan: updatedPayment.plan,
              status: "active",
              startedAt: updatedUser.subscription?.startedAt || nowIso,
              expiresAt: nextExpires,
              paymentId: updatedPayment.id,
            },
            updatedAt: nowIso,
          });
          await userCol.updateOne({ uid: updatedPayment.uid }, { $set: updatedUser });
        } else if (updatedUser.subscription?.status === "pending") {
          updatedUser = normalizeUserRecord(updatedPayment.uid, {
            ...updatedUser,
            subscription: {
              ...updatedUser.subscription,
              status: "none",
            },
            updatedAt: nowIso,
          });
          await userCol.updateOne({ uid: updatedPayment.uid }, { $set: updatedUser });
        }
      }

      return { payment: updatedPayment, user: updatedUser };
    },

    async listPaymentsPaginated({
      page = 1,
      pageSize = 20,
      statusFilter = "all",
      search = "",
    } = {}) {
      const db = await getDb();
      const col = db.collection("payment_submissions");
      const cleanPageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
      const cleanPage = Math.max(1, Number(page) || 1);

      const query = {};
      if (statusFilter && statusFilter !== "all") {
        query.status = statusFilter;
      }
      const q = String(search || "").trim();
      if (q) {
        const rx = new RegExp(escapeRegex(q), "i");
        query.$or = [
          { id: rx },
          { uid: rx },
          { userEmail: rx },
          { transactionId: rx },
          { referenceCode: rx },
        ];
      }

      const total = await col.countDocuments(query);
      const totalPages = Math.max(1, Math.ceil(total / cleanPageSize));
      const safePage = Math.min(totalPages, cleanPage);
      const skip = (safePage - 1) * cleanPageSize;

      const docs = await col
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(cleanPageSize)
        .toArray();

      return {
        items: docs.map(stripMongoId),
        page: safePage,
        pageSize: cleanPageSize,
        total,
        totalPages,
        hasNextPage: safePage < totalPages,
        hasPrevPage: safePage > 1,
      };
    },

    async saveReceiptImage(paymentId, buffer, mimeType) {
      const cleanId = sanitizeId(paymentId);
      const db = await getDb();
      const now = new Date();
      // Keep compressed receipt binaries for 180 days with automatic MongoDB TTL cleanup
      const expiresAt = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
      await db.collection("payment_receipts").updateOne(
        { paymentId: cleanId },
        {
          $set: {
            paymentId: cleanId,
            data: new Binary(buffer),
            mimeType: mimeType || "image/jpeg",
            size: buffer.length,
            createdAt: now,
            expiresAt,
          },
        },
        { upsert: true }
      );
      return {
        storagePath: `mongo:${cleanId}`,
        size: buffer.length,
        mimeType: mimeType || "image/jpeg",
      };
    },

    async readReceiptImage(storagePath) {
      const raw = String(storagePath || "");
      if (!raw.startsWith("mongo:")) return null;
      const paymentId = sanitizeId(raw.slice("mongo:".length));
      if (!paymentId) return null;
      const db = await getDb();
      const doc = await db.collection("payment_receipts").findOne({ paymentId });
      if (!doc || !doc.data) return null;
      const rawData = doc.data;
      const buffer = Buffer.isBuffer(rawData)
        ? rawData
        : rawData.buffer
        ? Buffer.from(rawData.buffer)
        : Buffer.from(rawData);
      return {
        buffer,
        mimeType: doc.mimeType || "image/jpeg",
      };
    },

    async getAdminAiConfig() {
      const db = await getDb();
      const doc = await db.collection("admin_config").findOne({ key: "ai" });
      if (!doc) return { ...DEFAULT_AI_CONFIG };
      const cleaned = stripMongoId(doc);
      delete cleaned.key;
      return { ...DEFAULT_AI_CONFIG, ...cleaned };
    },

    async saveAdminAiConfig(patch) {
      const db = await getDb();
      const current = await this.getAdminAiConfig();
      const next = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      await db
        .collection("admin_config")
        .updateOne({ key: "ai" }, { $set: { key: "ai", ...next } }, { upsert: true });
      return next;
    },

    async recordAiUsageLog(entry) {
      const id = entry.id || `use_${crypto.randomUUID()}`;
      const db = await getDb();
      await db.collection("ai_usage_logs").insertOne({
        ...entry,
        id,
        createdAtDate: new Date(),
      });
    },

    async getAdminOverview() {
      const db = await getDb();
      const nowIso = new Date().toISOString();
      const monthKey = nowIso.slice(0, 7);
      const dayKey = nowIso.slice(0, 10);

      const [totalUsers, activeSubscribers, pendingPayments, totalTrialsUsed, monthlyAgg, dailyAgg] =
        await Promise.all([
          db.collection("users").countDocuments({}),
          db.collection("users").countDocuments({
            "subscription.status": "active",
            "subscription.expiresAt": { $gt: nowIso },
          }),
          db.collection("payment_submissions").countDocuments({ status: "pending" }),
          db.collection("trial_ledger").countDocuments({}),
          db
            .collection("users")
            .aggregate([
              { $match: { "quota.monthlyResetKey": monthKey } },
              { $group: { _id: null, total: { $sum: "$quota.monthlyUsed" } } },
            ])
            .toArray(),
          db
            .collection("users")
            .aggregate([
              { $match: { "quota.dailyResetKey": dayKey } },
              { $group: { _id: null, total: { $sum: "$quota.dailyUsed" } } },
            ])
            .toArray(),
        ]);

      return {
        totalUsers,
        activeSubscribers,
        pendingPayments,
        totalTrialsUsed,
        monthlyManagedCalls: monthlyAgg[0]?.total || 0,
        dailyManagedCalls: dailyAgg[0]?.total || 0,
      };
    },
  };
}
