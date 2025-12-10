// src/app/layout.tsx
import { ServiceWorkerRegister } from "./sw-register";
import type { Metadata } from "next";
import "./globals.css";

export const metadata = {
  title: "Precision Pulse",
  description: "Precision Lumping Services – Production & Workforce OS",
  manifest: "/manifest.webmanifest",
};

export const viewport = {
  themeColor: "#020617",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}

