import type { FunctionReturnType } from 'convex/server';
import type { api } from 'convex/_generated/api';

export type AdminBooking = FunctionReturnType<typeof api.bookings.admin.listForAdmin>['bookings'][number];
