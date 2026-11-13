import { v } from 'convex/values';

// Published no-login response contracts. Fields are selected by each owning endpoint.
export const settingsPublicProfileResult = v.object({
"businessName": v.string(),
"tagline": v.string(),
"contactEmail": v.string(),
"contactPhone": v.string(),
"whatsapp": v.string(),
"lineId": v.string(),
"lineUrl": v.string(),
"address": v.string(),
"currency": v.string(),
"timezone": v.string(),
"checkInTime": v.string(),
"checkOutTime": v.string(),
"bookingRules": v.object({
"unpaidHoldMinutes": v.number(),
"chatQuoteValidityMinutes": v.number(),
"preArrivalDaysBefore": v.number(),
"reviewDaysAfter": v.number(),
"minNights": v.number(),
"maxAdvanceDays": v.number(),
"sameDayCutoff": v.string(),
}),
});
