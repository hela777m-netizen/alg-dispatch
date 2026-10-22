import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter/opsz.css";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "Reporting Dashboard",
  description: "Al Liwan Group geography reporting",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f3f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1424" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
