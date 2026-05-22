import 'regenerator-runtime/runtime.js';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from 'pdf-lib';
import {
	getBookingDocumentMessages,
	normalizePublicLocale
} from '@/lib/i18n/public-content';
import type { Locale } from '@/i18n/routing';

export type BookingDocumentData = {
	resortName: string;
	resortAddress: string;
	resortEmail: string;
	resortPhone: string;
	propertyName: string;
	guestName: string;
	guestEmail: string;
	guestPhone: string;
	checkIn: string;
	checkOut: string;
	nights: number;
	guests: number;
	subtotal: number;
	discountAmount: number;
	total: number;
	currency: string;
	confirmationCode?: string;
	invoiceNumber?: string;
	receiptNumber?: string;
	paidAt?: number;
	createdAt?: number;
};

function money(amount: number, currency: string) {
	return `${currency} ${amount.toLocaleString()}`;
}

function formatDate(value: number | undefined, locale: string) {
	return new Intl.DateTimeFormat(locale, {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	}).format(value ? new Date(value) : new Date());
}

function getPdfDocumentLocale(locale: string) {
	const normalizedLocale = normalizePublicLocale(locale);
	// fontkit crashes on Devanagari mark positioning here; keep Hindi PDFs stable until the renderer can shape it.
	return normalizedLocale === 'hi' ? 'en' : normalizedLocale;
}

const unicodePdfFonts: Partial<Record<Locale, string>> = {
	ja: 'NotoSansCJKjp-Regular.otf',
	ko: 'NotoSansCJKkr-Regular.otf',
	ru: 'NotoSans-Regular.ttf',
	th: 'NotoSansThai-Regular.ttf',
	'zh-CN': 'NotoSansCJKsc-Regular.otf'
};

const fontBytesCache = new Map<string, Promise<Uint8Array>>();

async function loadPublicFontBytes(fileName: string) {
	const cached = fontBytesCache.get(fileName);
	if (cached) {
		return cached;
	}

	const promise = (async () => {
		if (typeof window !== 'undefined') {
			const response = await fetch(`/fonts/${fileName}`);
			if (!response.ok) {
				throw new Error(`Unable to load PDF font ${fileName}.`);
			}
			return new Uint8Array(await response.arrayBuffer());
		}

		const [{ readFile }, { join }] = await Promise.all([
			import('node:fs/promises'),
			import('node:path')
		]);
		return readFile(join(process.cwd(), 'public', 'fonts', fileName));
	})();

	fontBytesCache.set(fileName, promise);
	return promise;
}

type DocumentFonts = {
	regular: PDFFont;
	bold: PDFFont;
	latinRegular: PDFFont;
	latinBold: PDFFont;
	usesUnicodeFont: boolean;
};

async function embedDocumentFonts(pdf: PDFDocument, locale: Locale): Promise<DocumentFonts> {
	const latinRegular = await pdf.embedFont(StandardFonts.Helvetica);
	const latinBold = await pdf.embedFont(StandardFonts.HelveticaBold);
	const unicodeFont = unicodePdfFonts[locale];
	if (!unicodeFont) {
		return {
			regular: latinRegular,
			bold: latinBold,
			latinRegular,
			latinBold,
			usesUnicodeFont: false
		};
	}

	pdf.registerFontkit(fontkit);
	const fontBytes = await loadPublicFontBytes(unicodeFont);
	const regular = await pdf.embedFont(fontBytes, { subset: true });
	return {
		regular,
		bold: regular,
		latinRegular,
		latinBold,
		usesUnicodeFont: true
	};
}

function usesLatinPdfFont(char: string) {
	const code = char.codePointAt(0) ?? 0;
	return code <= 0x007f || (code >= 0x00a0 && code <= 0x00ff);
}

function textRuns(value: string) {
	const runs: Array<{ text: string; latin: boolean }> = [];

	for (const char of value) {
		const latin = usesLatinPdfFont(char);
		const previous = runs.at(-1);
		if (previous && previous.latin === latin) {
			previous.text += char;
		} else {
			runs.push({ text: char, latin });
		}
	}

	return runs;
}

function drawPdfText(
	page: PDFPage,
	fonts: DocumentFonts,
	value: string,
	options: {
		x: number;
		y: number;
		size: number;
		font: PDFFont;
		color: ReturnType<typeof rgb>;
	}
) {
	if (!fonts.usesUnicodeFont) {
		page.drawText(value, options);
		return;
	}

	const requestedBold = options.font === fonts.bold;
	let x = options.x;

	for (const run of textRuns(value)) {
		const font = run.latin
			? requestedBold
				? fonts.latinBold
				: fonts.latinRegular
			: options.font;
		page.drawText(run.text, { ...options, x, font });
		x += font.widthOfTextAtSize(run.text, options.size);
	}
}

