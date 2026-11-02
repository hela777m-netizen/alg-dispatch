import { SignIn } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Logo from "@/components/Logo";

export default async function SignInPage() {
  // Someone already signed in can't use this form (Clerk shows nothing); send them into the dashboard.
  const { userId } = await auth();
  if (userId) redirect("/");
  return (
    <main className="signin">
      <section className="signin-art">
        <div>
          <Logo height={52} onDark />
          <div className="mark-word" style={{ marginTop: 40 }}>Reporting<br />Dashboard</div>
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
