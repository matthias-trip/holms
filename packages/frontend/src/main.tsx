import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HeroUIProvider } from "@heroui/react";
import { trpc, createTrpcClient } from "./trpc";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import LoginPage from "./components/LoginPage";
import App from "./App";
import "./styles/globals.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/**
 * Only mounts the tRPC provider (and its WS connection) once authenticated.
 * Before that, renders the login/loading screen directly — no tRPC needed.
 */
function AuthGate() {
  const { state, getAccessToken } = useAuth();

  if (state.status === "loading") {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: "var(--gray-2)" }}>
        <div className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background: "var(--warm)" }} />
      </div>
    );
  }

  if (state.status === "needs-setup" || state.status === "unauthenticated") {
    return <LoginPage />;
  }

  return (
    <AuthenticatedApp getAccessToken={getAccessToken} />
  );
}

function AuthenticatedApp({ getAccessToken }: { getAccessToken: () => string | null }) {
  const { client, close } = React.useMemo(
    () => createTrpcClient(getAccessToken),
    [getAccessToken],
  );

  React.useEffect(() => () => { close(); }, [close]);

  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </trpc.Provider>
  );
}

function ThemedRoot() {
  const { resolved } = useTheme();

  React.useEffect(() => {
    const html = document.documentElement;
    html.classList.remove("light", "dark");
    html.classList.add(resolved);
  }, [resolved]);

  return (
    <HeroUIProvider disableRipple>
      <AuthGate />
    </HeroUIProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <ThemeProvider>
        <ThemedRoot />
      </ThemeProvider>
    </AuthProvider>
  </React.StrictMode>,
);
