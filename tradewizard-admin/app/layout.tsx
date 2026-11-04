import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Ubuntu, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/providers";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { IosViewportGuard } from "@/components/pwa/IosViewportGuard";

// Same two families as the product, so the portal reads as TradeWizard rather
// than as a generic dashboard. Mono is reserved for identifiers and numerals.
const ubuntu = Ubuntu({
  variable: "--font-ubuntu",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "TradeWizard Admin",
    template: "%s · TradeWizard Admin",
  },
  description: "Internal management portal",
  applicationName: "TradeWizard Operations",
  robots: { index: false, follow: false, nocache: true },
  formatDetection: { telephone: false, email: false, address: false },
  appleWebApp: {
    capable: true,
    title: "TW Ops",
    // Opaque status bar: content starts below it, so the shell never has to
    // guess where the notch ends.
    statusBarStyle: "black",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the shell paint edge-to-edge and use env(safe-area-inset-*) itself.
  viewportFit: "cover",
  themeColor: "#0e1116",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${ubuntu.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
        <ServiceWorkerRegistrar />
        <IosViewportGuard />
      </body>
    </html>
  );
}
