import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import MainNav from "@/components/MainNav";

export const metadata: Metadata = {
  title: "Project Angel",
  description: "Agentic humanitarian globe for UN/HDX data."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <MainNav />
        {children}
      </body>
    </html>
  );
}
