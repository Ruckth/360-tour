"use client";

import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  COMMERCE_OFF,
  type CommerceActions,
  type CommerceBackend,
  type CommerceAccess,
  type PayActions,
  type PaymentsMode,
} from "./backend";
import { deviceKey, rememberTill, serverTillId, tillId, useOnline, useServerTillId } from "./pay-desk";

/*
 * The pay desk's wiring, kept small because every checkout loads it: the cutover's access reader,
 * the direct panel's registration and the connection state. The attempt flow itself
 * (pay-desk-attempts) loads on demand: in attempts mode, or the first time a command or the resume
 * reader needs it. The live backend passes Convex's hooks; tests pass the in-process database.
 */

/** The commands the pay desk calls. */
type FnsAll = {
  start: typeof api.pos.commands.startPaymentAttempt.startPaymentAttempt;
  change: typeof api.pos.commands.changePaymentPlan.changePaymentPlan;
  arm: typeof api.pos.commands.armPaymentLeg.armPaymentLeg;
  record: typeof api.pos.commands.recordPaymentLeg.recordPaymentLeg;
  settle: typeof api.pos.commands.settleOrder.settlePaymentAttempt;
  cancel: typeof api.pos.commands.cancelPaymentAttempt.cancelPaymentAttempt;
  preview: typeof api.pos.commands.recoverPaymentAttempt.previewPaymentRecovery;
  startRecovery: typeof api.pos.commands.recoverPaymentAttempt.startPaymentRecovery;
  giveBack: typeof api.pos.commands.recoverPaymentAttempt.armPaymentGiveBack;
  swap: typeof api.pos.commands.recoverPaymentAttempt.beginPaymentSwap;
  takeOver: typeof api.pos.commands.handoverPaymentAttempt.takeOverPaymentAttempt;
  split: typeof api.pos.commands.splitStayPayment.splitStayPayment;
  openPanel: typeof api.commerce.paymentCutover.openDirectPanel;
  instructPanel: typeof api.commerce.paymentCutover.instructDirectPanel;
  answerPanel: typeof api.commerce.paymentCutover.answerDirectPanel;
  takeOverPanel: typeof api.commerce.paymentCutover.takeOverDirectPanel;
};
export type Fns = FnsAll;
type Call<K extends keyof Fns> = (args: FunctionArgs<Fns[K]>) => Promise<FunctionReturnType<Fns[K]>>;
export type AttemptCalls = { [K in keyof Fns]: Call<K> };
/** Everything the attempt flow does; the direct panel's registration stays here. */
type DirectPanelActions = "openDirectPanel" | "instructDirectPanel" | "answerDirectPanel" | "takeOverDirectPanel";
export type AttemptActions = Omit<PayActions, DirectPanelActions>;
const ATTEMPT_ACTIONS = ["startAttempt", "changePlan", "armLeg", "saveCashTendered", "recordLeg", "settleAttempt", "cancelAttempt", "previewRecovery", "recover", "takeOver", "payRoomFirst"] as const satisfies readonly (keyof AttemptActions)[];

type Attempts = typeof import("./pay-desk-attempts");
let attempts: Attempts | null = null;
let loadingAttempts: Promise<Attempts> | null = null;
const attemptListeners = new Set<() => void>();
/** Loads the attempt flow once per page. */
export function loadAttempts() {
  loadingAttempts ??= import("./pay-desk-attempts").then((loaded) => {
    attempts = loaded;
    for (const fn of attemptListeners) fn();
    return loaded;
  });
  return loadingAttempts;
}
/** Warm the new panel before its first payment, including when the till later loses its connection. */
export function preloadPayDesk() {
  void Promise.all([import("./PayPanel"), import("./PayDeskPanel"), import("./PayDeskNotices"), import("./PayRecovery"), loadAttempts()]).catch(() => undefined);
}
/** The attempt flow once loaded; asking for it starts the load. */
function useAttempts(wanted: boolean) {
  const flow = useSyncExternalStore((fn) => { attemptListeners.add(fn); return () => { attemptListeners.delete(fn); }; }, () => attempts, () => null);
  useEffect(() => { if (wanted && !flow) void loadAttempts(); }, [wanted, flow]);
  return flow;
}

const noSubscribe = () => () => {};
const noTab = () => null;

/** Each attempt command loads the flow on first use; afterwards it runs at once. */
function lazyAttemptActions(calls: AttemptCalls): AttemptActions {
  let actions: AttemptActions | null = null;
  const get = async () => (actions ??= (await loadAttempts()).payActions(calls));
  return Object.fromEntries(ATTEMPT_ACTIONS.map((name) => [name, async (args: never) => ((await get())[name] as (a: never) => Promise<unknown>)(args)])) as unknown as AttemptActions;
}
export type PayDeskTransport = {
  /** The live connection, where the transport has one (Convex's useConvexConnectionState). */
  useConnectionState?: () => { isWebSocketConnected: boolean; hasEverConnected: boolean };
  useMutation: <F extends FunctionReference<"mutation">>(ref: F) => (args: FunctionArgs<F>) => Promise<FunctionReturnType<F>>;
  useQuery: <F extends FunctionReference<"query">>(ref: F, args: FunctionArgs<F> | "skip") => FunctionReturnType<F> | undefined;
};

