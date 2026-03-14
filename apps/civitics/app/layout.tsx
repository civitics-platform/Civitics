import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Civitics", template: "%s | Civitics" },
  description:
    "Democracy with receipts. Structured civic data, legislative tracking, and AI-powered accountability tools.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
