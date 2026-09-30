import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

/**
 * Built-in values used until an admin saves Settings. Business values mirror
 * `src/lib/data/resort-config.ts` (Convex can't import from `src`).
 */
export const SITE_DEFAULTS = {
	businessName: 'Auralis Cove Retreat',
	tagline: 'Where the ocean meets serenity',
	contactEmail: 'rugbykritsakorn@gmail.com',
	contactPhone: '+66 95 682 3432',
	whatsapp: '+66956823432',
	lineId: '@361jhvij',
	lineUrl: 'https://line.me/R/ti/p/@361jhvij',
	address: '88/8 Moo 3, Bophut, Koh Samui, Surat Thani 84320',
	currency: 'THB',
	timezone: 'Asia/Bangkok',
	checkInTime: '14:00',
	checkOutTime: '11:00',
	cancellationPolicy: 'Free cancellation up to 48 hours before check-in.',
	ai: { tone: 'warm, concise, and helpful', extraInstructions: '', maxWords: 150 },
	email: { fromName: '', ownerNotificationEmail: '', footer: 'Spin & Stay — Spin around every room. Then book your stay.' }
};

export const BUSINESS_FIELDS = [
	'businessName',
	'tagline',
	'contactEmail',
	'contactPhone',
	'whatsapp',
	'lineId',
	'lineUrl',
	'address',
	'currency',
	'timezone',
	'checkInTime',
	'checkOutTime',
	'cancellationPolicy'
] as const;

export type BusinessField = (typeof BUSINESS_FIELDS)[number];
export type BusinessSettings = Record<BusinessField, string>;
export type AiSettings = { tone: string; extraInstructions: string; maxWords: number };
export type EmailSettings = { fromName: string; ownerNotificationEmail: string; footer: string };
export type EffectiveSettings = BusinessSettings & {
	ai: AiSettings;
	email: EmailSettings;
	updatedAt: number | null;
	updatedByEmail: string | null;
};

/** Saved values merged over the defaults. Blank email fields mean "use the fallback" (business name, env). */
export function mergeSiteSettings(row: Doc<'siteSettings'> | null): EffectiveSettings {
	const business = {} as BusinessSettings;
	for (const field of BUSINESS_FIELDS) business[field] = row?.[field] ?? SITE_DEFAULTS[field];
	return {
		...business,
		ai: {
			tone: row?.ai?.tone || SITE_DEFAULTS.ai.tone,
			extraInstructions: row?.ai?.extraInstructions ?? SITE_DEFAULTS.ai.extraInstructions,
			maxWords: row?.ai?.maxWords ?? SITE_DEFAULTS.ai.maxWords
		},
		email: {
			fromName: row?.email?.fromName ?? SITE_DEFAULTS.email.fromName,
			ownerNotificationEmail: row?.email?.ownerNotificationEmail ?? SITE_DEFAULTS.email.ownerNotificationEmail,
			footer: row?.email?.footer ?? SITE_DEFAULTS.email.footer
		},
		updatedAt: row?.updatedAt ?? null,
		updatedByEmail: row?.updatedByEmail ?? null
	};
}

export async function getSiteSettingsRow(ctx: QueryCtx) {
	return await ctx.db
		.query('siteSettings')
		.withIndex('by_key', (q) => q.eq('key', 'default'))
		.unique();
}

export async function getEffectiveSettings(ctx: QueryCtx): Promise<EffectiveSettings> {
	return mergeSiteSettings(await getSiteSettingsRow(ctx));
}

// Validation is shared with the admin form so errors show inline before saving.

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

type Rule = { label: string; max: number; required?: boolean; check?: (value: string) => string | null };

const email = (value: string) => (EMAIL.test(value) ? null : 'Enter a valid email address.');
const time = (value: string) => (TIME.test(value) ? null : 'Use 24-hour HH:mm, e.g. 14:00.');

function timezone(value: string) {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: value });
		return null;
	} catch {
		return 'Use an IANA time zone, e.g. Asia/Bangkok.';
	}
}

