"use node";
import { action } from './_generated/server';
import { v } from 'convex/values';
import { api } from './_generated/api';
import Stripe from 'stripe';

export const createCheckoutSession = action({
	args: {
		bookingId: v.id('bookings'),
		successUrl: v.string(),
		cancelUrl: v.string()
	},
	handler: async (ctx, args) => {
		const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
		if (!stripeSecretKey) {
			throw new Error('STRIPE_SECRET_KEY is not configured');
		}

		const booking = await ctx.runQuery(api.bookings.getById, { id: args.bookingId });
		if (!booking) {
			throw new Error('Booking not found');
		}
		const property = await ctx.runQuery(api.properties.getById, { id: booking.propertyId });
		if (!property) {
			throw new Error('Property not found');
		}

		const stripe = new Stripe(stripeSecretKey);

		const session = await stripe.checkout.sessions.create({
			payment_method_types: ['card'],
			line_items: [
				{
					price_data: {
						currency: booking.currency.toLowerCase(),
						product_data: {
							name: `${property.name} — ${booking.nights} night${booking.nights > 1 ? 's' : ''}`,
							description: `Direct booking`
						},
						unit_amount: Math.round(booking.total * 100) // Stripe uses smallest currency unit
					},
					quantity: 1
				}
			],
			mode: 'payment',
			success_url: `${args.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
			cancel_url: args.cancelUrl,
			customer_email: booking.guestEmail,
			metadata: {
				bookingId: args.bookingId
			}
		});

		// Store the Stripe session ID on the booking
		await ctx.runMutation(api.bookings.updatePaymentStatus, {
			bookingId: args.bookingId,
			paymentStatus: 'pending',
			stripeSessionId: session.id
		});

		return { sessionId: session.id, url: session.url };
	}
});

export const handleWebhook = action({
	args: {
		stripeSessionId: v.string()
	},
	handler: async (ctx, args) => {
		const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
		if (!stripeSecretKey) {
			throw new Error('STRIPE_SECRET_KEY is not configured');
		}

		const stripe = new Stripe(stripeSecretKey);

		const session = await stripe.checkout.sessions.retrieve(args.stripeSessionId);

		if (session.payment_status === 'paid') {
			const bookingId = session.metadata?.bookingId;
			if (bookingId) {
				await ctx.runMutation(api.bookings.updatePaymentStatus, {
					bookingId: bookingId as any,
					paymentStatus: 'paid',
					stripePaymentIntentId:
						typeof session.payment_intent === 'string'
							? session.payment_intent
							: session.payment_intent?.id,
					stripeSessionId: session.id
				});
			}
		}

		return { status: session.payment_status };
	}
});
