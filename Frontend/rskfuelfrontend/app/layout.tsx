import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RBTC Gas Station",
  description: "Swap USDRIF or RIF for RBTC instantly on Rootstock Testnet.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
