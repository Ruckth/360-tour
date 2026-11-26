import { useRef, useState } from 'react';
import { ListFilter, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseMoneyInput } from '@/lib/money-input';
import { emptyFilters, type ProfitFilters, type ProfitRule } from 'convex/shared/profitability';
import { thb } from '../marketing/marketing-format';

export const inputStyle =
  'min-h-10 min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring';
const labels = {
  service: 'Service',
  source: 'Booking source',
  kind: 'Transaction type',
  coverage: 'Direct costs',
  attendee: 'Attendee',
  revenue: 'Revenue',
};
type Options = { services: { id: string; name: string }[]; sources: string[] };
function choices(field: ProfitRule['field'], options: Options) {
  if (field === 'service') return options.services.map((s) => ({ value: s.id, label: s.name }));
  const values =
    field === 'source'
      ? options.sources
      : field === 'kind'
        ? ['Service', 'Refund', 'Fee', 'Settlement']
        : field === 'attendee'
          ? ['Identified', 'Unidentified']
          : ['Complete', 'Missing'];
  return values.map((value) => ({ value, label: value }));
}
export function ruleLabel(rule: ProfitRule, options: Options) {
  const value =
    rule.field === 'revenue'
      ? thb(rule.value)
      : (Array.isArray(rule.value) ? rule.value : [rule.value])
          .map((value) => choices(rule.field, options).find((v) => v.value === value)?.label ?? value)
          .join(' or ');
  return [labels[rule.field], rule.operator, value].join(' ');
}
// Only the finite filter vocabulary goes into the URL. Customer lookup text stays on the page.
export function readGroup(value: string | null): ProfitFilters {
  if (!value) return emptyFilters;
  try {
    const group = JSON.parse(value);
    if (!group || !['and', 'or'].includes(group.join) || !Array.isArray(group.rules) || group.rules.length > 12)
      return emptyFilters;
    const valid = group.rules.every(
      (r: ProfitRule) =>
        r &&
        Object.hasOwn(labels, r.field) &&
        (r.field === 'revenue'
          ? ['at least', 'at most'].includes(r.operator) && Number.isSafeInteger(r.value)
          : ['is', 'is not'].includes(r.operator) &&
            ((typeof r.value === 'string' && r.value.length > 0 && r.value.length <= 150) ||
              (Array.isArray(r.value) &&
                r.value.length > 0 &&
                r.value.length <= 50 &&
                r.value.every((v) => typeof v === 'string' && !!v.trim() && v.length <= 150)))),
    );
    return valid ? group : emptyFilters;
  } catch {
    return emptyFilters;
  }
}

export function RuleEditor({
  group,
  options,
  onChange,
}: {
  group: ProfitFilters;
  options: Options;
  onChange: (next: ProfitFilters) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<ProfitRule['field']>('service');
  const [negate, setNegate] = useState(false);
  const [raw, setRaw] = useState('');
  const available = choices(field, options);
  const value = raw || (field !== 'revenue' ? (available[0]?.value ?? '') : '');
  function add() {
    let rule: ProfitRule;
    if (field === 'revenue') {
      const amount = parseMoneyInput(value.replace(/^-/, ''));
      if (!Number.isFinite(amount)) return;
      rule = { field, operator: negate ? 'at most' : 'at least', value: value.startsWith('-') ? -amount : amount };
    } else rule = { field, operator: negate ? 'is not' : 'is', value: selected.length ? selected : value };
    onChange({ ...group, rules: [...group.rules, rule] });
    close();
    setSelected([]);
    setRaw('');
  }
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          ref={trigger}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          disabled={group.rules.length >= 12}
        >
          <ListFilter size={15} />
          Add filter
        </Button>
        {group.rules.length > 1 && (
          <select
            aria-label="Combine rules"
            className={inputStyle}
            value={group.join}
            onChange={(e) => onChange({ ...group, join: e.target.value === 'or' ? 'or' : 'and' })}
          >
            <option value="and">Match all (AND)</option>
            <option value="or">Match any (OR)</option>
          </select>
        )}
        {group.rules.map((rule, index) => (
          <span
            key={index}
            className="inline-flex max-w-full items-center rounded-full bg-muted pl-3 text-xs font-medium"
          >
            {ruleLabel(rule, options)}
            <button
              type="button"
              className="grid size-11 shrink-0 place-items-center rounded-full"
              aria-label={'Remove ' + ruleLabel(rule, options)}
              onClick={() => onChange({ ...group, rules: group.rules.filter((_, i) => i !== index) })}
            >
              <X size={14} />
            </button>
          </span>
        ))}
      </div>
      {open && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg bg-muted/60 p-3"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              close();
            }
          }}
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <label className="grid gap-1 text-xs">
            Field
            <select
              className={inputStyle}
              value={field}
              onChange={(e) => {
                setField(e.target.value as ProfitRule['field']);
                setRaw('');
                setNegate(false);
                setSelected([]);
              }}
            >
              {Object.entries(labels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs">
            Condition
            <select
              className={inputStyle}
              value={negate ? '1' : '0'}
              onChange={(e) => setNegate(e.target.value === '1')}
            >
              <option value="0">{field === 'revenue' ? 'at least' : 'is'}</option>
              <option value="1">{field === 'revenue' ? 'at most' : 'is not'}</option>
            </select>
          </label>
          <label className="grid min-w-24 max-w-full gap-1 text-xs">
            Value
            {field === 'revenue' ? (
              <input
                required
                aria-label="Revenue in baht"
                type="number"
                step=".01"
                className={inputStyle}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
              />
            ) : (
              <select
                aria-label="Filter values"
                className={inputStyle}
                multiple
                size={Math.min(4, Math.max(2, available.length))}
                value={selected.length ? selected : value ? [value] : []}
                onChange={(e) => setSelected([...e.target.selectedOptions].map((o) => o.value))}
              >
                {available.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            )}
          </label>
          <Button size="sm" type="submit" disabled={!value}>
            <Plus size={15} />
            Apply rule
          </Button>
          <Button size="sm" type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
        </form>
      )}
    </div>
  );
}
