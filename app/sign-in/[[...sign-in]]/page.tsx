import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="signin">
      <section className="signin-art">
        <div>
          <div className="mark-word">Dispatch</div>
          <p className="muted" style={{ color: "inherit", opacity: 0.7, marginTop: 14 }}>
            Al Liwan Group
          </p>
        </div>
        <p style={{ maxWidth: "34ch", fontSize: 18, lineHeight: 1.45, margin: 0 }}>
          Updates from every geography, in one place. Log as you go, send your report every two weeks.
        </p>
      </section>
      <section className="signin-form">
        <SignIn withSignUp />
      </section>
    </main>
  );
}
