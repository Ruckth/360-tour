import type { Infer } from 'convex/values';
import type { appointmentAudit } from '../shared/appointmentAudit';
import type { MutationCtx } from '../_generated/server';

/** Call only with explicitly selected non-secret business fields, in the owning transaction. */
export async function appendRecordHistory(ctx: MutationCtx, event: {
 entityType: string; entityId: string; actor: string; kind: string;
 appointmentAudit?: Infer<typeof appointmentAudit>;
 effectiveAt?: number; reason?: string; before?: unknown; after?: unknown;
}) {
 const recordedAt = Date.now();
 const effectiveAt = event.effectiveAt ?? recordedAt;
 if (!Number.isFinite(effectiveAt)) throw new Error('Invalid effective time');
 return await ctx.db.insert('recordChanges', { ...event, recordedAt, effectiveAt, ...(event.appointmentAudit ? { appointmentId: event.appointmentAudit.appointmentId, at: event.appointmentAudit.at } : {}) });
}