const BUSINESS_RULES: Record<BusinessField, Rule> = {
	businessName: { label: 'Business name', max: 100, required: true },
	tagline: { label: 'Tagline', max: 200 },
	contactEmail: { label: 'Contact email', max: 200, check: email },
	contactPhone: { label: 'Contact phone', max: 40 },
	whatsapp: { label: 'WhatsApp', max: 40 },
	lineId: { label: 'LINE ID', max: 60 },
	lineUrl: {
		label: 'LINE URL',
		max: 300,
		check: (value) => (/^https:\/\/\S+$/.test(value) ? null : 'Use a full https:// link.')
	},
	address: { label: 'Address', max: 300 },
	currency: {
		label: 'Currency',
		max: 10,
		required: true,
		check: (value) => (/^[A-Z]{3}$/.test(value) ? null : 'Use a 3-letter code, e.g. THB.')
	},
	timezone: { label: 'Time zone', max: 60, required: true, check: timezone },
	checkInTime: { label: 'Check-in time', max: 5, required: true, check: time },
	checkOutTime: { label: 'Check-out time', max: 5, required: true, check: time },
	cancellationPolicy: { label: 'Cancellation policy', max: 1000 }
};

const AI_RULES: Record<'tone' | 'extraInstructions', Rule> = {
	tone: { label: 'Tone', max: 200 },
	extraInstructions: { label: 'Extra instructions', max: 2000 }
};

const EMAIL_RULES: Record<keyof EmailSettings, Rule> = {
	fromName: {
		label: 'Sender name',
		max: 100,
		check: (value) => (/[<>"\r\n]/.test(value) ? 'Remove < > " and line breaks.' : null)
	},
	ownerNotificationEmail: { label: 'Owner notification email', max: 200, check: email },
	footer: { label: 'Footer', max: 500 }
};

export const MAX_WORDS_RANGE = { min: 30, max: 400 };

export type SettingsErrors = Record<string, string>;

function cleanText<K extends string>(
	input: Partial<Record<K, string>>,
	rules: Record<K, Rule>,
	prefix: string,
	errors: SettingsErrors
) {
	const values: Partial<Record<K, string>> = {};
	for (const key of Object.keys(input) as K[]) {
		const raw = input[key];
		if (raw === undefined) continue;
		const rule = rules[key];
		if (!rule) continue;
		const value = key === 'currency' ? raw.trim().toUpperCase() : raw.trim();
		const error =
			!value && rule.required
				? `${rule.label} is required.`
				: value.length > rule.max
					? `${rule.label} must be ${rule.max} characters or fewer.`
					: value && rule.check
						? rule.check(value)
						: null;
		if (error) errors[`${prefix}${key}`] = error;
		values[key] = value;
	}
	return values;
}

export type SettingsInput = {
	business?: Partial<BusinessSettings>;
	ai?: Partial<AiSettings>;
	email?: Partial<EmailSettings>;
};

/** Trims and checks every provided field. Error keys are `field`, `ai.field` or `email.field`. */
export function validateSettingsInput(input: SettingsInput) {
	const errors: SettingsErrors = {};
	const business = input.business ? cleanText(input.business, BUSINESS_RULES, '', errors) : undefined;
	let ai: Partial<AiSettings> | undefined;
	if (input.ai) {
		const { maxWords, ...text } = input.ai;
		ai = cleanText(text, AI_RULES, 'ai.', errors);
		if (maxWords !== undefined) {
			if (!Number.isInteger(maxWords) || maxWords < MAX_WORDS_RANGE.min || maxWords > MAX_WORDS_RANGE.max) {
				errors['ai.maxWords'] = `Max words must be a whole number from ${MAX_WORDS_RANGE.min} to ${MAX_WORDS_RANGE.max}.`;
			}
			ai.maxWords = maxWords;
		}
	}
	const emailValues = input.email ? cleanText(input.email, EMAIL_RULES, 'email.', errors) : undefined;
	return { business, ai, email: emailValues, errors };
}
