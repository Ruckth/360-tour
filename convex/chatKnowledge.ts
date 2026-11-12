import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalMutation, type MutationCtx } from './auth/model';
import { staffNeeded } from './lib/inboxLifecycle';
import { currentClaim, durableTurnValidator } from './messaging/claims';

// A staff request needs a "talk/contact" verb near a "person/staff" noun (either order), so plain
// questions about staff ("is there cleaning staff?", "price per person") don't page the owner.
// Words in spaced scripts get unicode word boundaries; Thai/CJK terms are matched bare.
const word = (alternatives: string) => String.raw`(?<!\p{L})(?:${alternatives})(?!\p{L})`;

const STAFF_VERBS = [
  word('speak|talk|chat|connect|contact|reach|sprech(?:en|e)|reden|kontakt(?:ieren)?|hablar|hablo|contactar|comunicar(?:me)?|parler|contacter|joindre|parlare|contattare|बात|संपर्क'),
  'поговори|свяж|соедини|позов|คุย|ติดต่อ|พูด|โทร|話|連絡|つない|繋い|转人工|转接|联系|找|통화|얘기|이야기|연결'
].join('|');

const STAFF_PEOPLE = [
  word('staff|agent|host|manager|owner|someone|anyone|(?:a|the|real) (?:person|human)|menschen|mitarbeiter|gastgeber|jemandem|persona|alguien|anfitri[oó]n|humano|personal|encargado|personne|quelqu.un|h[ôo]te|humain|personnel|responsable|qualcuno|umano|responsabile|человеком|кем-нибудь|хозяином|оператором|менеджером|сотрудником|इंसान|व्यक्ति|स्टाफ|मैनेजर|मालिक|상담원|(?:직원|사람)(?:과|이랑|하고|에게|한테)?'),
  'พนักงาน|เจ้าหน้าที่|แอดมิน|เจ้าของ|คนจริง|スタッフ|担当者|人間|オペレーター|人工|客服|真人|老板|经理'
].join('|');

const STAFF_ALONE = [word('human|real person|live agent|staff member|representative|상담원'), 'คนจริง|真人客服|人工客服|转人工|担当者'].join('|');

const STAFF_REQUEST = new RegExp(`${STAFF_ALONE}|(?:${STAFF_VERBS}).{0,30}(?:${STAFF_PEOPLE})|(?:${STAFF_PEOPLE}).{0,30}(?:${STAFF_VERBS})`, 'iu');

export function asksForStaff(message: string) {
  return STAFF_REQUEST.test(message);
}

async function claimStaffAlertSlot(ctx: MutationCtx, now: number) {
  const key = 'staff-alert:global';
  const hour = 60 * 60 * 1000;
  const row = await ctx.db.query('rateLimits').withIndex('by_key', q => q.eq('key', key)).unique();
  // The count fallback handles a row created by the old fixed-window limiter.
  const recent = row?.timestamps?.filter(time => time > now - hour)
    ?? (row && row.expiresAt > now ? Array(Math.min(row.count, 30)).fill(now) as number[] : []);
  if (recent.length >= 30) return false;
  const timestamps = [...recent, now];
  if (row) await ctx.db.patch(row._id, { count: timestamps.length, expiresAt: now + hour, timestamps });
  else await ctx.db.insert('rateLimits', { key, count: 1, expiresAt: now + hour, timestamps });
  return true;
}

export async function queueStaffAlert(ctx: MutationCtx, sessionId: Id<'conversations'>, message: string, replyToMessageId?: Id<'messages'>) {
  const session = await ctx.db.get(sessionId);
  if (!session || session.visitorId?.startsWith("eval:")) return false;
  if (!await staffNeeded(ctx, sessionId, replyToMessageId)) return false;
  const now = Date.now();
  if (session.lastStaffAlertAt && now - session.lastStaffAlertAt < 30 * 60 * 1000) return false;
  // Sessions are created by anonymous clients, so enforce a rolling global hour as well.
  if (!(await claimStaffAlertSlot(ctx, now))) {
    console.warn('Staff alert rate limit reached, skipping alert for session', sessionId);
    return false;
  }
  await ctx.db.patch(sessionId, { lastStaffAlertAt: now });
  await ctx.scheduler.runAfter(0, internal.emails.sendStaffAlert, {
    sessionId,
    channel: session.channel,
    guestName: session.visitorName?.trim() || 'Unknown guest',
    lastMessage: message.slice(0, 1000)
  });
  return true;
}

export const alertStaffForHandoff = internalMutation({
  args: { durableTurn: v.optional(durableTurnValidator), sessionId: v.id('conversations'), lastMessage: v.string(), replyToMessageId: v.optional(v.id('messages')) },
  handler: async (ctx, args) => {
    if (args.durableTurn) { const event = await currentClaim(ctx, args.durableTurn.eventId, args.durableTurn.claimToken); if (event.sessionId !== args.sessionId) throw new Error('Turn conversation mismatch'); }
    return await queueStaffAlert(ctx, args.sessionId, args.lastMessage, args.replyToMessageId);
  }
});
