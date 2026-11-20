import { ConvexError } from 'convex/values';
import type { MutationCtx } from '../../_generated/server';
import type { StaffActor } from '../../auth/model';
import type { CommerceSettings } from '../../commerce/model';
import type { Doc } from '../../_generated/dataModel';
import type { Tender } from '../../shared/orderMath';
import { checkPaymentCart } from './paymentReview';
import { appendRecordHistory } from '../../settings/model';
import { reserveWrites } from '../../lib/readBudget';
import { prepareCommercePayment, type FrozenCatalogue } from './paymentCommerce';
import { holdsInstruction, paymentError, paymentRange, paymentRefusal, type Attempt } from './paymentAttempt';

export async function preflightAttempt(
  ctx: MutationCtx, order: Doc<'orders'>, attempt: Attempt, settings: CommerceSettings,
  actor: StaffActor, tenders: Tender[], now: number, persistRefusal = false,
) {
  try {
    const frozen = holdsInstruction(attempt) ? await readFrozenCatalogue(ctx, attempt) : undefined;
    if (!frozen && settings.revision !== attempt.reviewedRequest.settingsRevision) {
      paymentError('settings_changed', 'Checkout rules changed. Review the payment again.');
    }
    const cart = await checkPaymentCart(ctx, order, attempt.reviewedRequest);
    const sale = await prepareCommercePayment(ctx, {
      order, settings, actor, tenders, now, frozen, lines: cart.lines, appointment: cart.appointment,
      vouchers: attempt.reviewedRequest.vouchers,
    });
    const catalogue = attempt.fingerprint.split(':')[1];
    if (!frozen && catalogue && catalogue !== sale.catalogFingerprint) {
      paymentError('catalogue_changed', 'The catalogue changed. Review the payment again.');
    }
    return { cart, sale, frozen };
  } catch (error) {
    // Collection commands return the refusal as a value, so this write survives the failed review.
    if (persistRefusal && error instanceof ConvexError) {
      const { status, code, message } = paymentRefusal(error);
      reserveWrites(ctx, 1);
      await ctx.db.patch(attempt._id, { status, refusal: { code, message }, updatedAt: now });
    }
    throw error;
  }
}

// The checkpoint has no frozen-catalogue field on attempts. Keep the server's reviewed
// evidence in the existing append-only history, addressed by the attempt id.
const QUOTE_ENTITY = 'paymentAttemptQuote';

async function readFrozenCatalogue(ctx: MutationCtx, attempt: Attempt): Promise<FrozenCatalogue | undefined> {
  const [row] = await paymentRange(ctx, () => ctx.db.query('recordChanges')
    .withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', QUOTE_ENTITY).eq('entityId', attempt._id)).take(1));
  const after: unknown = row?.after;
  if (!after || typeof after !== 'object' || !('settingsRevision' in after) || after.settingsRevision !== attempt.reviewedRequest.settingsRevision) return;
  return after as FrozenCatalogue;
}

export async function freezeAttemptCatalogue(ctx: MutationCtx, attempt: Attempt, catalogue: FrozenCatalogue) {
  reserveWrites(ctx, 1);
  await appendRecordHistory(ctx, { entityType: QUOTE_ENTITY, entityId: attempt._id, actor: attempt.owner, kind: 'armed', after: catalogue });
}
