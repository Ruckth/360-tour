// Browser-only fixtures: no backend connection or writes.
export function useQuery() {
  return [];
}
export function useMutation() {
  return async (args: unknown) => {
    window.dispatchEvent(new CustomEvent("fixture-mutation", { detail: args }));
    return "fixture-booking";
  };
}
