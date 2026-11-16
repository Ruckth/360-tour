import { expect, it } from 'vitest';
import { CHAT_REPLY_LIMIT_DEFAULTS, CHAT_REPLY_LIMIT_RANGES, mergeSiteSettings, resolveChatReplyLimits, validateSettingsInput, type ChatReplyLimits } from 'convex/shared/siteSettings';

it('uses the existing allowances for every channel and each chat until saved', () => {
  expect(resolveChatReplyLimits(null)).toEqual({ web: 500, line: 500, whatsapp: 500, facebook: 500, instagram: 500, perChat: 20 });
  expect(mergeSiteSettings(null).chatReplyLimits).toEqual(CHAT_REPLY_LIMIT_DEFAULTS);
  expect(resolveChatReplyLimits({ chatReplyLimits: { line: 3 } })).toEqual({ ...CHAT_REPLY_LIMIT_DEFAULTS, line: 3 });
});
it.each(Object.keys(CHAT_REPLY_LIMIT_RANGES) as (keyof ChatReplyLimits)[])('validates %s with shared whole-number boundaries', key => {
  const [min, max] = CHAT_REPLY_LIMIT_RANGES[key];
  for (const value of [min, max]) expect(validateSettingsInput({ chatReplyLimits: { [key]: value } }).errors).toEqual({});
  for (const value of [min - 1, max + 1, 1.5, NaN, Infinity, -Infinity]) {
    expect(validateSettingsInput({ chatReplyLimits: { [key]: value } }).errors[`chatReplyLimits.${key}`]).toContain(`from ${min} to ${max}`);
  }
});
