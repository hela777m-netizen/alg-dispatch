import { Suspense } from "react";
import Logo from "@/components/Logo";
import WelcomeLink from "./WelcomeLink";

/** Where personal sign-in links land. One click, no code, no form. */
export default function WelcomePage() {
  return (
    <main className="signin welcome-page">
      <section className="signin-art welcome-art">
        <div>
          <Logo height={52} onDark />
          <div className="mark-word" style={{ marginTop: 40 }}>Reporting<br />Dashboard</div>
        </div>
        <p style={{ maxWidth: "34ch", fontSize: 18, lineHeight: 1.45, margin: 0 }}>
          Al Liwan&apos;s reporting dashboard: one place for every geography&apos;s updates, deals and reports.
        </p>
      </section>
      <section className="signin-form">
        <Suspense fallback={null}>
          <WelcomeLink />
        </Suspense>
      </section>
    </main>
  );
}
