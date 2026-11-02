import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Ubuntu, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/providers";

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
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  themeColor: "#0e1015",
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
      </body>
    </html>
  );
}
