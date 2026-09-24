'use client';

import { useMutation, useQuery } from 'convex/react';
import { api } from 'convex/_generated/api';
import type { Id } from 'convex/_generated/dataModel';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Property = { _id: Id<'properties'>; name: string };

export function IcalSourcesDialog({ open, onClose, properties }: { open: boolean; onClose: () => void; properties: Property[] }) {
  const [propertyId, setPropertyId] = useState<Id<'properties'> | ''>('');
  const [platform, setPlatform] = useState<'airbnb' | 'booking_com' | 'agoda'>('airbnb');
  const [icalUrl, setIcalUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = propertyId || properties[0]?._id;
  const sources = useQuery(api.ical.listSources, open && selected ? { propertyId: selected } : 'skip');
  const token = useQuery(api.ical.getExportToken, open && selected ? { propertyId: selected } : 'skip');
  const addSource = useMutation(api.ical.addSource);
  const removeSource = useMutation(api.ical.removeSource);
  const rotateToken = useMutation(api.ical.rotateExportToken);
  const site = process.env.NEXT_PUBLIC_CONVEX_SITE_URL || process.env.NEXT_PUBLIC_CONVEX_URL?.replace(/\.convex\.cloud$/, '.convex.site');
  const exportUrl = token && site ? `${site}/ical/export?token=${encodeURIComponent(token)}` : '';

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true); setError('');
    try { await addSource({ propertyId: selected, platform, icalUrl }); setIcalUrl(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not add calendar.'); }
    finally { setBusy(false); }
  }

  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>OTA calendars</DialogTitle><DialogDescription>Import iCal feeds every 30 minutes and export confirmed bookings to other platforms.</DialogDescription></DialogHeader>
      <div className="grid gap-4 text-sm">
        <label className="grid gap-1">Villa
          <select className="h-10 rounded-lg border border-border bg-background px-3" value={selected ?? ''} onChange={event => setPropertyId(event.target.value as Id<'properties'>)}>
            {properties.map(property => <option key={property._id} value={property._id}>{property.name}</option>)}
          </select>
        </label>
        <form className="grid gap-2" onSubmit={add}>
          <label htmlFor="ical-platform">Import from</label>
          <select id="ical-platform" className="h-10 rounded-lg border border-border bg-background px-3" value={platform} onChange={event => setPlatform(event.target.value as typeof platform)}>
            <option value="airbnb">Airbnb</option><option value="booking_com">Booking.com</option><option value="agoda">Agoda</option>
          </select>
          <label htmlFor="ical-url">HTTPS iCal URL</label>
          <Input id="ical-url" type="url" required placeholder="https://.../calendar.ics" value={icalUrl} onChange={event => setIcalUrl(event.target.value)} />
          <Button type="submit" disabled={busy || !selected}>Add calendar</Button>
        </form>
        <div className="grid gap-2">
          <h3 className="font-semibold">Imported feeds</h3>
          {sources?.length ? sources.map(source => <div key={source._id} className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-3"><strong>{source.platform}</strong><Button size="sm" variant="outline" disabled={busy} onClick={async () => {
              if (!window.confirm('Remove this calendar and its imported blocks?')) return;
              setBusy(true); setError('');
              try { await removeSource({ sourceId: source._id }); } catch (err) { setError(err instanceof Error ? err.message : 'Could not remove calendar.'); } finally { setBusy(false); }
            }}>Remove</Button></div>
            <p className="break-all text-xs text-muted-foreground">{source.icalUrl}</p>
            <p className="text-xs text-muted-foreground">Last sync: {source.lastSyncedAt ? new Date(source.lastSyncedAt).toLocaleString() : 'Waiting for first sync'}</p>
            {source.lastSyncError ? <p className="text-xs text-destructive">{source.lastSyncError}</p> : null}
          </div>) : <p className="text-muted-foreground">No imported calendars yet.</p>}
        </div>
        <div className="grid gap-2 border-t border-border pt-4">
          <h3 className="font-semibold">Export to OTAs</h3>
          {exportUrl ? <Input readOnly aria-label="iCal export URL" value={exportUrl} onFocus={event => event.currentTarget.select()} /> : <p className="text-muted-foreground">Generate a private feed URL for this villa.</p>}
          <Button variant="outline" disabled={busy || !selected} onClick={async () => {
            if (!selected) return;
            if (token && !window.confirm('Rotate the export URL? Existing OTA subscriptions will stop updating.')) return;
            setBusy(true); setError('');
            try { await rotateToken({ propertyId: selected }); } catch (err) { setError(err instanceof Error ? err.message : 'Could not generate export URL.'); } finally { setBusy(false); }
          }}>{token ? 'Rotate export URL' : 'Generate export URL'}</Button>
        </div>
        {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      </div>
    </DialogContent>
  </Dialog>;
}
