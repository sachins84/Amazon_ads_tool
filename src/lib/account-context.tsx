"use client";
/**
 * AccountContext — tracks the active account across the app.
 * Loads the account list from /api/accounts on mount, persists the
 * active selection to localStorage so it survives page refreshes.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";

export interface SafeAccount {
  id: string;
  name: string;
  color: string;
  adsEndpoint: string;
  adsProfileId: string;
  adsMarketplace: string;
  spMarketplaceId: string | null;
  spEndpoint: string | null;
  connected: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
}

interface AccountContextValue {
  accounts: SafeAccount[];
  activeAccount: SafeAccount | null;
  setActiveAccountId: (id: string) => void;
  reloadAccounts: () => Promise<void>;
  loading: boolean;
}

const AccountContext = createContext<AccountContextValue>({
  accounts: [],
  activeAccount: null,
  setActiveAccountId: () => {},
  reloadAccounts: async () => {},
  loading: true,
});

const STORAGE_KEY = "amazon-ads:activeAccountId";

export function AccountProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<SafeAccount[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts");
      if (!res.ok) return;
      const json = await res.json() as { accounts: SafeAccount[] };
      setAccounts(json.accounts ?? []);
    } catch {
      // silently ignore — no accounts configured
    } finally {
      setLoading(false);
    }
  }, []);

  // Load accounts on mount, restore saved selection
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) ?? "";
    setActiveId(saved);
    loadAccounts();
  }, [loadAccounts]);

  const setActiveAccountId = useCallback((id: string) => {
    setActiveId(id);
    // localStorage is only available on the client; this callback is only ever
    // invoked from event handlers so this is always safe, but guarded for clarity.
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore SSR / private-browsing restrictions */ }
  }, []);

  // If the saved account no longer exists in the list, reset
  useEffect(() => {
    if (!loading && accounts.length > 0 && activeId &&
        !accounts.find((a) => a.id === activeId)) {
      setActiveAccountId("");
    }
  }, [accounts, activeId, loading, setActiveAccountId]);

  const activeAccount = accounts.find((a) => a.id === activeId) ?? null;

  return (
    <AccountContext.Provider value={{
      accounts,
      activeAccount,
      setActiveAccountId,
      reloadAccounts: loadAccounts,
      loading,
    }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  return useContext(AccountContext);
}
