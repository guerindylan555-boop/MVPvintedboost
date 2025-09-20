import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AppShell from "@/app/components/app-shell";
import { SubscriptionProvider } from "@/app/components/subscription-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "VintedBoost",
  description: "Generate realistic Vinted-ready listings from garment photos.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <SubscriptionProvider>
          <AppShell>{children}</AppShell>
        </SubscriptionProvider>
      </body>
    </html>
  );
}
