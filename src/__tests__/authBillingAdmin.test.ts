import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  isDisposableEmail,
  maskApiKey,
  normalizeEmailForAntiAbuse,
  validateExternalBaseUrl,
} from "../../server/crypto.mjs";
import { createApiMiddleware } from "../../server/api.mjs";
import {
  LLM_CONFIG_STORAGE_KEY,
  loadLlmConfig,
  saveLlmConfig,
} from "../utils/llmMindMapAgent";

function makeDevToken(payload: {
  uid: string;
  email: string;
  displayName?: string;
  emailVerified?: boolean;
  isAdmin?: boolean;
}) {
  const b64 = Buffer.from(
    JSON.stringify({
      uid: payload.uid,
      email: payload.email,
      displayName: payload.displayName || "Test User",
      emailVerified: payload.emailVerified ?? true,
      isAdmin: payload.isAdmin ?? false,
      providers: ["password"],
    }),
    "utf8"
  ).toString("base64url");
  return `dev:${b64}`;
}

const SAMPLE_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("Security, Encryption, SSRF & Anti-Abuse Helpers", () => {
  it("encrypts/decrypts secrets with AES-256-GCM AAD binding and masks keys", () => {
    const enc = encryptSecret("sk-super-secret-value-9876", "byok:user_1");
    expect(enc.ciphertext).not.toContain("sk-super-secret");
    expect(decryptSecret(enc, "byok:user_1")).toBe("sk-super-secret-value-9876");
    expect(() => decryptSecret(enc, "byok:user_2")).toThrow();
    expect(maskApiKey("AIzaSyDummyKey12345")).toBe("AIza••••2345");
    expect(maskApiKey("short")).toBe("••••rt");
  });

  it("blocks private, loopback, metadata, and non-HTTPS custom LLM URLs against SSRF", () => {
    expect(() => validateExternalBaseUrl("http://127.0.0.1:8080/v1")).toThrow();
    expect(() => validateExternalBaseUrl("https://169.254.169.254/latest")).toThrow();
    expect(() => validateExternalBaseUrl("https://10.0.0.12/v1")).toThrow();
    expect(() => validateExternalBaseUrl("https://192.168.1.50/v1")).toThrow();
    expect(() => validateExternalBaseUrl("https://localhost/v1")).toThrow();
    expect(() => validateExternalBaseUrl("https://metadata.internal/v1")).toThrow();
    expect(validateExternalBaseUrl("https://api.deepseek.com/v1/")).toBe(
      "https://api.deepseek.com/v1"
    );
  });

  it("normalizes Gmail dot/+alias tricks and detects disposable email domains", () => {
    expect(normalizeEmailForAntiAbuse("Alice.Bob+trial99@googlemail.com")).toBe(
      "alicebob@gmail.com"
    );
    expect(normalizeEmailForAntiAbuse("user+work@outlook.com")).toBe("user@outlook.com");
    expect(isDisposableEmail("tester@mailinator.com")).toBe(true);
    expect(isDisposableEmail("sub@yopmail.com")).toBe(true);
    expect(isDisposableEmail("real.person@gmail.com")).toBe(false);
  });

  it("verifies bundled KBZPay QR image SHA-256 matches lazy-translator original", () => {
    const qrPath = path.resolve(process.cwd(), "src/assets/kbzpay_qr.jpg");
    const bytes = fs.readFileSync(qrPath);
    const sha = crypto.createHash("sha256").update(bytes).digest("hex");
    expect(sha).toBe("b2b641a01b62a1dc9bb6d851ea62c20fdbf15a01aad9162dad6f2b4d43dfd3c8");
  });

  it("never persists plaintext BYOK API keys to localStorage and scrubs legacy keys", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });

    try {
      saveLlmConfig({
        provider: "openai",
        apiKey: "sk-live-never-persist-me",
        model: "gpt-4o-mini",
        mode: "byok_session",
        byokStorage: "session",
      });
      const raw = store.get(LLM_CONFIG_STORAGE_KEY) || "";
      expect(raw).not.toContain("sk-live-never-persist-me");

      // Legacy plaintext apiKey stored previously should be scrubbed on load
      store.set(
        LLM_CONFIG_STORAGE_KEY,
        JSON.stringify({
          provider: "gemini",
          apiKey: "AIzaLegacyPlaintextKey",
          model: "gemini-3.1-flash-lite",
        })
      );
      const loaded = loadLlmConfig();
      expect(loaded.apiKey).toBe("");
      expect(store.get(LLM_CONFIG_STORAGE_KEY)).not.toContain("AIzaLegacyPlaintextKey");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Multi-User Maps, BYOK Vault, 3-Trial Anti-Abuse, KBZPay & Admin API", () => {
  const tempDirs: string[] = [];
  const servers: http.Server[] = [];

  afterEach(async () => {
    for (const s of servers.splice(0)) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  async function startTestApiServer() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lazymindmap-api-"));
    tempDirs.push(tempDir);

    const llmCalls: Array<{ url: string; body: string }> = [];
    const mockLlmFetch = async (url: string | URL, init?: RequestInit) => {
      llmCalls.push({ url: String(url), body: String(init?.body || "") });
      const u = String(url);
      if (u.includes("generativelanguage.googleapis.com")) {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        explanation: "Updated map via Gemini",
                        operations: [],
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "OpenAI mock response" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const middleware = createApiMiddleware(tempDir, {
      forceLocal: true,
      requireAuthForCloudMaps: true,
      llmFetch: mockLlmFetch as typeof fetch,
    });

    const server = http.createServer((req, res) => {
      void middleware(req, res, () => {
        res.writeHead(404);
        res.end("Not found");
      });
    });
    servers.push(server);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;
    return { baseUrl, llmCalls };
  }

  it("isolates cloud mind maps per user and blocks guests on cloud map endpoints", async () => {
    const { baseUrl } = await startTestApiServer();
    const tokenA = makeDevToken({ uid: "user_a", email: "alice@example.com" });
    const tokenB = makeDevToken({ uid: "user_b", email: "bob@example.com" });

    // Guest cannot access cloud maps endpoint
    const guestRes = await fetch(`${baseUrl}/api/maps`);
    expect(guestRes.status).toBe(401);

    // User A saves a map
    const saveRes = await fetch(`${baseUrl}/api/maps/map-alpha`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ id: "map-alpha", title: "Alice Map", nodes: { r: {} } }),
    });
    expect(saveRes.status).toBe(200);

    // User A sees their map; User B sees empty list and cannot read User A's map
    const listA = await (
      await fetch(`${baseUrl}/api/maps`, { headers: { Authorization: `Bearer ${tokenA}` } })
    ).json();
    expect(listA).toHaveLength(1);
    expect(listA[0].title).toBe("Alice Map");

    const listB = await (
      await fetch(`${baseUrl}/api/maps`, { headers: { Authorization: `Bearer ${tokenB}` } })
    ).json();
    expect(listB).toHaveLength(0);

    const readB = await fetch(`${baseUrl}/api/maps/map-alpha`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(readB.status).toBe(404);
  });

  it("encrypts BYOK keys in Cloud Vault, never leaks plaintext, and uses them for LLM chat", async () => {
    const { baseUrl, llmCalls } = await startTestApiServer();
    const tokenA = makeDevToken({ uid: "vault_u1", email: "vault@example.com" });

    const putRes = await fetch(`${baseUrl}/api/ai/byok`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-test-vault-9988",
      }),
    });
    expect(putRes.status).toBe(200);
    const putJson = (await putRes.json()) as { keyHint: string };
    expect(putJson.keyHint).toBe("sk-t••••9988");

    const getRes = await fetch(`${baseUrl}/api/ai/byok`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const getText = await getRes.text();
    expect(getText).not.toContain("sk-test-vault-9988");

    const chatRes = await fetch(`${baseUrl}/api/llm/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        mode: "byok_vault",
        systemPrompt: "Sys",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });
    expect(chatRes.status).toBe(200);
    expect(llmCalls).toHaveLength(1);

    // SSRF guard rejects localhost custom base URL
    const ssrfRes = await fetch(`${baseUrl}/api/ai/byok`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        provider: "custom",
        model: "llama",
        baseUrl: "http://127.0.0.1:11434/v1",
        apiKey: "sk-local",
      }),
    });
    expect(ssrfRes.status).toBe(400);

    const delRes = await fetch(`${baseUrl}/api/ai/byok`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(delRes.status).toBe(200);
  });

  it("enforces 3 free trials, email verification, disposable email block, and multi-account anti-abuse", async () => {
    const { baseUrl } = await startTestApiServer();
    const adminToken = makeDevToken({
      uid: "admin_1",
      email: "owner@lazymindmap.app",
      isAdmin: true,
    });

    // Configure Trial AI Studio key via Admin API
    const cfgRes = await fetch(`${baseUrl}/api/admin/ai-config`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        trialApiKey: "AIzaTrialKey123456",
        managedApiKey: "AIzaManagedKey654321",
        trialModel: "gemini-3.1-flash-lite",
        managedModel: "gemini-3.1-flash-lite",
      }),
    });
    expect(cfgRes.status).toBe(200);

    // Unverified user is blocked
    const unverifiedToken = makeDevToken({
      uid: "unv_1",
      email: "unverified@gmail.com",
      emailVerified: false,
    });
    const unvRes = await fetch(`${baseUrl}/api/llm/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${unverifiedToken}`,
        "X-Device-Fingerprint": "fp-unv",
      },
      body: JSON.stringify({ mode: "trial", messages: [{ role: "user", content: "Hi" }] }),
    });
    expect(unvRes.status).toBe(403);
    expect((await unvRes.json()).code).toBe("EMAIL_NOT_VERIFIED");

    // Disposable email user is blocked
    const dispToken = makeDevToken({
      uid: "disp_1",
      email: "throwaway@mailinator.com",
      emailVerified: true,
    });
    const dispRes = await fetch(`${baseUrl}/api/llm/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${dispToken}`,
        "X-Device-Fingerprint": "fp-disp",
      },
      body: JSON.stringify({ mode: "trial", messages: [{ role: "user", content: "Hi" }] }),
    });
    expect(dispRes.status).toBe(403);
    expect((await dispRes.json()).code).toBe("DISPOSABLE_EMAIL");

    // Legitimate verified user gets exactly 3 trials
    const alice1 = makeDevToken({
      uid: "alice_1",
      email: "Alice.Smith@gmail.com",
      emailVerified: true,
    });
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${baseUrl}/api/llm/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${alice1}`,
          "X-Device-Fingerprint": "device-fp-shared",
          "X-Forwarded-For": "203.0.113.10",
        },
        body: JSON.stringify({ mode: "trial", messages: [{ role: "user", content: `Try ${i}` }] }),
      });
      expect(r.status).toBe(200);
      const data = await r.json();
      expect(data.usage.trialRemaining).toBe(2 - i);
    }

    // 4th try is blocked
    const fourth = await fetch(`${baseUrl}/api/llm/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${alice1}`,
        "X-Device-Fingerprint": "device-fp-shared",
        "X-Forwarded-For": "203.0.113.10",
      },
      body: JSON.stringify({ mode: "trial", messages: [{ role: "user", content: "Try 4" }] }),
    });
    expect(fourth.status).toBe(403);
    expect((await fourth.json()).code).toBe("TRIAL_EXHAUSTED");

    // Second account using Gmail +alias trick from different IP/FP is blocked by normalized email
    const aliceAlias = makeDevToken({
      uid: "alice_2",
      email: "alicesmith+promo2@googlemail.com",
      emailVerified: true,
    });
    const aliasBlocked = await fetch(`${baseUrl}/api/llm/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aliceAlias}`,
        "X-Device-Fingerprint": "device-fp-other",
        "X-Forwarded-For": "198.51.100.77",
      },
      body: JSON.stringify({ mode: "trial", messages: [{ role: "user", content: "Bypass?" }] }),
    });
    expect(aliasBlocked.status).toBe(403);
    expect((await aliasBlocked.json()).code).toBe("TRIAL_ABUSE_EMAIL");

    // Second account with completely different email on the SAME device fingerprint is blocked
    const otherUserSameDevice = makeDevToken({
      uid: "bob_same_dev",
      email: "bob.completely.new@outlook.com",
      emailVerified: true,
    });
    const fpBlocked = await fetch(`${baseUrl}/api/llm/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${otherUserSameDevice}`,
        "X-Device-Fingerprint": "device-fp-shared",
        "X-Forwarded-For": "198.51.100.88",
      },
      body: JSON.stringify({ mode: "trial", messages: [{ role: "user", content: "Bypass FP?" }] }),
    });
    expect(fpBlocked.status).toBe(403);
    expect((await fpBlocked.json()).code).toBe("TRIAL_ABUSE_DEVICE");
  });

  it("handles KBZPay receipt upload, duplicate Tx protection, admin approval, and server-side pagination", async () => {
    const { baseUrl } = await startTestApiServer();
    const adminToken = makeDevToken({
      uid: "admin_master",
      email: "admin@lazymindmap.app",
      isAdmin: true,
    });
    const user1 = makeDevToken({ uid: "u1", email: "u1@example.com", displayName: "User One" });
    const user2 = makeDevToken({ uid: "u2", email: "u2@example.com", displayName: "User Two" });
    const user3 = makeDevToken({ uid: "u3", email: "u3@example.com", displayName: "User Three" });

    // Non-admin blocked from admin routes
    const nonAdminRes = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${user1}` },
    });
    expect(nonAdminRes.status).toBe(403);

    // Sync users & configure managed key
    await Promise.all([
      fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${user1}` } }),
      fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${user2}` } }),
      fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${user3}` } }),
      fetch(`${baseUrl}/api/admin/ai-config`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          managedApiKey: "AIzaManagedProdKey7777",
          managedModel: "gemini-3.1-flash-lite",
        }),
      }),
    ]);

    // Admin AI config GET never leaks plaintext API key
    const aiCfgText = await (
      await fetch(`${baseUrl}/api/admin/ai-config`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
    ).text();
    expect(aiCfgText).not.toContain("AIzaManagedProdKey7777");
    expect(aiCfgText).toContain("AIza••••7777");

    // Server-side pagination on /api/admin/users
    const page1 = await (
      await fetch(`${baseUrl}/api/admin/users?page=1&pageSize=2`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
    ).json();
    const page2 = await (
      await fetch(`${baseUrl}/api/admin/users?page=2&pageSize=2`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
    ).json();
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBeGreaterThanOrEqual(4);
    expect(page1.hasNextPage).toBe(true);
    expect(page2.page).toBe(2);
    expect(page2.hasPrevPage).toBe(true);

    // User 1 submits KBZPay screenshot
    const submitRes = await fetch(`${baseUrl}/api/billing/kbzpay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user1}`,
      },
      body: JSON.stringify({
        plan: "monthly",
        transactionId: "KBZ9988776655",
        screenshotDataUrl: SAMPLE_PNG_DATA_URL,
      }),
    });
    expect(submitRes.status).toBe(201);
    const { submission } = await submitRes.json();

    // Duplicate transaction ID rejected with 409
    const dupRes = await fetch(`${baseUrl}/api/billing/kbzpay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user2}`,
      },
      body: JSON.stringify({
        plan: "yearly",
        transactionId: "kbz9988776655",
        screenshotDataUrl: SAMPLE_PNG_DATA_URL,
      }),
    });
    expect(dupRes.status).toBe(409);

    // Admin can fetch the private receipt image
    const receiptRes = await fetch(`${baseUrl}/api/admin/receipts/${submission.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(receiptRes.status).toBe(200);
    expect(receiptRes.headers.get("content-type")).toBe("image/png");

    // Admin approves payment -> activates User 1 Pro subscription
    const approveRes = await fetch(`${baseUrl}/api/admin/payments/${submission.id}/review`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(approveRes.status).toBe(200);

    // User 1 can now run Managed Pro AI calls
    const managedChatRes = await fetch(`${baseUrl}/api/llm/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user1}`,
      },
      body: JSON.stringify({
        mode: "managed",
        systemPrompt: "Sys",
        messages: [{ role: "user", content: "Generate branches" }],
      }),
    });
    expect(managedChatRes.status).toBe(200);
    const managedData = await managedChatRes.json();
    expect(managedData.usage.mode).toBe("managed");
    expect(managedData.usage.monthlyRemaining).toBe(149);
  });
});
