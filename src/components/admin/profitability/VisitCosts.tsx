import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from 'convex/_generated/api';
import type { EvidenceRow } from 'convex/shared/profitability';
import { Button } from '@/components/ui/button';
import { AmountField, amount } from './FinanceInputs';
import { inputStyle } from './report-controls';
import { marketingErrorText } from '../marketing/marketing-format';

export function VisitCosts({
  entry,
  reference,
  saved,
  close,
}: {
  entry: NonNullable<EvidenceRow['costEntry']>;
  reference: string;
  saved: () => void;
  close: () => void;
}) {
  const save = useMutation(api.marketing.profitability.recordVisitCosts);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <form
      className="grid gap-3 border-y border-border bg-muted/40 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const fields = new FormData(e.currentTarget);
        setBusy(true);
        setError('');
        try {
          await save({
            appointmentId: entry.appointmentId,
            version: entry.version,
            reason: String(fields.get('reason') ?? ''),
            staff: amount(fields, 'staff'),
            materials: amount(fields, 'materials'),
            tools: amount(fields, 'tools'),
          });
          saved();
        } catch (err) {
          setError(marketingErrorText(err, 'Could not save visit costs.'));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3 className="font-semibold">Actual costs for {reference}</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        {(['staff', 'materials', 'tools'] as const).map((k) => (
          <AmountField key={k} name={k} label={k[0].toUpperCase() + k.slice(1)} amount={entry.costs?.[k]} />
        ))}
      </div>
      <label className="grid gap-1 text-sm">
        Reason
        <input className={inputStyle} required maxLength={300} name="reason" />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save actual costs'}
        </Button>
        <Button type="button" variant="ghost" onClick={close}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
