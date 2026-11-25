import { v } from 'convex/values';

export const serviceOption = v.object({ durationMin: v.number(), price: v.number() });
export const serviceOptionArgs = {
  durationMin: v.optional(v.number()),
  price: v.optional(v.number()),
  options: v.optional(v.array(serviceOption)),
  defaultDurationMin: v.optional(v.number()),
};

export const publicServiceFields = {
"imageUrl": v.optional(v.string()),
"slug": v.string(),
"name": v.string(),
"description": v.string(),
"category": v.string(),
"durationMin": v.number(),
"price": v.number(),
"options": v.array(serviceOption),
"currency": v.string(),
};
const publicService = v.object(publicServiceFields);

// Published no-login response contracts. Fields are selected by each owning endpoint.
export const publicServicesCategoriesResult = v.object({
"categories": v.array(v.object({
"name": v.string(),
"imageUrl": v.optional(v.string()),
})),
"nextCategory": v.union(v.null(), v.string()),
});

export const publicServicesListResult = v.object({
"page": v.array(publicService),
"isDone": v.boolean(),
"continueCursor": v.string(),
"splitCursor": v.optional(v.union(v.null(), v.string())),
"pageStatus": v.optional(v.union(v.null(), v.literal("SplitRecommended"), v.literal("SplitRequired"))),
});

export const publicServicesGetBySlugResult = v.union(v.null(), publicService);
