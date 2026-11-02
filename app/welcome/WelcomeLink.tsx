"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth, useClerk, useSignIn } from "@clerk/nextjs";

/**
 * Signs the person in with the one-time link the owner sent them, then opens the dashboard,
 * where they choose a password and go through the welcome walkthrough.
 */
export default function WelcomeLink() {
  const ticket = useSearchParams().get("ticket");
  const { signIn } = useSignIn();
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const [error, setError] = useState<string | null>(ticket ? null : "This page needs the personal link from your invitation. Open the link you were sent, or ask the dashboard administrator for a new one.");
  const started = useRef(false);

  useEffect(() => {
    if (!ticket || !isLoaded || !signIn || started.current) return;
    started.current = true;
    (async () => {
      // Someone else signed in on this browser: sign them out first, then use the link.
      if (isSignedIn) {
        await signOut();
      }
      const r = await signIn.ticket({ ticket });
      if (r.error) {
        console.error("Sign-in link refused", r.error.code);
        setError("This link has already been used or has expired. Ask the dashboard administrator for a new one. If you've already set your password, sign in instead.");
        return;
      }
      const f = await signIn.finalize({ navigate: async ({ decorateUrl }) => { window.location.href = decorateUrl("/"); } });
      if (f.error) {
        setError("Something went wrong opening your dashboard. Try the link again, or ask the dashboard administrator for a new one.");
        return;
      }
      window.location.href = "/";
    })();
  }, [ticket, isLoaded, isSignedIn, signIn, signOut]);

  return (
    <div className="accept">
      {error ? (
        <>
          <h1 className="accept-title">We couldn&apos;t open your link</h1>
          <p className="notice error" role="alert">{error}</p>
          <Link className="btn quiet" href="/sign-in">Sign in with email and password</Link>
        </>
      ) : (
        <>
          <h1 className="accept-title">Opening your dashboard</h1>
          <p className="muted" role="status">One moment.</p>
        </>
      )}
    </div>
  );
}
