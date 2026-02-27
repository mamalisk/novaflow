import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Novaflow",
  description: "AI-first development tool",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
