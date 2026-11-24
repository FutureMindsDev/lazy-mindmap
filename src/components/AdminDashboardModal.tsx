import { useCallback, useEffect, useId, useState, type CSSProperties, type FormEvent } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  KeyRound,
  Loader2,
  RefreshCw,
  Shield,
  Sparkles,
  Users,
  Wallet,
  X,
} from "lucide-react";
import type {
  AdminAiConfig,
  AdminOverview,
  AdminUserRow,
  PaginatedResponse,
  PaymentSubmission,
} from "../types/mindmap";
import {
  fetchAdminAiConfig,
  fetchAdminOverview,
  fetchAdminPayments,
  fetchAdminReceiptBlobUrl,
  fetchAdminUsers,
  patchAdminUser,
  reviewAdminPayment,
  saveAdminAiConfig,
  testAdminAiKey,
} from "../utils/accountApi";
import { NativeDialog } from "./NativeDialog";

type AdminTab = "users" | "payments" | "ai";

interface AdminDashboardModalProps {
  open: boolean;
  onClose: () => void;
  onRefreshAccount: () => Promise<unknown>;
  onAnnounce: (msg: string) => void;
}

export function AdminDashboardModal({
  open,
  onClose,
  onRefreshAccount,
  onAnnounce,
}: AdminDashboardModalProps) {
  const [tab, setTab] = useState<AdminTab>("users");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Users pagination & filters
  const [usersData, setUsersData] = useState<PaginatedResponse<AdminUserRow> | null>(null);
  const [usersPage, setUsersPage] = useState(1);
  const [usersPageSize, setUsersPageSize] = useState(10);
  const [usersSearch, setUsersSearch] = useState("");
  const [usersPlanFilter, setUsersPlanFilter] = useState("all");
  const [usersStatusFilter, setUsersStatusFilter] = useState("all");
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Payments pagination & filters
  const [paymentsData, setPaymentsData] = useState<PaginatedResponse<PaymentSubmission> | null>(
    null
  );
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [paymentsPageSize, setPaymentsPageSize] = useState(10);
  const [paymentsStatusFilter, setPaymentsStatusFilter] = useState("pending");
  const [paymentsSearch, setPaymentsSearch] = useState("");
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [receiptPreview, setReceiptPreview] = useState<{
    payment: PaymentSubmission;
    blobUrl: string;
  } | null>(null);

  // AI settings state
  const [aiConfig, setAiConfig] = useState<AdminAiConfig | null>(null);
  const [managedModel, setManagedModel] = useState("gemini-3.1-flash-lite");
  const [trialModel, setTrialModel] = useState("gemini-3.1-flash-lite");
  const [monthlyQuota, setMonthlyQuota] = useState(150);
  const [dailyQuota, setDailyQuota] = useState(15);
  const [maxTrialCount, setMaxTrialCount] = useState(3);
  const [monthlyPriceMmk, setMonthlyPriceMmk] = useState(1000);
  const [yearlyPriceMmk, setYearlyPriceMmk] = useState(10000);
  const [managedApiKeyInput, setManagedApiKeyInput] = useState("");
  const [trialApiKeyInput, setTrialApiKeyInput] = useState("");
  const [savingAi, setSavingAi] = useState(false);
  const [testingTarget, setTestingTarget] = useState<"managed" | "trial" | null>(null);

  const usersCaptionId = useId();
  const paymentsCaptionId = useId();
  const modelListId = useId();

  const loadOverview = useCallback(async () => {
    try {
      const ov = await fetchAdminOverview();
      setOverview(ov);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load admin overview.");
    }
  }, []);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    setError(null);
    try {
      const res = await fetchAdminUsers({
        page: usersPage,
        pageSize: usersPageSize,
        search: usersSearch,
        plan: usersPlanFilter,
        status: usersStatusFilter,
      });
      setUsersData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users.");
    } finally {
      setLoadingUsers(false);
    }
  }, [usersPage, usersPageSize, usersSearch, usersPlanFilter, usersStatusFilter]);

  const loadPayments = useCallback(async () => {
    setLoadingPayments(true);
    setError(null);
    try {
      const res = await fetchAdminPayments({
        page: paymentsPage,
        pageSize: paymentsPageSize,
        status: paymentsStatusFilter,
        search: paymentsSearch,
      });
      setPaymentsData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payments.");
    } finally {
      setLoadingPayments(false);
    }
  }, [paymentsPage, paymentsPageSize, paymentsStatusFilter, paymentsSearch]);

  const loadAiConfig = useCallback(async () => {
    try {
      const cfg = await fetchAdminAiConfig();
      setAiConfig(cfg);
      setManagedModel(cfg.managedModel);
      setTrialModel(cfg.trialModel);
      setMonthlyQuota(cfg.monthlyQuota);
      setDailyQuota(cfg.dailyQuota);
      setMaxTrialCount(cfg.maxTrialCount);
      setMonthlyPriceMmk(cfg.monthlyPriceMmk);
      setYearlyPriceMmk(cfg.yearlyPriceMmk);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load AI configuration.");
    }
  }, []);

  useEffect(() => {
    if (!open) {
      if (receiptPreview?.blobUrl) {
        URL.revokeObjectURL(receiptPreview.blobUrl);
      }
      setReceiptPreview(null);
      return;
    }
    void loadOverview();
    void loadAiConfig();
  }, [open, loadOverview, loadAiConfig]);

  useEffect(() => {
    if (!open) return;
    if (tab === "users") void loadUsers();
    if (tab === "payments") void loadPayments();
  }, [open, tab, loadUsers, loadPayments]);

  const handleUserAction = async (
    uid: string,
    payload: Parameters<typeof patchAdminUser>[1],
    label: string
  ) => {
    setError(null);
    setNotice(null);
    try {
      await patchAdminUser(uid, payload);
      setNotice(label);
      onAnnounce(label);
      await Promise.all([loadUsers(), loadOverview(), onRefreshAccount()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user.");
    }
  };

  const handleReviewPayment = async (paymentId: string, action: "approve" | "reject") => {
    const reviewNote =
      action === "reject"
        ? window.prompt("Optional rejection reason shown to the user:", "Screenshot unclear") ?? ""
        : "";
    setError(null);
    setNotice(null);
    try {
      await reviewAdminPayment(paymentId, { action, reviewNote });
      const msg = action === "approve" ? "Payment approved and plan activated." : "Payment rejected.";
      setNotice(msg);
      onAnnounce(msg);
      if (receiptPreview?.payment.id === paymentId) {
        URL.revokeObjectURL(receiptPreview.blobUrl);
        setReceiptPreview(null);
      }
      await Promise.all([loadPayments(), loadOverview(), loadUsers(), onRefreshAccount()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to review payment.");
    }
  };

  const handleViewReceipt = async (payment: PaymentSubmission) => {
    setError(null);
    try {
      if (receiptPreview?.blobUrl) {
        URL.revokeObjectURL(receiptPreview.blobUrl);
      }
      const blobUrl = await fetchAdminReceiptBlobUrl(payment.id);
      setReceiptPreview({ payment, blobUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load receipt image.");
    }
  };

  const handleSaveAiConfig = async (e: FormEvent) => {
    e.preventDefault();
    setSavingAi(true);
    setError(null);
    setNotice(null);
    try {
      const res = await saveAdminAiConfig({
        managedModel: managedModel.trim(),
        trialModel: trialModel.trim(),
        monthlyQuota,
        dailyQuota,
        maxTrialCount,
        monthlyPriceMmk,
        yearlyPriceMmk,
        managedApiKey: managedApiKeyInput.trim() || undefined,
        trialApiKey: trialApiKeyInput.trim() || undefined,
      });
      setAiConfig(res.config);
      setManagedApiKeyInput("");
      setTrialApiKeyInput("");
      setNotice("Saved AI model, quota, pricing, and encrypted API keys.");
      onAnnounce("Admin AI settings saved");
      await onRefreshAccount();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save AI settings.");
    } finally {
      setSavingAi(false);
    }
  };

  const handleClearKey = async (target: "managed" | "trial") => {
    setSavingAi(true);
    setError(null);
    try {
      const res = await saveAdminAiConfig(
        target === "managed" ? { clearManagedKey: true } : { clearTrialKey: true }
      );
      setAiConfig(res.config);
      setNotice(`Cleared vaulted ${target} API key.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear key.");
    } finally {
      setSavingAi(false);
    }
  };

  const handleTestKey = async (target: "managed" | "trial") => {
    setTestingTarget(target);
    setError(null);
    setNotice(null);
    try {
      const res = await testAdminAiKey({
        target,
        apiKey: (target === "managed" ? managedApiKeyInput : trialApiKeyInput).trim() || undefined,
        model: (target === "managed" ? managedModel : trialModel).trim() || undefined,
      });
      setNotice(`Gemini ${target} test passed on ${res.model}: "${res.reply}"`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gemini test request failed.");
    } finally {
      setTestingTarget(null);
    }
  };

  const usersTableVars = {
    "--label-2": '"Plan"',
    "--label-3": '"Trials"',
    "--label-4": '"Monthly AI"',
    "--label-5": '"Signals"',
    "--label-6": '"Status"',
    "--label-7": '"Actions"',
  } as CSSProperties;

  const paymentsTableVars = {
    "--label-2": '"Plan & MMK"',
    "--label-3": '"Tx ID"',
    "--label-4": '"Status"',
    "--label-5": '"Receipt"',
    "--label-6": '"Actions"',
  } as CSSProperties;

  return (
    <NativeDialog open={open} onClose={onClose} title="Admin Dashboard" maxWidth="1040px">
      <div className="mf-admin-wrap">
        {overview && (
          <div className="mf-admin-kpis">
            <div className="mf-kpi-card">
              <span>Total Users</span>
              <strong>{overview.totalUsers}</strong>
            </div>
            <div className="mf-kpi-card">
              <span>Active Pro</span>
              <strong>{overview.activeSubscribers}</strong>
            </div>
            <div className="mf-kpi-card">
              <span>Pending KBZPay</span>
              <strong>{overview.pendingPayments}</strong>
            </div>
            <div className="mf-kpi-card">
              <span>Trials Used</span>
              <strong>{overview.totalTrialsUsed}</strong>
            </div>
            <div className="mf-kpi-card">
              <span>Monthly AI Calls</span>
              <strong>{overview.monthlyManagedCalls}</strong>
            </div>
          </div>
        )}

        <div className="mf-admin-tabs" role="tablist" aria-label="Admin sections">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "users"}
            className={`mf-chip-btn ${tab === "users" ? "is-active" : ""}`}
            onClick={() => setTab("users")}
          >
            <Users size={14} aria-hidden="true" /> Users
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "payments"}
            className={`mf-chip-btn ${tab === "payments" ? "is-active" : ""}`}
            onClick={() => setTab("payments")}
          >
            <Wallet size={14} aria-hidden="true" /> KBZPay Payments
            {overview && overview.pendingPayments > 0 && (
              <span className="mf-llm-badge-count">{overview.pendingPayments}</span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "ai"}
            className={`mf-chip-btn ${tab === "ai" ? "is-active" : ""}`}
            onClick={() => setTab("ai")}
          >
            <Sparkles size={14} aria-hidden="true" /> AI Keys &amp; Models
          </button>
        </div>

        {error && (
          <div className="mf-alert-box is-error" role="alert">
            <AlertCircle size={15} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="mf-alert-box is-info" role="status">
            <CheckCircle2 size={15} aria-hidden="true" />
            <span>{notice}</span>
          </div>
        )}

        {tab === "users" && (
          <div className="mf-admin-section">
            <div className="mf-admin-filters">
              <input
                type="search"
                aria-label="Search users"
                placeholder="Search email, name, or UID…"
                value={usersSearch}
                onChange={(e) => {
                  setUsersSearch(e.target.value);
                  setUsersPage(1);
                }}
              />
              <select
                className="mf-select"
                aria-label="Filter by plan"
                value={usersPlanFilter}
                onChange={(e) => {
                  setUsersPlanFilter(e.target.value);
                  setUsersPage(1);
                }}
              >
                <option value="all">All Plans</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
                <option value="free">Free</option>
                <option value="admin">Admins</option>
              </select>
              <select
                className="mf-select"
                aria-label="Filter by status"
                value={usersStatusFilter}
                onChange={(e) => {
                  setUsersStatusFilter(e.target.value);
                  setUsersPage(1);
                }}
              >
                <option value="all">All Statuses</option>
                <option value="active">Active Sub</option>
                <option value="pending">Pending Sub</option>
                <option value="suspended">Suspended</option>
              </select>
              <select
                className="mf-select"
                aria-label="Rows per page"
                value={usersPageSize}
                onChange={(e) => {
                  setUsersPageSize(Number(e.target.value));
                  setUsersPage(1);
                }}
              >
                <option value={10}>10 / page</option>
                <option value={20}>20 / page</option>
                <option value={50}>50 / page</option>
              </select>
              <button type="button" className="mf-btn" onClick={() => void loadUsers()}>
                <RefreshCw size={14} className={loadingUsers ? "mf-spin" : ""} aria-hidden="true" />
              </button>
            </div>

            <div
              tabIndex={0}
              role="region"
              aria-labelledby={usersCaptionId}
              className="mf-table-wrapper"
            >
              <table style={usersTableVars}>
                <caption id={usersCaptionId} className="sr-only">
                  Registered LazyMindmap users (server-side paginated)
                </caption>
                <thead>
                  <tr>
                    <th scope="col">User</th>
                    <th scope="col">Plan</th>
                    <th scope="col">Trials</th>
                    <th scope="col">Monthly AI</th>
                    <th scope="col">Signals</th>
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(usersData?.items || []).map((u) => (
                    <tr key={u.uid}>
                      <th scope="row">
                        <div className="mf-cell-title">
                          {u.email || u.uid}
                          {u.role === "admin" && (
                            <span className="mf-pill-badge is-admin">admin</span>
                          )}
                        </div>
                        <div className="mf-cell-sub">
                          {u.displayName || "No name"} ·{" "}
                          {u.emailVerified ? "Verified" : "Unverified"}
                        </div>
                      </th>
                      <td>
                        <div className="mf-cell-title">
                          {u.subscription.plan} ({u.subscription.status})
                        </div>
                        {u.subscription.expiresAt && (
                          <div className="mf-cell-sub">
                            Exp: {new Date(u.subscription.expiresAt).toLocaleDateString()}
                          </div>
                        )}
                      </td>
                      <td>
                        {u.trial.used} / {u.trial.limit}
                      </td>
                      <td>
                        {u.quota.monthlyUsed} / {u.quota.monthlyLimit}
                        <div className="mf-cell-sub">
                          Today: {u.quota.dailyUsed}/{u.quota.dailyLimit}
                        </div>
                      </td>
                      <td>
                        {u.lastGeo?.country || "—"}
                        <div className="mf-cell-sub">
                          {u.lastIpHashPrefix ? `IP#${u.lastIpHashPrefix}` : "No IP"}
                          {u.hasDeviceSignal ? " · DevFP" : ""}
                        </div>
                      </td>
                      <td>
                        <span className={`mf-status-pill is-${u.status}`}>{u.status}</span>
                      </td>
                      <td>
                        <div className="mf-table-actions">
                          <button
                            type="button"
                            className="mf-chip-btn"
                            onClick={() =>
                              void handleUserAction(
                                u.uid,
                                { grantPlan: "monthly" },
                                `Granted 30d Monthly Pro to ${u.email || u.uid}`
                              )
                            }
                          >
                            +30d
                          </button>
                          <button
                            type="button"
                            className="mf-chip-btn"
                            onClick={() =>
                              void handleUserAction(
                                u.uid,
                                { grantPlan: "yearly" },
                                `Granted 365d Yearly Pro to ${u.email || u.uid}`
                              )
                            }
                          >
                            +1yr
                          </button>
                          <button
                            type="button"
                            className="mf-chip-btn"
                            onClick={() =>
                              void handleUserAction(
                                u.uid,
                                { resetTrials: true },
                                `Reset AI trials for ${u.email || u.uid}`
                              )
                            }
                          >
                            Reset Trials
                          </button>
                          <button
                            type="button"
                            className="mf-chip-btn"
                            onClick={() =>
                              void handleUserAction(
                                u.uid,
                                {
                                  status: u.status === "suspended" ? "active" : "suspended",
                                },
                                `${
                                  u.status === "suspended" ? "Activated" : "Suspended"
                                } ${u.email || u.uid}`
                              )
                            }
                          >
                            {u.status === "suspended" ? "Activate" : "Suspend"}
                          </button>
                          {u.subscription.status === "active" && (
                            <button
                              type="button"
                              className="mf-chip-btn"
                              onClick={() =>
                                void handleUserAction(
                                  u.uid,
                                  { revokeSubscription: true },
                                  `Revoked Pro plan for ${u.email || u.uid}`
                                )
                              }
                            >
                              Revoke
                            </button>
                          )}
                          <button
                            type="button"
                            className="mf-chip-btn"
                            onClick={() =>
                              void handleUserAction(
                                u.uid,
                                { role: u.role === "admin" ? "user" : "admin" },
                                `Updated role for ${u.email || u.uid}`
                              )
                            }
                          >
                            <Shield size={11} /> {u.role === "admin" ? "Demote" : "Make Admin"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!loadingUsers && (usersData?.items.length || 0) === 0 && (
                    <tr>
                      <td colSpan={7} className="mf-empty-cell">
                        No users match the current filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {usersData && (
              <div className="mf-pagination-bar">
                <span>
                  Page {usersData.page} of {usersData.totalPages} ({usersData.total} total)
                </span>
                <div className="mf-inline-actions">
                  <button
                    type="button"
                    className="mf-btn"
                    disabled={!usersData.hasPrevPage || loadingUsers}
                    onClick={() => setUsersPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft size={14} aria-hidden="true" /> Prev
                  </button>
                  <button
                    type="button"
                    className="mf-btn"
                    disabled={!usersData.hasNextPage || loadingUsers}
                    onClick={() => setUsersPage((p) => p + 1)}
                  >
                    Next <ChevronRight size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "payments" && (
          <div className="mf-admin-section">
            <div className="mf-admin-filters">
              <input
                type="search"
                aria-label="Search payments"
                placeholder="Search email, Tx ID, ref code…"
                value={paymentsSearch}
                onChange={(e) => {
                  setPaymentsSearch(e.target.value);
                  setPaymentsPage(1);
                }}
              />
              <select
                className="mf-select"
                aria-label="Filter payments by status"
                value={paymentsStatusFilter}
                onChange={(e) => {
                  setPaymentsStatusFilter(e.target.value);
                  setPaymentsPage(1);
                }}
              >
                <option value="pending">Pending Review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="all">All Submissions</option>
              </select>
              <select
                className="mf-select"
                aria-label="Payments per page"
                value={paymentsPageSize}
                onChange={(e) => {
                  setPaymentsPageSize(Number(e.target.value));
                  setPaymentsPage(1);
                }}
              >
                <option value={10}>10 / page</option>
                <option value={20}>20 / page</option>
                <option value={50}>50 / page</option>
              </select>
              <button type="button" className="mf-btn" onClick={() => void loadPayments()}>
                <RefreshCw
                  size={14}
                  className={loadingPayments ? "mf-spin" : ""}
                  aria-hidden="true"
                />
              </button>
            </div>

            {receiptPreview && (
              <div className="mf-admin-receipt-drawer">
                <div className="mf-admin-receipt-head">
                  <strong>
                    Receipt · {receiptPreview.payment.userEmail || receiptPreview.payment.uid} · Tx{" "}
                    <code>{receiptPreview.payment.transactionId}</code>
                  </strong>
                  <button
                    type="button"
                    className="mf-btn"
                    onClick={() => {
                      URL.revokeObjectURL(receiptPreview.blobUrl);
                      setReceiptPreview(null);
                    }}
                  >
                    <X size={14} aria-hidden="true" /> Close Preview
                  </button>
                </div>
                <img
                  src={receiptPreview.blobUrl}
                  alt={`KBZPay receipt for ${receiptPreview.payment.transactionId}`}
                  className="mf-admin-receipt-img"
                />
              </div>
            )}

            <div
              tabIndex={0}
              role="region"
              aria-labelledby={paymentsCaptionId}
              className="mf-table-wrapper"
            >
              <table style={paymentsTableVars}>
                <caption id={paymentsCaptionId} className="sr-only">
                  KBZPay payment submissions (server-side paginated)
                </caption>
                <thead>
                  <tr>
                    <th scope="col">User</th>
                    <th scope="col">Plan &amp; MMK</th>
                    <th scope="col">Tx ID</th>
                    <th scope="col">Status</th>
                    <th scope="col">Receipt</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(paymentsData?.items || []).map((p) => (
                    <tr key={p.id}>
                      <th scope="row">
                        <div className="mf-cell-title">{p.userEmail || p.uid}</div>
                        <div className="mf-cell-sub">
                          {new Date(p.createdAt).toLocaleString()} · Ref {p.referenceCode}
                        </div>
                      </th>
                      <td>
                        <strong>{p.plan}</strong> · {p.amountMmk.toLocaleString()} MMK
                      </td>
                      <td>
                        <code>{p.transactionId}</code>
                        {p.note && <div className="mf-cell-sub">{p.note}</div>}
                      </td>
                      <td>
                        <span className={`mf-status-pill is-${p.status}`}>{p.status}</span>
                      </td>
                      <td>
                        {p.hasReceipt ? (
                          <button
                            type="button"
                            className="mf-chip-btn"
                            onClick={() => void handleViewReceipt(p)}
                          >
                            <Eye size={12} aria-hidden="true" /> View Image
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {p.status === "pending" ? (
                          <div className="mf-table-actions">
                            <button
                              type="button"
                              className="mf-chip-btn is-active"
                              onClick={() => void handleReviewPayment(p.id, "approve")}
                            >
                              <Check size={12} aria-hidden="true" /> Approve
                            </button>
                            <button
                              type="button"
                              className="mf-chip-btn"
                              onClick={() => void handleReviewPayment(p.id, "reject")}
                            >
                              <X size={12} aria-hidden="true" /> Reject
                            </button>
                          </div>
                        ) : (
                          <span className="mf-cell-sub">
                            {p.reviewedBy ? `By ${p.reviewedBy}` : "Reviewed"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!loadingPayments && (paymentsData?.items.length || 0) === 0 && (
                    <tr>
                      <td colSpan={6} className="mf-empty-cell">
                        No KBZPay submissions match this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {paymentsData && (
              <div className="mf-pagination-bar">
                <span>
                  Page {paymentsData.page} of {paymentsData.totalPages} ({paymentsData.total} total)
                </span>
                <div className="mf-inline-actions">
                  <button
                    type="button"
                    className="mf-btn"
                    disabled={!paymentsData.hasPrevPage || loadingPayments}
                    onClick={() => setPaymentsPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft size={14} aria-hidden="true" /> Prev
                  </button>
                  <button
                    type="button"
                    className="mf-btn"
                    disabled={!paymentsData.hasNextPage || loadingPayments}
                    onClick={() => setPaymentsPage((p) => p + 1)}
                  >
                    Next <ChevronRight size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "ai" && (
          <form className="mf-admin-ai-form" onSubmit={handleSaveAiConfig}>
            <datalist id={modelListId}>
              {(
                aiConfig?.curatedModels || [
                  "gemini-3.1-flash-lite",
                  "gemini-3.1-flash",
                  "gemini-2.5-flash",
                  "gemini-2.5-flash-lite",
                  "gemini-2.5-pro",
                ]
              ).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>

            <div className="mf-admin-ai-grid">
              <div className="mf-form-field">
                <label htmlFor="admin-managed-model">Managed Pro Gemini Model</label>
                <input
                  id="admin-managed-model"
                  type="text"
                  list={modelListId}
                  value={managedModel}
                  onChange={(e) => setManagedModel(e.target.value)}
                  required
                />
              </div>

              <div className="mf-form-field">
                <label htmlFor="admin-trial-model">Free Trial (AI Studio) Model</label>
                <input
                  id="admin-trial-model"
                  type="text"
                  list={modelListId}
                  value={trialModel}
                  onChange={(e) => setTrialModel(e.target.value)}
                  required
                />
              </div>

              <div className="mf-form-field">
                <label htmlFor="admin-managed-key">
                  Managed Gemini API Key{" "}
                  {aiConfig?.hasManagedKey ? `(${aiConfig.managedKeyHint} · ${aiConfig.managedKeySource})` : "(Not set)"}
                </label>
                <div className="mf-password-row">
                  <input
                    id="admin-managed-key"
                    type="password"
                    autoComplete="off"
                    value={managedApiKeyInput}
                    onChange={(e) => setManagedApiKeyInput(e.target.value)}
                    placeholder="Enter new key to encrypt & rotate…"
                  />
                  <button
                    type="button"
                    className="mf-btn"
                    disabled={testingTarget !== null}
                    onClick={() => void handleTestKey("managed")}
                  >
                    {testingTarget === "managed" ? "Testing…" : "Test"}
                  </button>
                  {aiConfig?.managedKeySource === "vault" && (
                    <button
                      type="button"
                      className="mf-btn"
                      onClick={() => void handleClearKey("managed")}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div className="mf-form-field">
                <label htmlFor="admin-trial-key">
                  Trial AI Studio API Key{" "}
                  {aiConfig?.hasTrialKey ? `(${aiConfig.trialKeyHint} · ${aiConfig.trialKeySource})` : "(Falls back to Managed key)"}
                </label>
                <div className="mf-password-row">
                  <input
                    id="admin-trial-key"
                    type="password"
                    autoComplete="off"
                    value={trialApiKeyInput}
                    onChange={(e) => setTrialApiKeyInput(e.target.value)}
                    placeholder="Enter AI Studio key to encrypt & save…"
                  />
                  <button
                    type="button"
                    className="mf-btn"
                    disabled={testingTarget !== null}
                    onClick={() => void handleTestKey("trial")}
                  >
                    {testingTarget === "trial" ? "Testing…" : "Test"}
                  </button>
                  {aiConfig?.trialKeySource === "vault" && (
                    <button
                      type="button"
                      className="mf-btn"
                      onClick={() => void handleClearKey("trial")}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div className="mf-form-field">
                <label htmlFor="admin-monthly-quota">Monthly Fair-Use Msg Cap</label>
                <input
                  id="admin-monthly-quota"
                  type="number"
                  min={1}
                  max={10000}
                  value={monthlyQuota}
                  onChange={(e) => setMonthlyQuota(Number(e.target.value))}
                />
              </div>

              <div className="mf-form-field">
                <label htmlFor="admin-daily-quota">Daily Fair-Use Msg Cap</label>
                <input
                  id="admin-daily-quota"
                  type="number"
                  min={1}
                  max={2000}
                  value={dailyQuota}
                  onChange={(e) => setDailyQuota(Number(e.target.value))}
                />
              </div>

              <div className="mf-form-field">
                <label htmlFor="admin-trial-count">Free Trials Per Account/Device</label>
                <input
                  id="admin-trial-count"
                  type="number"
                  min={0}
                  max={20}
                  value={maxTrialCount}
                  onChange={(e) => setMaxTrialCount(Number(e.target.value))}
                />
              </div>

              <div className="mf-form-field">
                <label htmlFor="admin-monthly-price">Monthly Price (MMK)</label>
                <input
                  id="admin-monthly-price"
                  type="number"
                  min={100}
                  step={100}
                  value={monthlyPriceMmk}
                  onChange={(e) => setMonthlyPriceMmk(Number(e.target.value))}
                />
              </div>

              <div className="mf-form-field">
                <label htmlFor="admin-yearly-price">Yearly Price (MMK)</label>
                <input
                  id="admin-yearly-price"
                  type="number"
                  min={100}
                  step={100}
                  value={yearlyPriceMmk}
                  onChange={(e) => setYearlyPriceMmk(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="mf-admin-ai-footer">
              <span className="mf-help-text">
                <KeyRound size={12} aria-hidden="true" /> Keys are encrypted at rest with
                AES-256-GCM and never returned in plaintext to any client.
              </span>
              <button type="submit" className="mf-btn mf-btn-primary" disabled={savingAi}>
                {savingAi && <Loader2 size={14} className="mf-spin" aria-hidden="true" />}
                <span>Save AI Settings</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </NativeDialog>
  );
}
