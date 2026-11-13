export default function requireLocalIntegration() {
  for (const key of ["E2E_BASE_URL", "NEXT_PUBLIC_CONVEX_URL"] as const) {
    const value = process.env[key];
    if (!value || !["localhost", "127.0.0.1"].includes(new URL(value).hostname))
      throw new Error(
        `Run pnpm test:e2e; ${key} must name the fresh isolated local server`,
      );
  }
}
