import { describe, expect, it } from 'vitest';
import { isMarketingBot } from '../../src/lib/marketing/bot';

describe('marketing preview bot detection', () => {
  it.each(['Googlebot/2.1', 'BingBot', 'crawler', 'Spider', 'facebookexternalhit/1.1', 'Twitterbot', 'preview', 'Slackbot-LinkExpanding', 'WhatsApp/2.0', 'facebookexternalhit/1.1;line-poker/1.0'])('detects %s', ua => {
    expect(isMarketingBot(ua)).toBe(true);
  });
  it.each([null, undefined, '', 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Safari/604.1', 'Mozilla/5.0 Chrome/130.0', 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Safari Line/13.6.1'])('allows browser %s', ua => {
    expect(isMarketingBot(ua)).toBe(false);
  });
});
