import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  FacebookAuthProvider,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
  type Auth,
  type User,
} from "firebase/auth";

export interface DevPreviewUser {
  uid: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  isAdmin: boolean;
}

const DEV_SESSION_STORAGE_KEY = "lazymindmap:devAuthUser";

const firebaseWebConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
};

export function isFirebaseWebConfigured(): boolean {
  return Boolean(firebaseWebConfig.apiKey && firebaseWebConfig.projectId);
}

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;

function getFirebaseClientAuth(): Auth | null {
  if (!isFirebaseWebConfigured()) return null;
  if (!cachedApp) {
    cachedApp = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseWebConfig);
  }
  if (!cachedAuth) {
    cachedAuth = getAuth(cachedApp);
  }
  return cachedAuth;
}

export function encodeDevToken(user: DevPreviewUser): string {
  const json = JSON.stringify({
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    emailVerified: user.emailVerified,
    isAdmin: user.isAdmin,
    providers: ["password"],
  });
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64url = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `dev:${b64url}`;
}

export function getSavedDevPreviewUser(): DevPreviewUser | null {
  if (!import.meta.env.DEV) return null;
  try {
    const raw = sessionStorage.getItem(DEV_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DevPreviewUser;
    if (parsed && typeof parsed.uid === "string" && parsed.uid) return parsed;
  } catch {}
  return null;
}

export function saveDevPreviewUser(user: DevPreviewUser | null): void {
  try {
    if (!user) {
      sessionStorage.removeItem(DEV_SESSION_STORAGE_KEY);
    } else if (import.meta.env.DEV) {
      sessionStorage.setItem(DEV_SESSION_STORAGE_KEY, JSON.stringify(user));
    }
  } catch {}
}

export async function getActiveAuthToken(forceRefresh = false): Promise<string | null> {
  const auth = getFirebaseClientAuth();
  if (auth?.currentUser) {
    return auth.currentUser.getIdToken(forceRefresh);
  }
  const devUser = getSavedDevPreviewUser();
  if (devUser) {
    return encodeDevToken(devUser);
  }
  return null;
}

export function subscribeFirebaseAuth(
  callback: (user: User | null) => void
): () => void {
  const auth = getFirebaseClientAuth();
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const auth = getFirebaseClientAuth();
  if (!auth) throw new Error("Firebase Authentication is not configured.");
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export async function signUpWithEmail(
  name: string,
  email: string,
  password: string
): Promise<User> {
  const auth = getFirebaseClientAuth();
  if (!auth) throw new Error("Firebase Authentication is not configured.");
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (name.trim()) {
    await updateProfile(cred.user, { displayName: name.trim() });
  }
  try {
    await sendEmailVerification(cred.user);
  } catch {
    // User can resend from Account Modal if SMTP/throttling prevents immediate send
  }
  return cred.user;
}

export async function sendPasswordReset(email: string): Promise<void> {
  const auth = getFirebaseClientAuth();
  if (!auth) throw new Error("Firebase Authentication is not configured.");
  await sendPasswordResetEmail(auth, email.trim());
}

export async function resendEmailVerification(): Promise<void> {
  const auth = getFirebaseClientAuth();
  if (!auth?.currentUser) throw new Error("Not signed in.");
  await sendEmailVerification(auth.currentUser);
}

export async function reloadFirebaseUser(): Promise<User | null> {
  const auth = getFirebaseClientAuth();
  if (!auth?.currentUser) return null;
  await reload(auth.currentUser);
  return auth.currentUser;
}

async function signInWithProvider(provider: GoogleAuthProvider | FacebookAuthProvider): Promise<User | null> {
  const auth = getFirebaseClientAuth();
  if (!auth) throw new Error("Firebase Authentication is not configured.");
  try {
    const cred = await signInWithPopup(auth, provider);
    return cred.user;
  } catch (err) {
    const code = (err as { code?: string })?.code || "";
    if (code === "auth/popup-blocked") {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw err;
  }
}

export function signInWithGoogle(): Promise<User | null> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithProvider(provider);
}

export function signInWithFacebook(): Promise<User | null> {
  const provider = new FacebookAuthProvider();
  provider.addScope("email");
  return signInWithProvider(provider);
}

export async function signOutAll(): Promise<void> {
  saveDevPreviewUser(null);
  const auth = getFirebaseClientAuth();
  if (auth?.currentUser) {
    await signOut(auth);
  }
}

export function formatFirebaseAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code || "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Invalid email or password.";
    case "auth/email-already-in-use":
      return "An account with this email already exists. Try signing in instead.";
    case "auth/weak-password":
      return "Password is too weak. Please use at least 6 characters.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/account-exists-with-different-credential":
      return "An account already exists with this email using another sign-in provider.";
    case "auth/popup-closed-by-user":
      return "Sign-in window was closed before finishing.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/unauthorized-domain":
      return "This domain is not authorized in Firebase Auth settings.";
    case "auth/operation-not-allowed":
      return "This sign-in provider is not enabled in Firebase Console (Authentication → Sign-in method).";
    default:
      return err instanceof Error ? err.message : "Authentication failed.";
  }
}
