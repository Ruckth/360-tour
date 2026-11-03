"use client";

import { api } from "convex/_generated/api";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { checkoutTabId } from "./checkout-tab-id";

/** The paired displays, and whether this checkout tab drives them ("here"), another tab does, or none. */
export function useDisplayDriver() {
  // Settled after mount: the id needs sessionStorage and a quick check with the other tabs.
  const [clientId, setClientId] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    void checkoutTabId().then((id) => mounted && setClientId(id));
    return () => {
      mounted = false;
    };
  }, []);
  const status = useQuery(api.displays.listDisplays, clientId ? { clientId } : "skip");
  return { clientId, displays: status?.displays, driver: status?.driver };
}
