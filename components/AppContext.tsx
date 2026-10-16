"use client";

import { createContext, useContext } from "react";
import type { Doc } from "@/convex/_generated/dataModel";

export type AppState = {
  member: Doc<"members">;
  geographies: Doc<"geographies">[];
  anchor: string;
  today: string;
  currentCycle: number;
  cycle: number;
  setCycle: (c: number) => void;
  geoName: (key: string) => string;
  /** Geographies this person may log against, in display order. */
  loggable: Doc<"geographies">[];
  isLead: boolean;
  isOwner: boolean;
  toast: (message: string) => void;
};

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside the app shell");
  return ctx;
}
