"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

export default function Providers({ children }: { children: React.ReactNode }) {
  if (!convex) {
    return (
      <div className="center-screen">
        <div className="gate">
          <p className="h2">Almost there</p>
          <p className="muted">
            The app can&apos;t find its database address. Add NEXT_PUBLIC_CONVEX_URL in Vercel, then redeploy.
          </p>
        </div>
      </div>
    );
  }
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "#0b3b80",
          borderRadius: "10px",
          fontFamily: '"Inter Variable", "Inter", system-ui, sans-serif',
        },
      }}
    >
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
