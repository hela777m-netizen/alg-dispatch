"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Authenticated, AuthLoading, Unauthenticated, useAction, useMutation, useQuery } from "convex/react";
import { SignOutButton, UserButton, useAuth, useUser } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import { AppContext, useApp, type AppState } from "./AppContext";
import Logo from "./Logo";
import { useClock } from "@/lib/useClock";
import { cycleOf, todayISO } from "@/convex/lib/cycles";
import { MyPresence } from "./Presence";

export default function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthLoading>
        <Splash text="Opening Reporting Dashboard" />
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
  if (!isLoaded) return <Splash text="Opening Reporting Dashboard" />;
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
        <div className="mark-word">Reporting<br />Dashboard</div>
        <p className="h2">We couldn&apos;t open your dashboard</p>
        <p className="muted">
          You&apos;re signed in, but the dashboard couldn&apos;t confirm your access. Try again in a minute. If it keeps happening,
          contact the dashboard administrator and quote reference SIGNIN-TOKEN.
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
        <div className="mark-word">Reporting<br />Dashboard</div>
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
        <div className="mark-word">Reporting<br />Dashboard</div>
        <p className="h2">{setupProblem ? "We couldn't confirm your email" : "This email doesn't have access"}</p>
        <p className="muted">
          {setupProblem
            ? "Try again in a minute. If it keeps happening, contact the dashboard administrator and quote reference SIGNIN-EMAIL."
            : `You're signed in as ${email ?? "an unknown email"}, which isn't on the team list or has had its access switched off. Contact the dashboard administrator if you think this is wrong.`}
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
  const applyFixes = useMutation(api.members.applyFixes);
  const fixed = useRef(false);
  useEffect(() => {
    if (me.member.role === "owner" && !fixed.current) {
      fixed.current = true;
      applyFixes({}).catch(() => {});
    }
  }, [me.member.role, applyFixes]);
  const now = useClock();
  const today = todayISO(now.getTime());
  const liveCycle = cycleOf(today, me.anchor);
  const [cycle, setCycle] = useState(liveCycle);
  // When a new cycle starts while the page is open, move with it if you were on the current one.
  const lastLive = useRef(liveCycle);
  useEffect(() => {
    if (liveCycle !== lastLive.current) {
      setCycle((c) => (c === lastLive.current ? liveCycle : c));
      lastLive.current = liveCycle;
    }
  }, [liveCycle]);
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
    // Anyone can post to any office or market; their own geographies come first in the picker.
    const own = (k: string) => me.member.geographies.includes(k) || me.member.extraGeographies.includes(k);
    const loggable = [...me.geographies.filter((g) => own(g.key)), ...me.geographies.filter((g) => !own(g.key))];
    return {
      member: me.member,
      geographies: me.geographies,
      anchor: me.anchor,
      today,
      currentCycle: liveCycle,
      cycle,
      setCycle,
      geoName: (k: string) => names.get(k) ?? k,
      loggable,
      isLead,
      isOwner: me.member.role === "owner",
      toast,
    };
  }, [me, cycle, toast, today, liveCycle]);

  return (
    <AppContext.Provider value={value}>
      <div className="shell">
        <Rail />
        <main className="main">
          <TestBanner />
          <div className="topbar">
            <Link href="/" className="mark"><span className="mark-word">Reporting<br />Dashboard</span></Link>
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

/** Shown on every deployment that isn't the approved production one, so nobody mistakes it for the real system. */
function TestBanner() {
  if (process.env.NEXT_PUBLIC_DEPLOYMENT === "production") return null;
  return (
    <p className="test-banner" role="note">
      Test environment. Use made-up or non-confidential information only.
    </p>
  );
}

function useNav() {
  const { member } = useApp();
  const waiting = useQuery(api.reports.forReview, member.role !== "reporter" ? {} : "skip");
  const unread = useQuery(api.notifications.unreadCount) ?? 0;
  const pending = waiting?.length ?? 0;
  const inbox = { href: "/inbox", label: "Inbox", badge: unread || undefined };
  if (member.role === "reporter") {
    return [
      { href: "/desk", label: "My desk" },
      ...member.geographies.map((g) => ({ href: `/geo/${g}`, label: g, geo: g })),
      inbox,
      { href: "/", label: "Overview" },
    ] as { href: string; label: string; badge?: number; geo?: string }[];
  }
  const items: { href: string; label: string; badge?: number; geo?: string }[] = [
    { href: "/", label: "Overview" },
    { href: "/reviews", label: "Reviews", badge: pending || undefined },
    inbox,
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
            {it.badge ? <span className="count">{it.badge}</span> : null}
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
        <Logo height={46} />
        <span className="mark-word" style={{ marginTop: 18 }}>Reporting<br />Dashboard</span>
      </Link>
      <nav className="nav" aria-label="Main">
        <NavLinks variant="rail" />
      </nav>
      <div className="rail-presence">
        <MyPresence />
      </div>
      <div className="rail-foot">
        <UserButton />
        <Link href={`/people/${member._id}`} className="who" style={{ textDecoration: "none" }}>
          {member.name}
          <span>{role}</span>
        </Link>
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
