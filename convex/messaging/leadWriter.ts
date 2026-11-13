import type { Doc, Id } from '../_generated/dataModel';
import { type MutationCtx } from '../auth/model';

/**
 * One row per email + source + villa: a repeat sign-up from somewhere new gets its own row,
 * an identical repeat returns the existing one.
 */
export async function recordLead(
	ctx: MutationCtx,
	lead: { email: string; source: Doc<'leads'>['source']; propertyId?: Id<'properties'> }
) {
	// first(), not unique(): older data may already hold duplicates of a combination.
	const duplicate = await ctx.db
		.query('leads')
		.withIndex('by_email_and_source_and_propertyId', (q) =>
			q.eq('email', lead.email).eq('source', lead.source).eq('propertyId', lead.propertyId)
		)
		.first();
	if (duplicate) return duplicate._id;

	return await ctx.db.insert('leads', {
		...(lead.propertyId ? { propertyId: lead.propertyId } : {}),
		email: lead.email,
		source: lead.source,
		createdAt: Date.now()
	});
}
