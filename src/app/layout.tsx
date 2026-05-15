import type { Metadata } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import "../app.css";
import { SiteShell } from "@/components/global/SiteShell";
import { resort } from "@/lib/data/resort-config";
import { Providers } from "./providers";

const serif = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

const sans = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://seaviewresidence.com"),
  title: `${resort.name} — Luxury Villas in ${resort.location}`,
  description: resort.description,
  openGraph: {
    type: "website",
    siteName: resort.name,
    title: `${resort.name} — ${resort.location}`,
    description: resort.description,
    images: ["/garden-image.webp"],
  },
  twitter: {
    card: "summary_large_image",
    title: `${resort.name} — ${resort.location}`,
    description: resort.description,
    images: ["/garden-image.webp"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const convexUrl =
    process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.PUBLIC_CONVEX_URL;
  const clerkPublishableKey =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
    process.env.PUBLIC_CLERK_PUBLISHABLE_KEY;

  return (
    <html lang="en" suppressHydrationWarning className={`${serif.variable} ${sans.variable}`}>
      <body>
        <Providers convexUrl={convexUrl} clerkPublishableKey={clerkPublishableKey}>
          <SiteShell>{children}</SiteShell>
        </Providers>
      </body>
    </html>
  );
}
