import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
  themeColor: "#0B1220",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
