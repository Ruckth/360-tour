'use client';

import { useMutation, useQuery } from 'convex/react';
import { api } from 'convex/_generated/api';
import type { Doc, Id } from 'convex/_generated/dataModel';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { resort } from '@/lib/data/resort-config';

type Property = { _id: Id<'properties'>; name: string };
type Platform = Doc<'otaRates'>['platform'];

const PLATFORMS: Record<Platform, string> = { booking_com: 'Booking.com', agoda: 'Agoda', airbnb: 'Airbnb', expedia: 'Expedia' };
const STALE_AFTER_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export function OtaRatesDialog({ open, onClose, properties }: { open: boolean; onClose: () => void; properties: Property[] }) {
  const [propertyId, setPropertyId] = useState<Id<'properties'> | ''>('');
  const [platform, setPlatform] = useState<Platform>('booking_com');
  const [nightlyRate, setNightlyRate] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now] = useState(() => Date.now());
  const selected = propertyId || properties[0]?._id;
  const rates = useQuery(api.properties.listOtaRates, open && selected ? { propertyId: selected } : 'skip');
  const upsertRate = useMutation(api.properties.upsertOtaRate);
  const removeRate = useMutation(api.properties.removeOtaRate);
  const hasRate = rates?.some(rate => rate.platform === platform) ?? false;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true); setError('');
    try { await upsertRate({ propertyId: selected, platform, nightlyRate: Number(nightlyRate), url: url.trim() || undefined }); setNightlyRate(''); setUrl(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save rate.'); }
    finally { setBusy(false); }
  }

  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>OTA rates</DialogTitle><DialogDescription>Enter the nightly price each villa is listed at on other sites. Guests see these next to your direct price; with no rates entered, no comparison is shown.</DialogDescription></DialogHeader>
      <div className="grid gap-4 text-sm">
        <label className="grid gap-1">Villa
          <select className="h-10 rounded-lg border border-border bg-background px-3" value={selected ?? ''} onChange={event => { setPropertyId(event.target.value as Id<'properties'>); setPlatform('booking_com'); setNightlyRate(''); setUrl(''); setError(''); }}>
            {properties.map(property => <option key={property._id} value={property._id}>{property.name}</option>)}
          </select>
        </label>
        <form className="grid gap-2" onSubmit={save}>
          <label htmlFor="ota-platform">Platform</label>
          <select id="ota-platform" className="h-10 rounded-lg border border-border bg-background px-3" value={platform} onChange={event => setPlatform(event.target.value as Platform)}>
            {Object.entries(PLATFORMS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <label htmlFor="ota-rate">Nightly price (same currency as the villa, incl. the platform&apos;s fees)</label>
          <Input id="ota-rate" type="number" min={1} step={1} required inputMode="numeric" placeholder="10000" value={nightlyRate} onChange={event => setNightlyRate(event.target.value)} />
          <label htmlFor="ota-url">Listing URL (optional)</label>
          <Input id="ota-url" type="url" placeholder="https://www.booking.com/hotel/..." value={url} onChange={event => setUrl(event.target.value)} />
          <Button type="submit" disabled={busy || !selected}>{hasRate ? 'Update rate' : 'Save rate'}</Button>
        </form>
        <div className="grid gap-2">
          <h3 className="font-semibold">Current rates</h3>
          {rates?.length ? rates.map(rate => <div key={rate._id} className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <strong>{PLATFORMS[rate.platform]} · {resort.currencySymbol}{rate.nightlyRate.toLocaleString()}</strong>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => { setPlatform(rate.platform); setNightlyRate(String(rate.nightlyRate)); setUrl(rate.url ?? ''); }}>Edit</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
                  if (!window.confirm(`Remove the ${PLATFORMS[rate.platform]} rate?`)) return;
                  setBusy(true); setError('');
                  try { await removeRate({ rateId: rate._id }); } catch (err) { setError(err instanceof Error ? err.message : 'Could not remove rate.'); } finally { setBusy(false); }
                }}>Remove</Button>
              </div>
            </div>
            {rate.url ? <p className="break-all text-xs text-muted-foreground">{rate.url}</p> : null}
            <p className="text-xs text-muted-foreground">Last checked: {new Date(rate.updatedAt).toLocaleString()}</p>
            {now - rate.updatedAt > STALE_AFTER_DAYS * DAY_MS ? <p className="text-xs text-amber-600">Rate is {Math.floor((now - rate.updatedAt) / DAY_MS)} days old, please re-check and save it again.</p> : null}
          </div>) : <p className="text-muted-foreground">No OTA rates yet.</p>}
        </div>
        {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      </div>
    </DialogContent>
  </Dialog>;
}
