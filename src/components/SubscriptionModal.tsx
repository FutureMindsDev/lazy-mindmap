import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Camera,
  Check,
  CheckCircle2,
  Copy,
  Crown,
  Loader2,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import kbzpayQrUrl from "../assets/kbzpay_qr.jpg";
import type { PaymentSubmission, UserAccountState } from "../types/mindmap";
import { fetchBillingStatus, submitKbzPayPayment } from "../utils/accountApi";
import { NativeDialog } from "./NativeDialog";

const KBZPAY_PAYEE_NAME = "Arkar Chan Myae (*******4519)";

interface SubscriptionModalProps {
  open: boolean;
  onClose: () => void;
  account: UserAccountState;
  onOpenAuth: () => void;
  onRefreshAccount: () => Promise<UserAccountState | null>;
  onAnnounce: (msg: string) => void;
}

async function compressImageFileToJpegDataUrl(source: File | Blob): Promise<string> {
  const bitmap = await createImageBitmap(source);
  const maxDim = 1600;
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.84);
}

export function SubscriptionModal({
  open,
  onClose,
  account,
  onOpenAuth,
  onRefreshAccount,
  onAnnounce,
}: SubscriptionModalProps) {
  const [plan, setPlan] = useState<"monthly" | "yearly">("monthly");
  const [transactionId, setTransactionId] = useState("");
  const [note, setNote] = useState("");
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string>("");
  const [submissions, setSubmissions] = useState<PaymentSubmission[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedRef, setCopiedRef] = useState(false);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mobileCameraInputRef = useRef<HTMLInputElement>(null);

  const stopCamera = () => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraOpen(false);
  };

  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }
    if (!account.authenticated) return;
    let active = true;
    setLoadingList(true);
    fetchBillingStatus()
      .then((res) => {
        if (active) setSubmissions(res.submissions || []);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingList(false);
      });
    return () => {
      active = false;
      stopCamera();
    };
  }, [open, account.authenticated]);

  const handleOpenWebcam = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      mobileCameraInputRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      // Fallback to native mobile camera file capture if permission/device unavailable
      setCameraError("Webcam unavailable here — opening device camera / photo picker instead.");
      mobileCameraInputRef.current?.click();
    }
  };

  const handleCapturePhoto = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const maxDim = 1600;
    const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.max(1, Math.round(video.videoWidth * scale));
    const h = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    setScreenshotDataUrl(canvas.toDataURL("image/jpeg", 0.85));
    stopCamera();
    onAnnounce("Captured payment screenshot");
  };

  const handleFilePicked = async (file?: File | null) => {
    if (!file) return;
    setError(null);
    try {
      const compressed = await compressImageFileToJpegDataUrl(file);
      setScreenshotDataUrl(compressed);
    } catch {
      setError("Could not read that image. Please choose a valid PNG, JPG, or WebP screenshot.");
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!screenshotDataUrl) {
      setError("Please upload or capture your KBZPay payment screenshot.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitKbzPayPayment({
        plan,
        transactionId: transactionId.trim(),
        note: note.trim(),
        screenshotDataUrl,
      });
      setSubmissions((prev) => [res.submission, ...prev]);
      setTransactionId("");
      setNote("");
      setScreenshotDataUrl("");
      setNotice(
        "Payment screenshot uploaded to cloud database! An admin will review and activate your Pro AI plan shortly."
      );
      await onRefreshAccount();
      onAnnounce("KBZPay receipt submitted for review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit payment screenshot.");
    } finally {
      setSubmitting(false);
    }
  };

  const monthlyMmk = account.billing.monthlyPriceMmk || 1000;
  const yearlyMmk = account.billing.yearlyPriceMmk || 10000;
  const refCode = account.billing.referenceCode || "LM-GUEST";
  const selectedPrice = plan === "yearly" ? yearlyMmk : monthlyMmk;

  return (
    <NativeDialog
      open={open}
      onClose={() => {
        stopCamera();
        onClose();
      }}
      title="AI Subscription (KBZPay)"
      maxWidth="740px"
    >
      <div className="mf-sub-wrap">
        <div className="mf-sub-free-banner">
          <strong>Mind mapping is always free.</strong> Only managed AI calls require a plan
          after your {account.billing.maxTrialCount} free trials — or you can use your own API key
          (BYOK) for free anytime.
        </div>

        {!account.authenticated ? (
          <div className="mf-alert-box is-info">
            <AlertCircle size={15} aria-hidden="true" />
            <div className="mf-alert-content">
              Please sign in first so we can link your KBZPay receipt to your account.
              <div className="mf-inline-actions" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="mf-btn mf-btn-primary"
                  onClick={() => {
                    onClose();
                    onOpenAuth();
                  }}
                >
                  Sign In / Create Account
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="mf-sub-plans" role="radiogroup" aria-label="Choose AI subscription plan">
              <button
                type="button"
                role="radio"
                aria-checked={plan === "monthly"}
                className={`mf-plan-card ${plan === "monthly" ? "is-selected" : ""}`}
                onClick={() => setPlan("monthly")}
              >
                <div className="mf-plan-top">
                  <span className="mf-plan-name">Monthly Pro AI</span>
                  <span className="mf-plan-price">{monthlyMmk.toLocaleString()} MMK / mo</span>
                </div>
                <div className="mf-plan-desc">
                  Model: <code>{account.billing.managedModel}</code> ·{" "}
                  {account.billing.monthlyQuota} msgs/mo ({account.billing.dailyQuota}/day)
                </div>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={plan === "yearly"}
                className={`mf-plan-card ${plan === "yearly" ? "is-selected" : ""}`}
                onClick={() => setPlan("yearly")}
              >
                <div className="mf-plan-top">
                  <span className="mf-plan-name">
                    Yearly Pro AI <span className="mf-pill-badge is-save">Save 17%</span>
                  </span>
                  <span className="mf-plan-price">{yearlyMmk.toLocaleString()} MMK / yr</span>
                </div>
                <div className="mf-plan-desc">
                  Model: <code>{account.billing.managedModel}</code> ·{" "}
                  {account.billing.monthlyQuota} msgs/mo ({account.billing.dailyQuota}/day)
                </div>
              </button>
            </div>

            <div className="mf-kbz-grid">
              <div className="mf-kbz-qr-card">
                <img
                  src={kbzpayQrUrl}
                  alt="KBZPay QR code for Arkar Chan Myae"
                  className="mf-kbz-qr-img"
                />
                <div className="mf-kbz-payee">
                  <ShieldCheck size={14} aria-hidden="true" />
                  <span>{KBZPAY_PAYEE_NAME}</span>
                </div>
                <p className="mf-kbz-warning">
                  Verify the recipient name matches <strong>{KBZPAY_PAYEE_NAME}</strong> in KBZPay
                  before transferring <strong>{selectedPrice.toLocaleString()} MMK</strong>.
                </p>
                <div className="mf-kbz-ref-row">
                  <span>Transfer note / ref:</span>
                  <code>{refCode}</code>
                  <button
                    type="button"
                    className="mf-chip-btn"
                    onClick={() => {
                      void navigator.clipboard?.writeText(refCode);
                      setCopiedRef(true);
                      setTimeout(() => setCopiedRef(false), 1800);
                    }}
                  >
                    {copiedRef ? <Check size={12} /> : <Copy size={12} />}
                    <span>{copiedRef ? "Copied" : "Copy"}</span>
                  </button>
                </div>
              </div>

              <form className="mf-kbz-form" onSubmit={handleSubmit}>
                <div className="mf-form-field">
                  <label htmlFor="kbz-tx-id">KBZPay Transaction ID *</label>
                  <input
                    id="kbz-tx-id"
                    name="transactionId"
                    type="text"
                    required
                    minLength={6}
                    maxLength={40}
                    value={transactionId}
                    onChange={(e) => setTransactionId(e.target.value)}
                    placeholder="e.g. 012345678901"
                  />
                </div>

                <div className="mf-form-field">
                  <label htmlFor="kbz-note">Optional Note</label>
                  <input
                    id="kbz-note"
                    name="note"
                    type="text"
                    maxLength={300}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={`Memo: ${refCode}`}
                  />
                </div>

                <div className="mf-form-field">
                  <span className="mf-field-label">Payment Screenshot *</span>
                  <div className="mf-inline-actions">
                    <button
                      type="button"
                      className="mf-btn mf-btn-outline"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload size={14} aria-hidden="true" /> Choose File
                    </button>
                    <button
                      type="button"
                      className="mf-btn mf-btn-outline"
                      onClick={handleOpenWebcam}
                    >
                      <Camera size={14} aria-hidden="true" /> Use Camera
                    </button>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    onChange={(e) => void handleFilePicked(e.target.files?.[0])}
                  />
                  <input
                    ref={mobileCameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    onChange={(e) => void handleFilePicked(e.target.files?.[0])}
                  />
                </div>

                {cameraError && (
                  <p className="mf-help-text" role="status">
                    {cameraError}
                  </p>
                )}

                {cameraOpen && (
                  <div className="mf-camera-box">
                    <video ref={videoRef} playsInline muted className="mf-camera-video" />
                    <div className="mf-inline-actions">
                      <button
                        type="button"
                        className="mf-btn mf-btn-primary"
                        onClick={handleCapturePhoto}
                      >
                        <Camera size={14} aria-hidden="true" /> Capture Photo
                      </button>
                      <button type="button" className="mf-btn" onClick={stopCamera}>
                        <X size={14} aria-hidden="true" /> Cancel
                      </button>
                    </div>
                  </div>
                )}

                {screenshotDataUrl && (
                  <div className="mf-receipt-preview-box">
                    <img
                      src={screenshotDataUrl}
                      alt="KBZPay receipt preview"
                      className="mf-receipt-preview-img"
                    />
                    <button
                      type="button"
                      className="mf-chip-btn"
                      onClick={() => setScreenshotDataUrl("")}
                    >
                      Remove
                    </button>
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

                <button type="submit" className="mf-btn mf-btn-primary" disabled={submitting}>
                  {submitting ? (
                    <Loader2 size={15} className="mf-spin" aria-hidden="true" />
                  ) : (
                    <Crown size={15} aria-hidden="true" />
                  )}
                  <span>
                    Submit {plan === "yearly" ? "Yearly" : "Monthly"} Receipt (
                    {selectedPrice.toLocaleString()} MMK)
                  </span>
                </button>
              </form>
            </div>

            <div className="mf-submissions-box">
              <h4>Your Payment History</h4>
              {loadingList ? (
                <p className="mf-help-text">Loading payment history…</p>
              ) : submissions.length === 0 ? (
                <p className="mf-help-text">No payment submissions yet.</p>
              ) : (
                <div className="mf-submissions-list">
                  {submissions.map((s) => (
                    <div key={s.id} className="mf-submission-row">
                      <div>
                        <strong>
                          {s.plan === "yearly" ? "Yearly" : "Monthly"} ·{" "}
                          {s.amountMmk.toLocaleString()} MMK
                        </strong>
                        <div className="mf-help-text">
                          Tx: <code>{s.transactionId}</code> ·{" "}
                          {new Date(s.createdAt).toLocaleDateString()}
                        </div>
                        {s.reviewNote && (
                          <div className="mf-help-text">Admin note: {s.reviewNote}</div>
                        )}
                      </div>
                      <span className={`mf-status-pill is-${s.status}`}>{s.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </NativeDialog>
  );
}
