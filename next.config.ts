import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from '@sentry/nextjs/config';

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  async headers() {
    const cacheHeaders = [
      {
        key: "Cache-Control",
        value: "public, max-age=31536000, immutable",
      },
    ];

    return [
      {
        source: "/videos/:path*",
        headers: cacheHeaders,
      },
      {
        source: "/fonts/:path*",
        headers: cacheHeaders,
      },
      {
        source: "/contact/:path*",
        headers: cacheHeaders,
      },
      {
        source: "/:path*\\.(png|jpg|jpeg|webp|avif|gif|svg|ico|mp4|woff2|ttf|otf)",
        headers: cacheHeaders,
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/garden-image.jpg",
        destination: "/garden-image.webp",
        permanent: true,
      },
    ];
  },
  images: {
    formats: ["image/avif", "image/webp"],
    qualities: [72, 75, 82],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "qr-official.line.me",
      },
    ],
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const configured = withNextIntl(nextConfig);
export default process.env.SENTRY_DSN
  ? withSentryConfig(configured, { silent: true, sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN } })
  : configured;