async function createDocument(title: string, data: BookingDocumentData, locale = 'en') {
	const documentLocale = getPdfDocumentLocale(locale);
	const labels = getBookingDocumentMessages(documentLocale);
	const pdf = await PDFDocument.create();
	const page = pdf.addPage([595.28, 841.89]);
	const fonts = await embedDocumentFonts(pdf, documentLocale);
	const { regular, bold } = fonts;
	const navy = rgb(0.09, 0.11, 0.17);
	const muted = rgb(0.38, 0.4, 0.46);
	const gold = rgb(0.78, 0.55, 0.24);
	let y = 780;

	const text = (
		value: string,
		x: number,
		size = 10,
		font: PDFFont = regular,
		color = navy
	) => {
		drawPdfText(page, fonts, value, { x, y, size, font, color });
	};

	drawPdfText(page, fonts, data.resortName, { x: 48, y, size: 22, font: bold, color: navy });
	drawPdfText(page, fonts, title, { x: 420, y: y + 4, size: 18, font: bold, color: gold });
	y -= 26;
	drawPdfText(page, fonts, data.resortAddress, { x: 48, y, size: 9, font: regular, color: muted });
	y -= 14;
	drawPdfText(page, fonts, `${data.resortEmail} | ${data.resortPhone}`, {
		x: 48,
		y,
		size: 9,
		font: regular,
		color: muted
	});

	y -= 46;
	page.drawRectangle({
		x: 48,
		y: y - 78,
		width: 499,
		height: 92,
		borderColor: rgb(0.86, 0.86, 0.86),
		borderWidth: 1,
		color: rgb(0.98, 0.97, 0.94)
	});
	y -= 18;
	text(`${labels.guest}: ${data.guestName}`, 66, 11, bold);
	y -= 18;
	text(`${labels.email}: ${data.guestEmail}`, 66, 10, regular, muted);
	y -= 18;
	text(`${labels.phone}: ${data.guestPhone}`, 66, 10, regular, muted);
	y -= 18;
	text(`${labels.property}: ${data.propertyName}`, 66, 10, regular, muted);

	y -= 48;
	text(`${labels.stayDates}: ${data.checkIn} ${labels.to} ${data.checkOut}`, 48, 11, bold);
	y -= 18;
	text(`${data.nights} ${data.nights === 1 ? labels.night : labels.nights} · ${data.guests} ${data.guests === 1 ? labels.guestUnit : labels.guestUnits}`, 48, 10, regular, muted);

	y -= 40;
	const row = (label: string, value: string, strong = false) => {
		drawPdfText(page, fonts, label, {
			x: 48,
			y,
			size: strong ? 12 : 10,
			font: strong ? bold : regular,
			color: strong ? navy : muted
		});
		drawPdfText(page, fonts, value, {
			x: 430,
			y,
			size: strong ? 12 : 10,
			font: strong ? bold : regular,
			color: strong ? navy : muted
		});
		y -= strong ? 24 : 20;
	};

	row(`${data.propertyName} x ${data.nights} ${data.nights === 1 ? labels.night : labels.nights}`, money(data.subtotal, data.currency));
	row(labels.directBookingDiscount, `-${money(data.discountAmount, data.currency)}`);
	page.drawLine({ start: { x: 48, y: y + 6 }, end: { x: 547, y: y + 6 }, thickness: 1, color: rgb(0.86, 0.86, 0.86) });
	row(labels.total, money(data.total, data.currency), true);

	return { pdf, page, regular, bold, navy, muted, gold, y, labels, fonts };
}

export async function buildInvoicePdf(data: BookingDocumentData, locale = 'en') {
	const documentLocale = getPdfDocumentLocale(locale);
	const doc = await createDocument(getBookingDocumentMessages(documentLocale).invoice, data, documentLocale);
	let y = doc.y - 18;
	drawPdfText(doc.page, doc.fonts, `${doc.labels.invoiceNumber}: ${data.invoiceNumber ?? doc.labels.demoInvoice}`, {
		x: 48,
		y,
		size: 10,
		font: doc.bold,
		color: doc.navy
	});
	y -= 16;
	drawPdfText(doc.page, doc.fonts, `${doc.labels.issueDate}: ${formatDate(data.createdAt, documentLocale)}`, {
		x: 48,
		y,
		size: 10,
		font: doc.regular,
		color: doc.muted
	});
	y -= 34;
	drawPdfText(doc.page, doc.fonts, doc.labels.demoInvoiceNotice, {
		x: 48,
		y,
		size: 9,
		font: doc.regular,
		color: doc.muted
	});
	return doc.pdf.save();
}

export async function buildReceiptPdf(data: BookingDocumentData, locale = 'en') {
	const documentLocale = getPdfDocumentLocale(locale);
	const doc = await createDocument(getBookingDocumentMessages(documentLocale).receipt, data, documentLocale);
	let y = doc.y - 18;
	drawPdfText(doc.page, doc.fonts, `${doc.labels.receiptNumber}: ${data.receiptNumber ?? doc.labels.demoReceipt}`, {
		x: 48,
		y,
		size: 10,
		font: doc.bold,
		color: doc.navy
	});
	y -= 16;
	drawPdfText(doc.page, doc.fonts, `${doc.labels.confirmationCode}: ${data.confirmationCode ?? doc.labels.demoConfirmation}`, {
		x: 48,
		y,
		size: 10,
		font: doc.regular,
		color: doc.muted
	});
	y -= 16;
	drawPdfText(doc.page, doc.fonts, `${doc.labels.paidDate}: ${formatDate(data.paidAt, documentLocale)}`, {
		x: 48,
		y,
		size: 10,
		font: doc.regular,
		color: doc.muted
	});
	y -= 16;
	drawPdfText(doc.page, doc.fonts, doc.labels.paymentMethodDemo, {
		x: 48,
		y,
		size: 10,
		font: doc.regular,
		color: doc.muted
	});
	y -= 34;
	drawPdfText(doc.page, doc.fonts, doc.labels.paidNotice, {
		x: 48,
		y,
		size: 9,
		font: doc.regular,
		color: doc.muted
	});
	return doc.pdf.save();
}

export function downloadPdf(bytes: Uint8Array, filename: string) {
	const arrayBuffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(arrayBuffer).set(bytes);
	const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.append(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
