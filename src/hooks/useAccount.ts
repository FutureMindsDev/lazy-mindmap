import { useCallback, useEffect, useState } from "react";
import type { UserAccountState } from "../types/mindmap";
import { fetchAccountState, syncAccountProfile } from "../utils/accountApi";
import {
  getActiveAuthToken,
  isFirebaseWebConfigured,
  saveDevPreviewUser,
  signOutAll,
  subscribeFirebaseAuth,
  type DevPreviewUser,
} from "../utils/firebaseClient";
import { setStorageAuthTokenProvider, setStorageUserScope } from "../utils/storage";

const DEFAULT_GUEST_ACCOUNT: UserAccountState = {
  authenticated: false,
  firebaseConfigured: isFirebaseWebConfigured(),
  isAdmin: false,
  billing: {
    monthlyPriceMmk: 1000,
    yearlyPriceMmk: 10000,
    managedModel: "gemini-3.1-flash-lite",
    trialModel: "gemini-3.1-flash-lite",
    dailyQuota: 15,
    monthlyQuota: 150,
    maxTrialCount: 3,
  },
};

export function useAccount() {
  const [account, setAccount] = useState<UserAccountState>(DEFAULT_GUEST_ACCOUNT);
  const [loading, setLoading] = useState<boolean>(true);
  const [authVersion, setAuthVersion] = useState<number>(0);

  useEffect(() => {
    setStorageAuthTokenProvider(() => getActiveAuthToken());
  }, []);

  const refreshAccount = useCallback(async (forceTokenRefresh = false) => {
    try {
      const token = await getActiveAuthToken(forceTokenRefresh);
      const state = await fetchAccountState(token);
      setStorageUserScope(state.authenticated && state.user?.uid ? state.user.uid : null);
      setAccount(state);
      return state;
    } catch {
      setStorageUserScope(null);
      setAccount((prev) => ({ ...DEFAULT_GUEST_ACCOUNT, firebaseConfigured: prev.firebaseConfigured }));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const unsub = subscribeFirebaseAuth(async (fbUser) => {
      if (!active) return;
      if (fbUser) {
        try {
          const token = await fbUser.getIdToken();
          const state = await syncAccountProfile(
            {
              displayName: fbUser.displayName || undefined,
              photoURL: fbUser.photoURL || undefined,
            },
            token
          );
          if (active) {
            setStorageUserScope(state.authenticated && state.user?.uid ? state.user.uid : null);
            setAccount(state);
            setAuthVersion((v) => v + 1);
          }
        } catch {
          if (active) await refreshAccount();
        } finally {
          if (active) setLoading(false);
        }
      } else {
        await refreshAccount();
        if (active) setAuthVersion((v) => v + 1);
      }
    });
    return () => {
      active = false;
      unsub();
    };
  }, [refreshAccount]);

  const signInDevUser = useCallback(
    async (devUser: DevPreviewUser) => {
      saveDevPreviewUser(devUser);
      await refreshAccount();
      setAuthVersion((v) => v + 1);
    },
    [refreshAccount]
  );

  const signOut = useCallback(async () => {
    await signOutAll();
    await refreshAccount();
    setAuthVersion((v) => v + 1);
  }, [refreshAccount]);

  return {
    account,
    loading,
    authVersion,
    refreshAccount,
    signInDevUser,
    signOut,
  };
}
