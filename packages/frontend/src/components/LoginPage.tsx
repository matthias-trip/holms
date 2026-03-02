import { useState, type FormEvent } from "react";
import { Button } from "@heroui/react";
import { useAuth } from "../context/AuthContext";

function PasswordInput({
  label,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--gray-11)" }}>
        {label}
      </label>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        required
        className="w-full text-xs px-3 py-2 rounded-lg outline-none transition-colors duration-150"
        style={{
          background: "var(--gray-2)",
          border: "1px solid var(--gray-a5)",
          color: "var(--gray-12)",
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent-a5)"; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = "var(--gray-a5)"; }}
      />
    </div>
  );
}

export default function LoginPage() {
  const { state, login, setup } = useAuth();
  const isSetup = state.status === "needs-setup";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (isSetup) {
      if (password.length < 4) {
        setError("Password must be at least 4 characters");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords don't match");
        return;
      }
    }

    setLoading(true);
    try {
      if (isSetup) {
        await setup(password);
      } else {
        await login(password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="flex items-center justify-center h-screen"
      style={{ background: "var(--gray-2)" }}
    >
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 w-full max-w-[320px] p-8 rounded-2xl"
        style={{
          background: "var(--gray-1)",
          border: "1px solid var(--gray-a3)",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 mb-2 justify-center">
          <img src="/logo.png" alt="Holms" className="w-8 h-8 rounded-lg" />
          <span
            className="text-lg font-medium"
            style={{
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.04em",
              color: "var(--gray-12)",
            }}
          >
            holms
          </span>
        </div>

        <p
          className="text-sm text-center mb-2"
          style={{ color: "var(--gray-9)" }}
        >
          {isSetup ? "Create a password to get started" : "Sign in to continue"}
        </p>

        <PasswordInput
          label="Password"
          value={password}
          onChange={setPassword}
          autoFocus
        />

        {isSetup && (
          <PasswordInput
            label="Confirm password"
            value={confirmPassword}
            onChange={setConfirmPassword}
          />
        )}

        {error && (
          <p className="text-xs" style={{ color: "var(--err)" }}>
            {error}
          </p>
        )}

        <Button
          type="submit"
          color="primary"
          isLoading={loading}
          className="w-full"
        >
          {isSetup ? "Create password" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
