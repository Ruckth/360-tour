// convex-test discovers modules through Vite's import.meta.glob; vite is not a direct dependency,
// so declare only the part the tests use.
interface ImportMeta {
  glob(pattern: string | string[]): Record<string, () => Promise<unknown>>;
}
