"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@clerk/nextjs";
import { ConvexProvider, ConvexReactClient, useConvexAuth } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";

const ConvexClientContext = createContext<ConvexReactClient | null>(null);
const OptionalConvexAuthContext = createContext({
  isConfigured: false,
  isAuthEnabled: false,
  isLoading: false,
  isAuthenticated: false,
});

function ConvexAuthStateProvider({ children }: { children: ReactNode }) {
  const auth = useConvexAuth();

  return (
    <OptionalConvexAuthContext.Provider
      value={{
        isConfigured: true,
        isAuthEnabled: true,
        isLoading: auth.isLoading,
        isAuthenticated: auth.isAuthenticated,
      }}
    >
      {children}
    </OptionalConvexAuthContext.Provider>
  );
}

export function OptionalConvexProvider({
  convexUrl,
  clerkEnabled = false,
  children,
}: {
  convexUrl?: string;
  clerkEnabled?: boolean;
  children: ReactNode;
}) {
  const client = useMemo(() => {
    if (!convexUrl || convexUrl.includes("placeholder")) return null;
    return new ConvexReactClient(convexUrl);
  }, [convexUrl]);

  if (!client) {
    return (
      <ConvexClientContext.Provider value={null}>
        <OptionalConvexAuthContext.Provider
          value={{
            isConfigured: false,
            isAuthEnabled: clerkEnabled,
            isLoading: false,
            isAuthenticated: false,
          }}
        >
          {children}
        </OptionalConvexAuthContext.Provider>
      </ConvexClientContext.Provider>
    );
  }

  if (clerkEnabled) {
    return (
      <ConvexProviderWithClerk client={client} useAuth={useAuth}>
        <ConvexClientContext.Provider value={client}>
          <ConvexAuthStateProvider>{children}</ConvexAuthStateProvider>
        </ConvexClientContext.Provider>
      </ConvexProviderWithClerk>
    );
  }

  return (
    <ConvexProvider client={client}>
      <ConvexClientContext.Provider value={client}>
        <OptionalConvexAuthContext.Provider
          value={{
            isConfigured: true,
            isAuthEnabled: false,
            isLoading: false,
            isAuthenticated: true,
          }}
        >
          {children}
        </OptionalConvexAuthContext.Provider>
      </ConvexClientContext.Provider>
    </ConvexProvider>
  );
}

export function useOptionalConvex() {
  return useContext(ConvexClientContext);
}

export function useOptionalConvexAuth() {
  return useContext(OptionalConvexAuthContext);
}

export function useConvexQuery<T>(
  queryFn: unknown,
  args: Record<string, unknown>,
  fallback: T,
) {
  const client = useOptionalConvex();
  const argsKey = JSON.stringify(args);
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
    const queryArgs = JSON.parse(argsKey) as Record<string, unknown>;
    client
      .query(queryFn as never, queryArgs as never)
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
  }, [argsKey, client, fallback, queryFn]);

  return { data, loading, error };
}
