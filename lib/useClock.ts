"use client";

import { useEffect, useState } from "react";

/** Current time, refreshed every 30 seconds, for local clocks. */
export function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}
