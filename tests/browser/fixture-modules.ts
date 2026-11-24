// Browser-only assertions import these real application functions in the page's timezone and realm.
export { nightsBetweenIso } from "convex/shared/dates";
export { resortDateTime, resortTodayIso } from "convex/shared/time";
export { dateToIso, isoToDate } from "@/lib/dates/values";
export { browserCaptureDeps } from "@/lib/tour/first-panorama-cache";
