"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Authenticated, AuthLoading, Unauthenticated, useAction, useQuery } from "convex/react";
import { SignOutButton, UserButton, useAuth, useUser } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import { AppContext, useApp, type AppState } from "./AppContext";

export default function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthLoading>
        <Splash text="Opening Dispatch" />
      </AuthLoading>
      <Unauthenticated>
        <SignedOutOrMismatch />
      </Unauthenticated>
      <Authenticated>
        <Gate>{children}</Gate>
      </Authenticated>
    </>
  );
}

/** Clerk may say "signed in" while the database rejects the login pass. Explain instead of looping. */
function SignedOutOrMismatch() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <Splash text="Opening Dispatch" />;
  if (!isSignedIn) {
    return (
      <div className="center-screen">
        <div className="gate">
          <p className="h2">You&apos;re signed out</p>
          <Link className="btn" href="/sign-in">Sign in</Link>
        </div>
      </div>
    );
  }
  return (
    <div className="center-screen">
      <div className="gate">
        <div className="mark-word">Dispatch</div>
        <p className="h2">Signed in, but the database didn&apos;t accept it</p>
        <p className="muted">
          Clerk signed you in, but Convex rejected the login pass. In Clerk, check the Convex integration is active.
          In Convex Production, check CLERK_JWT_ISSUER_DOMAIN matches this Clerk app&apos;s Frontend API URL exactly.
        </p>
        <div className="row">
          <SignOutButton>
            <button className="btn quiet">Sign out</button>
          </SignOutButton>
          <button className="btn" onClick={() => window.location.reload()}>Try again</button>
        </div>
      </div>
    </div>
  );
}

function Splash({ text }: { text: string }) {
  return (
    <div className="center-screen">
      <div className="gate" style={{ alignItems: "center" }}>
        <div className="mark-word">Dispatch</div>
        <p className="faint small" role="status">{text}</p>
      </div>
    </div>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const me = useQuery(api.members.me);
  const claim = useAction(api.members.claim);
  const { user } = useUser();
  const tried = useRef(false);
  const [result, setResult] = useState<{ ok: boolean; email?: string; reason?: string } | null>(null);

  useEffect(() => {
    if (me?.state === "unlinked" && !tried.current) {
      tried.current = true;
      claim({}).then(setResult).catch(() => setResult({ ok: false, reason: "error" }));
    }
  }, [me, claim]);

  if (me === undefined) return <Splash text="Loading" />;
  if (me.state === "member") return <App me={me}>{children}</App>;
  if (me.state === "unlinked" && (!result || result.ok)) return <Splash text="Checking your access" />;

  const email = result?.email ?? user?.primaryEmailAddress?.emailAddress;
  const setupProblem = result?.reason === "missing_clerk_secret" || result?.reason === "clerk_lookup_failed";
  return (
    <div className="center-screen">
      <div className="gate">
        <div className="mark-word">Dispatch</div>
        <p className="h2">{setupProblem ? "Sign-in isn't fully set up" : "You're not on the team list yet"}</p>
        <p className="muted">
          {setupProblem
            ? "The database can't confirm your email. Check CLERK_SECRET_KEY in the Convex settings."
            : `Signed in as ${email ?? "an unknown email"}. Ask Hela to add this email on the Team page, then sign in again.`}
        </p>
        <div className="row">
          <SignOutButton>
            <button className="btn quiet">Sign out</button>
          </SignOutButton>
          <button className="btn" onClick={() => window.location.reload()}>Try again</button>
        </div>
      </div>
    </div>
  );
}

type MeMember = Extract<NonNullable<ReturnType<typeof useQuery<typeof api.members.me>>>, { state: "member" }>;

function App({ me, children }: { me: MeMember; children: React.ReactNode }) {
  const [cycle, setCycle] = useState(me.cycle);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toast = useCallback((m: string) => {
    setToastMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastMsg(null), 2600);
  }, []);

  const value: AppState = useMemo(() => {
    const isLead = me.member.role === "owner" || me.member.role === "manager";
    const names = new Map(me.geographies.map((g) => [g.key, g.name]));
    const loggable = me.geographies.filter(
      (g) => isLead || me.member.geographies.includes(g.key) || me.member.extraGeographies.includes(g.key),
    );
    return {
      member: me.member,
      geographies: me.geographies,
      anchor: me.anchor,
      today: me.today,
      currentCycle: me.cycle,
      cycle,
      setCycle,
      geoName: (k: string) => names.get(k) ?? k,
      loggable,
      isLead,
      isOwner: me.member.role === "owner",
      toast,
    };
  }, [me, cycle, toast]);

  return (
    <AppContext.Provider value={value}>
      <div className="shell">
        <Rail />
        <main className="main">
          <div className="topbar">
            <Link href="/" className="mark"><span className="mark-word">Dispatch</span></Link>
            <UserButton />
          </div>
          {children}
        </main>
        <TabBar />
      </div>
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </AppContext.Provider>
  );
}

function useNav() {
  const { member } = useApp();
  const waiting = useQuery(api.reports.forReview, member.role !== "reporter" ? {} : "skip");
  const pending = waiting?.length ?? 0;
  if (member.role === "reporter") {
    return [
      { href: "/desk", label: "My desk" },
      ...member.geographies.map((g) => ({ href: `/geo/${g}`, label: g, geo: g })),
      { href: "/", label: "Overview" },
    ] as { href: string; label: string; badge?: number; geo?: string }[];
  }
  const items: { href: string; label: string; badge?: number; geo?: string }[] = [
    { href: "/", label: "Overview" },
    { href: "/reviews", label: "Reviews", badge: pending || undefined },
    { href: "/desk", label: "My desk" },
  ];
  if (member.role === "owner") items.push({ href: "/admin", label: "Team" });
  return items;
}

function NavLinks({ variant }: { variant: "rail" | "tab" }) {
  const items = useNav();
  const path = usePathname();
  const { geoName } = useApp();
  return (
    <>
      {items.map((it) => {
        const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
        const label = it.geo ? geoName(it.geo) : it.label;
        return (
          <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}>
            <span>{label}</span>
            {variant === "rail" && it.badge ? <span className="count">{it.badge}</span> : null}
          </Link>
        );
      })}
    </>
  );
}

function Rail() {
  const { member } = useApp();
  const role = member.role === "owner" ? "Owner" : member.role === "manager" ? "Manager" : "Reporter";
  return (
    <aside className="rail">
      <Link href="/" className="mark">
        <span className="mark-word">Dispatch</span>
        <span className="mark-sub">Al Liwan Group</span>
      </Link>
      <nav className="nav" aria-label="Main">
        <NavLinks variant="rail" />
      </nav>
      <div className="rail-foot">
        <UserButton />
        <div className="who">
          {member.name}
          <span>{role}</span>
        </div>
      </div>
    </aside>
  );
}

function TabBar() {
  return (
    <nav className="tabbar" aria-label="Main">
      <NavLinks variant="tab" />
    </nav>
  );
}
