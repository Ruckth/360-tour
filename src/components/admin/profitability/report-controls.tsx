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
export function readGroup(value: string | null): ProfitFilters | null {
  if (value === null) return emptyFilters;
  try {
    const group = JSON.parse(value);
    if (
      !group ||
      !['and', 'or'].includes(group.join) ||
      !Array.isArray(group.rules) ||
      group.rules.length > 12
    )
      return null;
    const valid = group.rules.every(
      (r: ProfitRule) =>
        r &&
        Object.hasOwn(labels, r.field) &&
        (r.field === 'revenue'
          ? ['at least', 'at most'].includes(r.operator) && Number.isSafeInteger(r.value)
          : ['is', 'is not'].includes(r.operator) &&
            ((typeof r.value === 'string' && !!r.value.trim() && r.value.length <= 150) ||
              (Array.isArray(r.value) &&
                r.value.length > 0 &&
                r.value.length <= 50 &&
                r.value.every((v) => typeof v === 'string' && !!v.trim() && v.length <= 150)))),
    );
    return valid ? group : null;
  } catch {
    return null;
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
  const [lookup, setLookup] = useState('');
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
  const value = raw;
  const hasSelection =
    selected.length > 0 && selected.every((value) => available.some((option) => option.value === value));
  function add() {
    let rule: ProfitRule;
    if (field === 'revenue') {
      const amount = parseMoneyInput(value.replace(/^-/, ''));
      if (!Number.isFinite(amount)) return;
      rule = {
        field,
        operator: negate ? 'at most' : 'at least',
        value: value.startsWith('-') ? -amount : amount,
      };
    } else {
      if (!hasSelection) return;
      rule = {
        field,
        operator: negate ? 'is not' : 'is',
        value: selected.length === 1 ? selected[0] : selected,
      };
    }
    onChange({ ...group, rules: [...group.rules, rule] });
    close();
    setSelected([]);
    setLookup('');
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
            onChange={(e) =>
              onChange({
                ...group,
                join: e.target.value === 'or' ? 'or' : 'and',
              })
            }
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
              onClick={() =>
                onChange({
                  ...group,
                  rules: group.rules.filter((_, i) => i !== index),
                })
              }
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
                setLookup('');
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
          {field === 'revenue' ? (
            <label className="grid min-w-24 max-w-full gap-1 text-xs">
              Revenue in baht
              <input
                required
                type="number"
                step=".01"
                className={inputStyle}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
              />
            </label>
          ) : (
            <fieldset className="grid min-w-0 basis-full gap-2">
              <legend className="text-xs">Filter values</legend>
              {(field === 'service' || field === 'source') && (
                <label className="grid gap-1 text-xs">
                  Search {labels[field].toLowerCase()} values
                  <input
                    type="search"
                    className={inputStyle}
                    value={lookup}
                    onChange={(e) => setLookup(e.target.value)}
                  />
                </label>
              )}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span role="status">{selected.length} selected</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!selected.length}
                  onClick={() => setSelected([])}
                >
                  Clear selection
                </Button>
              </div>
              <div className="grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">
                {available
                  .filter(
                    (item) =>
                      selected.includes(item.value) ||
                      item.label.toLowerCase().includes(lookup.trim().toLowerCase()),
                  )
                  .map((item) => (
                    <label key={item.value} className="flex min-h-11 items-center gap-2 break-all text-sm">
                      <input
                        type="checkbox"
                        checked={selected.includes(item.value)}
                        disabled={selected.length >= 50 && !selected.includes(item.value)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, item.value]
                              : selected.filter((value) => value !== item.value),
                          )
                        }
                      />
                      {item.label}
                    </label>
                  ))}
              </div>
            </fieldset>
          )}
          <Button size="sm" type="submit" disabled={field === 'revenue' ? !value : !hasSelection}>
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
