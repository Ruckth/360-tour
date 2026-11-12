"use client";

import { api } from "convex/_generated/api";
import { useConvex, useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useOptionalConvex } from "@/lib/react/convex";
import { Message, PairingCode, Screen } from "./DisplayScreens";

/**
 * The customer display's connection: pairing (link or code), the device token, heartbeats and the
 * Convex connection. What it shows is in DisplayScreens.tsx.
 */

const TOKEN_KEY = "display-token";
const PAIR_EXPIRES_KEY = "display-pair-expires";
const HEARTBEAT_MS = 30_000;
/** After this long offline the order is hidden, so a stale total is never shown as current. */
const STALE_AFTER_MS = 60_000;
const RETRY_MS = 15_000;

/**
 * localStorage can be blocked (private mode, kiosk policies) or full. The token always lives in memory
 * first; storage only lets it survive a reload, so failures are ignored.
 */
const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Keep going with the in-memory token.
    }
  },
  remove(key: string) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing stored to forget.
    }
  },
};

/** A friendly default name for the staff list ("Display · iPad"). */
function deviceName() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  if (/SMART-TV|SmartTV|Tizen|Web0S|BRAVIA|CrKey|\bTV\b/i.test(ua)) return "TV";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "Customer display";
}

export function CustomerDisplay() {
  const t = useTranslations("Display");
  const convex = useOptionalConvex();
  if (!convex) return <Message>{t("notConfigured")}</Message>;
  return <PairedDisplay />;
}

