import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";

export function RegisterPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (password !== confirmPassword) {
      setErrorMsg("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setErrorMsg("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await api.POST("/api/auth/register", {
        body: {
          email: email.trim(),
          password,
          display_name: displayName.trim(),
        },
      });

      if (error) throw error;

      // Registration successful — redirect to login
      navigate("/login", { replace: true, state: { registered: true } });
    } catch (err) {
      if (isApiError(err)) {
        if (err.status === 403) {
          // Registration is closed — redirect with toast message
          navigate("/login", {
            replace: true,
            state: {
              flash:
                "Registration is closed on this instance. Ask your admin to add you.",
            },
          });
          return;
        }
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
        <div className="mb-8 text-center">
          <span
            className="text-2xl font-bold tracking-tight"
            style={{ color: "var(--fg-default)" }}
          >
            Wombat
          </span>
          <h1 className="mt-2 text-base font-semibold" style={{ color: "var(--fg-default)" }}>
            Bootstrap admin account
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>
            Create the first administrator account for this instance.
          </p>
        </div>

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
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                placeholder="admin@example.com"
              />
            </div>

            <div>
              <label
                htmlFor="display_name"
                className="mb-1.5 block text-sm font-medium"
                style={{ color: "var(--fg-default)" }}
              >
                Display name
              </label>
              <Input
                id="display_name"
                type="text"
                autoComplete="name"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={submitting}
                placeholder="Your name"
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
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                placeholder="Min. 8 characters"
              />
            </div>

            <div>
              <label
                htmlFor="confirm_password"
                className="mb-1.5 block text-sm font-medium"
                style={{ color: "var(--fg-default)" }}
              >
                Confirm password
              </label>
              <Input
                id="confirm_password"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={submitting}
                placeholder="Repeat password"
              />
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
            disabled={submitting || !email || !displayName || !password || !confirmPassword}
          >
            {submitting ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm" style={{ color: "var(--fg-muted)" }}>
          Already have an account?{" "}
          <a
            href="/login"
            className="font-medium underline-offset-4 hover:underline"
            style={{ color: "var(--accent-fg)" }}
          >
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
