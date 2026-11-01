import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { assertValidIsoDate } from './validation';
import { appendRecordHistory } from './recordHistory';

type ReadCtx = QueryCtx | MutationCtx;
export type WeeklyPattern = Pick<Doc<'staff'>, 'workingHours' | 'breaks'>;
export type PatternEvidence = { pattern: WeeklyPattern; historyKnown: boolean; knownFrom: string };
export function rosterDate(at = Date.now()) {
	// Match serviceSlots' production-safe fixed Bangkok offset (no DST).
	return new Date(at + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
const pattern = (staff: WeeklyPattern): WeeklyPattern => ({ workingHours: staff.workingHours, breaks: staff.breaks });
function legacy(person: Doc<'staff'>): PatternEvidence {
	// Creation is the only proven origin when the document has never been updated.
	const proven = person.createdAt === person.updatedAt;
	return {
		pattern: pattern(person),
		historyKnown: proven,
		knownFrom: rosterDate(proven ? person.createdAt : Date.now())
	};
}

/** One indexed latest-version lookup. Older unknown dates use the earliest observed baseline, labelled unknown. */
export async function patternForDate(ctx: ReadCtx, person: Doc<'staff'>, date: string): Promise<PatternEvidence> {
	assertValidIsoDate(date, 'Date');
	const row = await ctx.db
		.query('staffPatternVersions')
		.withIndex('by_staffId_and_effectiveFrom', (q) => q.eq('staffId', person._id).lte('effectiveFrom', date))
		.order('desc')
		.first();
	if (row) return { pattern: pattern(row), historyKnown: true, knownFrom: row.effectiveFrom };
	const first = await ctx.db
		.query('staffPatternVersions')
		.withIndex('by_staffId_and_effectiveFrom', (q) => q.eq('staffId', person._id))
		.first();
	if (first) return { pattern: pattern(first), historyKnown: false, knownFrom: first.effectiveFrom };
	const value = legacy(person);
	return { ...value, historyKnown: value.historyKnown && date >= value.knownFrom };
}

/** Fetch versions once per staff/range, then resolve all cells in memory (no query per calendar cell). */
export async function patternsForRange(ctx: ReadCtx, people: Doc<'staff'>[], first: string, last: string) {
	const entries = await Promise.all(
		people.map(async (person) => {
			const prior = await ctx.db
				.query('staffPatternVersions')
				.withIndex('by_staffId_and_effectiveFrom', (q) => q.eq('staffId', person._id).lte('effectiveFrom', first))
				.order('desc')
				.first();
			const rows = await ctx.db
				.query('staffPatternVersions')
				.withIndex('by_staffId_and_effectiveFrom', (q) =>
					q.eq('staffId', person._id).gt('effectiveFrom', first).lte('effectiveFrom', last)
				)
				.take(513);
			if (rows.length > 512) throw new Error('Too many pattern changes in this range. Select a shorter date range.');
			const earliest =
				prior ??
				rows[0] ??
				(await ctx.db
					.query('staffPatternVersions')
					.withIndex('by_staffId_and_effectiveFrom', (q) => q.eq('staffId', person._id))
					.first());
			const baseline = earliest
				? { pattern: pattern(earliest), historyKnown: false, knownFrom: earliest.effectiveFrom }
				: legacy(person);
			return [
				person._id,
				(date: string): PatternEvidence => {
					let selected = prior;
					for (const row of rows) {
						if (row.effectiveFrom > date) break;
						selected = row;
					}
					return selected
						? { pattern: pattern(selected), historyKnown: true, knownFrom: selected.effectiveFrom }
						: { ...baseline, historyKnown: baseline.historyKnown && date >= baseline.knownFrom };
				}
			] as const;
		})
	);
	return new Map(entries);
}

/** Call before any direct staff weekly-pattern write, including adminServices.updateStaff and undo. */
export async function writeWeeklyPattern(
	ctx: MutationCtx,
	person: Doc<'staff'>,
	next: WeeklyPattern,
	actor: string,
	kind = 'pattern_updated'
) {
	const today = rosterDate();
	const latest = await ctx.db
		.query('staffPatternVersions')
		.withIndex('by_staffId_and_effectiveFrom', (q) => q.eq('staffId', person._id))
		.order('desc')
		.first();
	if (!latest) {
		const baseline = legacy(person);
		await ctx.db.insert('staffPatternVersions', {
			staffId: person._id,
			...pattern(person),
			effectiveFrom: baseline.knownFrom,
			recordedAt: Date.now(),
			actor,
			provenance: baseline.historyKnown ? 'created' : 'observed'
		});
	}
	const versionId = await ctx.db.insert('staffPatternVersions', {
		staffId: person._id,
		...pattern(next),
		effectiveFrom: today,
		recordedAt: Date.now(),
		actor,
		provenance: 'change'
	});
	await ctx.db.patch(person._id, { ...pattern(next), updatedAt: Date.now() });
	await appendRecordHistory(ctx, {
		entityType: 'roster',
		entityId: person._id,
		actor,
		kind,
		effectiveAt: Date.parse(`${today}T00:00:00+07:00`),
		before: { ...pattern(person), scope: 'weekly' },
		after: { ...pattern(next), scope: 'weekly', effectiveFrom: today }
	});
	return versionId;
}

/** Initialize at creation or before the first profile write. Legacy updated rows begin with observed evidence. */
export async function initializeWeeklyPattern(ctx: MutationCtx, staffId: Id<'staff'>, actor: string) {
	const person = await ctx.db.get(staffId);
	if (!person) throw new Error('Staff member not found');
	if (
		await ctx.db
			.query('staffPatternVersions')
			.withIndex('by_staffId_and_effectiveFrom', (q) => q.eq('staffId', staffId))
			.first()
	)
		return;
	const baseline = legacy(person);
	await ctx.db.insert('staffPatternVersions', {
		staffId,
		...pattern(person),
		effectiveFrom: baseline.knownFrom,
		recordedAt: Date.now(),
		actor,
		provenance: baseline.historyKnown ? 'created' : 'observed'
	});
}
