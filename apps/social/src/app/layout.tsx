import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Commons",
    template: "%s | Commons",
  },
  description:
    "Censorship-resistant civic discourse. Earn COMMONS through quality contributions. Cat memes welcome.",
  openGraph: {
    type: "website",
    siteName: "Commons",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