// The payments mode and cutover revision this page loaded with (v27 Rollout gate). Never refreshed
// in place: a later cutover leaves the till on "reload" until the page is reloaded.
const pinned: { mode?: PaymentsMode; revision?: number | null } = {};
let acknowledging = false;
// The cutover revision this page has acknowledged: its till is admitted, and acknowledging again
// would only repeat it while the access reader catches up with the till it returned.
let acknowledgedRevision: number | null = null;
/** Tests only: a new page load, optionally one that loaded with `next`. */
export function resetPinnedAccess(next?: { mode: PaymentsMode; revision: number | null }) {
  delete pinned.mode;
  delete pinned.revision;
  if (next) Object.assign(pinned, next);
  acknowledging = false;
  acknowledgedRevision = null;
}

/** Pins the mode and cutover revision on the page's first access answer; later answers never change it. */
export function pinLoadedAccess(mode: PaymentsMode, revision: number | null) {
  if (pinned.mode !== undefined) return;
  pinned.mode = mode;
  pinned.revision = revision;
}

export function withSwapOwner<A extends { swapOwner?: { tillId: string; tabKey?: string } }, R>(mutate: (args: A) => Promise<R>) {
  return async (args: A) => {
    const id = pinned.mode === "attempts" ? serverTillId() : undefined;
    if (!id) return mutate(args);
    const { claimTabKey } = await import("./pay-desk-tab");
    return mutate({ ...args, swapOwner: { tillId: id, tabKey: await claimTabKey() } });
  };
}

/**
 * The acknowledged load this page pinned (start, arm, give-back and takeover admission). Missing
 * before the till is admitted: the server then answers TILL_NEEDS_RELOAD and the reload screen shows.
 */
export function tillLoad() {
  const id = serverTillId();
  return id && pinned.mode && typeof pinned.revision === "number"
    ? { load: { tillId: id, deviceKey: deviceKey(), loadedMode: pinned.mode, loadedRevision: pinned.revision } }
    : {};
}

/**
 * The cutover lane's access reader (commerce/settings:getAccess). After a reload into attempts,
 * this till acknowledges the new panel with the pinned mode and revision before taking payments;
 * until it has, access reads as loading. A stale acknowledgement leaves tillReady false (reload).
 */
export function cutoverAccess(transport: PayDeskTransport): CommerceBackend["useAccess"] {
  return function useCutoverAccess() {
    // The acknowledgement answers after its query refresh: re-render when it names this device's till.
    const till = useServerTillId();
    const args = { deviceKey: deviceKey(), ...(till ? { tillId: till } : {}), ...(typeof pinned.revision === "number" ? { loadedRevision: pinned.revision } : {}) };
    const fresh = transport.useQuery(api.commerce.settings.getAccess, args);
    // Learning this till's id or the pinned revision changes the arguments: keep the last answer
    // meanwhile, so an open panel doesn't flash to loading and remount.
    const last = useRef(fresh);
    useEffect(() => { if (fresh) last.current = fresh; });
    const result = fresh ?? last.current;
    const acknowledge = transport.useMutation(api.commerce.paymentCutover.acknowledge);
    const [refused, setRefused] = useState(false);
    if (result) pinLoadedAccess(result.paymentsMode, result.cutoverRevision);
    const revision = pinned.revision;
    const unready = Boolean(result && pinned.mode === "attempts" && result.paymentsMode === "attempts" && typeof revision === "number" &&
      result.cutoverRevision === revision && !result.tillReady && !refused);
    const needsAck = unready && acknowledgedRevision !== revision;
    // Acknowledged, and the reader for the returned till is still loading: loading, not reload.
    const catchingUp = unready && acknowledgedRevision === revision && fresh === undefined;
    useEffect(() => {
      if (!needsAck || acknowledging || typeof revision !== "number") return;
      acknowledging = true;
      acknowledge({ deviceKey: deviceKey(), ...(till ? { tillId: till } : {}), loadedMode: "attempts", loadedRevision: revision })
        .then((ack) => { rememberTill(ack.tillId); acknowledgedRevision = revision; })
        .catch(() => setRefused(true))
        .finally(() => { acknowledging = false; });
    }, [needsAck, acknowledge, till, revision]);
    return useMemo((): CommerceAccess | undefined => {
      if (!result || needsAck || catchingUp) return undefined;
      const { cutoverRevision: _revision, ...access } = result;
      void _revision;
      return access;
    }, [result, needsAck, catchingUp]);
  };
}

