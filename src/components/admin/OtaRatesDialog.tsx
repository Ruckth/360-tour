"use client";
import { satangToBaht } from "convex/shared/money";
import { parseMoneyInput } from "@/lib/money-input";


import { staffDateTime } from "@/lib/staff-time";
import { useMutation, useQuery } from 'convex/react';
import { api } from 'convex/_generated/api';
import type { Doc, Id } from 'convex/_generated/dataModel';
import { useEffect, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useConfirm } from '@/components/admin/ConfirmDialog';
import { formatMoney, sourceLabel } from '@/components/admin/labels';
import { TONES } from '@/components/admin/status-tones';
import { resort } from '@/lib/data/resort-config';
import { errorText } from '@/lib/staff-bookings';

type Property = { _id: Id<'properties'>; name: string };
type Platform = Doc<'otaRates'>['platform'];

const PLATFORMS: Platform[] = ['booking_com', 'agoda', 'airbnb', 'expedia'];
const STALE_AFTER_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export function OtaRatesDialog({ open, onClose, properties }: { open: boolean; onClose: () => void; properties: Property[] }) {
  const [propertyId, setPropertyId] = useState<Id<'properties'> | ''>('');
  const panel = useRef<{ canDiscard: () => Promise<boolean> }>(null);
  const [busy, setBusy] = useState(false);
  const selected = propertyId || properties[0]?._id;

  return <Dialog open={open} onOpenChange={value => { if (!value && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>OTA rates</DialogTitle><DialogDescription>Enter the nightly price each villa is listed at on other sites. Guests see these next to your direct price; with no rates entered, no comparison is shown.</DialogDescription></DialogHeader>
      <div className="grid gap-4 text-sm">
        <div className="grid gap-2">
          <Label>Villa</Label>
          <Select disabled={busy} value={selected ?? ''} onValueChange={async value => {
            if (!panel.current || await panel.current.canDiscard()) setPropertyId(value as Id<'properties'>);
          }}>
            <SelectTrigger aria-label="Villa"><SelectValue /></SelectTrigger>
            <SelectContent>
              {properties.map(property => <SelectItem key={property._id} value={property._id}>{property.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {open && selected ? <OtaRatesPanel ref={panel} key={selected} propertyId={selected} onBusyChange={setBusy} /> : null}
      </div>
    </DialogContent>
  </Dialog>;
}

/** A saved link is offered as an "Open listing" link only when it parses as http(s). */
export function listingHref(url: string | undefined): string | null {
  if (!url) return null;
  try { const parsed = new URL(url); return !parsed.username && !parsed.password && (parsed.protocol === 'https:' || parsed.protocol === 'http:') ? parsed.toString() : null; } catch { return null; }
}

type UrlIntent = 'preserve' | 'set' | 'clear';
type OtaRate = Doc<'otaRates'>;

/** Add, edit and remove one villa's OTA rates. Used in the dialog above and the villa editor. */
export function OtaRatesPanel({ propertyId, ref, onBusyChange }: {
  propertyId: Id<'properties'>;
  ref?: Ref<{ canDiscard: () => Promise<boolean> }>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [platform, setPlatform] = useState<Platform>('booking_com');
  const [nightlyRate, setNightlyRate] = useState('');
  const [url, setUrl] = useState('');
  // preserve: the server keeps whatever link is stored at save time; set: replace it; clear: remove it.
  const [urlIntent, setUrlIntent] = useState<UrlIntent>('preserve');
  const [dirty, setDirty] = useState(false);
  const [hydratedFor, setHydratedFor] = useState<Platform | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  function setPending(next: boolean) {
    pending.current = next;
    setBusy(next);
    onBusyChange?.(next);
  }
  const [error, setError] = useState('');
  const rateInputRef = useRef<HTMLInputElement>(null);
  const [rowEditRequest, setRowEditRequest] = useState(0);
  const confirm = useConfirm();
  const [now] = useState(() => Date.now());
  const rates = useQuery(api.catalog.properties.listOtaRates, { propertyId });
  const upsertRate = useMutation(api.catalog.properties.upsertOtaRate);
  const removeRate = useMutation(api.catalog.properties.removeOtaRate);
  const savedRate = rates?.find(rate => rate.platform === platform);
  const hasRate = savedRate !== undefined;

  function hydrate(next: Platform, row: OtaRate | undefined) {
    setPlatform(next);
    setNightlyRate(row ? String(satangToBaht(row.nightlyRate)) : '');
    setUrl(row?.url ?? '');
    setUrlIntent('preserve');
    setDirty(false);
    setHydratedFor(next);
  }
  // The initial platform hydrates once its saved row has loaded.
  if (rates !== undefined && hydratedFor === null) hydrate(platform, savedRate);

  async function canDiscard() {
    if (pending.current) return false;
    return !dirty || await confirm({ title: 'Discard unsaved rate changes?', description: `Your ${sourceLabel(platform)} edits have not been saved.`, confirmLabel: 'Discard changes', destructive: true });
  }
  useImperativeHandle(ref, () => ({ canDiscard }));

  async function choosePlatform(next: Platform, row = rates?.find(rate => rate.platform === next)) {
    if (!(await canDiscard()) || pending.current) return false;
    hydrate(next, row);
    return true;
  }

  useEffect(() => {
    if (!rowEditRequest) return;
    rateInputRef.current?.focus();
    rateInputRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [rowEditRequest]);

  async function startRowEdit(rate: OtaRate) {
    if (await choosePlatform(rate.platform, rate)) setRowEditRequest((request) => request + 1);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending.current || rates === undefined) return;
    setPending(true); setError('');
    try {
      const trimmed = url.trim();
      await upsertRate({
        propertyId, platform, nightlyRate: parseMoneyInput(nightlyRate),
        urlChange: urlIntent === 'set' ? { kind: 'set', url: trimmed } : { kind: urlIntent },
      });
      setDirty(false); setUrlIntent('preserve'); setHydratedFor(null);
    }
    catch (err) { setError(errorText(err, 'Could not save rate.')); }
    finally { setPending(false); }
  }

  return <div className="grid gap-4 text-sm">
    <form className="grid gap-2" onSubmit={save} aria-labelledby="ota-form-heading">
      <h3 id="ota-form-heading" className="text-sm font-semibold">
        {hasRate ? `Edit ${sourceLabel(platform)} rate` : `Add ${sourceLabel(platform)} rate`}
      </h3>
      <Label htmlFor="ota-platform">Platform</Label>
      <Select disabled={busy || rates === undefined} value={platform} onValueChange={value => { void choosePlatform(value as Platform); }}>
        <SelectTrigger id="ota-platform"><SelectValue /></SelectTrigger>
        <SelectContent>
          {PLATFORMS.map(value => <SelectItem key={value} value={value}>{sourceLabel(value)}</SelectItem>)}
        </SelectContent>
      </Select>
      <Label htmlFor="ota-rate">Nightly price (same currency as the villa, incl. the platform&apos;s fees)</Label>
      <Input ref={rateInputRef} id="ota-rate" disabled={busy || rates === undefined} type="number" min={0.01} step={0.01} required inputMode="decimal" placeholder="10000" value={nightlyRate} onChange={event => { setNightlyRate(event.target.value); setDirty(true); }} />
      <Label htmlFor="ota-url">Listing URL (optional)</Label>
      <Input id="ota-url" type="url" placeholder="https://www.booking.com/hotel/..." disabled={busy || rates === undefined || urlIntent === 'clear'} value={urlIntent === 'clear' ? '' : url}
        onChange={event => { setUrl(event.target.value); setUrlIntent(event.target.value.trim() ? 'set' : 'preserve'); setDirty(true); }} />
      {urlIntent === 'clear'
        ? <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="status">The saved link will be removed when you save. <Button type="button" size="sm" disabled={busy} variant="ghost" onClick={() => { setUrlIntent('preserve'); setUrl(savedRate?.url ?? ''); }}>Keep link</Button></p>
        : savedRate?.url
          ? <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{urlIntent === 'preserve' ? 'Saving keeps the current link unless you enter a new one.' : 'Saving replaces the current link.'} <Button type="button" size="sm" disabled={busy} variant="ghost" onClick={() => { setUrlIntent('clear'); setDirty(true); }}>Clear link</Button></p>
          : null}
      <Button type="submit" className="mt-1 justify-self-start" disabled={busy || rates === undefined}>{busy ? <Spinner className="text-current" /> : null}{hasRate ? 'Update rate' : 'Save rate'}</Button>
    </form>
    <div className="grid gap-2">
      <h3 className="text-sm font-semibold">Current rates</h3>
      {rates === undefined ? <div role="status" aria-label="Loading rates" className="grid gap-2">{[0, 1].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div> : rates.length ? rates.map(rate => <div key={rate._id} className="grid gap-1 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <strong>{sourceLabel(rate.platform)} · {formatMoney(rate.nightlyRate, resort.currency)}</strong>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { void startRowEdit(rate); }}>Edit</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
              if (!(await confirm({ title: `Remove the ${sourceLabel(rate.platform)} rate?`, confirmLabel: 'Remove', destructive: true }))) return;
              if (pending.current) return;
              setPending(true); setError('');
              try { await removeRate({ rateId: rate._id }); } catch (err) { setError(errorText(err, 'Could not remove rate.')); } finally { setPending(false); }
            }}>Remove</Button>
          </div>
        </div>
        {rate.url ? <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="break-all">{rate.url}</span>{listingHref(rate.url) ? <a className="font-medium text-primary underline underline-offset-2" href={listingHref(rate.url)!} target="_blank" rel="noopener noreferrer" aria-label={`Open ${sourceLabel(rate.platform)} listing in a new tab`}>Open listing ↗</a> : null}</p> : null}
        <p className="text-xs text-muted-foreground">Last checked: {staffDateTime(rate.updatedAt)}</p>
        {now - rate.updatedAt > STALE_AFTER_DAYS * DAY_MS ? <p className={`text-xs ${TONES.warning.text}`}>Rate is {Math.floor((now - rate.updatedAt) / DAY_MS)} days old, please re-check and save it again.</p> : null}
      </div>) : <p className="text-muted-foreground">No OTA rates yet. Without them, guests see no price comparison.</p>}
    </div>
    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
  </div>;
}
