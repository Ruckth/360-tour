"use client";

import { useMutation, useQueries } from "convex/react";
import { api } from "convex/_generated/api";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OrderLine } from "./backend";

type PackingOptions = FunctionReturnType<typeof api.pos.orders.packedLotOptions>;
type PackedParts = FunctionArgs<typeof api.pos.orders.savePackedLots>["parts"];
type DraftOptions = NonNullable<PackingOptions>;
const fieldKey = (contentKey: string, lotId: string) => JSON.stringify([contentKey, lotId]);

function savedQuantities(parts: PackedParts) {
  return Object.fromEntries(parts.flatMap(part => part.allocations.map(lot =>
    [fieldKey(part.contentKey, lot.lotId), lot.quantity],
  )));
}

export function PackedLotEditor({ line, disabled }: { line: Pick<OrderLine, "_id" | "packing">; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [baseline, setBaseline] = useState<DraftOptions | null>(null);
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const result: PackingOptions | Error | undefined = useQueries(open ? {
    packing: { query: api.pos.orders.packedLotOptions, args: { lineId: line._id } },
  } : {}).packing;
  const latest = result instanceof Error ? null : result;
  if (open && latest && !baseline) setBaseline(latest);
  const options = baseline;
  const stale = !!options && !!latest && options.revision !== latest.revision;
  const draft = { ...(options ? savedQuantities(options.packing) : {}), ...edits };
  const editableKeys = new Set(options?.parts.flatMap(part => part.lots.map(lot => fieldKey(part.contentKey, lot.lotId))));
  const unavailable = Object.keys(draft).filter(key => draft[key] > 0 && !editableKeys.has(key));
  const save = useMutation(api.pos.orders.savePackedLots);

  async function submit(parts: PackedParts) {
    if (!options || !latest || stale || pending) return;
    setPending(true);
    setMessage("");
    try {
      await save({ lineId: line._id, expectedRevision: options.revision, parts });
      setOpen(false);
      setBaseline(null);
      setEdits({});
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not confirm packed lots.");
    } finally {
      setPending(false);
    }
  }

  return <div className="grid gap-2 py-2">
    <Button className="justify-self-start" variant="outline" size="sm" disabled={disabled} onClick={() => {
      setBaseline(null);
      setEdits({});
      setMessage("");
      setOpen(!open);
    }}>{open ? "Close packed lots" : line.packing?.length ? "Edit packed lots" : "Confirm packed lots"}</Button>
    {open ? <form className="grid gap-2" onSubmit={event => {
      event.preventDefault();
      if (unavailable.length) return;
      void submit((options?.parts ?? []).flatMap(part => {
        const allocations = part.lots.flatMap(lot => {
          const quantity = draft[fieldKey(part.contentKey, lot.lotId)] ?? 0;
          return quantity > 0 ? [{ lotId: lot.lotId, quantity }] : [];
        });
        return allocations.length ? [{ contentKey: part.contentKey, allocations }] : [];
      }));
    }}>
      {latest && (stale || message) ? <div role="status" className="grid gap-2">
        {stale ? <p>The order changed while you were editing. Review the latest packing before saving.</p> : null}
        <Button className="justify-self-start" type="button" variant="outline" disabled={disabled || pending} onClick={() => {
          setBaseline(latest);
          setMessage("");
        }}>Refresh and keep my edits</Button>
      </div> : null}
      {unavailable.length ? <div role="alert" className="grid gap-2">
        <p>Some selected lots are unavailable. Remove those quantities before saving.</p>
        <Button className="justify-self-start" type="button" variant="outline" disabled={disabled || pending || stale} onClick={() => {
          setEdits(current => ({ ...current, ...Object.fromEntries(unavailable.map(key => [key, 0])) }));
        }}>Remove unavailable quantities</Button>
      </div> : null}
      {result instanceof Error ? <p role="alert">Packed lots are unavailable. Review branch access and lot balances.</p> :
        !options && result === undefined ? <p role="status">Loading packed lot options…</p> : !options?.parts.length ?
        <p>No lot-tracked components are available on this row.</p> : <>
          <p className="text-sm">Enter the quantities physically packed from each lot. Confirm every row containing the same variant.</p>
          {options.parts.map(part => <fieldset className="grid gap-2" key={part.contentKey} disabled={disabled || pending || stale}>
            <legend>{part.label} · {part.units} units</legend>
            {part.lots.map(lot => {
              const key = fieldKey(part.contentKey, lot.lotId);
              return <label key={lot.lotId} className="flex items-center justify-between gap-2 text-sm">
                {lot.code} · {lot.quantity} available
                <Input className="w-20" type="number" min={0} max={Math.min(lot.quantity, part.units)} step={1}
                  value={draft[key] ?? ""} onChange={event => {
                    const quantity = Number(event.target.value);
                    setEdits(current => ({ ...current, [key]: quantity }));
                  }} />
              </label>;
            })}
          </fieldset>)}
          <Button className="justify-self-start" size="sm" disabled={disabled || pending || stale || !latest || unavailable.length > 0}>Save packed lots</Button>
        </>}
      {options?.packing.length ? <Button className="justify-self-start" type="button" variant="outline"
        disabled={disabled || pending || stale || !latest} onClick={() => { void submit([]); }}>Clear packing</Button> : null}
      {message ? <p role="alert">{message}</p> : null}
    </form> : null}
  </div>;
}
