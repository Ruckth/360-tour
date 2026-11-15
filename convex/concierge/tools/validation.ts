import { isIsoDate } from '../../shared/dates';
import { BOOKING_TOOLS, TOOLS } from './metadata';
import { humanToolResult } from './presentation';
import { ToolArgs } from './types';

// The runtime contract is the same schema the model sees.
const toolDefinitions = new Map([...TOOLS, ...BOOKING_TOOLS].map(tool => {
  tool.function.parameters.additionalProperties = false;
  return [tool.function.name, tool] as const;
}));

export function validateToolArgs(name: string, value: unknown): ToolArgs {
  const definition = toolDefinitions.get(name);
  if (!definition) throw new Error(`Unknown function: ${name}`);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tool arguments must be an object');
  const args = value as ToolArgs;
  const schema = definition.function.parameters;
  for (const field of schema.required ?? []) {
    if (!(field in args)) throw new Error(`Missing required field: ${field}`);
  }
  for (const [field, input] of Object.entries(args)) {
    const rule = schema.properties[field];
    if (!rule) throw new Error(`Unknown field: ${field}`);
    if (rule.type === 'string') {
      if (typeof input !== 'string' || !input.trim() || input.length > 500) throw new Error(`Invalid ${field}: expected a nonempty string`);
      if (rule.format === 'date' && !isIsoDate(input)) throw new Error(`Invalid ${field}: expected YYYY-MM-DD`);
      if (rule.pattern && !new RegExp(rule.pattern).test(input)) throw new Error(`Invalid ${field}: expected HH:mm`);
    } else if (typeof input !== 'number' || !Number.isFinite(input) || (rule.type === 'integer' && !Number.isInteger(input)) ||
      (rule.minimum !== undefined && input < rule.minimum) || (rule.maximum !== undefined && input > rule.maximum)) {
      throw new Error(`Invalid ${field}: expected ${rule.type} in the permitted range`);
    }
  }
  return args;
}

export function toolError(code: string, error: string) {
  return humanToolResult({ ok: false, code, error, retryable: false });
}
