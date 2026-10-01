import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { normalizeSuggestedQuestion } from './chatSuggestions';

type CuratedText = Pick<Doc<'curatedChatQuestions'>, 'question' | 'normalizedQuestion' | 'translations'>;

/** Every normalized text a guest message can equal to match the item exactly: the question and each translation. */
export function curatedQuestionVariants(question: CuratedText): string[] {
	const variants = [question.question, question.normalizedQuestion, ...Object.values(question.translations ?? {})]
		.filter((value): value is string => typeof value === 'string')
		.map(normalizeSuggestedQuestion)
		.filter(Boolean);
	return [...new Set(variants)];
}

/**
 * Rewrites the item's exact-match lookup rows. Call after any change to its question,
 * translations or villa. Status is not copied: readers check the item itself.
 */
export async function syncCuratedVariants(ctx: MutationCtx, question: Doc<'curatedChatQuestions'>) {
	const wanted = new Set(curatedQuestionVariants(question));
	const existing = await ctx.db
		.query('curatedChatQuestionVariants')
		.withIndex('by_questionId', (q) => q.eq('questionId', question._id))
		.take(100);
	for (const row of existing) {
		if (row.propertySlug === question.propertySlug && wanted.delete(row.normalizedVariant)) continue;
		await ctx.db.delete(row._id);
	}
	for (const normalizedVariant of wanted) {
		await ctx.db.insert('curatedChatQuestionVariants', {
			questionId: question._id,
			normalizedVariant,
			...(question.propertySlug ? { propertySlug: question.propertySlug } : {})
		});
	}
}

export async function deleteCuratedVariants(ctx: MutationCtx, questionId: Id<'curatedChatQuestions'>) {
	const rows = await ctx.db
		.query('curatedChatQuestionVariants')
		.withIndex('by_questionId', (q) => q.eq('questionId', questionId))
		.take(100);
	for (const row of rows) await ctx.db.delete(row._id);
}
