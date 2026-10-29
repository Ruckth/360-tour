import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireAdmin } from './lib/adminAuth';
import { orderTitle } from './lib/billMath';
import { orderState } from './lib/orderLinks';
import { assertValidEmail } from './lib/validation';

/**
 * Reusable customer profiles for orders (admin only). An order links to a customer by id;
 * customers are never created, matched or merged from a name, so namesakes stay distinct and a
 * booking's guest is not assumed to be the payer.
 */

const SEARCH_LIMIT = 20;
const NAME_MAX = 120;
const PHONE_MAX = 40;
const EMAIL_MAX = 200;
const NOTES_MAX = 1000;

const customerInput = {
	name: v.string(),
	phone: v.optional(v.string()),
	email: v.optional(v.string()),
	notes: v.optional(v.string())
};

function text(value: string | undefined, label: string, max: number) {
	const trimmed = value?.trim();
	if (trimmed && trimmed.length > max) throw new Error(`${label} must be at most ${max} characters`);
	return trimmed || undefined;
}

/** Trims and validates a profile, with its exact-lookup fields. */
export function cleanCustomer(input: { name: string; phone?: string; email?: string; notes?: string }) {
	const name = text(input.name, 'Name', NAME_MAX);
	if (!name) throw new Error('Enter the customer name');
	const phone = text(input.phone, 'Phone', PHONE_MAX);
	const email = text(input.email, 'Email', EMAIL_MAX);
	if (email) assertValidEmail(email);
	return {
		name,
		phone,
		phoneDigits: phone?.replace(/\D/g, '') || undefined,
		email,
		emailNormalized: email?.toLowerCase(),
		notes: text(input.notes, 'Notes', NOTES_MAX)
	};
}

export function customerCard(customer: Doc<'customers'>) {
	return { _id: customer._id, name: customer.name, phone: customer.phone, email: customer.email };
}

/** By exact phone (digits) or email, and by name words. Same-name results are listed separately. */
export const searchCustomers = query({
	args: { query: v.string() },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const raw = args.query.trim();
		if (raw.length < 2) return [];
		const digits = raw.replace(/\D/g, '');
		const email = raw.toLowerCase();
		const [byPhone, byEmail, byName] = await Promise.all([
			digits.length >= 4 ? ctx.db.query('customers').withIndex('by_phoneDigits', (q) => q.eq('phoneDigits', digits)).take(SEARCH_LIMIT) : [],
			email.includes('@') ? ctx.db.query('customers').withIndex('by_emailNormalized', (q) => q.eq('emailNormalized', email)).take(SEARCH_LIMIT) : [],
			ctx.db.query('customers').withSearchIndex('search_name', (q) => q.search('name', raw)).take(SEARCH_LIMIT)
		]);
		const found = new Map<Id<'customers'>, Doc<'customers'>>();
		for (const customer of [...byPhone, ...byEmail, ...byName]) found.set(customer._id, customer);
		return [...found.values()].slice(0, SEARCH_LIMIT).map(customerCard);
	}
});

/** A profile with its most recent orders. */
export const getCustomer = query({
	args: { customerId: v.id('customers') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const customer = await ctx.db.get(args.customerId);
		if (!customer) return null;
		const orders = await ctx.db
			.query('bills')
			.withIndex('by_customerId_and_updatedAt', (q) => q.eq('customerId', customer._id))
			.order('desc')
			.take(10);
		return {
			...customerCard(customer),
			notes: customer.notes,
			orders: orders.map((order) => ({
				_id: order._id,
				title: orderTitle(order.orderNumber),
				state: orderState(order),
				total: order.total,
				currency: order.currency,
				updatedAt: order.updatedAt
			}))
		};
	}
});

export const createCustomer = mutation({
	args: customerInput,
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const now = Date.now();
		return await ctx.db.insert('customers', { ...cleanCustomer(args), createdBy: admin.email, createdAt: now, updatedAt: now });
	}
});

const MAX_OPEN_ORDERS = 100;

/**
 * Edits the profile. Paid receipts keep the details they were issued with (bills.customerSnapshot).
 * The customer's open orders are marked changed, so a payment reviewed with the old name or
 * contact details has to be reviewed again before the receipt is issued.
 */
export const updateCustomer = mutation({
	args: { customerId: v.id('customers'), ...customerInput },
	handler: async (ctx, { customerId, ...input }) => {
		await requireAdmin(ctx);
		const customer = await ctx.db.get(customerId);
		if (!customer) throw new Error('Customer not found');
		const next = cleanCustomer(input);
		const now = Date.now();
		await ctx.db.patch(customerId, { ...next, updatedAt: now });
		if (next.name === customer.name && next.phone === customer.phone && next.email === customer.email) return;
		for (const status of ['draft', 'held'] as const) {
			const open = await ctx.db
				.query('bills')
				.withIndex('by_customerId_and_status', (q) => q.eq('customerId', customerId).eq('status', status))
				.take(MAX_OPEN_ORDERS + 1);
			if (open.length > MAX_OPEN_ORDERS) throw new Error(`This customer has more than ${MAX_OPEN_ORDERS} unpaid orders. Settle or clear some first.`);
			for (const order of open) await ctx.db.patch(order._id, { revision: order.revision + 1, updatedAt: now });
		}
	}
});
