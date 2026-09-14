"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Public, signed-out page -- this is exactly what a password-reset link
// has to be. No FocusGuard/dashboard chrome needed here; just the plain
// auth-card look the login page uses, so the two feel like one flow.
function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError("");

    if (!token) {
      setError("This link is missing its reset code. Ask an admin to send you a new one.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't set your password");
      setDone(true);
    } catch (err) {
      setError(err.message || "Couldn't set your password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="auth-form-panel" style={{ minHeight: "100vh" }}>
      <div className="auth-card">
        <img src="/logo.svg" alt="Bullock Logan" style={{ width: 160, marginBottom: 20 }} />

        {done ? (
          <>
            <h2 className="auth-title">Password set</h2>
            <p className="auth-subtitle">You can sign in with your new password now.</p>
            <button className="btn btn-primary btn-block" onClick={() => router.push("/")}>Go to Login</button>
          </>
        ) : (
          <>
            <h2 className="auth-title">Set your password</h2>
            <p className="auth-subtitle">Choose a password to sign in with.</p>

            {!token && (
              <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>
                This link is missing its reset code. Ask an admin to send you a new one.
              </p>
            )}

            <label className="field-label" htmlFor="reset-password">New Password</label>
            <input
              id="reset-password"
              className="field"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />

            <label className="field-label" htmlFor="reset-password-confirm">Confirm Password</label>
            <input
              id="reset-password-confirm"
              className="field"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") submit(); }}
            />

            {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

            <button className="btn btn-primary btn-block" disabled={saving || !token} onClick={submit}>
              {saving ? "Saving..." : "Set Password"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="auth-form-panel" style={{ minHeight: "100vh" }} />}>
      <ResetPasswordContent />
    </Suspense>
  );
}
