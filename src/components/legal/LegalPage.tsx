import Link from '@/platform/link';
import { useLocale, useTranslations } from '@/platform/intl';
import type { ReactNode } from 'react';
import { localizeHref } from '@/i18n/routing';
import { resort } from '@/lib/data/resort-config';
import { AnalyticsChoice } from './AnalyticsChoice';

export function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const t = useTranslations('Legal');
  const locale = useLocale();
  const privacy = kind === 'privacy';
  const email = resort.contactEmail;
  const mail = (chunks: ReactNode) => <a className="underline" href={`mailto:${email}`}>{chunks}</a>;
  const heading = 'mb-2 scroll-mt-24 text-xl font-semibold text-foreground';
  const sections = privacy
    ? [
        ['information', t('privacy.collectTitle')],
        ['measurement', t('privacy.measurementTitle')],
        ['your-choices', t('privacy.choicesTitle')],
      ]
    : [
        ['status', t('terms.statusTitle')],
        ['booking', t('terms.bookingTitle')],
        ['changes', t('terms.changesTitle')],
      ];
  return <article className="mx-auto max-w-3xl px-5 py-20 text-foreground">
    <h1 id="legal-title" className="font-serif text-4xl font-semibold">{t(privacy ? 'privacy.title' : 'terms.title')}</h1>
    <p className="mt-4 text-sm text-muted-foreground">{t('lastUpdated')}</p>
    <nav aria-labelledby="legal-title" className="mt-3 flex flex-wrap gap-x-4">
      {[...sections, ['contact', t('contactTitle')]].map(([id, label]) => (
        <a key={id} href={`#${id}`} className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">{label}</a>
      ))}
    </nav>
    <div className="mt-8 space-y-7 leading-relaxed text-muted-foreground">
      {privacy ? <>
        <section><h2 id="information" tabIndex={-1} className={heading}>{t('privacy.collectTitle')}</h2><p>{t('privacy.collectBody')}</p></section>
        <section><h2 className={heading}>{t('privacy.useTitle')}</h2><p>{t('privacy.useBody')}</p></section>
        <section><h2 id="measurement" tabIndex={-1} className={heading}>{t('privacy.measurementTitle')}</h2><p>{t('privacy.measurementTab')}</p><p className="mt-3">{t('privacy.measurementConsent')}</p></section>
        <section><h2 className={heading}>{t('privacy.sharingTitle')}</h2><p>{t('privacy.sharingBody')}</p></section>
        <section><h2 id="your-choices" tabIndex={-1} className={heading}>{t('privacy.choicesTitle')}</h2><p>{t('privacy.choicesRequests')}</p><p className="mt-3">{t('privacy.choicesMeasurement')}</p><AnalyticsChoice /></section>
        <section><h2 id="contact" tabIndex={-1} className={heading}>{t('contactTitle')}</h2><p>{t.rich('privacy.contact', { email, link: mail })}</p></section>
      </> : <>
        <section><h2 id="status" tabIndex={-1} className={heading}>{t('terms.statusTitle')}</h2><p>{t('terms.statusBody')}</p></section>
        <section><h2 id="booking" tabIndex={-1} className={heading}>{t('terms.bookingTitle')}</h2><p>{t('terms.bookingBody')}</p></section>
        <section><h2 id="changes" tabIndex={-1} className={heading}>{t('terms.changesTitle')}</h2><p>{t('terms.changesBody')}</p></section>
        <section><h2 id="contact" tabIndex={-1} className={heading}>{t('contactTitle')}</h2><p>{t.rich('terms.contact', { email, link: mail })}</p></section>
      </>}
    </div>
    <p className="mt-10"><Link className="underline" href={localizeHref('/', locale)}>{t('returnHome')}</Link></p>
  </article>;
}
