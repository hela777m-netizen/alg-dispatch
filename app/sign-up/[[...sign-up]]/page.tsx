import { SignUp } from "@clerk/nextjs";
import Logo from "@/components/Logo";

/** Where invitation links land. The invitation fills in the email; the person sets their own password. */
export default function SignUpPage() {
  return (
    <main className="signin">
      <section className="signin-art">
        <div>
          <Logo height={52} onDark />
          <div className="mark-word" style={{ marginTop: 40 }}>Reporting<br />Dashboard</div>
        </div>
        <p style={{ maxWidth: "34ch", fontSize: 18, lineHeight: 1.45, margin: 0 }}>
          You&apos;ve been invited to the reporting dashboard. Set your password to get started.
        </p>
      </section>
      <section className="signin-form">
        <SignUp path="/sign-up" signInUrl="/sign-in" forceRedirectUrl="/" />
      </section>
    </main>
  );
}
