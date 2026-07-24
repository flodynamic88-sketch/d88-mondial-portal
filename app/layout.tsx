import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mondial Portal | Dynamic88 Solutions",
  description: "Delivery management portal for Mondial88 Trading Corporation",
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
