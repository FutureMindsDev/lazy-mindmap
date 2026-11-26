import { useState, type FormEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Crown,
  Eye,
  EyeOff,
  Loader2,
  LogOut,
  MailCheck,
  Shield,
  Sparkles,
} from "lucide-react";
import type { UserAccountState } from "../types/mindmap";
import {
  formatFirebaseAuthError,
  isFirebaseWebConfigured,
  reloadFirebaseUser,
  resendEmailVerification,
  sendPasswordReset,
  signInWithEmail,
  signInWithFacebook,
  signInWithGoogle,
  signUpWithEmail,
  type DevPreviewUser,
} from "../utils/firebaseClient";
import { NativeDialog } from "./NativeDialog";

type AuthTab = "signin" | "signup" | "reset";

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  account: UserAccountState;
  onRefreshAccount: (forceTokenRefresh?: boolean) => Promise<UserAccountState | null>;
  onSignInDevUser: (user: DevPreviewUser) => Promise<void>;
  onSignOut: () => Promise<void>;
  onOpenSubscription: () => void;
  onOpenAdmin: () => void;
  onAnnounce: (msg: string) => void;
}

export function AuthModal({
  open,
  onClose,
  account,
  onRefreshAccount,
  onSignInDevUser,
  onSignOut,
  onOpenSubscription,
  onOpenAdmin,
  onAnnounce,
}: AuthModalProps) {
  const [tab, setTab] = useState<AuthTab>("signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const firebaseReady = account.firebaseConfigured && isFirebaseWebConfigured();
  const isDevEnv = import.meta.env.DEV;

  const resetMessages = () => {
    setError(null);
    setNotice(null);
  };

  const handleSignInSubmit = async (e: FormEvent) => {
    e.preventDefault();
    resetMessages();
    setBusy(true);
    try {
      await signInWithEmail(email, password);
      await onRefreshAccount(true);
      onAnnounce("Signed in to LazyMindmap");
      onClose();
    } catch (err) {
      setError(formatFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSignUpSubmit = async (e: FormEvent) => {
    e.preventDefault();
    resetMessages();
    setBusy(true);
    try {
      await signUpWithEmail(fullName, email, password);
      await onRefreshAccount(true);
      setNotice(
        "Account created! Check your inbox for a verification email to unlock your 3 free AI trials."
      );
      onAnnounce("Account created. Please verify your email.");
    } catch (err) {
      setError(formatFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleResetSubmit = async (e: FormEvent) => {
    e.preventDefault();
    resetMessages();
    setBusy(true);
    try {
      await sendPasswordReset(email);
      setNotice("Password reset link sent. Please check your email.");
    } catch (err) {
      setError(formatFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleOAuth = async (provider: "google" | "facebook") => {
    resetMessages();
    setBusy(true);
    try {
      const user =
        provider === "google" ? await signInWithGoogle() : await signInWithFacebook();
      if (user) {
        await onRefreshAccount(true);
        onAnnounce(`Signed in with ${provider === "google" ? "Google" : "Facebook"}`);
        onClose();
      }
    } catch (err) {
      setError(formatFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleResendVerification = async () => {
    resetMessages();
    setBusy(true);
    try {
      await resendEmailVerification();
      setNotice("Verification email sent. Check your inbox and spam folder.");
    } catch (err) {
      setError(formatFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCheckVerification = async () => {
    resetMessages();
    setBusy(true);
    try {
      await reloadFirebaseUser();
      const updated = await onRefreshAccount(true);
      if (updated?.user?.emailVerified) {
        setNotice("Email verified! Your 3 free AI trials are ready.");
      } else {
        setError("Email is not verified yet. Click the verification link in your email first.");
      }
    } catch (err) {
      setError(formatFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDevLogin = async (kind: "user" | "admin") => {
    resetMessages();
    setBusy(true);
    try {
      const devUser: DevPreviewUser =
        kind === "admin"
          ? {
              uid: "dev_admin_01",
              email: "admin@lazymindmap.local",
              displayName: "Admin Preview",
              emailVerified: true,
              isAdmin: true,
            }
          : {
              uid: "dev_user_01",
              email: "user@lazymindmap.local",
              displayName: "Demo User",
              emailVerified: true,
              isAdmin: false,
            };
      await onSignInDevUser(devUser);
      onAnnounce(`Signed in as ${devUser.displayName} (local dev)`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dev login failed");
    } finally {
      setBusy(false);
    }
  };

  if (account.authenticated && account.user) {
    const sub = account.subscription;
    const trial = account.trial;
    const quota = account.quota;
    const isSubActive = sub?.status === "active";

    return (
      <NativeDialog open={open} onClose={onClose} title="Your Account" maxWidth="520px">
        <div className="mf-account-card">
          <div className="mf-account-header">
            <div className="mf-account-avatar" aria-hidden="true">
              {(account.user.displayName || account.user.email || "U").slice(0, 1).toUpperCase()}
            </div>
            <div className="mf-account-meta">
              <div className="mf-account-name">
                <span>{account.user.displayName || "LazyMindmap User"}</span>
                {account.isAdmin && (
                  <span className="mf-pill-badge is-admin">
                    <Shield size={11} aria-hidden="true" /> Admin
                  </span>
                )}
              </div>
              <div className="mf-account-email">{account.user.email}</div>
            </div>
          </div>

          {!account.user.emailVerified && firebaseReady && (
            <div className="mf-alert-box is-warn">
              <AlertCircle size={15} aria-hidden="true" />
              <div className="mf-alert-content">
                <strong>Email not verified yet.</strong> Verify your email to unlock your{" "}
                {account.billing.maxTrialCount} free AI trials.
                <div className="mf-inline-actions">
                  <button
                    type="button"
                    className="mf-chip-btn"
                    disabled={busy}
                    onClick={handleResendVerification}
                  >
                    <MailCheck size={13} aria-hidden="true" /> Resend Email
                  </button>
                  <button
                    type="button"
                    className="mf-chip-btn"
                    disabled={busy}
                    onClick={handleCheckVerification}
                  >
                    I Verified — Refresh
                  </button>
                </div>
              </div>
            </div>
          )}

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

          <div className="mf-account-stats">
            <div className="mf-stat-tile">
              <span className="mf-stat-label">
                <Cloud size={13} aria-hidden="true" /> Mind Maps
              </span>
              <strong>Free Cloud Sync</strong>
              <small>All editing &amp; export features are free</small>
            </div>
            <div className="mf-stat-tile">
              <span className="mf-stat-label">
                <Sparkles size={13} aria-hidden="true" /> AI Plan
              </span>
              <strong>
                {isSubActive
                  ? `Pro (${sub?.plan === "yearly" ? "Yearly" : "Monthly"})`
                  : sub?.status === "pending"
                  ? "Payment Pending Review"
                  : "Free Tier + BYOK"}
              </strong>
              <small>
                {isSubActive && quota
                  ? `${quota.monthlyRemaining}/${quota.monthlyLimit} monthly · ${quota.dailyRemaining}/${quota.dailyLimit} today`
                  : `${trial?.remaining ?? 0}/${trial?.limit ?? 3} free AI trials left`}
              </small>
            </div>
          </div>

          <div className="mf-account-actions">
            <button
              type="button"
              className="mf-btn mf-btn-primary"
              onClick={() => {
                onClose();
                onOpenSubscription();
              }}
            >
              <Crown size={15} aria-hidden="true" />
              <span>{isSubActive ? "Manage AI Subscription" : "Upgrade AI with KBZPay"}</span>
            </button>

            {account.isAdmin && (
              <button
                type="button"
                className="mf-btn mf-btn-outline"
                onClick={() => {
                  onClose();
                  onOpenAdmin();
                }}
              >
                <Shield size={15} aria-hidden="true" />
                <span>Admin Dashboard</span>
              </button>
            )}

            <button
              type="button"
              className="mf-btn mf-btn-outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onSignOut();
                setBusy(false);
                onAnnounce("Signed out");
                onClose();
              }}
            >
              <LogOut size={15} aria-hidden="true" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </NativeDialog>
    );
  }

  return (
    <NativeDialog open={open} onClose={onClose} title="Sign In or Create Account" maxWidth="470px">
      <div className="mf-auth-wrap">
        <p className="mf-auth-subtitle">
          Mind mapping is <strong>100% free</strong> for guests and signed-in users. Sign in for
          cloud map sync, encrypted BYOK key vault, and{" "}
          <strong>{account.billing.maxTrialCount} free AI trials</strong>.
        </p>

        {firebaseReady ? (
          <>
            <div className="mf-oauth-row">
              <button
                type="button"
                className="mf-btn mf-oauth-btn"
                disabled={busy}
                onClick={() => handleOAuth("google")}
              >
                <span>Continue with Google</span>
              </button>
              <button
                type="button"
                className="mf-btn mf-oauth-btn"
                disabled={busy}
                onClick={() => handleOAuth("facebook")}
              >
                <span>Continue with Facebook</span>
              </button>
            </div>

            <div className="mf-auth-divider">
              <span>or use email</span>
            </div>

            <div className="mf-auth-tabs" role="tablist" aria-label="Authentication mode">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "signin"}
                className={`mf-chip-btn ${tab === "signin" ? "is-active" : ""}`}
                onClick={() => {
                  setTab("signin");
                  resetMessages();
                }}
              >
                Sign In
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "signup"}
                className={`mf-chip-btn ${tab === "signup" ? "is-active" : ""}`}
                onClick={() => {
                  setTab("signup");
                  resetMessages();
                }}
              >
                Create Account
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "reset"}
                className={`mf-chip-btn ${tab === "reset" ? "is-active" : ""}`}
                onClick={() => {
                  setTab("reset");
                  resetMessages();
                }}
              >
                Forgot Password
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

            {tab === "signin" && (
              <form className="mf-auth-form" onSubmit={handleSignInSubmit}>
                <div className="mf-form-field">
                  <label htmlFor="auth-signin-email">Email</label>
                  <input
                    id="auth-signin-email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    spellCheck={false}
                    enterKeyHint="next"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                <div className="mf-form-field">
                  <label htmlFor="auth-signin-password">Password</label>
                  <div className="mf-password-row">
                    <input
                      id="auth-signin-password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      enterKeyHint="done"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                    />
                    <button
                      type="button"
                      className="mf-btn"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      onClick={() => setShowPassword((s) => !s)}
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
                <div className="mf-auth-form-footer">
                  <button
                    type="button"
                    className="mf-link-btn"
                    onClick={() => {
                      setTab("reset");
                      resetMessages();
                    }}
                  >
                    Forgot password?
                  </button>
                  <button type="submit" className="mf-btn mf-btn-primary" disabled={busy}>
                    {busy && <Loader2 size={14} className="mf-spin" aria-hidden="true" />}
                    <span>Sign In</span>
                  </button>
                </div>
              </form>
            )}

            {tab === "signup" && (
              <form className="mf-auth-form" onSubmit={handleSignUpSubmit}>
                <div className="mf-form-field">
                  <label htmlFor="auth-signup-name">Full name</label>
                  <input
                    id="auth-signup-name"
                    name="fullname"
                    type="text"
                    autoComplete="name"
                    enterKeyHint="next"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your name"
                  />
                </div>
                <div className="mf-form-field">
                  <label htmlFor="auth-signup-email">Email</label>
                  <input
                    id="auth-signup-email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    spellCheck={false}
                    enterKeyHint="next"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                <div className="mf-form-field">
                  <label htmlFor="auth-signup-password">Password (6+ characters)</label>
                  <div className="mf-password-row">
                    <input
                      id="auth-signup-password"
                      name="new-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      enterKeyHint="done"
                      minLength={6}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Create a strong password"
                    />
                    <button
                      type="button"
                      className="mf-btn"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      onClick={() => setShowPassword((s) => !s)}
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
                <button type="submit" className="mf-btn mf-btn-primary" disabled={busy}>
                  {busy && <Loader2 size={14} className="mf-spin" aria-hidden="true" />}
                  <span>Create Account</span>
                </button>
              </form>
            )}

            {tab === "reset" && (
              <form className="mf-auth-form" onSubmit={handleResetSubmit}>
                <div className="mf-form-field">
                  <label htmlFor="auth-reset-email">Account email</label>
                  <input
                    id="auth-reset-email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    spellCheck={false}
                    enterKeyHint="done"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                <button type="submit" className="mf-btn mf-btn-primary" disabled={busy}>
                  {busy && <Loader2 size={14} className="mf-spin" aria-hidden="true" />}
                  <span>Send Reset Link</span>
                </button>
              </form>
            )}
          </>
        ) : (
          <div className="mf-alert-box is-info">
            <AlertCircle size={15} aria-hidden="true" />
            <div className="mf-alert-content">
              <strong>Firebase Auth keys not set in .env yet.</strong>
              <p style={{ margin: "4px 0 0" }}>
                Add <code>VITE_FIREBASE_API_KEY</code> and <code>VITE_FIREBASE_PROJECT_ID</code>{" "}
                from your Firebase project console to enable Email, Google, and Facebook sign-in.
              </p>
              {isDevEnv && (
                <div className="mf-inline-actions" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="mf-btn mf-btn-primary"
                    disabled={busy}
                    onClick={() => handleDevLogin("user")}
                  >
                    Dev Preview: Sign In as User
                  </button>
                  <button
                    type="button"
                    className="mf-btn mf-btn-outline"
                    disabled={busy}
                    onClick={() => handleDevLogin("admin")}
                  >
                    <Shield size={14} aria-hidden="true" /> Dev Preview: Admin
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </NativeDialog>
  );
}
