import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

export const create = mutation({
	args: {
		propertySlug: v.string(),
		guestName: v.string(),
		guestEmail: v.string(),
		guestPhone: v.string(),
		checkIn: v.string(),
		checkOut: v.string(),
		guests: v.number()
	},
	handler: async (ctx, args) => {
		const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
		const utcMidnightMs = (s: string) => {
			const [y, m, d] = s.split('-').map((n) => Number(n));
			return Date.UTC(y, m - 1, d);
		};

		if (!isIsoDate(args.checkIn) || !isIsoDate(args.checkOut)) {
			throw new Error('Dates must be in YYYY-MM-DD format');
		}

		if (!Number.isInteger(args.guests) || args.guests < 1) {
			throw new Error('Guest count must be at least 1');
		}

		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.guestEmail.trim())) {
			throw new Error('Please enter a valid email address');
		}

		const property = await ctx.db
			.query('properties')
			.withIndex('by_slug', (q) => q.eq('slug', args.propertySlug))
			.first();
		if (!property) {
			throw new Error('Property not found');
		}

		if (args.guests > property.maxGuests) {
			throw new Error(`Guest count exceeds max capacity (${property.maxGuests})`);
		}

		// Validate dates aren't in the past
		const today = new Date().toISOString().split('T')[0];
		if (args.checkIn < today) {
			throw new Error('Check-in date cannot be in the past');
		}
		if (args.checkOut <= args.checkIn) {
			throw new Error('Check-out must be after check-in');
		}

		const nights = Math.floor((utcMidnightMs(args.checkOut) - utcMidnightMs(args.checkIn)) / 86400000);
		if (!Number.isFinite(nights) || nights <= 0) {
			throw new Error('Check-out must be after check-in');
		}

		const subtotal = property.pricePerNight * nights;
		const discountAmount = Math.round(subtotal * (property.directDiscountPercent / 100));
		const total = subtotal - discountAmount;

		// Check availability (no overlapping bookings)
		const existingBookings = await ctx.db
			.query('bookings')
			.withIndex('by_property', (q) => q.eq('propertyId', property._id))
			.filter((q) =>
				q.and(
					q.neq(q.field('status'), 'cancelled'),
					q.lt(q.field('checkIn'), args.checkOut),
					q.gt(q.field('checkOut'), args.checkIn)
				)
			)
			.collect();

		if (existingBookings.length > 0) {
			throw new Error('These dates are no longer available. Please choose different dates.');
		}

		// Check availability table for blocked dates from iCal sync
		const blockedDates = await ctx.db
			.query('availability')
			.withIndex('by_property', (q) => q.eq('propertyId', property._id))
			.filter((q) =>
				q.and(
					q.neq(q.field('status'), 'available'),
					q.gte(q.field('date'), args.checkIn),
					q.lt(q.field('date'), args.checkOut)
				)
			)
			.collect();

		if (blockedDates.length > 0) {
			throw new Error('Some of these dates are blocked. Please choose different dates.');
		}

		const bookingId = await ctx.db.insert('bookings', {
			propertyId: property._id,
			tenantId: property.tenantId,
			guestName: args.guestName,
			guestEmail: args.guestEmail,
			guestPhone: args.guestPhone,
			checkIn: args.checkIn,
			checkOut: args.checkOut,
			guests: args.guests,
			nights,
			subtotal,
			discountAmount,
			total,
			currency: property.currency,
			paymentStatus: 'pending',
			status: 'pending',
			createdAt: Date.now()
		});

		return bookingId;
	}
});

export const updatePaymentStatus = mutation({
	args: {
		bookingId: v.id('bookings'),
		paymentStatus: v.union(
			v.literal('pending'),
			v.literal('paid'),
			v.literal('failed'),
			v.literal('refunded')
		),
		stripePaymentIntentId: v.optional(v.string()),
		stripeSessionId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const update: Record<string, unknown> = {
			paymentStatus: args.paymentStatus
		};
		if (args.stripePaymentIntentId) {
			update.stripePaymentIntentId = args.stripePaymentIntentId;
		}
		if (args.stripeSessionId) {
			update.stripeSessionId = args.stripeSessionId;
		}
		if (args.paymentStatus === 'paid') {
			update.status = 'confirmed';
		}
		await ctx.db.patch(args.bookingId, update);
	}
});

export const getByStripeSession = query({
	args: { stripeSessionId: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('bookings')
			.withIndex('by_stripe_session', (q) => q.eq('stripeSessionId', args.stripeSessionId))
			.first();
	}
});

export const getById = query({
	args: { id: v.id('bookings') },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.id);
	}
});

export const listByProperty = query({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('bookings')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.collect();
	}
});
