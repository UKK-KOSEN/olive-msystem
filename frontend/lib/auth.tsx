'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, AuthUser, setAuthToken, getAuthToken } from '@/lib/api';

const TOKEN_KEY = 'olive_msystem_token';

function lsGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
function lsRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore: storage unavailable (private mode, quota, etc.)
  }
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  register: (payload: { username: string; password: string; display_name?: string; farm_name?: string }) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  loading: true,
  login: async () => { throw new Error('uninitialized'); },
  register: async () => { throw new Error('uninitialized'); },
  logout: async () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // restore from localStorage on mount
  useEffect(() => {
    const stored = lsGet(TOKEN_KEY);
    if (stored) {
      setAuthToken(stored);
      setTokenState(stored);
      api
        .me()
        .then(setUser)
        .catch(() => {
          setAuthToken(null);
          lsRemove(TOKEN_KEY);
          setTokenState(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const setSession = useCallback((token: string, user: AuthUser) => {
    setAuthToken(token);
    setTokenState(token);
    setUser(user);
    lsSet(TOKEN_KEY, token);
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await api.login(username, password);
      setSession(res.token, res.user);
      return res.user;
    },
    [setSession]
  );

  const register = useCallback(
    async (payload: { username: string; password: string; display_name?: string; farm_name?: string }) => {
      const res = await api.register(payload);
      setSession(res.token, res.user);
      return res.user;
    },
    [setSession]
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setUser(null);
    setTokenState(null);
    lsRemove(TOKEN_KEY);
  }, []);

  const refresh = useCallback(async () => {
    if (!getAuthToken()) return;
    try {
      setUser(await api.me());
    } catch {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, token, loading, login, register, logout, refresh }),
    [user, token, loading, login, register, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
