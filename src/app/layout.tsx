import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const convexUrl =
    process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.PUBLIC_CONVEX_URL;
  const clerkPublishableKey =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
    process.env.PUBLIC_CLERK_PUBLISHABLE_KEY;
  const clerkEnabled =
    Boolean(clerkPublishableKey) && !clerkPublishableKey?.includes("placeholder");
  const app = (
    <Providers convexUrl={convexUrl} clerkEnabled={clerkEnabled}>
      <SiteShell>{children}</SiteShell>
    </Providers>
  );

  return (
    <html lang={locale} suppressHydrationWarning className={`${serif.variable} ${sans.variable}`}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {clerkEnabled ? (
            <ClerkProvider publishableKey={clerkPublishableKey}>{app}</ClerkProvider>
          ) : (
            app
          )}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
