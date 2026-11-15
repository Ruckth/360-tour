import { v } from 'convex/values';

export const usersFields = {
		clerkId: v.string(),
		tokenIdentifier: v.string(),
		email: v.string(),
		name: v.optional(v.string()),
		imageUrl: v.optional(v.string())
	};

// Published no-login response contracts. Fields are selected by each owning endpoint.
export const staffAccessMyAccessResult = v.object({
"capabilities": v.object({
"marketing": v.boolean(),
"checkout": v.boolean(),
"approve": v.boolean(),
"operations": v.boolean(),
"manageTeam": v.boolean(),
"settings": v.boolean(),
"bookings": v.boolean(),
"services": v.boolean(),
"customers": v.boolean(),
"orders": v.boolean(),
"chats": v.boolean(),
"properties": v.boolean(),
"roster": v.boolean(),
"reports": v.boolean(),
}),
"cashierRules": v.object({
"refund": v.union(v.literal("manager"), v.literal("cashier")),
"customPrice": v.union(v.literal("manager"), v.literal("cashier")),
"voidPaidSale": v.union(v.literal("manager"), v.literal("cashier")),
"paymentFix": v.union(v.literal("manager"), v.literal("cashier")),
"discountLimitPercent": v.number(),
"revision": v.number(),
}),
"marketingRole": v.union(v.null(), v.literal("manager"), v.literal("admin"), v.literal("marketer"), v.literal("finance"), v.literal("viewer")),
"email": v.union(v.null(), v.string()),
"role": v.union(v.null(), v.literal("manager"), v.literal("cashier"), v.literal("owner")),
"pendingInvitation": v.union(v.null(), v.object({
"role": v.union(v.literal("manager"), v.literal("cashier")),
"expiresAt": v.number(),
})),
});

export const usersCurrentResult = v.union(v.null(), v.object({ ...usersFields, _id: v.id('users'), _creationTime: v.number() }));
