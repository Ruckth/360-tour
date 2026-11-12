import type { Doc } from '../../_generated/dataModel';
import type { ReplyCard } from '../../lib/replyCards';
import { v } from 'convex/values';

export const socialChannel = v.union(v.literal('line'), v.literal('facebook'), v.literal('instagram'), v.literal('whatsapp'));
export type SocialChannel = 'line' | 'facebook' | 'instagram' | 'whatsapp';
export const inboundValidator = v.object({
  eventKey: v.string(), recipient: v.optional(v.string()), accountId: v.optional(v.string()),
  profileName: v.optional(v.string()), eventType: v.union(v.literal('message'), v.literal('follow'), v.literal('postback'), v.literal('unsupported')),
  messageText: v.optional(v.string()), postbackData: v.optional(v.string()), eventTimestamp: v.optional(v.number()),
  replyToken: v.optional(v.string()), sourceType: v.optional(v.string()),
});
export type InboundEvent = {
  eventKey: string; recipient?: string; accountId?: string; profileName?: string;
  eventType: 'message' | 'follow' | 'postback' | 'unsupported'; messageText?: string;
  postbackData?: string; eventTimestamp?: number; replyToken?: string; sourceType?: string;
};
export type SendResult = { state: 'sent' | 'rejected' | 'uncertain'; status?: number; reason?: string; invalidPayload?: boolean };
export type SendArgs = { event: Doc<'channelEvents'>; text: string; card?: ReplyCard; locale?: string; siteUrl: string; transport?: typeof fetch };
export type ChannelAdapter = {
  verify: (raw: string | ArrayBuffer, signature: string | null) => Promise<boolean>;
  normalize: (body: unknown) => Promise<InboundEvent[]>;
  send: (args: SendArgs) => Promise<SendResult>;
  replyWindowMs: number;
};
export const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const string = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
export const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
export async function eventDigest(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return `derived:${Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')}`;
}
/** Verify exactly the received bytes, before parsing or normalizing JSON. */
export async function verifyHmac(raw: string | ArrayBuffer, signature: string | null, secret: string | undefined, encoding: 'hex' | 'base64') {
  if (!secret || !signature) return false;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    if (encoding === 'hex') {
      if (!/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
      bytes = Uint8Array.from(signature.slice(7).match(/../g)!, hex => parseInt(hex, 16));
    } else {
      if (!/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
      bytes = Uint8Array.from(atob(signature), char => char.charCodeAt(0));
    }
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('HMAC', key, bytes, typeof raw === 'string' ? new TextEncoder().encode(raw) : raw);
  } catch { return false; }
}
export const graphVersion = (value?: string) => value && /^v\d+\.\d+$/.test(value) ? value : 'v25.0';
/** A network failure or server error cannot prove that delivery did not occur. */
export async function providerRequest(url: string, token: string, body: object, transport: typeof fetch = fetch): Promise<SendResult> {
  try {
    const response = await transport(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    if (response.ok) return { state: 'sent', status: response.status };
    let invalidPayload = false;
    if (response.status === 400) {
      try { const error = object(object(await response.json()).error); invalidPayload = error.code === 100 || error.code === 131009; } catch { /* Not a known payload rejection. */ }
    }
    return { state: response.status < 500 ? 'rejected' : 'uncertain', status: response.status, reason: 'Provider did not confirm delivery', ...(invalidPayload ? { invalidPayload: true } : {}) };
  } catch { return { state: 'uncertain', reason: 'Provider delivery may have succeeded' }; }
}
