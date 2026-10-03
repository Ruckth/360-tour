import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { internalQuery, mutation, query, type MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireAdmin } from './lib/adminAuth';

const status = v.union(v.literal('draft'), v.literal('approved'), v.literal('archived'));

const structuredSourceValidator = v.union(
	v.literal('settings'),
	v.literal('property_details'),
	v.literal('services'),
	v.literal('pricing_availability')
);

/** Bounded per call so a large unknown group is resolved in verifiable batches. */
const RESOLVE_GROUP_LIMIT = 100;
const RESOLVE_ROW_LIMIT = 100;

function unresolvedReports(ctx: MutationCtx, key: string, propertyId?: Id<'properties'>) {
	const rows = ctx.db.query('chatUnknownQuestions');
	return propertyId
		? rows.withIndex('by_status_and_normalizedQuestion_and_propertyId', q =>
			q.eq('status', 'new').eq('normalizedQuestion', key).eq('propertyId', propertyId))
		: rows.withIndex('by_status_and_normalizedQuestion', q =>
			q.eq('status', 'new').eq('normalizedQuestion', key));
}

function text(value: string, label: string, limit: number) {
	const clean = value.trim();
	if (!clean || clean.length > limit) throw new Error(`${label} must contain 1–${limit} characters`);
	return clean;
}

export const adminList = query({
	args: { paginationOpts: paginationOptsValidator, status: v.optional(status) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const rows = args.status
			? ctx.db.query('businessFacts').withIndex('by_status_and_updatedAt', q => q.eq('status', args.status!))
			: ctx.db.query('businessFacts');
		return await rows.order('desc').paginate(args.paginationOpts);
	}
});

export const adminSave = mutation({
	args: {
		factId: v.optional(v.id('businessFacts')),
		expectedRevision: v.optional(v.number()),
		title: v.string(), body: v.string(), searchText: v.string(), source: v.string(),
		propertyId: v.optional(v.id('properties')), status,
		unknownQuestionId: v.optional(v.id('chatUnknownQuestions'))
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const existing = args.factId ? await ctx.db.get(args.factId) : null;
		if (args.factId && !existing) throw new Error('Fact not found');
		if (existing && args.expectedRevision !== existing.revision) throw new Error('This fact changed. Reload before saving.');
		if (args.propertyId) {
			const property = await ctx.db.get(args.propertyId);
			if (!property || property.status !== 'active') throw new Error('Choose an active property');
		}
		const fields = {
			title: text(args.title, 'Title', 160), body: text(args.body, 'Fact', 2400),
			searchText: text(args.searchText, 'English search terms', 1200),
			source: text(args.source, 'Source', 500), propertyId: args.propertyId,
			status: args.status, revision: (existing?.revision ?? 0) + 1,
			updatedAt: Date.now(), updatedByAdminEmail: admin.email
		};
		const factId = existing
			? (await ctx.db.patch(existing._id, fields), existing._id)
			: await ctx.db.insert('businessFacts', { ...fields, createdAt: Date.now(), createdByAdminEmail: admin.email });
		if (args.unknownQuestionId) {
			const unknown = await ctx.db.get(args.unknownQuestionId);
			if (!unknown) throw new Error('Missing-information report not found');
			if (args.status !== 'approved') throw new Error('Approve the fact before resolving missing information');
			if (args.propertyId && unknown.propertyId !== args.propertyId) throw new Error('The fact must apply to the reported property');
			await ctx.db.patch(unknown._id, {
				status: 'resolved', resolvedFactId: factId, resolvedSource: undefined, resolvedAnswerId: undefined, resolvedQuestionId: undefined,
				resolvedAt: Date.now(), updatedAt: Date.now(), ignoredAt: undefined
			});
		}
		return factId;
	}
});

/** Session authorization and real property scope are resolved server-side, never from a user ID. */
export const search = internalQuery({
	args: { sessionId: v.id('chatSessions'), query: v.string(), propertySlug: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const session = await ctx.db.get(args.sessionId);
		if (!session || session.aiPaused) throw new Error('No active AI session');
		const queryText = text(args.query, 'Search query', 500);
		const terms = queryText.match(/[\p{L}\p{N}]+/gu)?.filter(term => term.length <= 32).slice(0, 16).join(' ') ?? '';
		if (!terms) return { facts: [], noMatch: true };
		const slug = args.propertySlug ?? session.propertySlug;
		const property = slug ? await ctx.db.query('properties').withIndex('by_slug', q => q.eq('slug', slug)).unique() : null;
		if (slug && (!property || property.status !== 'active')) throw new Error('Unknown active property');
		const scoped = property ? await ctx.db.query('businessFacts').withSearchIndex('search_text', q =>
			q.search('searchText', terms).eq('status', 'approved').eq('propertyId', property._id)
		).take(6) : [];
		const global = await ctx.db.query('businessFacts').withSearchIndex('search_text', q =>
			q.search('searchText', terms).eq('status', 'approved').eq('propertyId', undefined)
		).take(6);
		// Property facts override global facts on the same maintained subject (title).
		const subjects = new Set(scoped.map(fact => fact.title.trim().toLowerCase()));
		const selected: Doc<'businessFacts'>[] = [...scoped, ...global.filter(fact => !subjects.has(fact.title.trim().toLowerCase()))].slice(0, 6);
		let remaining = 8000; // Conservative character cap in addition to bounded rows/body size.
		const facts = selected.flatMap(fact => {
			const size = fact.title.length + fact.body.length + fact.source.length;
			if (size > remaining) return [];
			remaining -= size;
			return [{ factId: fact._id, title: fact.title, body: fact.body, source: fact.source, revision: fact.revision,
				updatedAt: fact.updatedAt, propertySlug: fact.propertyId ? property?.slug : null }];
		});
		return { facts, noMatch: facts.length === 0 };
	}
});

