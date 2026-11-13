export function richCardsEnabled(channel: 'line' | 'whatsapp'): boolean {
  return (process.env.MESSAGING_RICH_CARDS ?? '').split(',').map(value => value.trim()).includes(channel);
}
