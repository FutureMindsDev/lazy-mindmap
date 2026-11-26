import { useState, type FormEvent } from "react";
import {
  AlertCircle,
  BadgeCheck,
  CheckCircle2,
  Cloud,
  Crown,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  MailCheck,
  Shield,
  Sparkles,
  UserPlus,
  UserRound,
  LockKeyhole,
} from "lucide-react";
import type { UserAccountState } from "../types/mindmap";
import {
  formatFirebaseAuthError,
  isFirebaseWebConfigured,
  reloadFirebaseUser,
  resendEmailVerification,
  sendPasswordReset,
  signInWithEmail,
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

/** Official-style, crisp 18×18 provider marks. Purely decorative (aria-hidden). */
function GoogleBrandIcon() {
  return (
    <svg
      className="mf-brand-icon mf-brand-icon-google"
      width="18"
      height="18"
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function FacebookBrandIcon() {
  return (
    <svg
      className="mf-brand-icon mf-brand-icon-facebook"
      width="18"
      height="18"
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#1877F2"
        d="M48 24C48 10.75 37.25 0 24 0S0 10.75 0 24c0 11.98 8.78 21.9 20.25 23.73V31.17H14.16V24h6.09v-5.42c0-6.01 3.58-9.34 9.07-9.34 2.63 0 5.38.47 5.38.47v5.91h-3.03c-2.98 0-3.91 1.85-3.91 3.75V24h6.66l-1.06 7.17h-5.6v16.56C39.22 45.9 48 35.98 48 24z"
      />
    </svg>
  );
}

/** Lightweight decorative mini mind-map hero for the auth dialog. */
function MindMapHero() {
  return (
    <div className="mf-auth-hero" aria-hidden="true">
      <svg
        className="mf-auth-hero-svg"
        viewBox="0 0 300 88"
        preserveAspectRatio="xMidYMid meet"
        focusable="false"
      >
        <g className="mf-hero-branches">
          <path d="M130 44 C100 44 96 18 64 18" />
          <path d="M130 44 C100 44 96 70 64 70" />
          <path d="M170 44 C200 44 204 18 236 18" />
          <path d="M170 44 C200 44 204 70 236 70" />
        </g>
        <g className="mf-hero-node mf-hero-node-a">
          <rect x="12" y="10" width="52" height="16" rx="8" />
          <circle cx="23" cy="18" r="3" />
        </g>
        <g className="mf-hero-node mf-hero-node-b">
          <rect x="12" y="62" width="52" height="16" rx="8" />
          <circle cx="23" cy="70" r="3" />
        </g>
        <g className="mf-hero-node mf-hero-node-c">
          <rect x="236" y="10" width="52" height="16" rx="8" />
          <circle cx="277" cy="18" r="3" />
        </g>
        <g className="mf-hero-node mf-hero-node-d">
          <rect x="236" y="62" width="52" height="16" rx="8" />
          <circle cx="277" cy="70" r="3" />
        </g>
        <g className="mf-hero-root">
          <rect x="130" y="32" width="40" height="24" rx="9" />
          <text x="150" y="44" textAnchor="middle" dominantBaseline="middle">
            M
          </text>
        </g>
      </svg>
    </div>
  );
}

/** Signed-in provider pill derived from the account's Firebase providers. */
function ProviderBadge({ provider }: { provider: string }) {
  const id = provider.toLowerCase();
  if (id.includes("google")) {
    return (
      <span className="mf-provider-badge">
        <GoogleBrandIcon /> Google
      </span>
    );
  }
  if (id.includes("facebook")) {
    return (
      <span className="mf-provider-badge">
        <FacebookBrandIcon /> Facebook
      </span>
    );
  }
  return (
    <span className="mf-provider-badge">
      <Mail size={12} aria-hidden="true" /> Email
    </span>
  );
}

/** Avatar that renders photoURL with a graceful initial-letter fallback. */
function AccountAvatar({ photoURL, initial }: { photoURL: string; initial: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const hasPhoto = Boolean(photoURL) && !imageFailed;
  return (
    <span className={`mf-account-avatar${hasPhoto ? " has-photo" : ""}`} aria-hidden="true">
      {hasPhoto ? <img src={photoURL} alt="" onError={() => setImageFailed(true)} /> : initial}
    </span>
  );
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

  const handleGoogleSignIn = async () => {
    resetMessages();
    setBusy(true);
    try {
      const user = await signInWithGoogle();
      if (user) {
        await onRefreshAccount(true);
        onAnnounce("Signed in with Google");
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
            <div className="mf-account-avatar-wrap">
              <AccountAvatar
                photoURL={account.user.photoURL}
                initial={(account.user.displayName || account.user.email || "U")
                  .slice(0, 1)
                  .toUpperCase()}
              />
              {account.user.emailVerified && (
                <span
                  className="mf-avatar-verified"
                  role="img"
                  aria-label="Email verified"
                  title="Email verified"
                >
                  <BadgeCheck size={15} aria-hidden="true" />
                </span>
              )}
            </div>
            <div className="mf-account-meta">
              <div className="mf-account-name">
                <span>{account.user.displayName || "LazyMindmap User"}</span>
                {account.isAdmin && (
                  <span className="mf-pill-badge is-admin">
                    <Shield size={11} aria-hidden="true" /> Admin
                  </span>
                )}
                {isSubActive && (
                  <span className="mf-pill-badge is-pro">
                    <Crown size={11} aria-hidden="true" /> Pro
                  </span>
                )}
              </div>
              <div className="mf-account-email-row">
                <span className="mf-account-email">{account.user.email}</span>
                <ProviderBadge provider={account.user.providers?.[0] ?? "password"} />
              </div>
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
                {account.isAdmin
                  ? "Admin (Unlimited)"
                  : isSubActive
                  ? `Pro (${sub?.plan === "yearly" ? "Yearly" : "Monthly"})`
                  : sub?.status === "pending"
                  ? "Payment Pending Review"
                  : "Free Tier + BYOK"}
              </strong>
              <small>
                {account.isAdmin
                  ? "Unlimited AI usage · No daily or monthly limits"
                  : isSubActive && quota
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
        <MindMapHero />
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
                className="mf-btn mf-oauth-btn mf-oauth-google"
                disabled={busy}
                onClick={handleGoogleSignIn}
              >
                <GoogleBrandIcon />
                <span>Continue with Google</span>
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
                <LogIn size={13} aria-hidden="true" /> Sign In
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
                <UserPlus size={13} aria-hidden="true" /> Create Account
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
                <KeyRound size={13} aria-hidden="true" /> Forgot Password
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
                  <div className="mf-input-adorned">
                    <Mail size={14} className="mf-input-icon" aria-hidden="true" />
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
                </div>
                <div className="mf-form-field">
                  <label htmlFor="auth-signin-password">Password</label>
                  <div className="mf-password-row">
                    <div className="mf-input-adorned">
                      <LockKeyhole size={14} className="mf-input-icon" aria-hidden="true" />
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
                    </div>
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
                  <div className="mf-input-adorned">
                    <UserRound size={14} className="mf-input-icon" aria-hidden="true" />
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
                </div>
                <div className="mf-form-field">
                  <label htmlFor="auth-signup-email">Email</label>
                  <div className="mf-input-adorned">
                    <Mail size={14} className="mf-input-icon" aria-hidden="true" />
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
                </div>
                <div className="mf-form-field">
                  <label htmlFor="auth-signup-password">Password (6+ characters)</label>
                  <div className="mf-password-row">
                    <div className="mf-input-adorned">
                      <LockKeyhole size={14} className="mf-input-icon" aria-hidden="true" />
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
                    </div>
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
                  <div className="mf-input-adorned">
                    <Mail size={14} className="mf-input-icon" aria-hidden="true" />
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
                from your Firebase project console to enable Email and Google sign-in.
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
