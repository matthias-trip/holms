import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HeroUIProvider } from "@heroui/react";
import { trpc, trpcClient } from "./trpc";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
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

function ThemedApp() {
  const { resolved } = useTheme();

  React.useEffect(() => {
    const html = document.documentElement;
    html.classList.remove("light", "dark");
    html.classList.add(resolved);
  }, [resolved]);

  return (
    <HeroUIProvider disableRipple>
      <App />
    </HeroUIProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ThemedApp />
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>
  </React.StrictMode>,
);
