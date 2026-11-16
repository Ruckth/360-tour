import { staffQuery } from '../auth/model';
import { catalogItems, catalogRanking } from './private/orderModel';

export const stableCatalog = staffQuery({
  capability: 'checkout',
	args: {},
	handler: async (ctx) => {
		return catalogItems(ctx);
	}
});

export const recentCatalogRanking = staffQuery({
  capability: 'checkout',
	args: {},
	handler: async (ctx) => {
		return catalogRanking(ctx);
	}
});
