import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Boardgame Timer",
  description:
    "Single-host web app that allocates a clock to each player in a board-game session.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
