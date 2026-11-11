import type { Metadata } from 'next';
import { getLocale } from 'next-intl/server';
import { LegalPage } from '@/components/legal/LegalPage';
import { getPublicMessages } from '@/lib/i18n/server-content';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getPublicMessages(await getLocale()).Legal.privacy.title };
}
export default function Page() { return <LegalPage kind="privacy" />; }
