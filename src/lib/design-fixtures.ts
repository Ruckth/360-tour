/**
 * Sample-data design routes render in `next dev` and on Vercel Preview deployments, so reviewers see
 * every checkout and commerce state with all switches off. Production always answers 404.
 */
export function designFixturesEnabled(env: Partial<Record<"NODE_ENV" | "VERCEL_ENV", string>> = process.env) {
  return env.NODE_ENV === "development" || env.VERCEL_ENV === "preview";
}
