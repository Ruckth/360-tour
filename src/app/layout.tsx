import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import "../app.css";
import { SiteShell } from "@/components/global/SiteShell";
import { getLocalizedResort, getPublicMessages } from "@/lib/i18n/public-content";
import { themeInitScript } from "@/lib/theme";
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

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const resort = getLocalizedResort(locale);
  const seo = getPublicMessages(locale).SEO;

  return {
    metadataBase: new URL("https://seaviewresidence.com"),
    title: seo.rootTitle,
    description: seo.rootDescription,
    openGraph: {
      type: "website",
      siteName: resort.name,
      title: seo.rootOgTitle,
      description: seo.rootDescription,
      images: ["/garden-image.webp"],
    },
    twitter: {
      card: "summary_large_image",
      title: seo.rootOgTitle,
      description: seo.rootDescription,
      images: ["/garden-image.webp"],
    },
  };
}

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
    <html
      lang={locale}
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      className={`${serif.variable} ${sans.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
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
