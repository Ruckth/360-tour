import type { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

export type LivePropertyRow = FunctionReturnType<
  typeof api.catalog.properties.list
>[number];
export type PublicBooking = NonNullable<
  FunctionReturnType<typeof api.bookings.bookings.getById>
>;
