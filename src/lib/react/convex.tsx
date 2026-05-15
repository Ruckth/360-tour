"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ConvexReactClient } from "convex/react";

const ConvexClientContext = createContext<ConvexReactClient | null>(null);

export function OptionalConvexProvider({
  convexUrl,
  children,
}: {
  convexUrl?: string;
  children: ReactNode;
}) {
  const client = useMemo(() => {
    if (!convexUrl || convexUrl.includes("placeholder")) return null;
    return new ConvexReactClient(convexUrl);
  }, [convexUrl]);

  return (
    <ConvexClientContext.Provider value={client}>
      {children}
    </ConvexClientContext.Provider>
  );
}

export function useOptionalConvex() {
  return useContext(ConvexClientContext);
}

export function useConvexQuery<T>(
  queryFn: unknown,
  args: Record<string, unknown>,
  fallback: T,
) {
  const client = useOptionalConvex();
  const [data, setData] = useState<T>(fallback);
  const [loading, setLoading] = useState(Boolean(client));
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    if (!client) {
      setData(fallback);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    client
      .query(queryFn as never, args as never)
      .then((result) => {
        if (!active) return;
        setData((result ?? fallback) as T);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setData(fallback);
        setError(err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [client, queryFn, JSON.stringify(args), fallback]);

  return { data, loading, error };
}
