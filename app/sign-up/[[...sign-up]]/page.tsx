import { Suspense } from "react";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Logo from "@/components/Logo";
import AcceptInvite from "./AcceptInvite";

/** Where invitation links land: set a password, then straight into the welcome walkthrough. */
export default async function SignUpPage() {
  // Someone already signed in goes straight into the dashboard.
  const { userId } = await auth();
  if (userId) redirect("/");
  return (
    <main className="signin">
      <section className="signin-art welcome-art">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/alliwan-arch-white.png" alt="" aria-hidden="true" className="welcome-arch" />
        <div style={{ position: "relative" }}>
          <Logo height={52} onDark />
          <div className="mark-word" style={{ marginTop: 40 }}>Reporting<br />Dashboard</div>
        </div>
        <p style={{ position: "relative", maxWidth: "34ch", fontSize: 18, lineHeight: 1.45, margin: 0 }}>
          You&apos;ve been invited to Al Liwan&apos;s reporting dashboard: one place for every geography&apos;s updates, deals and reports.
        </p>
      </section>
      <section className="signin-form">
        <Suspense fallback={null}>
          <AcceptInvite />
        </Suspense>
      </section>
    </main>
  );
}
