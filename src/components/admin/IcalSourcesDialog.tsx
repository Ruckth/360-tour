'use client';

import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from 'convex/_generated/api';
import type { Doc, Id } from 'convex/_generated/dataModel';
import { Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfirm } from '@/components/admin/ConfirmDialog';
import { errorText } from '@/lib/staff-bookings';

type Property = { _id: Id<'properties'>; name: string };
type Platform = 'airbnb' | 'booking_com' | 'agoda';

const PLATFORMS: Record<Platform, string> = { airbnb: 'Airbnb', booking_com: 'Booking.com', agoda: 'Agoda' };

function PlatformSelect({ value, onChange, id }: { value: Platform; onChange: (value: Platform) => void; id?: string }) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as Platform)}>
      <SelectTrigger id={id} className="rounded-lg" aria-label="Platform"><SelectValue /></SelectTrigger>
      <SelectContent>
        {Object.entries(PLATFORMS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function IcalSourcesDialog({ open, onClose, properties }: { open: boolean; onClose: () => void; properties: Property[] }) {
  const [propertyId, setPropertyId] = useState<Id<'properties'> | ''>('');
  const [platform, setPlatform] = useState<Platform>('airbnb');
  const [icalUrl, setIcalUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirm = useConfirm();
  const selected = propertyId || properties[0]?._id;
  const sources = useQuery(api.ical.listSources, open && selected ? { propertyId: selected } : 'skip');
  const token = useQuery(api.ical.getExportToken, open && selected ? { propertyId: selected } : 'skip');
  const addSource = useMutation(api.ical.addSource);
  const rotateToken = useMutation(api.ical.rotateExportToken);
  const site = process.env.NEXT_PUBLIC_CONVEX_SITE_URL || process.env.NEXT_PUBLIC_CONVEX_URL?.replace(/\.convex\.cloud$/, '.convex.site');
  const exportUrl = token && site ? `${site}/ical/export?token=${encodeURIComponent(token)}` : '';

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true); setError('');
    try { await addSource({ propertyId: selected, platform, icalUrl }); setIcalUrl(''); }
    catch (err) { setError(errorText(err, 'Could not add calendar.')); }
    finally { setBusy(false); }
  }

  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>OTA calendars</DialogTitle><DialogDescription>Import iCal feeds every 30 minutes and export confirmed bookings to other platforms.</DialogDescription></DialogHeader>
      <div className="grid gap-4 text-sm">
        <div className="grid gap-2">
          <Label>Villa</Label>
          <Select value={selected ?? ''} onValueChange={value => setPropertyId(value as Id<'properties'>)}>
            <SelectTrigger className="rounded-lg" aria-label="Villa"><SelectValue /></SelectTrigger>
            <SelectContent>
              {properties.map(property => <SelectItem key={property._id} value={property._id}>{property.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <form className="grid gap-2" onSubmit={add}>
          <Label htmlFor="ical-platform">Import from</Label>
          <PlatformSelect id="ical-platform" value={platform} onChange={setPlatform} />
          <Label htmlFor="ical-url">HTTPS iCal URL</Label>
          <Input id="ical-url" type="url" required placeholder="https://.../calendar.ics" value={icalUrl} onChange={event => setIcalUrl(event.target.value)} />
          <Button type="submit" disabled={busy || !selected}>Add calendar</Button>
        </form>
        <div className="grid gap-2">
          <h3 className="font-semibold">Imported feeds</h3>
          {sources === undefined && open
            ? <Loader2 role="status" aria-label="Loading calendars" className="size-4 animate-spin text-gold" />
            : sources?.length
              ? sources.map(source => <SourceRow key={source._id} source={source} />)
              : <p className="text-muted-foreground">No imported calendars yet.</p>}
        </div>
        <div className="grid gap-2 border-t border-border pt-4">
          <h3 className="font-semibold">Export to OTAs</h3>
          {exportUrl ? <Input readOnly aria-label="iCal export URL" value={exportUrl} onFocus={event => event.currentTarget.select()} /> : <p className="text-muted-foreground">Generate a private feed URL for this villa.</p>}
          <Button variant="outline" disabled={busy || !selected} onClick={async () => {
            if (!selected) return;
            if (token && !(await confirm({ title: 'Rotate the export URL?', description: 'Existing OTA subscriptions will stop updating.', confirmLabel: 'Rotate URL', destructive: true }))) return;
            setBusy(true); setError('');
            try { await rotateToken({ propertyId: selected }); } catch (err) { setError(errorText(err, 'Could not generate export URL.')); } finally { setBusy(false); }
          }}>{token ? 'Rotate export URL' : 'Generate export URL'}</Button>
        </div>
        {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      </div>
    </DialogContent>
  </Dialog>;
}

function SourceRow({ source }: { source: Doc<'icalSources'> }) {
  const updateSource = useMutation(api.ical.updateSource);
  const removeSource = useMutation(api.ical.removeSource);
  const syncSource = useAction(api.ical.syncSource);
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [platform, setPlatform] = useState<Platform>(source.platform as Platform);
  const [icalUrl, setIcalUrl] = useState(source.icalUrl);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function run(name: string, work: () => Promise<string | void>) {
    setBusy(name); setMessage(null);
    try { const text = await work(); if (text) setMessage({ text, error: false }); }
    catch (err) { setMessage({ text: errorText(err, 'Something went wrong.'), error: true }); }
    finally { setBusy(null); }
  }

  if (editing) {
    return <form className="grid gap-2 rounded-lg border border-border p-3" onSubmit={event => {
      event.preventDefault();
      void run('save', async () => { await updateSource({ sourceId: source._id, platform, icalUrl }); setEditing(false); });
    }}>
      <Label htmlFor={`platform-${source._id}`}>Platform</Label>
      <PlatformSelect id={`platform-${source._id}`} value={platform} onChange={setPlatform} />
      <Label htmlFor={`url-${source._id}`}>HTTPS iCal URL</Label>
      <Input id={`url-${source._id}`} type="url" required value={icalUrl} onChange={event => setIcalUrl(event.target.value)} />
      {message?.error ? <p role="alert" className="text-xs text-destructive">{message.text}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy !== null}>{busy === 'save' ? <Loader2 className="size-4 animate-spin" /> : null}Save</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => { setEditing(false); setPlatform(source.platform as Platform); setIcalUrl(source.icalUrl); setMessage(null); }}>Cancel</Button>
      </div>
    </form>;
  }

  return <div className="rounded-lg border border-border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <strong>{PLATFORMS[source.platform as Platform] ?? source.platform}</strong>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run('sync', async () => {
          const result = await syncSource({ sourceId: source._id });
          if (!result.ok) throw new Error(`Sync failed: ${result.error}`);
          const nights = `${result.blockedNights} imported ${result.blockedNights === 1 ? 'night' : 'nights'}`;
          return result.conflicts ? `Synced: ${nights}, ${result.conflicts} overlapping another booking or block.` : `Synced: ${nights}.`;
        })}>{busy === 'sync' ? <Loader2 className="size-4 animate-spin" /> : null}Sync now</Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setEditing(true)}>Edit</Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={async () => {
          if (!(await confirm({ title: 'Remove this calendar?', description: 'Its imported blocks are removed too.', confirmLabel: 'Remove', destructive: true }))) return;
          await run('remove', async () => { await removeSource({ sourceId: source._id }); });
        }}>Remove</Button>
      </div>
    </div>
    <p className="break-all text-xs text-muted-foreground">{source.icalUrl}</p>
    <p className="text-xs text-muted-foreground">Last sync: {source.lastSyncedAt ? new Date(source.lastSyncedAt).toLocaleString() : 'Waiting for first sync'}</p>
    {source.lastSyncError ? <p className="text-xs text-destructive">{source.lastSyncError}</p> : null}
    {message ? <p role={message.error ? 'alert' : 'status'} className={message.error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>{message.text}</p> : null}
  </div>;
}
