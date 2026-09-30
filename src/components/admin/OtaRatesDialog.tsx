'use client';

import { useMutation, useQuery } from 'convex/react';
import { api } from 'convex/_generated/api';
import type { Doc, Id } from 'convex/_generated/dataModel';
import { useState, type FormEvent } from 'react';
import { format } from 'date-fns';
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
  const selected = propertyId || properties[0]?._id;

  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>OTA rates</DialogTitle><DialogDescription>Enter the nightly price each villa is listed at on other sites. Guests see these next to your direct price; with no rates entered, no comparison is shown.</DialogDescription></DialogHeader>
      <div className="grid gap-4 text-sm">
        <div className="grid gap-2">
          <Label>Villa</Label>
          <Select value={selected ?? ''} onValueChange={value => setPropertyId(value as Id<'properties'>)}>
            <SelectTrigger aria-label="Villa"><SelectValue /></SelectTrigger>
            <SelectContent>
              {properties.map(property => <SelectItem key={property._id} value={property._id}>{property.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {open && selected ? <OtaRatesPanel key={selected} propertyId={selected} /> : null}
      </div>
    </DialogContent>
  </Dialog>;
}

/** Add, edit and remove one villa's OTA rates. Used in the dialog above and the villa editor. */
export function OtaRatesPanel({ propertyId }: { propertyId: Id<'properties'> }) {
  const [platform, setPlatform] = useState<Platform>('booking_com');
  const [nightlyRate, setNightlyRate] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirm = useConfirm();
  const [now] = useState(() => Date.now());
  const rates = useQuery(api.properties.listOtaRates, { propertyId });
  const upsertRate = useMutation(api.properties.upsertOtaRate);
  const removeRate = useMutation(api.properties.removeOtaRate);
  const hasRate = rates?.some(rate => rate.platform === platform) ?? false;

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try { await upsertRate({ propertyId, platform, nightlyRate: Number(nightlyRate), url: url.trim() || undefined }); setNightlyRate(''); setUrl(''); }
    catch (err) { setError(errorText(err, 'Could not save rate.')); }
    finally { setBusy(false); }
  }

  return <div className="grid gap-4 text-sm">
    <form className="grid gap-2" onSubmit={save}>
      <Label htmlFor="ota-platform">Platform</Label>
      <Select value={platform} onValueChange={value => setPlatform(value as Platform)}>
        <SelectTrigger id="ota-platform"><SelectValue /></SelectTrigger>
        <SelectContent>
          {PLATFORMS.map(value => <SelectItem key={value} value={value}>{sourceLabel(value)}</SelectItem>)}
        </SelectContent>
      </Select>
      <Label htmlFor="ota-rate">Nightly price (same currency as the villa, incl. the platform&apos;s fees)</Label>
      <Input id="ota-rate" type="number" min={1} step={1} required inputMode="numeric" placeholder="10000" value={nightlyRate} onChange={event => setNightlyRate(event.target.value)} />
      <Label htmlFor="ota-url">Listing URL (optional)</Label>
      <Input id="ota-url" type="url" placeholder="https://www.booking.com/hotel/..." value={url} onChange={event => setUrl(event.target.value)} />
      <Button type="submit" className="mt-1 justify-self-start" disabled={busy}>{busy ? <Spinner className="text-current" /> : null}{hasRate ? 'Update rate' : 'Save rate'}</Button>
    </form>
    <div className="grid gap-2">
      <h3 className="text-sm font-semibold">Current rates</h3>
      {rates === undefined ? <div role="status" aria-label="Loading rates" className="grid gap-2">{[0, 1].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div> : rates.length ? rates.map(rate => <div key={rate._id} className="grid gap-1 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <strong>{sourceLabel(rate.platform)} · {formatMoney(rate.nightlyRate, resort.currency)}</strong>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => { setPlatform(rate.platform); setNightlyRate(String(rate.nightlyRate)); setUrl(rate.url ?? ''); }}>Edit</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
              if (!(await confirm({ title: `Remove the ${sourceLabel(rate.platform)} rate?`, confirmLabel: 'Remove', destructive: true }))) return;
              setBusy(true); setError('');
              try { await removeRate({ rateId: rate._id }); } catch (err) { setError(errorText(err, 'Could not remove rate.')); } finally { setBusy(false); }
            }}>Remove</Button>
          </div>
        </div>
        {rate.url ? <p className="break-all text-xs text-muted-foreground">{rate.url}</p> : null}
        <p className="text-xs text-muted-foreground">Last checked: {format(rate.updatedAt, 'd MMM yyyy, HH:mm')}</p>
        {now - rate.updatedAt > STALE_AFTER_DAYS * DAY_MS ? <p className={`text-xs ${TONES.warning.text}`}>Rate is {Math.floor((now - rate.updatedAt) / DAY_MS)} days old, please re-check and save it again.</p> : null}
      </div>) : <p className="text-muted-foreground">No OTA rates yet. Without them, guests see no price comparison.</p>}
    </div>
    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
  </div>;
}
