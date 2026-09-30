/**
 * A per-invocation read budget with headroom under Convex's transaction limits
 * (https://docs.convex.dev/production/state/limits): 32,000 documents scanned, 4,096 index
 * ranges plus single gets, 16 MiB read. Everything one query or mutation reads through a budget
 * is counted against the same totals, so several bounded loops can't add up past the limit.
 *
 * convex-test does not enforce production limits; these counters are what keep a call inside them.
 */
export const READ_BUDGET_DOCUMENTS = 16_000;
export const READ_BUDGET_RANGES = 2_000;
export const READ_BUDGET_BYTES = 8 * 1024 * 1024;

export const READ_BUDGET_ERROR = 'This request reads too much data to answer safely. Narrow it and try again.';

export class ReadBudgetExceeded extends Error {
	constructor(message = READ_BUDGET_ERROR) {
		super(message);
		this.name = 'ReadBudgetExceeded';
	}
}

const encoder = new TextEncoder();

export class ReadBudget {
	documents = 0;
	ranges = 0;
	bytes = 0;

	constructor(
		readonly maxDocuments = READ_BUDGET_DOCUMENTS,
		readonly maxRanges = READ_BUDGET_RANGES,
		readonly maxBytes = READ_BUDGET_BYTES
	) {}

	get exhausted() {
		return this.documents > this.maxDocuments || this.ranges > this.maxRanges || this.bytes > this.maxBytes;
	}

	/** Counts one index range or `db.get`. Returns false once the budget is spent. */
	range(): boolean {
		this.ranges++;
		return !this.exhausted;
	}

	/** Counts one document read (size measured as its UTF-8 JSON). Returns false once the budget is spent. */
	document(doc: unknown): boolean {
		this.documents++;
		this.bytes += encoder.encode(JSON.stringify(doc)).length;
		return !this.exhausted;
	}

	/** Throws `ReadBudgetExceeded` if the budget is spent; for callers that must not answer from a partial read. */
	assert(message?: string) {
		if (this.exhausted) throw new ReadBudgetExceeded(message);
	}
}

const budgets = new WeakMap<object, ReadBudget>();

/**
 * The read budget of one Convex invocation. Keyed on the handler's `ctx`, so every helper called
 * with the same `ctx` shares the same totals without passing a budget around.
 */
export function readBudget(ctx: object): ReadBudget {
	let budget = budgets.get(ctx);
	if (!budget) {
		budget = new ReadBudget();
		budgets.set(ctx, budget);
	}
	return budget;
}

/**
 * Reads a whole index range within the invocation's budget, throwing `ReadBudgetExceeded`
 * (never returning a partial list) if the range is larger than the budget allows.
 */
export async function readRangeWithinBudget<T>(ctx: object, range: AsyncIterable<T>, message?: string): Promise<T[]> {
	const budget = readBudget(ctx);
	if (!budget.range()) throw new ReadBudgetExceeded(message);
	const rows: T[] = [];
	for await (const row of range) {
		if (!budget.document(row)) throw new ReadBudgetExceeded(message);
		rows.push(row);
	}
	return rows;
}

/** Writes one invocation may make, with headroom under Convex's 16,000 documents written. */
export const WRITE_BUDGET_DOCUMENTS = 12_000;
const writes = new WeakMap<object, number>();

/** Counts `count` upcoming writes for this invocation; throws before the transaction limit is reached. */
export function reserveWrites(ctx: object, count: number) {
	const total = (writes.get(ctx) ?? 0) + count;
	if (total > WRITE_BUDGET_DOCUMENTS) {
		throw new Error('This batch would write too many documents in one transaction. Use a smaller batch.');
	}
	writes.set(ctx, total);
}
