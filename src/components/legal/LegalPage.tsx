import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { localizeHref } from '@/i18n/routing';
import { resort } from '@/lib/data/resort-config';
import { AnalyticsChoice } from './AnalyticsChoice';

/** The privacy policy or the terms. All copy comes from the `Legal` messages of the active locale. */
export function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const t = useTranslations('Legal');
  const locale = useLocale();
  const privacy = kind === 'privacy';
  const email = resort.contactEmail;
  const mail = (chunks: ReactNode) => <a className="underline" href={`mailto:${email}`}>{chunks}</a>;
  const heading = 'mb-2 text-xl font-semibold text-foreground';
  return <main className="mx-auto max-w-3xl px-5 py-20 text-foreground">
    <h1 className="font-serif text-4xl font-semibold">{t(privacy ? 'privacy.title' : 'terms.title')}</h1>
    <p className="mt-4 text-sm text-muted-foreground">{t('lastUpdated')}</p>
    <div className="mt-8 space-y-7 leading-relaxed text-muted-foreground">
      {privacy ? <>
        <section><h2 className={heading}>{t('privacy.collectTitle')}</h2><p>{t('privacy.collectBody')}</p></section>
        <section><h2 className={heading}>{t('privacy.useTitle')}</h2><p>{t('privacy.useBody')}</p></section>
        <section><h2 className={heading}>{t('privacy.measurementTitle')}</h2><p>{t('privacy.measurementTab')}</p><p className="mt-3">{t('privacy.measurementConsent')}</p></section>
        <section><h2 className={heading}>{t('privacy.sharingTitle')}</h2><p>{t('privacy.sharingBody')}</p></section>
        <section><h2 className={heading}>{t('privacy.choicesTitle')}</h2><p>{t('privacy.choicesRequests')}</p><p className="mt-3">{t('privacy.choicesMeasurement')}</p><AnalyticsChoice /></section>
        <section><h2 className={heading}>{t('contactTitle')}</h2><p>{t.rich('privacy.contact', { email, link: mail })}</p></section>
      </> : <>
        <section><h2 className={heading}>{t('terms.statusTitle')}</h2><p>{t('terms.statusBody')}</p></section>
        <section><h2 className={heading}>{t('terms.bookingTitle')}</h2><p>{t('terms.bookingBody')}</p></section>
        <section><h2 className={heading}>{t('terms.changesTitle')}</h2><p>{t('terms.changesBody')}</p></section>
        <section><h2 className={heading}>{t('contactTitle')}</h2><p>{t.rich('terms.contact', { email, link: mail })}</p></section>
      </>}
    </div>
    <p className="mt-10"><Link className="underline" href={localizeHref('/', locale)}>{t('returnHome')}</Link></p>
  </main>;
}
