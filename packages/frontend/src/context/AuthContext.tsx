import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";

type AuthState =
  | { status: "loading" }
  | { status: "needs-setup" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; accessToken: string };

interface AuthContextValue {
  state: AuthState;
  login: (password: string) => Promise<void>;
  setup: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  getAccessToken: () => string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const API_BASE = `${window.location.origin}/api/auth`;

async function post(path: string, body?: Record<string, unknown>): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function postAuthed(path: string, token: string, body?: Record<string, unknown>): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef<string | null>(null);
  const initRef = useRef(false);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    // Refresh 1 minute before the 15min access token expiry
    refreshTimerRef.current = setTimeout(async () => {
      try {
        const res = await post("/refresh");
        if (res.ok) {
          const data = await res.json();
          tokenRef.current = data.accessToken;
          setState({ status: "authenticated", accessToken: data.accessToken });
          scheduleRefresh();
        } else {
          tokenRef.current = null;
          setState({ status: "unauthenticated" });
        }
      } catch {
        tokenRef.current = null;
        setState({ status: "unauthenticated" });
      }
    }, 14 * 60 * 1000); // 14 minutes
  }, []);

  // Check auth status on mount — try refresh first, then status
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    async function init() {
      // Check setup status first (cheap, no auth required)
      try {
        const statusRes = await post("/status");
        if (!statusRes.ok) {
          setState({ status: "unauthenticated" });
          return;
        }
        const { isSetup } = await statusRes.json();
        if (!isSetup) {
          setState({ status: "needs-setup" });
          return;
        }
      } catch {
        setState({ status: "unauthenticated" });
        return;
      }

      // Password is set up — try silent refresh (user may have a valid refresh cookie)
      try {
        const refreshRes = await post("/refresh");
        if (refreshRes.ok) {
          const data = await refreshRes.json();
          tokenRef.current = data.accessToken;
          setState({ status: "authenticated", accessToken: data.accessToken });
          scheduleRefresh();
          return;
        }
      } catch {
        // Refresh failed
      }

      setState({ status: "unauthenticated" });
    }

    init();

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [scheduleRefresh]);

  const login = useCallback(async (password: string) => {
    const res = await post("/login", { password });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "Login failed" }));
      throw new Error(data.error || "Login failed");
    }
    const data = await res.json();
    tokenRef.current = data.accessToken;
    setState({ status: "authenticated", accessToken: data.accessToken });
    scheduleRefresh();
  }, [scheduleRefresh]);

  const setup = useCallback(async (password: string) => {
    const res = await post("/setup", { password });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "Setup failed" }));
      throw new Error(data.error || "Setup failed");
    }
    const data = await res.json();
    tokenRef.current = data.accessToken;
    setState({ status: "authenticated", accessToken: data.accessToken });
    scheduleRefresh();
  }, [scheduleRefresh]);

  const logout = useCallback(async () => {
    if (tokenRef.current) {
      try {
        await postAuthed("/logout", tokenRef.current);
      } catch {
        // Best effort
      }
    }
    tokenRef.current = null;
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    setState({ status: "unauthenticated" });
  }, []);

  const getAccessToken = useCallback(() => tokenRef.current, []);

  return (
    <AuthContext.Provider value={{ state, login, setup, logout, getAccessToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
