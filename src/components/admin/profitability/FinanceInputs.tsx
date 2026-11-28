import { useConfirm } from '../ConfirmDialog';
import { useImperativeHandle, useRef, useState, type FormEvent, type Ref } from 'react';
import { useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from 'convex/_generated/api';
import type { Id } from 'convex/_generated/dataModel';
import { isIsoDate } from 'convex/shared/dates';
import { Button } from '@/components/ui/button';
import { parseMoneyInput } from '@/lib/money-input';
import { marketingErrorText } from '../marketing/marketing-format';
import { inputStyle } from './report-controls';

type Inputs = FunctionReturnType<typeof api.marketing.profitability.financeInputs>;
export function AmountField({ name, label, amount }: { name: string; label: string; amount?: number }) {
  return (
    <label className="grid gap-1 text-sm">
      {label} (฿)
      <input
        name={name}
        required
        type="number"
        step="0.01"
        min="0"
        max="10000000"
        className={inputStyle}
        defaultValue={amount === undefined ? '' : amount / 100}
      />
    </label>
  );
}
export function amount(data: FormData, key: string) {
  const number = parseMoneyInput(String(data.get(key) ?? ''));
  if (!Number.isSafeInteger(number))
    throw new Error('Enter each amount in baht, including zero where applicable.');
  return number;
}
function FinanceForm({
  data,
  mode,
  serviceId,
  date,
  saved,
  onDirty,
  onBusy,
}: {
  data: Inputs;
  mode: 'cost' | 'month';
  serviceId: Id<'services'> | null;
  date: string;
  saved: () => void;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const recordCosts = useMutation(api.marketing.profitability.recordCosts);
  const recordMonth = useMutation(api.marketing.profitability.recordMonth);
  const baseline = useRef<string | null>(null);
  const [initial] = useState(data);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fields = new FormData(e.currentTarget);
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      if (mode === 'cost' && serviceId)
        await recordCosts({
          from: date,
          reason: String(fields.get('reason') ?? ''),
          serviceId,
          expected: initial.schedule?._id ?? null,
          staff: amount(fields, 'staff'),
          materials: amount(fields, 'materials'),
          tools: amount(fields, 'tools'),
        });
      else if (mode === 'month')
        await recordMonth({
          month: date.slice(0, 7),
          expected: initial.statement?._id ?? null,
          overhead: amount(fields, 'overhead'),
          otherExpenses: amount(fields, 'otherExpenses'),
          tax: amount(fields, 'tax'),
          otherIncome: amount(fields, 'otherIncome'),
          campaignIds: initial.campaigns.filter((c) => fields.get(c.id) === 'included').map((c) => c.id),
          excludedCampaignIds: initial.campaigns.filter((c) => fields.get(c.id) === 'excluded').map((c) => c.id),
          reason: String(fields.get('reason') ?? ''),
        });
      else return;
      saved();
    } catch (err) {
      setError(marketingErrorText(err, 'Could not save the finance entry.'));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <form
      ref={(form) => {
        if (form && baseline.current === null) baseline.current = JSON.stringify([...new FormData(form)]);
      }}
      onChange={(event) => onDirty(JSON.stringify([...new FormData(event.currentTarget)]) !== baseline.current)}
      className="grid gap-4"
      onSubmit={(e) => {
        void submit(e);
      }}
    >
      {mode === 'cost' ? (
        <>
          <p className="text-sm text-muted-foreground">
            Standard cost per delivered service. Historical entries are estimates based on the schedule effective
            on the delivery day.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {(['staff', 'materials', 'tools'] as const).map((key) => (
              <AmountField
                key={key}
                name={key}
                label={key[0].toUpperCase() + key.slice(1)}
                amount={initial.schedule?.[key]}
              />
            ))}
          </div>
          {initial.schedule && (
            <p className="text-xs text-muted-foreground">
              Current schedule effective {initial.schedule.from} · recorded by {initial.schedule.actor}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Enter the month’s totals for the service business. Exclude direct service costs and the campaign spend
            selected below. Partial months use a daily share.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ['overhead', 'Operating overhead'],
                ['otherExpenses', 'Other expenses'],
                ['tax', 'Income tax'],
                ['otherIncome', 'Other income'],
              ] as const
            ).map(([key, label]) => (
              <AmountField key={key} name={key} label={label} amount={initial.statement?.[key]} />
            ))}
          </div>
          <fieldset>
            <legend className="mb-2 font-medium">Service acquisition campaigns</legend>
            <p className="text-sm text-muted-foreground">
              Classify campaign spend for this month. Spending awaiting classification holds CAC and net profit
              open.
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              {initial.campaigns.map((c) => (
                <label key={c.id} className="inline-flex min-h-10 items-center gap-2">
                  {c.name}
                  <select
                    className={inputStyle}
                    name={c.id}
                    defaultValue={
                      initial.statement?.campaignIds.includes(c.id)
                        ? 'included'
                        : initial.statement?.excludedCampaignIds?.includes(c.id)
                          ? 'excluded'
                          : ''
                    }
                  >
                    <option value="">Unclassified</option>
                    <option value="included">Service acquisition</option>
                    <option value="excluded">Outside service business</option>
                  </select>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="confirmedStatement" required className="mt-1" />I have included all service expenses, other income
            and acquisition spend for this month.
          </label>
        </>
      )}
      {(mode === 'month' ? initial.statement : initial.schedule)?.reason && (
        <p className="text-sm text-muted-foreground">
          Last entry note · {(mode === 'month' ? initial.statement : initial.schedule)?.reason}
        </p>
      )}
      <label className="grid gap-1 text-sm">
        Entry note
        <input
          className={inputStyle}
          name="reason"
          maxLength={300}
          required={Boolean(mode === 'month' ? initial.statement : initial.schedule)}
          placeholder="Required when revising an entry"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button className="justify-self-start" type="submit" disabled={busy || (mode === 'cost' && !serviceId)}>
        {busy ? 'Saving…' : mode === 'cost' ? 'Save cost schedule' : 'Confirm monthly accounts'}
      </Button>
    </form>
  );
}

export type FinanceInputsHandle = { changeContext: (change: () => void) => Promise<void> };

export function FinanceInputs({
  ref,
  initialDate,
  initialMode,
  onSave,
  onClose,
}: {
  ref?: Ref<FinanceInputsHandle>;
  initialDate: string;
  initialMode: 'cost' | 'month';
  onSave: () => void;
  onClose?: () => void;
}) {
  const confirm = useConfirm();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const confirming = useRef(false);
  async function changeContext(change: () => void) {
    if (saving || confirming.current) return;
    confirming.current = true;
    try {
      if (dirty && !(await confirm({
        title: "Discard unsaved finance inputs?",
        description: "Your edits to this entry will be lost.",
        cancelLabel: "Keep editing",
        confirmLabel: "Discard changes",
        destructive: true,
      }))) return;
      setDirty(false);
      setMessage('');
      change();
    } finally {
      confirming.current = false;
    }
  }
  useImperativeHandle(ref, () => ({ changeContext }));
  const [mode, setMode] = useState(initialMode);
  const [date, setDate] = useState(initialDate);
  const [id, setId] = useState<Id<'services'> | null>(null);
  const [revision, setRevision] = useState(0),
    [message, setMessage] = useState('');
  const valid = isIsoDate(date);
  const data = useQuery(
    api.marketing.profitability.financeInputs,
    valid ? { month: date.slice(0, 7), from: date, ...(id ? { serviceId: id } : {}) } : 'skip',
  );
  return (
    <div className="grid gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs">
          Finance entry
          <select
            className={inputStyle}
            value={mode}
            onChange={(e) => {
              const next = e.target.value === "month" ? "month" : "cost";
              e.target.value = mode;
              void changeContext(() => setMode(next));
            }}
          >
            <option value="cost">Service cost schedule</option>
            <option value="month">Monthly accounts</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs">
          {mode === 'cost' ? 'Effective from' : 'Accounting month'}
          <input
            className={inputStyle}
            type={mode === 'cost' ? 'date' : 'month'}
            value={mode === 'cost' ? date : date.slice(0, 7)}
            onChange={(e) => {
              const next = mode === 'cost' ? e.target.value : e.target.value + '-01';
              e.target.value = mode === 'cost' ? date : date.slice(0, 7);
              void changeContext(() => setDate(next));
            }}
          />
        </label>
        {mode === 'cost' && (
          <label className="grid max-w-full gap-1 text-xs">
            Service
            <select
              className={inputStyle}
              value={id ?? ''}
              onChange={(e) => {
                const next = (e.target.value as Id<'services'>) || null;
                e.target.value = id ?? '';
                void changeContext(() => setId(next));
              }}
            >
              <option value="">Choose a service</option>
              {data?.services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {onClose && <Button type="button" variant="outline" className="w-fit" disabled={saving} onClick={() => void changeContext(onClose)}>Close finance inputs</Button>}
      {message && (
        <p role="status" className="text-sm font-medium">
          {message}
        </p>
      )}
      {!valid ? (
        <p>Choose a valid date.</p>
      ) : !data ? (
        <p role="status">Loading finance entries…</p>
      ) : (
        (mode === 'month' || id) && (
          <FinanceForm
            key={[mode, id, date, revision].join('|')}
            data={data}
            mode={mode}
            serviceId={id}
            date={date}
            onDirty={setDirty}
            onBusy={setSaving}
            saved={() => {
              setDirty(false);
              setMessage('Finance entry saved.');
              setRevision((v) => v + 1);
              onSave();
            }}
          />
        )
      )}
    </div>
  );
}
