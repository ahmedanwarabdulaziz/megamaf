import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";

const cairo = Cairo({
  variable: "--font-sans",
  subsets: ["arabic", "latin"],
});

import type { Viewport } from "next";

export const viewport: Viewport = {
  themeColor: "#1e3a8a", // Navy Blue
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // Prevents zooming on input focus in iOS
};

export const metadata: Metadata = {
  title: "MegaMaf Construction",
  description: "نظام إدارة شركة مقاولات",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "MegaMaf",
  },
};


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className={`${cairo.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
