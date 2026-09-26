import { v } from 'convex/values';
import { internalMutation, mutation } from './_generated/server';
import { requireAdmin } from './lib/adminAuth';
import { normalizeSuggestedQuestion, supportedSuggestionLocales } from './lib/chatSuggestions';
import { curatedQuestionSeeds, type CuratedQuestionSeed } from './seeds/curatedQuestions';
import { seedProperties } from './seeds/properties';
import { seedRooms } from './seeds/rooms';
import { seedSocialProof } from './seeds/socialProof';
import { seedReviews } from './seeds/reviews';
import { seedTourSnippets } from './seeds/tourSnippets';
import { seedRecentBookings } from './seeds/recentBookings';
import { seedStaffServicesData } from './seeds/staffServices';

function sameTranslations(left?: Record<string, string>, right?: Record<string, string>) {
	return supportedSuggestionLocales.every((locale) => left?.[locale]?.trim() === right?.[locale]);
}

function seedNeedsUpdate(
	existing: {
		question: string;
		normalizedQuestion: string;
		translations?: Record<string, string>;
		answer?: string;
		answerTranslations?: Record<string, string>;
		answerMode?: 'static' | 'dynamic';
		dynamicIntent?: 'availability' | 'pricing' | 'property_details' | 'booking_help' | 'contact';
		propertySlug?: string;
		topic: string;
		score: number;
		status: 'active' | 'archived';
		archivedAt?: number;
		archivedByAdminEmail?: string;
	},
	seed: CuratedQuestionSeed
) {
	return (
		existing.question !== seed.question ||
		existing.normalizedQuestion !== normalizeSuggestedQuestion(seed.question) ||
		!sameTranslations(existing.translations, seed.translations) ||
		existing.answer !== undefined ||
		existing.answerTranslations !== undefined ||
		existing.answerMode !== 'dynamic' ||
		existing.dynamicIntent !== seed.dynamicIntent ||
		existing.propertySlug !== undefined ||
		existing.topic !== seed.topic ||
		existing.score !== seed.score ||
		existing.status !== 'active' ||
		existing.archivedAt !== undefined ||
		existing.archivedByAdminEmail !== undefined
	);
}

export const seedAll = mutation({
	args: {},
	handler: async (ctx) => {
		const existing = await ctx.db.query('properties').first();
		if (existing) {
			return { status: 'already_seeded' };
		}

		const properties = await seedProperties(ctx);
		await seedRooms(ctx, properties);
		await seedSocialProof(ctx, properties);
		await seedReviews(ctx, properties);
		await seedTourSnippets(ctx, properties);
		await seedRecentBookings(ctx, properties);
		await seedStaffServicesData(ctx);

		return {
			status: 'seeded',
			properties: {
				poolVilla: properties['pool-villa'],
				gardenSuite: properties['garden-suite'],
				penthouse: properties.penthouse
			}
		};
	}
});

/** Adds demo staff/services to an already-seeded deployment: `npx convex run seed:seedStaffServices`. */
export const seedStaffServices = internalMutation({
	args: {},
	handler: async (ctx) => await seedStaffServicesData(ctx)
});

export const seedCuratedQuestionBank = mutation({
	args: {
		dryRun: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const dryRun = args.dryRun ?? false;
		const now = Date.now();
		let created = 0;
		let updated = 0;
		let unchanged = 0;
		let duplicateExistingRows = 0;
		const items: Array<{
			question: string;
			action: 'create' | 'update' | 'unchanged';
			duplicateExistingRows: number;
		}> = [];

		for (const seed of curatedQuestionSeeds) {
			const normalizedQuestion = normalizeSuggestedQuestion(seed.question);
			const existingRows = await ctx.db
				.query('curatedChatQuestions')
				.withIndex('by_propertySlug_and_normalizedQuestion', (q) =>
					q.eq('propertySlug', undefined).eq('normalizedQuestion', normalizedQuestion)
				)
				.take(2);
			const existing = existingRows[0];
			const duplicates = Math.max(0, existingRows.length - 1);
			duplicateExistingRows += duplicates;

			if (!existing) {
				created++;
				items.push({ question: seed.question, action: 'create', duplicateExistingRows: duplicates });
				if (!dryRun) {
					await ctx.db.insert('curatedChatQuestions', {
						question: seed.question,
						normalizedQuestion,
						translations: seed.translations,
						answerMode: 'dynamic',
						dynamicIntent: seed.dynamicIntent,
						topic: seed.topic,
						score: seed.score,
						status: 'active',
						createdAt: now,
						updatedAt: now,
						createdByAdminEmail: admin.email,
						updatedByAdminEmail: admin.email
					});
				}
				continue;
			}

			if (!seedNeedsUpdate(existing, seed)) {
				unchanged++;
				items.push({ question: seed.question, action: 'unchanged', duplicateExistingRows: duplicates });
				continue;
			}

			updated++;
			items.push({ question: seed.question, action: 'update', duplicateExistingRows: duplicates });
			if (!dryRun) {
				await ctx.db.patch(existing._id, {
					question: seed.question,
					normalizedQuestion,
					translations: seed.translations,
					answer: undefined,
					answerTranslations: undefined,
					answerMode: 'dynamic',
					dynamicIntent: seed.dynamicIntent,
					propertySlug: undefined,
					topic: seed.topic,
					score: seed.score,
					status: 'active',
					archivedAt: undefined,
					archivedByAdminEmail: undefined,
					updatedAt: now,
					updatedByAdminEmail: admin.email
				});
			}
		}

		return {
			dryRun,
			totalSeeds: curatedQuestionSeeds.length,
			created,
			updated,
			unchanged,
			duplicateExistingRows,
			items
		};
	}
});