/** A display paired with a device token (a link, which "This computer" also uses, or a code). */
function PairedDisplay() {
  const t = useTranslations("Display");
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [linkFailed, setLinkFailed] = useState(false);
  const claimLink = useMutation(api.pos.displays.claimLink);
  const startPairing = useMutation(api.pos.displays.startPairing);
  const heartbeat = useMutation(api.pos.displays.heartbeat);
  const started = useRef(false);
  const claimed = useRef(new Set<string>());
  const retry = useRef<number | undefined>(undefined);
  const tokenRef = useRef<string | null>(null);
  const keepToken = useCallback((next: string | null) => {
    tokenRef.current = next;
    setToken(next);
  }, []);

  /*
   * Pairing is one sequence: link claims, run one at a time in the order the links arrived, and
   * codes from startPairing. A claim invalidates any code request in flight (`generation`), whose
   * response is then ignored and never stores a token. While claims are waiting no code is
   * requested; code pairing resumes (`resume`) only if the last of them fails. A successful claim
   * keeps its token even if a later link then fails.
   */
  const generation = useRef(0);
  const codeRequest = useRef<number | null>(null);
  const claimQueue = useRef<Promise<void>>(Promise.resolve());
  const claimsWaiting = useRef(0);
  const [resume, setResume] = useState(0);

  const pair = useCallback(async () => {
    if (claimsWaiting.current > 0 || codeRequest.current === generation.current) return;
    const mine = ++generation.current;
    codeRequest.current = mine;
    window.clearTimeout(retry.current);
    try {
      // The previous token's row is replaced if it is still pending, so refreshes leave no orphans.
      const result = await startPairing({ deviceName: deviceName(), previousToken: tokenRef.current ?? undefined });
      // Superseded (a link claim started meanwhile), or staff approved the code just now: keep the token.
      if (mine !== generation.current || result.status === "active") return;
      keepToken(result.token);
      setExpiresAt(result.expiresAt);
      storage.set(TOKEN_KEY, result.token);
      storage.set(PAIR_EXPIRES_KEY, String(result.expiresAt));
    } catch {
      if (mine === generation.current) retry.current = window.setTimeout(() => void pair(), RETRY_MS);
    } finally {
      if (codeRequest.current === mine) codeRequest.current = null;
    }
  }, [startPairing, keepToken]);

  const resumeStored = useCallback(() => {
    const stored = storage.get(TOKEN_KEY);
    if (!stored) return void pair();
    setExpiresAt(Number(storage.get(PAIR_EXPIRES_KEY)) || null);
    keepToken(stored);
  }, [pair, keepToken]);

  /**
   * Claims a pairing link in the fragment (`#pair=<secret>`, plus `name=` from "This computer").
   * Runs on load and on `hashchange`, since a link can also arrive in a display window that is
   * already open. Returns whether there was a new link to claim.
   */
  const claimFragment = useCallback(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const secret = params.get("pair");
    // Drop the fragment before any async work, so the secret never lingers in the address bar or history.
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (!secret || claimed.current.has(secret)) return false;
    claimed.current.add(secret);
    const name = params.get("name") ?? deviceName();
    claimsWaiting.current += 1;
    generation.current += 1;
    window.clearTimeout(retry.current);
    const claim = async () => {
      let token: string | null = null;
      try {
        // The pending code's row (if any) is deleted once the link is claimed.
        const result = await claimLink({ secret, deviceName: name, previousToken: tokenRef.current ?? undefined });
        if (result.ok) token = result.token;
      } catch {
        // Treated like an invalid link.
      }
      claimsWaiting.current -= 1;
      if (token) {
        // In memory first: a failed storage write must not lose the token or start pairing again.
        keepToken(token);
        storage.set(TOKEN_KEY, token);
        storage.remove(PAIR_EXPIRES_KEY);
        return;
      }
      setLinkFailed(true);
      if (claimsWaiting.current > 0) return;
      if (tokenRef.current) setResume((value) => value + 1);
      else resumeStored();
    };
    claimQueue.current = claimQueue.current.then(claim);
    return true;
  }, [claimLink, keepToken, resumeStored]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!claimFragment()) resumeStored();
  }, [claimFragment, resumeStored]);

  useEffect(() => {
    const onHashChange = () => void claimFragment();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [claimFragment]);

  useEffect(() => () => window.clearTimeout(retry.current), []);

  const state = useQuery(api.pos.displays.current, token ? { token } : "skip");
  const kind = state?.state;
  const paired = kind !== undefined && kind !== "unpaired" && kind !== "pending";

  // Revoked, unknown or expired: forget the token and show a fresh code. Re-checked after a failed claim.
  useEffect(() => {
    if (kind !== "unpaired") return;
    storage.remove(TOKEN_KEY);
    storage.remove(PAIR_EXPIRES_KEY);
    void pair();
  }, [kind, pair, resume]);

  // A pending code refreshes itself when it expires (or straight away if its expiry is unknown).
  // Re-armed after a failed claim, since a refresh that fell due during the claim was skipped.
  useEffect(() => {
    if (kind !== "pending") return;
    const wait = expiresAt ? expiresAt - Date.now() : 0;
    const id = window.setTimeout(() => void pair(), Math.max(0, wait));
    return () => window.clearTimeout(id);
  }, [kind, expiresAt, pair, resume]);

  useEffect(() => {
    if (paired) {
      setLinkFailed(false);
      storage.remove(PAIR_EXPIRES_KEY);
    }
  }, [paired]);

  useEffect(() => {
    if (!paired || !token) return;
    const beat = () => void heartbeat({ token }).catch(() => undefined);
    beat();
    const id = window.setInterval(beat, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [paired, token, heartbeat]);

  if (state === undefined || state.state === "unpaired") return <Connection>{null}</Connection>;
  if (state.state === "pending") {
    return (
      <Connection>
        <PairingCode code={state.code} notice={linkFailed ? t("pairLinkFailed") : null} />
      </Connection>
    );
  }
  return <Connection hideStale><Screen state={state} /></Connection>;
}

/**
 * Whether the display is offline: a quiet pill while reconnecting, and the order hidden after a minute.
 * The browser's `offline` event shows it at once (the Convex socket only notices after its timeout);
 * recovery follows the Convex connection, so it clears once the socket is back.
 */
function useOffline() {
  const convex = useConvex();
  const [socketDown, setSocketDown] = useState(false);
  const [networkDown, setNetworkDown] = useState(false);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const update = (connection: ReturnType<typeof convex.connectionState>) =>
      setSocketDown(connection.hasEverConnected && !connection.isWebSocketConnected);
    update(convex.connectionState());
    return convex.subscribeToConnectionState(update);
  }, [convex]);

  useEffect(() => {
    const sync = () => setNetworkDown(!navigator.onLine);
    sync();
    window.addEventListener("offline", sync);
    window.addEventListener("online", sync);
    return () => {
      window.removeEventListener("offline", sync);
      window.removeEventListener("online", sync);
    };
  }, []);

  const offline = socketDown || networkDown;
  useEffect(() => {
    setStale(false);
    if (!offline) return;
    const id = window.setTimeout(() => setStale(true), STALE_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [offline]);

  return { offline, stale };
}

function Connection({ children, hideStale = false }: { children: ReactNode; hideStale?: boolean }) {
  const t = useTranslations("Display");
  const { offline, stale } = useOffline();
  if (offline && stale && hideStale) {
    return (
      <Message>
        <span className="flex flex-col items-center gap-4">
          <span className="text-4xl font-semibold tracking-tight text-foreground">{t("reconnecting")}</span>
          <span>{t("reconnectingBody")}</span>
        </span>
      </Message>
    );
  }
  return (
    <>
      {children ?? <Message>{t("connecting")}</Message>}
      {offline ? (
        // A slim strip inside the screens' top padding, so it never covers the header (business name, order number).
        <div role="status" className="fixed inset-x-0 top-0 z-10 flex items-center justify-center gap-2.5 border-b border-amber-200 bg-amber-50/95 py-1.5 text-sm font-medium text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/15 dark:text-amber-200">
          <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-amber-500" />
          {t("reconnecting")}
        </div>
      ) : null}
    </>
  );
}
