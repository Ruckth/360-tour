"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { ConvexError } from "convex/values";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const unassigned = "unassigned";

export type BinRelocation = FunctionArgs<typeof api.commerce.stock.relocateBinStock>;

export function StockBinPanel({ branchId, variantId, label, onClose, pendingRelocation, onPendingRelocation }: {
  branchId: Id<"branches">; variantId: Id<"productVariants">; label: string; onClose: () => void;
  pendingRelocation: BinRelocation | undefined; onPendingRelocation: (change?: BinRelocation) => void;
}) {
  const data = useQuery(api.commerce.stock.binBalances, { branchId, variantId });
  const add = useMutation(api.commerce.stock.addBin);
  const relocate = useMutation(api.commerce.stock.relocateBinStock);
  const [name, setName] = useState("");
  const [from, setFrom] = useState(unassigned);
  const [to, setTo] = useState(unassigned);
  const [selectedLot, setSelectedLot] = useState("");
  const [units, setUnits] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const relocationBusy = useRef(false);
  const lot = data?.lots.find(item => item.id === selectedLot);
  const locations = [{ id: unassigned, name: "Unassigned", quantity: lot?.unassigned ?? data?.unassigned ?? 0 },
    ...(data?.bins ?? []).map(bin => ({ ...bin, quantity: lot ? lot.bins.find(position => position.id === bin.id)?.quantity ?? 0 : bin.quantity })),
  ];
  const binId = (value: string) => data?.bins.find(bin => bin.id === value)?.id ?? null;

  async function run(action: () => Promise<void>, success: string) {
    setPending(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function move(change: BinRelocation) {
    if (relocationBusy.current) return;
    relocationBusy.current = true;
    onPendingRelocation(change);
    await run(async () => {
      try {
        await relocate(change);
        onPendingRelocation();
        setUnits("");
      } catch (error) {
        if (error instanceof ConvexError) onPendingRelocation();
        throw error;
      } finally {
        relocationBusy.current = false;
      }
    }, "Stock relocated.");
  }

  return <Card className="grid gap-3 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 ref={heading} tabIndex={-1} className="font-semibold">Bin custody · {label}</h3>
      <Button variant="outline" disabled={pending} onClick={onClose}>Close</Button>
    </div>
    {!data ? <p role="status">Loading bin balances…</p> : <>
      <p>Branch on hand: {data.onHand}</p>
      {data.bins.length ? <p className="text-sm text-muted-foreground">
        Move picked units to Unassigned before selling, transferring or adjusting them.
      </p> : null}
      {data.tracking ? <label className="flex flex-wrap items-center gap-2">Lot
        <select className="h-9 rounded-md border bg-background px-2" value={selectedLot} onChange={event => setSelectedLot(event.target.value)}>
          <option value="">All lots</option>
          {data.lots.map(item => <option key={item.id} value={item.id}>{item.code}</option>)}
        </select>
      </label> : null}
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        {locations.map(location => <div className="contents" key={location.id}>
          <dt>{location.name}</dt><dd className="tabular-nums">{location.quantity}</dd>
        </div>)}
      </dl>
      {data.canManage ? <>
        <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
          event.preventDefault();
          void run(async () => { await add({ branchId, name }); setName(""); }, "Bin saved.");
        }}>
          <label>New bin <Input value={name} onChange={event => setName(event.target.value)} maxLength={60} required /></label>
          <Button disabled={pending || !name.trim()}>Add bin</Button>
        </form>
        {pendingRelocation ? <div className="grid gap-2">
          <p role="status">Confirm the result of the previous {pendingRelocation.quantity}-unit relocation before starting another.</p>
          <Button className="justify-self-start" type="button" variant="outline" disabled={pending}
            onClick={() => { void move(pendingRelocation); }}>Retry previous relocation</Button>
        </div> : data.bins.length > 0 ? <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
          event.preventDefault();
          if (pending) return;
          const change = { branchId, variantId, from: binId(from), to: binId(to), ...(lot ? { lotId: lot.id } : {}), quantity: Number(units) };
          void move({ ...change, requestKey: crypto.randomUUID() });
        }}>
          <label className="grid gap-1">From
            <select className="h-9 rounded-md border bg-background px-2" value={from} onChange={event => setFrom(event.target.value)}>
              {locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1">To
            <select className="h-9 rounded-md border bg-background px-2" value={to} onChange={event => setTo(event.target.value)}>
              {locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </label>
          <label>Units <Input className="w-24" type="number" min={1} step={1} required value={units} onChange={event => setUnits(event.target.value)} /></label>
          <Button disabled={pending || from === to || !units || (data.tracking && !lot)}>Relocate stock</Button>
        </form> : null}
      </> : null}
      {data.recent.length ? <div>
        <h4 className="font-medium">Recent relocations</h4>
        <ul className="grid gap-1 text-sm">{data.recent.map(move => <li key={move._id}>
          {move.quantity} units{move.lotCode ? ` · ${move.lotCode}` : ""} from {locations.find(location => location.id === (move.from ?? unassigned))?.name} to {locations.find(location => location.id === (move.to ?? unassigned))?.name}
        </li>)}</ul>
      </div> : null}
    </>}
    {message ? <p role="status">{message}</p> : null}
  </Card>;
}
