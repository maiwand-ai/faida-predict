import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

// Design-system type stack (redesign ratification): Inter for interface text,
// Space Grotesk for display/headings, JetBrains Mono for every number.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "FAIDA Predict — Autonomous prediction-market trading",
  description:
    "Paper-trading prediction-market platform: order state machine, reconciliation, venue adapters (Polymarket, Manifold, Limitless, Kalshi), model registry with calibration governance and AI cost controls. Live trading stays disabled until Phase 7 gates pass.",
  keywords: ["FAIDA Predict", "prediction markets", "trading robots", "Polymarket", "Kalshi"],
  icons: {
    icon: "/brand/logo_mark.png",
    apple: "/brand/apple-touch-icon.png",
  },
  // C18 mobile shell (Phase 9): installable web app — store-policy re-check
  // recorded in docs/STORE_POLICY_PHASE9.md (web/PWA distribution, no native
  // store shells; [VERIFY] rows are counsel work).
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "FAIDA Predict",
    statusBarStyle: "black-translucent",
  },
};

// C18 mobile shell (Phase 9) — viewport honesty: device width, no forced zoom,
// notch-safe (viewport-fit=cover feeds env(safe-area-*) to the bottom tab bar).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0B0E14",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
