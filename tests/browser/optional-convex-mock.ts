// These component fixtures are disconnected; public booking hints use defaults.
// Keep authentication and network providers out of the browser-only harness.
export function useOptionalConvex() {
  return null;
}
export function useOptionalConvexAuth() {
  return { isConfigured: false, isAuthEnabled: false, isLoading: false, isAuthenticated: false };
}
