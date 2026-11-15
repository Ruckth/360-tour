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

/** Compatibility endpoint; both subscription paths share the same extraction and ranking. */
export const catalog = staffQuery({
  capability: 'checkout',
	args: {},
	handler: async (ctx) => {
		const [items, frequent] = await Promise.all([catalogItems(ctx), catalogRanking(ctx)]);
		return { ...items, frequent };
	}
});
