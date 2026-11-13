import { ConvexError, v } from 'convex/values';
import { guestMutation, guestQuery } from '../auth/model';
import { STATIC_SUGGESTION_KEYS } from '../shared/chatSuggestions';

const DEFAULT_LIMIT = 2;

const SCORE_ORDERED_CANDIDATE_SCAN_LIMIT = 100;

const staticSuggestionRefValidator = v.object({
	source: v.literal('static'),
	suggestionId: v.union(...STATIC_SUGGESTION_KEYS.map(key => v.literal(key)))
});

export const nextForSession = guestQuery({
	args: {
		sessionId: v.id('conversations'),
		guestToken: v.optional(v.string()),
		candidateSuggestionIds: v.array(v.union(...STATIC_SUGGESTION_KEYS.map(key => v.literal(key)))),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		if (args.candidateSuggestionIds.length > 5) throw new ConvexError('At most 5 suggestions may be selected per call');
		const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), 5);

		const interactions = await ctx.db
			.query('chatStaticSuggestionInteractions')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.take(SCORE_ORDERED_CANDIDATE_SCAN_LIMIT);
		const hiddenSuggestionKeys = new Set(
			interactions
				.filter((interaction) => interaction.shownAt || interaction.clickedAt)
				.map((interaction) => interaction.suggestionKey)
		);
		const seenCandidateKeys = new Set<string>();
		const selected = [];
		for (const suggestionId of args.candidateSuggestionIds) {
			const trimmed = suggestionId;
			if (!trimmed || seenCandidateKeys.has(trimmed) || hiddenSuggestionKeys.has(trimmed)) {
				continue;
			}
			seenCandidateKeys.add(trimmed);
			selected.push({ source: 'static' as const, suggestionId: trimmed });
			if (selected.length >= limit) break;
		}

		return selected;
	}
});

export const markShown = guestMutation({
 args: { sessionId: v.id('conversations'), guestToken: v.optional(v.string()), suggestions: v.array(staticSuggestionRefValidator) },
 handler: async (ctx, args) => {
  if (args.suggestions.length > 5) throw new ConvexError('At most 5 suggestions may be tracked per call');
  const now = Date.now(); let updated = 0;
  for (const ref of args.suggestions) {
   const existing = await ctx.db.query('chatStaticSuggestionInteractions').withIndex('by_session_and_suggestionKey', q => q.eq('sessionId', args.sessionId).eq('suggestionKey', ref.suggestionId)).unique();
   if (existing?.shownAt !== undefined) continue;
   if (existing) await ctx.db.patch(existing._id, { shownAt: now, updatedAt: now });
   else await ctx.db.insert('chatStaticSuggestionInteractions', { sessionId: args.sessionId, suggestionKey: ref.suggestionId, shownAt: now, createdAt: now, updatedAt: now });
   updated++;
  }
  return { updated };
 }
});

export const markClicked = guestMutation({
 args: { sessionId: v.id('conversations'), guestToken: v.optional(v.string()), suggestion: staticSuggestionRefValidator },
 handler: async (ctx, args) => {
  const now = Date.now();
  const existing = await ctx.db.query('chatStaticSuggestionInteractions').withIndex('by_session_and_suggestionKey', q => q.eq('sessionId', args.sessionId).eq('suggestionKey', args.suggestion.suggestionId)).unique();
  if (existing) await ctx.db.patch(existing._id, { shownAt: existing.shownAt ?? now, clickedAt: now, updatedAt: now });
  else await ctx.db.insert('chatStaticSuggestionInteractions', { sessionId: args.sessionId, suggestionKey: args.suggestion.suggestionId, shownAt: now, clickedAt: now, createdAt: now, updatedAt: now });
  return { clicked: true };
 }
});
