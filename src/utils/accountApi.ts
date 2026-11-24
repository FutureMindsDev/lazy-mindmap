import type {
  AdminAiConfig,
  AdminOverview,
  AdminUserRow,
  ByokVaultInfo,
  LlmProviderId,
  PaginatedResponse,
  PaymentSubmission,
  UserAccountState,
} from "../types/mindmap";
import { getDeviceFingerprint } from "./deviceFingerprint";
import { getActiveAuthToken } from "./firebaseClient";

export class AccountApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "AccountApiError";
    this.status = status;
    this.code = code;
  }
}

export async function apiFetchJson<T>(
  url: string,
  options: RequestInit & { tokenOverride?: string | null } = {}
): Promise<T> {
  const { tokenOverride, headers: extraHeaders, ...rest } = options;
  const [token, fp] = await Promise.all([
    tokenOverride !== undefined ? Promise.resolve(tokenOverride) : getActiveAuthToken(),
    getDeviceFingerprint(),
  ]);

  const headers = new Headers(extraHeaders || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (fp) headers.set("X-Device-Fingerprint", fp);
  if (rest.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, { ...rest, headers });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    parsed = {};
  }

  if (!res.ok) {
    throw new AccountApiError(
      String(parsed.error || res.statusText || "Request failed"),
      res.status,
      typeof parsed.code === "string" ? parsed.code : undefined
    );
  }

  return parsed as T;
}

export function fetchAccountState(tokenOverride?: string | null): Promise<UserAccountState> {
  return apiFetchJson<UserAccountState>("/api/auth/me", { tokenOverride });
}

export function syncAccountProfile(
  payload: { displayName?: string; photoURL?: string },
  tokenOverride?: string | null
): Promise<UserAccountState> {
  return apiFetchJson<UserAccountState>("/api/auth/sync-profile", {
    method: "POST",
    body: JSON.stringify(payload),
    tokenOverride,
  });
}

export function fetchByokVaultInfo(): Promise<ByokVaultInfo> {
  return apiFetchJson<ByokVaultInfo>("/api/ai/byok");
}

export function saveByokVaultKey(payload: {
  provider: LlmProviderId;
  model: string;
  baseUrl?: string;
  apiKey?: string;
}): Promise<ByokVaultInfo & { ok: boolean }> {
  return apiFetchJson<ByokVaultInfo & { ok: boolean }>("/api/ai/byok", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteByokVaultKey(): Promise<{ ok: boolean; configured: boolean }> {
  return apiFetchJson<{ ok: boolean; configured: boolean }>("/api/ai/byok", {
    method: "DELETE",
  });
}

export function fetchBillingStatus(): Promise<{
  subscription: UserAccountState["subscription"];
  trial: UserAccountState["trial"];
  quota: UserAccountState["quota"];
  billing: UserAccountState["billing"];
  submissions: PaymentSubmission[];
}> {
  return apiFetchJson("/api/billing/status");
}

export function submitKbzPayPayment(payload: {
  plan: "monthly" | "yearly";
  transactionId: string;
  note?: string;
  screenshotDataUrl: string;
}): Promise<{ ok: boolean; submission: PaymentSubmission }> {
  return apiFetchJson("/api/billing/kbzpay", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// -----------------------------------------------------------------------------
// Admin Dashboard APIs
// -----------------------------------------------------------------------------
export function fetchAdminOverview(): Promise<AdminOverview> {
  return apiFetchJson<AdminOverview>("/api/admin/overview");
}

export function fetchAdminUsers(params: {
  page: number;
  pageSize: number;
  search?: string;
  plan?: string;
  status?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}): Promise<PaginatedResponse<AdminUserRow>> {
  const qs = new URLSearchParams();
  qs.set("page", String(params.page));
  qs.set("pageSize", String(params.pageSize));
  if (params.search?.trim()) qs.set("search", params.search.trim());
  if (params.plan && params.plan !== "all") qs.set("plan", params.plan);
  if (params.status && params.status !== "all") qs.set("status", params.status);
  if (params.sortBy) qs.set("sortBy", params.sortBy);
  if (params.sortDir) qs.set("sortDir", params.sortDir);
  return apiFetchJson<PaginatedResponse<AdminUserRow>>(`/api/admin/users?${qs.toString()}`);
}

export function patchAdminUser(
  uid: string,
  payload: {
    role?: "user" | "admin";
    status?: "active" | "suspended";
    resetTrials?: boolean;
    resetQuota?: boolean;
    grantPlan?: "monthly" | "yearly";
    revokeSubscription?: boolean;
  }
): Promise<{ ok: boolean; user: AdminUserRow }> {
  return apiFetchJson(`/api/admin/users/${encodeURIComponent(uid)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function fetchAdminPayments(params: {
  page: number;
  pageSize: number;
  status?: string;
  search?: string;
}): Promise<PaginatedResponse<PaymentSubmission>> {
  const qs = new URLSearchParams();
  qs.set("page", String(params.page));
  qs.set("pageSize", String(params.pageSize));
  if (params.status && params.status !== "all") qs.set("status", params.status);
  if (params.search?.trim()) qs.set("search", params.search.trim());
  return apiFetchJson<PaginatedResponse<PaymentSubmission>>(
    `/api/admin/payments?${qs.toString()}`
  );
}

export function reviewAdminPayment(
  paymentId: string,
  payload: { action: "approve" | "reject"; reviewNote?: string }
): Promise<{ ok: boolean; payment: PaymentSubmission; user: AdminUserRow | null }> {
  return apiFetchJson(`/api/admin/payments/${encodeURIComponent(paymentId)}/review`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchAdminReceiptBlobUrl(paymentId: string): Promise<string> {
  const [token, fp] = await Promise.all([getActiveAuthToken(), getDeviceFingerprint()]);
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (fp) headers.set("X-Device-Fingerprint", fp);
  const res = await fetch(`/api/admin/receipts/${encodeURIComponent(paymentId)}`, { headers });
  if (!res.ok) {
    throw new Error(`Failed to load receipt (${res.status})`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export function fetchAdminAiConfig(): Promise<AdminAiConfig> {
  return apiFetchJson<AdminAiConfig>("/api/admin/ai-config");
}

export function saveAdminAiConfig(payload: {
  managedModel?: string;
  trialModel?: string;
  monthlyQuota?: number;
  dailyQuota?: number;
  monthlyPriceMmk?: number;
  yearlyPriceMmk?: number;
  maxTrialCount?: number;
  managedApiKey?: string;
  trialApiKey?: string;
  clearManagedKey?: boolean;
  clearTrialKey?: boolean;
}): Promise<{ ok: boolean; config: AdminAiConfig }> {
  return apiFetchJson("/api/admin/ai-config", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function testAdminAiKey(payload: {
  target: "managed" | "trial";
  apiKey?: string;
  model?: string;
}): Promise<{ ok: boolean; model: string; target: string; reply: string }> {
  return apiFetchJson("/api/admin/ai-config/test", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
