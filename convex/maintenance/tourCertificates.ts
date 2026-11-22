import { v } from 'convex/values';
import { env } from '../_generated/server';
import { internalMutation, maintenancePaused } from '../auth/model';
import { sha256 } from '../shared/displayTokens';

/** Inspect or remove ordinary-tour certificates while public writes are paused. */
export const page = internalMutation({
	args: {
		targetOrigin: v.string(),
		snapshotSha256: v.string(),
		propertyId: v.optional(v.id('properties')),
		mode: v.union(v.literal('check'), v.literal('clear')),
		cursor: v.union(v.null(), v.string()),
		checkpoint: v.union(v.null(), v.string())
	},
	handler: async (ctx, { targetOrigin, snapshotSha256, propertyId, mode, cursor, checkpoint }) => {
		if (!maintenancePaused()) throw new Error('Pause public writes before checking or clearing tour certificates');
		const deployedOrigin = env.CONVEX_CLOUD_URL;
		if (!deployedOrigin || targetOrigin !== new URL(deployedOrigin).origin) throw new Error('Tour certificate target mismatch');
		if (!/^[a-f0-9]{64}$/.test(snapshotSha256)) throw new Error('Provide the verified snapshot SHA-256');
		const hash = (position: string) => sha256(JSON.stringify([targetOrigin, snapshotSha256, propertyId ?? null, mode, position]));
		if (checkpoint !== (cursor === null ? null : await hash(cursor))) throw new Error('Tour certificate checkpoint mismatch');

		// The index keys are unchanged by clearing the certificate, so the next page resumes safely.
		const scenes = propertyId
			? ctx.db.query('tourScenes').withIndex('by_property', q => q.eq('propertyId', propertyId))
			: ctx.db.query('tourScenes');
		const result = await scenes.paginate({ cursor, numItems: 8, maximumBytesRead: 4 * 1024 * 1024 });
		const certified = result.page.filter(room => room.ordinaryTourCertified);
		if (mode === 'clear') {
			for (const room of certified) await ctx.db.patch(room._id, { ordinaryTourCertified: undefined });
		}

		// SplitRequired pages carry the next cursor for the returned prefix. Never advance on an empty partial page.
		const nextCursor = result.isDone ? null : result.continueCursor;
		if (nextCursor !== null && (!result.page.length || nextCursor === cursor)) throw new Error('Tour certificate scan did not advance');
		return {
			scanned: result.page.length,
			certified: certified.length,
			cleared: mode === 'clear' ? certified.length : 0,
			isDone: result.isDone,
			cursor: nextCursor,
			checkpoint: nextCursor === null ? null : await hash(nextCursor)
		};
	}
});
