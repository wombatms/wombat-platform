import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isApiError } from "@/lib/api/errors";
import { useSession } from "./useSession";

async function detectBootstrap(): Promise<boolean> {
  const cached = sessionStorage.getItem("wombat.bootstrap_checked");
  if (cached !== null) return cached === "true";

  try {
    // POST with known-invalid data: 403 = non-bootstrap, 422 = bootstrap open
    const base = import.meta.env.VITE_API_BASE_URL ?? "";
    const res = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "", password: "", display_name: "" }),
    });
    const isBootstrap = res.status === 422 || res.status === 400;
    sessionStorage.setItem("wombat.bootstrap_checked", isBootstrap ? "true" : "false");
    return isBootstrap;
  } catch {
    return false;
  }
}

export function LoginPage() {
  const { login, status } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const nextPath = searchParams.get("next") ?? "/projects";

  // Flash message from RegisterPage 403 redirect
  const locationState = location.state as { flash?: string; registered?: boolean } | null;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [flashMsg] = useState<string | null>(
    locationState?.flash ?? (locationState?.registered ? "Account created — please sign in." : null),
  );
  const [capsLock, setCapsLock] = useState(false);
  const [showBootstrapLink, setShowBootstrapLink] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Redirect if already authenticated
  useEffect(() => {
    if (status === "authed") {
      navigate(nextPath, { replace: true });
    }
  }, [status, navigate, nextPath]);

  // Detect bootstrap state on mount
  useEffect(() => {
    void detectBootstrap().then((isBootstrap) => setShowBootstrapLink(isBootstrap));
  }, []);

  const handleCapsLock = (e: KeyboardEvent) => {
    setCapsLock(e.getModifierState("CapsLock"));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(nextPath, { replace: true });
    } catch (err) {
      if (isApiError(err)) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg("An unexpected error occurred. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-12">
      <div
        className="w-full max-w-sm rounded-lg border px-8 py-10"
        style={{
          background: "var(--bg-surface-1)",
          borderColor: "var(--border-default)",
          boxShadow: "var(--shadow-md)",
        }}
      >
        {/* Logo / mark */}
        <div className="mb-8 text-center">
          <span
            className="text-2xl font-bold tracking-tight"
            style={{ color: "var(--fg-default)" }}
          >
            Wombat
          </span>
          <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>
            Sign in to your account
          </p>
        </div>

        {flashMsg && (
          <p
            className="mb-4 rounded-md px-3 py-2 text-sm"
            style={{
              background: "var(--feedback-info-bg)",
              color: "var(--feedback-info-fg)",
            }}
            role="status"
          >
            {flashMsg}
          </p>
        )}

        <form onSubmit={(e) => { void handleSubmit(e); }} noValidate>
          <div className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-sm font-medium"
                style={{ color: "var(--fg-default)" }}
              >
                Email
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-medium"
                style={{ color: "var(--fg-default)" }}
              >
                Password
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                ref={passwordRef}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleCapsLock}
                onKeyUp={handleCapsLock}
                disabled={submitting}
                placeholder="••••••••"
              />
              {capsLock && (
                <p className="mt-1 text-xs" style={{ color: "var(--feedback-warn-fg)" }}>
                  Caps Lock is on
                </p>
              )}
            </div>
          </div>

          {errorMsg && (
            <p
              className="mt-4 rounded-md px-3 py-2 text-sm"
              style={{
                background: "var(--feedback-error-bg)",
                color: "var(--feedback-error-fg)",
              }}
              role="alert"
            >
              {errorMsg}
            </p>
          )}

          <Button
            type="submit"
            className="mt-6 w-full"
            disabled={submitting || !email || !password}
          >
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        {showBootstrapLink && (
          <p className="mt-6 text-center text-sm" style={{ color: "var(--fg-muted)" }}>
            First time?{" "}
            <a
              href="/register"
              className="font-medium underline-offset-4 hover:underline"
              style={{ color: "var(--accent-fg)" }}
            >
              Create the first admin account
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
