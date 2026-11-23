import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from 'convex/_generated/api';
import type { Id } from 'convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { inputStyle } from './report-controls';
import { marketingErrorText } from '../marketing/marketing-format';

export function CustomerAssignment({
  visit,
  expected,
  reference,
  done,
}: {
  visit: Id<'appointments'>;
  expected: Id<'customers'> | null;
  reference: string;
  done: () => void;
}) {
  const [name, setName] = useState(''),
    [selected, setSelected] = useState<Id<'customers'> | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const matches = useQuery(api.marketing.profitability.findCustomers, name.trim().length >= 2 ? { name } : 'skip');
  const save = useMutation(api.marketing.profitability.identifyCustomer);
  async function assign(customerId: Id<'customers'> | null) {
    setBusy(true);
    setError('');
    try {
      await save({ appointmentId: visit, expected, customerId });
      done();
    } catch (err) {
      setError(marketingErrorText(err, 'Could not link the customer.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-3 border-y border-border bg-muted/40 p-4">
      <h3 className="font-semibold">Identify customer for {reference}</h3>
      <p className="text-sm text-muted-foreground">
        Select the verified attendee for lifetime value and acquisition reporting. This assignment is recorded in
        the visit history.
      </p>
      <label className="grid gap-1 text-sm">
        Find customer
        <input
          className={inputStyle}
          type="search"
          maxLength={100}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSelected(null);
          }}
          placeholder="Enter at least two characters"
        />
      </label>
      {matches &&
        (matches.length ? (
          <label className="grid gap-1 text-sm">
            Matching profiles
            <select
              className={inputStyle}
              value={selected ?? ''}
              onChange={(e) => setSelected((e.target.value as Id<'customers'>) || null)}
            >
              <option value="">Choose the attendee</option>
              {matches.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.phoneEnding ? ' · phone ending ' + m.phoneEnding : ''}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-sm">No active customers match. Customer profiles can be created in Checkout.</p>
        ))}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!selected || busy}
          onClick={() => {
            void assign(selected);
          }}
        >
          Confirm customer
        </Button>
        {expected && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              void assign(null);
            }}
          >
            Remove assignment
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={done}>
          Close
        </Button>
      </div>
    </div>
  );
}