/**
 * The pay desk's readers and writers, on any transport. Everything else in CommerceBackend stays
 * Off (COMMERCE_OFF) until its own wave; `useAccess` is the caller's (the cutover lane's reader).
 */
export function payDeskCommerce(transport: PayDeskTransport, useAccess: CommerceBackend["useAccess"] = COMMERCE_OFF.useAccess): CommerceBackend {
  return {
    ...COMMERCE_OFF,
    useAccess,
    usePaymentAttempt(orderId, activeAttemptId) {
      // Loading until this tab's key is claimed (whether the payment is this tab's depends on it)
      // and the attempt flow has loaded.
      const flow = useAttempts(Boolean(orderId));
      const tabKey = useSyncExternalStore(flow?.subscribeTab ?? noSubscribe, flow?.currentTab ?? noTab, noTab);
      const result = transport.useQuery(api.pos.commands.resumePaymentAttempt.resumePaymentAttempt, orderId && tabKey ? { orderId, tillId: tillId(), tabKey } : "skip");
      return useMemo(() => {
        if (!orderId) return null;
        if (result === undefined || !tabKey || !flow) return undefined;
        return flow.attemptReading(result, orderId, activeAttemptId);
      }, [result, orderId, activeAttemptId, tabKey, flow]);
    },
    useConnected() {
      const online = useOnline();
      const state = transport.useConnectionState?.();
      // Before the first connection the page is still loading, not disconnected.
      return online && (!state || !state.hasEverConnected || state.isWebSocketConnected);
    },
    useActions() {
      // One named hook per command, so each endpoint's caller is visible where it is wired.
      const calls: AttemptCalls = {
        start: transport.useMutation(api.pos.commands.startPaymentAttempt.startPaymentAttempt),
        change: transport.useMutation(api.pos.commands.changePaymentPlan.changePaymentPlan),
        arm: transport.useMutation(api.pos.commands.armPaymentLeg.armPaymentLeg),
        record: transport.useMutation(api.pos.commands.recordPaymentLeg.recordPaymentLeg),
        settle: transport.useMutation(api.pos.commands.settleOrder.settlePaymentAttempt),
        cancel: transport.useMutation(api.pos.commands.cancelPaymentAttempt.cancelPaymentAttempt),
        preview: transport.useMutation(api.pos.commands.recoverPaymentAttempt.previewPaymentRecovery),
        startRecovery: transport.useMutation(api.pos.commands.recoverPaymentAttempt.startPaymentRecovery),
        giveBack: transport.useMutation(api.pos.commands.recoverPaymentAttempt.armPaymentGiveBack),
        swap: transport.useMutation(api.pos.commands.recoverPaymentAttempt.beginPaymentSwap),
        takeOver: transport.useMutation(api.pos.commands.handoverPaymentAttempt.takeOverPaymentAttempt),
        split: transport.useMutation(api.pos.commands.splitStayPayment.splitStayPayment),
        openPanel: transport.useMutation(api.commerce.paymentCutover.openDirectPanel),
        instructPanel: transport.useMutation(api.commerce.paymentCutover.instructDirectPanel),
        answerPanel: transport.useMutation(api.commerce.paymentCutover.answerDirectPanel),
        takeOverPanel: transport.useMutation(api.commerce.paymentCutover.takeOverDirectPanel),
      };
      const off = COMMERCE_OFF.useActions();
      // Stable for as long as the transport's mutation functions are.
      return useMemo(() => ({ ...off, ...lazyAttemptActions(calls), ...directPanel(calls) }) satisfies CommerceActions,
        // eslint-disable-next-line react-hooks/exhaustive-deps -- one entry per fixed function reference
        Object.values(calls));
    },
  };
}

/** The direct panel's registration calls, on this device (its till) and the panel's tab. */
function directPanel(call: AttemptCalls): Pick<PayActions, DirectPanelActions> {
  const device = <A extends { tillId?: string }>(args: A) => {
    const till = args.tillId ?? serverTillId();
    return { ...args, deviceKey: deviceKey(), ...(till ? { tillId: till as Id<"tills"> } : {}) };
  };
  return {
    async openDirectPanel(args) {
      const { tillId: registered, previous } = await call.openPanel(device(args));
      rememberTill(registered);
      return previous ? { previous } : null;
    },
    instructDirectPanel: (args) => call.instructPanel(device(args)),
    answerDirectPanel: (args) => call.answerPanel({ ...device(args), outcome: "notTaken" }),
    takeOverDirectPanel: (args) => call.takeOverPanel({ ...args, deviceKey: deviceKey() }),
  };
}
