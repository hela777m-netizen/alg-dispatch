"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSignIn, useSignUp } from "@clerk/nextjs";

type Stage = "loading" | "password" | "names" | "entering" | "no_ticket" | "error";

function messageFor(code: string | undefined): string {
  if (!code) return "Something went wrong. Try the link again, or ask the dashboard administrator to resend your invitation.";
  if (/expired|revoked|invalid|not_found|ticket/i.test(code)) {
    return "This invitation link has expired or was replaced by a newer one. Ask the dashboard administrator to send you a fresh invitation.";
  }
  if (/identifier_exists|already/i.test(code)) return "You already have a login. Sign in with your email and password instead.";
  if (/password/i.test(code)) return "Choose a stronger password: at least 8 characters, not one that's commonly used.";
  return "Something went wrong. Try the link again, or ask the dashboard administrator to resend your invitation.";
}

/**
 * The invitation link lands here. The link itself proves the email, so there is no code to type:
 * new people choose a password and go straight in; people who already have a login go straight in.
 */
export default function AcceptInvite() {
  const params = useSearchParams();
  const ticket = params.get("__clerk_ticket");
  const status = params.get("__clerk_status");
  const { signUp } = useSignUp();
  const { signIn } = useSignIn();
  const [stage, setStage] = useState<Stage>(ticket ? "loading" : "no_ticket");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const started = useRef(false);

  const enter = () => {
    setStage("entering");
    window.location.href = "/";
  };

  useEffect(() => {
    if (!ticket || started.current || !signIn || !signUp) return;
    started.current = true;
    if (status === "sign_in") {
      // Already has a login: the link signs them in directly.
      (async () => {
        const r = await signIn.ticket({ ticket });
        if (r.error) { setErr(messageFor(r.error.code)); setStage("error"); return; }
        const f = await signIn.finalize({ navigate: async ({ decorateUrl }) => { window.location.href = decorateUrl("/"); } });
        if (f.error) { setErr(messageFor(f.error.code)); setStage("error"); return; }
        enter();
      })();
      return;
    }
    setStage("password");
  }, [ticket, status, signIn, signUp]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!signUp || !ticket) return;
    setErr(null);
    if (password.length < 8) return setErr("Use at least 8 characters.");
    if (password !== confirm) return setErr("The two passwords don't match.");
    setStage("entering");
    const r = await signUp.create({
      strategy: "ticket",
      ticket,
      password,
      ...(firstName ? { firstName } : {}),
      ...(lastName ? { lastName } : {}),
    });
    if (r.error) {
      setErr(messageFor(r.error.code));
      setStage(/identifier_exists|expired|revoked|invalid|not_found/i.test(r.error.code) ? "error" : "password");
      return;
    }
    if (signUp.status !== "complete") {
      const missing = signUp.missingFields ?? [];
      if (missing.some((f) => f === "first_name" || f === "last_name")) {
        setStage("names");
        return;
      }
      setErr("Your account needs a setting the dashboard can't fill in. Contact the dashboard administrator (ref INVITE-FIELDS).");
      console.error("Sign-up missing fields", missing);
      setStage("error");
      return;
    }
    const f = await signUp.finalize({ navigate: async ({ decorateUrl }) => { window.location.href = decorateUrl("/"); } });
    if (f.error) { setErr(messageFor(f.error.code)); setStage("error"); return; }
    enter();
  }

  if (stage === "no_ticket") {
    return (
      <div className="accept">
        <h1 className="accept-title">Use your invitation link</h1>
        <p className="muted">Access to the dashboard is by invitation. Open the invitation email and click its button. Already set up?</p>
        <Link className="btn" href="/sign-in">Sign in</Link>
      </div>
    );
  }

  if (stage === "loading" || stage === "entering") {
    return (
      <div className="accept">
        <h1 className="accept-title">{stage === "entering" ? "Opening your dashboard" : "Checking your invitation"}</h1>
        <p className="muted" role="status">One moment.</p>
      </div>
    );
  }

  if (stage === "error") {
    return (
      <div className="accept">
        <h1 className="accept-title">We couldn&apos;t open your invitation</h1>
        <p className="notice error" role="alert">{err}</p>
        <Link className="btn quiet" href="/sign-in">Go to sign in</Link>
      </div>
    );
  }

  return (
    <form className="accept" onSubmit={submit}>
      <h1 className="accept-title">{stage === "names" ? "Your name" : "Choose your password"}</h1>
      <p className="muted">
        {stage === "names"
          ? "One more thing: how should your name appear?"
          : "Your email is confirmed by the invitation. Pick a password and you're in. You'll use it with your work email next time."}
      </p>
      {stage === "names" ? (
        <div className="fields">
          <label className="field"><span>First name</span><input className="input" autoFocus required value={firstName} onChange={(e) => setFirstName(e.target.value)} /></label>
          <label className="field"><span>Last name</span><input className="input" required value={lastName} onChange={(e) => setLastName(e.target.value)} /></label>
        </div>
      ) : (
        <>
          <label className="field">
            <span>Password</span>
            <input className="input" type="password" autoComplete="new-password" autoFocus minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label className="field">
            <span>Type it again</span>
            <input className="input" type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          <p className="small faint" style={{ margin: 0 }}>At least 8 characters.</p>
        </>
      )}
      {err && <p className="notice error" role="alert">{err}</p>}
      <button className="btn" type="submit">{stage === "names" ? "Continue" : "Set password and continue"}</button>
    </form>
  );
}
