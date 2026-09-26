import type { ActionCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { api, internal } from '../_generated/api';
import { nightsBetween } from './dates';
import { calculateDirectQuote, maxSavings } from './pricing';
import type { ToolDef } from './chatLlm';

export const TOOLS: ToolDef[] = [
	{
		type: 'function',
		function: {
			name: 'list_services',
			description: 'List active resort services with descriptions, durations, prices, and available staff.',
			parameters: { type: 'object', properties: {} }
		}
	},
	{
		type: 'function',
		function: {
			name: 'check_service_availability',
			description: 'Find available local times for a service on a date, or check one local time and get alternatives.',
			parameters: {
				type: 'object',
				properties: {
					serviceSlug: { type: 'string', description: 'Service slug from list_services' },
					date: { type: 'string', description: 'Resort local date, YYYY-MM-DD' },
					time: { type: 'string', description: 'Optional resort local time, HH:mm' }
				},
				required: ['serviceSlug', 'date']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'check_availability',
			description:
				'Answer "is it free?" questions: whether one villa is available for specific dates, with the price. Not for making a booking (use prepare_booking for that when it is offered).',
			parameters: {
				type: 'object',
				properties: {
					propertySlug: {
						type: 'string',
						description: 'The property slug (pool-villa, garden-suite, or penthouse)'
					},
					checkIn: {
						type: 'string',
						description: 'Check-in date in YYYY-MM-DD format'
					},
					checkOut: {
						type: 'string',
						description: 'Check-out date in YYYY-MM-DD format'
					}
				},
				required: ['propertySlug', 'checkIn', 'checkOut']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'calculate_price',
			description:
				'Price a stay by number of nights when the guest asks what it costs (no dates needed). Includes the direct discount, plus OTA comparison prices only when the owner has entered them.',
			parameters: {
				type: 'object',
				properties: {
					propertySlug: {
						type: 'string',
						description: 'The property slug (pool-villa, garden-suite, or penthouse)'
					},
					nights: {
						type: 'number',
						description: 'Number of nights'
					},
					guests: {
						type: 'number',
						description: 'Number of guests'
					}
				},
				required: ['propertySlug', 'nights']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_property_details',
			description:
				'Full details for one villa (description, amenities, capacity, rooms, size) when the property list in the prompt is not enough.',
			parameters: {
				type: 'object',
				properties: {
					propertySlug: {
						type: 'string',
						description: 'The property slug (pool-villa, garden-suite, or penthouse)'
					}
				},
				required: ['propertySlug']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'list_properties',
			description: 'List all available properties with basic info and pricing.',
			parameters: {
				type: 'object',
				properties: {}
			}
		}
	}
];

/** Booking tools, only offered on messaging channels (web chat uses the booking card). */
export const BOOKING_TOOLS: ToolDef[] = [
	{
		type: 'function',
		function: {
			name: 'prepare_service_booking',
			description: 'Prepare a service booking for guest approval. Checks the local time and price; creates no appointment. Read back the result and ask for yes. An unknown staff preference is ignored and reported.',
			parameters: {
				type: 'object',
				properties: {
					serviceSlug: { type: 'string', description: 'Service slug from list_services' },
					date: { type: 'string', description: 'Resort local date, YYYY-MM-DD' },
					time: { type: 'string', description: 'Resort local time, HH:mm' },
					guestName: { type: 'string', description: 'Guest full name' },
					guestPhone: { type: 'string', description: 'Guest phone (ignored on WhatsApp)' },
					staffPreference: { type: 'string', description: 'Optional preferred staff first name' }
				},
				required: ['serviceSlug', 'date', 'time', 'guestName']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'confirm_service_booking',
			description: 'Create the prepared service appointment only after the guest agrees to its summary in a later message. Takes no arguments. Payment is at the resort.',
			parameters: { type: 'object', properties: {} }
		}
	},
	{
		type: 'function',
		function: {
			name: 'prepare_booking',
			description:
				'Start a booking as soon as the guest wants to book and you know villa, check-in, check-out, guests and their name. Checks availability, capacity and price itself and holds the stay for the guest to approve; it does not create the booking yet. Read the returned summary (villa, dates, guests, total) back and ask the guest to reply "yes". Call again if they change details.',
			parameters: {
				type: 'object',
				properties: {
					propertySlug: { type: 'string', description: 'Villa slug: pool-villa, garden-suite, or penthouse' },
					checkIn: { type: 'string', description: 'Check-in date in YYYY-MM-DD format' },
					checkOut: { type: 'string', description: 'Check-out date in YYYY-MM-DD format' },
					guests: { type: 'number', description: 'Number of guests' },
					guestName: { type: 'string', description: 'Full name of the guest' },
					guestPhone: {
						type: 'string',
						description: 'Guest phone number as they typed it (ignored on WhatsApp)'
					}
				},
				required: ['propertySlug', 'checkIn', 'checkOut', 'guests', 'guestName']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'confirm_booking',
			description:
				'Create the booking held by prepare_booking, once the guest agrees to its summary in a later message (yes, ok, confirm, ใช่, ยืนยัน…). Returns the confirmation code and paymentUrl to share. Takes no arguments.',
			parameters: { type: 'object', properties: {} }
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_my_bookings',
			description:
				"List this guest's villa bookings and upcoming service appointments, with references, dates, status, and villa payment links where applicable. Takes no arguments.",
			parameters: { type: 'object', properties: {} }
		}
	},
	{
		type: 'function',
		function: {
			name: 'cancel_booking',
			description:
				'Cancel one of the guest\'s eligible villa bookings or future booked service appointments (SVC- reference). The first call returns needs_confirmation: read the booking back and ask for "yes". Call again with the same reference after they confirm.',
			parameters: {
				type: 'object',
				properties: {
					reference: { type: 'string', description: 'Reference from get_my_bookings, e.g. CONF-2026-ABC123 or SVC-2026-ABC123' }
				},
				required: ['reference']
			}
		}
	}
];

type ToolArgs = Record<string, unknown>;

export type ToolContext = {
	sessionId: Id<'chatSessions'>;
	siteUrl?: string;
	/** When the current AI turn started; lets two-step tools require a guest reply in between. */
	turnStartedAt: number;
};

function paymentUrl(toolContext: ToolContext, bookingId: string, accessToken: string) {
	const base = toolContext.siteUrl?.replace(/\/+$/, '') ?? '';
	return `${base}/booking/pay?bookingId=${bookingId}&token=${accessToken}`;
}

function findProperty(properties: Doc<'properties'>[], slug: unknown): Doc<'properties'> | null {
	if (typeof slug !== 'string') return null;
	return properties.find((p) => p.slug === slug) ?? null;
}

/** Owner-entered OTA rates only (same source as the villa-page widget); empty when none are entered. */
async function ownerOtaQuotes(ctx: ActionCtx, slug: string, nights: number) {
	const comparison = await ctx.runQuery(api.properties.getOtaComparison, { slug });
	return (comparison?.rates ?? []).map(({ platform, nightlyRate }) => ({
		platform,
		nightlyRate,
		total: nightlyRate * nights
	}));
}

export async function executeTool(
	ctx: ActionCtx,
	fnName: string,
	fnArgs: ToolArgs,
	properties: Doc<'properties'>[],
	toolContext: ToolContext
): Promise<string> {
	switch (fnName) {
		case 'list_services':
			return JSON.stringify({ services: await ctx.runQuery(internal.serviceBookings.listActiveServices, {}) });

		case 'check_service_availability':
			return JSON.stringify(await ctx.runQuery(internal.serviceBookings.checkServiceAvailability, {
				serviceSlug: String(fnArgs.serviceSlug ?? ''), date: String(fnArgs.date ?? ''),
				...(typeof fnArgs.time === 'string' ? { time: fnArgs.time } : {})
			}));

		case 'prepare_service_booking': {
			const summary = await ctx.runMutation(internal.serviceBookings.prepareChatServiceBooking, {
				sessionId: toolContext.sessionId,
				serviceSlug: String(fnArgs.serviceSlug ?? ''), date: String(fnArgs.date ?? ''),
				time: String(fnArgs.time ?? ''), guestName: String(fnArgs.guestName ?? ''),
				...(typeof fnArgs.guestPhone === 'string' ? { guestPhone: fnArgs.guestPhone } : {}),
				...(typeof fnArgs.staffPreference === 'string' ? { staffPreference: fnArgs.staffPreference } : {})
			});
			return JSON.stringify('error' in summary ? summary : { ...summary, next: 'Ask the guest to reply "yes" to confirm.' });
		}

		case 'confirm_service_booking':
			return JSON.stringify(await ctx.runMutation(internal.serviceBookings.confirmChatServiceBooking, {
				sessionId: toolContext.sessionId
			}));

		case 'check_availability': {
			const property = findProperty(properties, fnArgs.propertySlug);
			if (!property) return JSON.stringify({ error: 'Property not found' });

			const checkIn = String(fnArgs.checkIn);
			const checkOut = String(fnArgs.checkOut);

			const available = await ctx.runQuery(api.availability.isAvailable, {
				propertyId: property._id,
				checkIn,
				checkOut
			});

			const nights = nightsBetween(checkIn, checkOut);
			const quote = calculateDirectQuote(property, nights);
			const ota = await ownerOtaQuotes(ctx, property.slug, nights);

			return JSON.stringify({
				property: property.name,
				checkIn,
				checkOut,
				nights,
				available,
				pricePerNight: property.pricePerNight,
				directPrice: Math.round(quote.directTotal / Math.max(nights, 1)),
				totalDirect: quote.directTotal,
				...(ota.length > 0 ? { totalOTA: Math.max(...ota.map((o) => o.total)) } : {}),
				currency: property.currency
			});
		}

		case 'calculate_price': {
			const property = findProperty(properties, fnArgs.propertySlug);
			if (!property) return JSON.stringify({ error: 'Property not found' });

			const nights = typeof fnArgs.nights === 'number' && fnArgs.nights > 0 ? fnArgs.nights : 1;
			const quote = calculateDirectQuote(property, nights);
			const otaComparison = await ownerOtaQuotes(ctx, property.slug, nights);

			return JSON.stringify({
				property: property.name,
				nights,
				guests: fnArgs.guests ?? 'any',
				maxGuests: property.maxGuests,
				pricePerNight: property.pricePerNight,
				listedTotal: quote.subtotal,
				discountPercent: quote.discountPercent,
				discountAmount: quote.discountAmount,
				directTotal: quote.directTotal,
				...(otaComparison.length > 0
					? { otaComparison, maxSavings: maxSavings(quote.directTotal, otaComparison.map((o) => o.total)) }
					: {}),
				currency: property.currency
			});
		}

		case 'get_property_details': {
			const property = findProperty(properties, fnArgs.propertySlug);
			if (!property) return JSON.stringify({ error: 'Property not found' });

			const oneNightQuote = calculateDirectQuote(property, 1);

			return JSON.stringify({
				name: property.name,
				slug: property.slug,
				tagline: property.tagline,
				description: property.description,
				pricePerNight: property.pricePerNight,
				directPrice: oneNightQuote.directTotal,
				currency: property.currency,
				maxGuests: property.maxGuests,
				bedrooms: property.bedrooms,
				bathrooms: property.bathrooms,
				area: property.area,
				amenities: property.amenities,
				has360Tour: true
			});
		}

		case 'list_properties': {
			const list = properties.map((p) => {
				const oneNightQuote = calculateDirectQuote(p, 1);
				return {
					name: p.name,
					slug: p.slug,
					tagline: p.tagline,
					pricePerNight: p.pricePerNight,
					directPrice: oneNightQuote.directTotal,
					maxGuests: p.maxGuests,
					bedrooms: p.bedrooms
				};
			});
			return JSON.stringify({ properties: list, currency: properties[0]?.currency ?? 'THB' });
		}

		case 'prepare_booking': {
			const summary = await ctx.runMutation(internal.bookings.prepareChatBooking, {
				sessionId: toolContext.sessionId,
				propertySlug: String(fnArgs.propertySlug ?? ''),
				checkIn: String(fnArgs.checkIn ?? ''),
				checkOut: String(fnArgs.checkOut ?? ''),
				guests: Number(fnArgs.guests),
				guestName: String(fnArgs.guestName ?? ''),
				...(typeof fnArgs.guestPhone === 'string' ? { guestPhone: fnArgs.guestPhone } : {})
			});
			return JSON.stringify({ ...summary, next: 'Ask the guest to reply "yes" to confirm.' });
		}

		case 'confirm_booking': {
			const booking = await ctx.runMutation(internal.bookings.confirmChatBooking, {
				sessionId: toolContext.sessionId
			});
			return JSON.stringify({
				confirmationCode: booking.confirmationCode,
				status: 'pending_payment',
				total: booking.total,
				currency: booking.currency,
				paymentUrl: paymentUrl(toolContext, booking.bookingId, booking.accessToken),
				alreadyConfirmed: booking.alreadyConfirmed
			});
		}

		case 'get_my_bookings': {
			const bookings = await ctx.runQuery(internal.bookings.listChatGuestBookings, {
				sessionId: toolContext.sessionId
			});
			const services = await ctx.runQuery(internal.serviceBookings.listChatGuestServiceBookings, {
				sessionId: toolContext.sessionId
			});
			return JSON.stringify({
				bookings: bookings.map(({ bookingId, accessToken, ...booking }) => ({
					...booking,
					...(accessToken ? { paymentUrl: paymentUrl(toolContext, bookingId, accessToken) } : {})
				})),
				services
			});
		}

		case 'cancel_booking': {
			const reference = String(fnArgs.reference ?? '');
			const result = await ctx.runMutation(reference.trim().toUpperCase().startsWith('SVC-')
				? internal.serviceBookings.cancelChatServiceBooking : internal.bookings.cancelChatBooking, {
				sessionId: toolContext.sessionId,
				reference,
				turnStartedAt: toolContext.turnStartedAt
			});
			return JSON.stringify(
				result.state === 'needs_confirmation'
					? { ...result, next: 'Ask the guest to reply "yes" to cancel this booking.' }
					: result
			);
		}

		default:
			return JSON.stringify({ error: `Unknown function: ${fnName}` });
	}
}
