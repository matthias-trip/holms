import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

type Appearance = "light" | "dark" | "inherit";

interface ThemeContextValue {
  appearance: Appearance;
  resolved: "light" | "dark";
  toggleAppearance: () => void;
  setAppearance: (a: Appearance) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "holms-appearance";

function getSystemPreference(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolve(appearance: Appearance): "light" | "dark" {
  return appearance === "inherit" ? getSystemPreference() : appearance;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearanceRaw] = useState<Appearance>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "inherit") return stored;
    return "inherit";
  });

  const [resolved, setResolved] = useState<"light" | "dark">(() => resolve(appearance));

  useEffect(() => {
    setResolved(resolve(appearance));
  }, [appearance]);

  // Listen for system preference changes when in inherit mode
  useEffect(() => {
    if (appearance !== "inherit") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setResolved(getSystemPreference());
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [appearance]);

  const setAppearance = useCallback((a: Appearance) => {
    localStorage.setItem(STORAGE_KEY, a);
    setAppearanceRaw(a);
  }, []);

  const toggleAppearance = useCallback(() => {
    setAppearance(resolved === "light" ? "dark" : "light");
  }, [resolved, setAppearance]);

  return (
    <ThemeContext.Provider value={{ appearance, resolved, toggleAppearance, setAppearance }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
