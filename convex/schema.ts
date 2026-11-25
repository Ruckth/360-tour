import { defineSchema } from 'convex/server';
import { authTables } from './auth/tables';
import { branchesTables } from './branches/tables';
import { catalogTables } from './catalog/tables';
import { bookingsTables } from './bookings/tables';
import { servicesTables } from './services/tables';
import { posTables } from './pos/tables';
import { commerceTables } from './commerce/tables';
import { conciergeTables } from './concierge/tables';
import { messagingTables } from './messaging/tables';
import { marketingTables } from './marketing/tables';
import { settingsTables } from './settings/tables';

// Table ownership follows the architecture plan. Function moves are separate Phase 3b PRs.
export default defineSchema({
	...authTables,
	...branchesTables,
	...catalogTables,
	...bookingsTables,
	...servicesTables,
	...posTables,
	...commerceTables,
	...conciergeTables,
	...messagingTables,
	...marketingTables,
	...settingsTables,
});