/** Change a fact's status with a revision check, bumping the revision so stale editors are rejected. */
export const adminSetStatus = mutation({
	args: { factId: v.id('businessFacts'), status, expectedRevision: v.number() },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const existing = await ctx.db.get(args.factId);
		if (!existing) throw new Error('Fact not found');
		if (args.expectedRevision !== existing.revision) throw new Error('This fact changed. Reload before saving.');
		await ctx.db.patch(existing._id, {
			status: args.status,
			revision: existing.revision + 1,
			updatedAt: Date.now(),
			updatedByAdminEmail: admin.email
		});
		return { status: args.status, revision: existing.revision + 1 };
	}
});

/**
 * Resolve the "new" unknown questions in the given groups by pointing them at one approved fact
 * OR a current structured source. Exactly one of factId / structuredSource is required. A
 * property-scoped fact may only resolve unknowns reported for that property; a global fact may
 * resolve any. Bounded per call so each batch can be verified before the next.
 */
export const adminResolveUnknownGroups = mutation({
	args: {
		normalizedQuestions: v.array(v.string()),
		factId: v.optional(v.id('businessFacts')),
		structuredSource: v.optional(structuredSourceValidator)
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		if ((args.factId === undefined) === (args.structuredSource === undefined)) {
			throw new Error('Provide exactly one of a fact or a structured source');
		}

		let fact: Doc<'businessFacts'> | null = null;
		if (args.factId) {
			fact = await ctx.db.get(args.factId);
			if (!fact) throw new Error('Fact not found');
			if (fact.status !== 'approved') throw new Error('Approve the fact before resolving missing information');
		}

		const keys = [...new Set(args.normalizedQuestions.map(key => key.trim()).filter(Boolean))];
		if (keys.length > RESOLVE_GROUP_LIMIT) throw new Error(`Select ${RESOLVE_GROUP_LIMIT} or fewer groups at a time`);

		const now = Date.now();
		const unknownQuestionIds: Id<'chatUnknownQuestions'>[] = [];
		for (const key of keys) {
			const budget = RESOLVE_ROW_LIMIT - unknownQuestionIds.length;
			if (budget === 0) break;
			const rows = await unresolvedReports(ctx, key, fact?.propertyId).take(budget);
			for (const row of rows) {
				await ctx.db.patch(row._id, {
					status: 'resolved',
					resolvedFactId: args.factId,
					resolvedSource: args.structuredSource,
					resolvedAnswerId: undefined,
					resolvedQuestionId: undefined,
					resolvedAt: now,
					ignoredAt: undefined,
					updatedAt: now
				});
				unknownQuestionIds.push(row._id);
			}
		}

		let remaining = 0;
		for (const key of keys) {
			const budget = RESOLVE_ROW_LIMIT + 1 - remaining;
			if (budget === 0) break;
			remaining += (await unresolvedReports(ctx, key, fact?.propertyId).take(budget)).length;
		}

		// Count at most one more than the batch budget: zero proves completion; larger groups
		// expose an honest lower bound without scanning their whole backlog. Returned IDs stay
		// small enough for Convex serialization and the existing adminReopenUnknownGroups undo.
		return {
			resolved: unknownQuestionIds.length,
			remaining: Math.min(remaining, RESOLVE_ROW_LIMIT),
			remainingIsLowerBound: remaining > RESOLVE_ROW_LIMIT,
			hasMore: remaining > 0,
			unknownQuestionIds
		};
	}
});

/** Active properties (id/slug/name) for the fact editor's property picker. */
export const adminPropertyOptions = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const properties = await ctx.db
			.query('properties')
			.withIndex('by_status', q => q.eq('status', 'active'))
			.take(100);
		return properties
			.map(property => ({ _id: property._id, slug: property.slug, name: property.name }))
			.sort((left, right) => left.name.localeCompare(right.name));
	}
});
