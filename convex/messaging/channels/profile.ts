import { graphVersion, object, string, type SocialChannel } from './adapter';
/** Best-effort display metadata; never delays durable ingress or determines identity/authorization. */
export async function profileName(channel: SocialChannel, recipient: string, transport: typeof fetch = fetch) {
  if (channel === 'whatsapp') return undefined; // Its signed payload already carries the contact name.
  const token = process.env[channel === 'line' ? 'LINE_CHANNEL_ACCESS_TOKEN' : `${channel.toUpperCase()}_ACCESS_TOKEN`];
  if (!token) return undefined;
  const url = channel === 'line' ? `https://api.line.me/v2/bot/profile/${encodeURIComponent(recipient)}`
    : `https://${channel === 'instagram' ? 'graph.instagram.com' : 'graph.facebook.com'}/${graphVersion(process.env[`${channel.toUpperCase()}_GRAPH_API_VERSION`])}/${encodeURIComponent(recipient)}?fields=name,first_name,last_name`;
  try {
    const response = await transport(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1500) });
    if (!response.ok) return undefined;
    const profile = object(await response.json());
    return string(profile.displayName) ?? string(profile.name) ?? string([string(profile.first_name), string(profile.last_name)].filter(Boolean).join(' '));
  } catch { return undefined; }
}
