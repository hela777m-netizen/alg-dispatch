"use client";

import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const KEY = "alg-install-dismissed";
const SNOOZE_DAYS = 14;

function snoozed(): boolean {
  try {
    const at = Number(localStorage.getItem(KEY) || 0);
    return Date.now() - at < SNOOZE_DAYS * 86400000;
  } catch {
    return false;
  }
}

function snooze() {
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Private browsing: the card just shows again next visit.
  }
}

/**
 * On phones, invites people to add the dashboard to the home screen so it opens full screen.
 * Hidden on laptops, inside the installed app, and for two weeks after "Not now".
 */
export default function InstallPrompt() {
  const [mode, setMode] = useState<"ios" | "android" | null>(null);
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const phone = window.matchMedia("(max-width: 860px) and (pointer: coarse)").matches;
    if (standalone || !phone || snoozed()) return;

    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setMode(ios ? "ios" : "android");

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallEvent);
    };
    const onInstalled = () => setMode(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!mode) return null;

  const close = () => {
    snooze();
    setMode(null);
  };

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === "accepted") setMode(null);
    setInstallEvent(null);
  };

  return (
    <div className="install" role="dialog" aria-labelledby="install-title">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" width={44} height={44} className="install-icon" />
      <div className="install-body">
        <p id="install-title" className="install-title">Add ALG Reports to your home screen</p>
        {mode === "ios" ? (
          <p className="install-steps">
            Tap <ShareIcon /> <b>Share</b>, then <b>Add to Home Screen</b>. It opens full screen, like an app.
          </p>
        ) : installEvent ? (
          <p className="install-steps">One tap. It opens full screen, like an app.</p>
        ) : (
          <p className="install-steps">
            Open the <b>⋮</b> menu, then <b>Add to Home screen</b>. It opens full screen, like an app.
          </p>
        )}
        <div className="install-actions">
          {mode === "android" && installEvent && (
            <button className="btn sm" onClick={install}>Install</button>
          )}
          <button className="btn quiet sm" onClick={close}>Not now</button>
        </div>
      </div>
    </div>
  );
}

function ShareIcon() {
  return (
    <svg className="install-share" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M12 3v12M8 7l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 11H5v10h14V11h-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
