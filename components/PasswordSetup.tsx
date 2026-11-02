"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import Logo from "./Logo";

/** First visit from a sign-in link: the person chooses the password they'll use from now on. */
export default function PasswordSetup({ firstName }: { firstName: string }) {
  const { user } = useUser();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) return setErr("Use at least 8 characters.");
    if (password !== confirm) return setErr("The two passwords don't match.");
    if (!user) return;
    setBusy(true);
    try {
      await user.updatePassword({ newPassword: password, signOutOfOtherSessions: false });
      await user.reload();
    } catch (x) {
      const code = (x as { errors?: { code?: string; longMessage?: string }[] })?.errors?.[0];
      console.error("Set password failed", code?.code);
      setErr(
        /pwned|strength|password/i.test(code?.code ?? "")
          ? "Choose a stronger password: at least 8 characters, not one that's commonly used."
          : "Your password couldn't be saved (ref PASSWORD-SET). Try again, or contact the dashboard administrator.",
      );
      setBusy(false);
    }
  }

  return (
    <main className="signin welcome-page">
      <section className="signin-art welcome-art">
        <div>
          <Logo height={52} onDark />
          <p className="welcome-kicker">Al Liwan Reporting Dashboard</p>
          <h1 className="welcome-title">Welcome to your reporting tool,<br />{firstName}.</h1>
          <p className="welcome-catch">Less time writing reports. More time closing deals.</p>
        </div>
      </section>
      <section className="signin-form">
        <form className="accept" onSubmit={submit}>
          <h2 className="accept-title">Choose your password</h2>
          <p className="muted">You&apos;re signed in. Pick a password for next time: you&apos;ll sign in with your work email and this password.</p>
          <label className="field">
            <span>Password</span>
            <input className="input" type="password" autoComplete="new-password" autoFocus minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label className="field">
            <span>Type it again</span>
            <input className="input" type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          <p className="small faint" style={{ margin: 0 }}>At least 8 characters.</p>
          {err && <p className="notice error" role="alert">{err}</p>}
          <button className="btn" type="submit" disabled={busy}>{busy ? "Saving" : "Save password and continue"}</button>
        </form>
      </section>
    </main>
  );
}
