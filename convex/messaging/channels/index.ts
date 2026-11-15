import { line } from './line';
import { meta } from './meta';
import { whatsapp } from './whatsapp';
import type { SocialChannel, ChannelAdapter } from './adapter';
export const adapters: Record<SocialChannel, ChannelAdapter> = { line, facebook: meta('facebook', 'graph.facebook.com'), instagram: meta('instagram', 'graph.instagram.com'), whatsapp };
