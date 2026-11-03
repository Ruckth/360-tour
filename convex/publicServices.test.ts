// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import type { FunctionReturnType } from 'convex/server';
import { describe, expect, it } from 'vitest';
import { api, internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
type ServiceInput = Omit<Doc<'services'>, '_id' | '_creationTime'>;
type ServicePage = FunctionReturnType<typeof api.publicServices.list>;

function service(index: number, overrides: Partial<ServiceInput> = {}): ServiceInput {
  return {
    slug: `service-${index}`, name: `Service ${index}`, description: `Description ${index}`,
    category: 'Wellness', durationMin: 60, bufferMin: 15, price: 1000 + index,
    currency: 'THB', staffIds: [], status: 'active', createdAt: index, updatedAt: index,
    ...overrides,
  };
}

describe('public service catalog', () => {
  it('exposes only guest-facing fields, without staff IDs or internal timing metadata', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      const staffId = await ctx.db.insert('staff', {
        name: 'Private Staff Name', role: 'Therapist', color: '#123456', status: 'active',
        workingHours: [], breaks: [], createdAt: 1, updatedAt: 1,
      });
      await ctx.db.insert('services', service(1, {
        staffIds: [staffId], description: 'x'.repeat(1500), imageUrl: 'https://example.convex.cloud/api/storage/photo',
      }));
    });
    const detail = await t.query(api.publicServices.getBySlug, { slug: 'service-1' });
    expect(detail).toEqual({
      slug: 'service-1', name: 'Service 1', description: 'x'.repeat(1000), category: 'Wellness',
      durationMin: 60, price: 1001, currency: 'THB', imageUrl: 'https://example.convex.cloud/api/storage/photo',
    });
    const list = await t.query(api.publicServices.list, { paginationOpts: { numItems: 20, cursor: null } });
    expect(list.page).toEqual([detail]);
    const chat = await t.query(internal.publicServices.browseForChat, { category: 'Wellness' });
    expect(chat.services).toEqual([detail]);
    for (const value of [detail, list.page, chat.services]) {
      const serialized = JSON.stringify(value);
      expect(serialized).not.toContain('staffIds');
      expect(serialized).not.toContain('Private Staff');
      expect(serialized).not.toContain('bufferMin');
      expect(serialized).not.toContain('createdAt');
      expect(serialized).not.toContain('_id');
    }
  });

  it('hides archived services from details, lists, search, and categories', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert('services', service(1, { name: 'Thai Massage' }));
      await ctx.db.insert('services', service(2, { name: 'Hidden Massage', category: 'Archived only', status: 'archived' }));
    });
    expect(await t.query(api.publicServices.getBySlug, { slug: 'service-2' })).toBeNull();
    expect(await t.query(api.publicServices.getBySlug, { slug: 'missing' })).toBeNull();
    expect(await t.query(api.publicServices.getBySlug, { slug: 'x'.repeat(501) })).toBeNull();
    const all = await t.query(api.publicServices.list, { paginationOpts: { numItems: 20, cursor: null } });
    const search = await t.query(api.publicServices.list, { query: 'Massage', paginationOpts: { numItems: 20, cursor: null } });
    expect(all.page.map(row => row.slug)).toEqual(['service-1']);
    expect(search.page.map(row => row.slug)).toEqual(['service-1']);
    expect(await t.query(api.publicServices.categories, {})).toEqual({ categories: [{ name: 'Wellness' }], nextCategory: null });
  });

  it('paginates past 100 active services without omissions or duplicate rows', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      for (let index = 0; index < 125; index++) {
        await ctx.db.insert('services', service(index, { category: ['Wellness', 'Dining', 'Activities'][index % 3] }));
      }
      for (let index = 125; index < 136; index++) await ctx.db.insert('services', service(index, { status: 'archived' }));
    });
    const slugs: string[] = [];
    let cursor: string | null = null;
    let done = false;
    const cursors = new Set<string>();
    for (let pageIndex = 0; pageIndex < 10 && !done; pageIndex++) {
      const page: ServicePage = await t.query(api.publicServices.list, { paginationOpts: { numItems: 500, cursor } });
      expect(page.page.length).toBeLessThanOrEqual(20);
      slugs.push(...page.page.map(row => row.slug));
      done = page.isDone;
      if (!done) {
        expect(cursors.has(page.continueCursor)).toBe(false);
        cursors.add(page.continueCursor);
        cursor = page.continueCursor;
      }
    }
    expect(done).toBe(true);
    expect(slugs).toHaveLength(125);
    expect(new Set(slugs).size).toBe(125);
    expect(new Set(slugs)).toEqual(new Set(Array.from({ length: 125 }, (_, index) => `service-${index}`)));
  });

  it('paginates name-search results with the exact category filter retained', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      for (let index = 0; index < 47; index++) await ctx.db.insert('services', service(index, { name: `Massage option ${index}` }));
      await ctx.db.insert('services', service(48, { name: 'Massage candle', category: 'Retail' }));
    });
    const slugs: string[] = [];
    let cursor: string | null = null;
    let done = false;
    for (let index = 0; index < 5 && !done; index++) {
      const page: ServicePage = await t.query(api.publicServices.list, { category: 'Wellness', query: 'Massage', paginationOpts: { numItems: 20, cursor } });
      expect(page.page.every(row => row.category === 'Wellness')).toBe(true);
      slugs.push(...page.page.map(row => row.slug));
      done = page.isDone;
      cursor = page.continueCursor;
    }
    expect(done).toBe(true);
    expect(slugs).toHaveLength(47);
    expect(new Set(slugs).size).toBe(47);
    expect(slugs).not.toContain('service-48');
  });

  it('returns distinct category pages and does not hide a category after a large group', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      for (let index = 0; index < 120; index++) await ctx.db.insert('services', service(index, { category: 'Category 00' }));
      for (let index = 1; index < 45; index++) {
        const category = `Category ${String(index).padStart(2, '0')}`;
        await ctx.db.insert('services', service(120 + index, { category }));
        await ctx.db.insert('services', service(220 + index, { category }));
      }
      await ctx.db.insert('services', service(999, { category: 'Archived only', status: 'archived' }));
    });
    const names: string[] = [];
    let after: string | undefined;
    for (let index = 0; index < 4; index++) {
      const result = await t.query(api.publicServices.categories, after ? { after } : {});
      expect(result.categories.length).toBeLessThanOrEqual(20);
      names.push(...result.categories.map(category => category.name));
      if (result.nextCategory === null) break;
      after = result.nextCategory;
    }
    expect(names).toEqual(Array.from({ length: 45 }, (_, index) => `Category ${String(index).padStart(2, '0')}`));
    expect(new Set(names).size).toBe(45);
  });

  it('combines trimmed name search and exact categories without leaking neighboring groups', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert('services', service(1, { name: 'Thai Massage' }));
      await ctx.db.insert('services', service(2, { name: 'Massage dinner', category: 'Dining' }));
      await ctx.db.insert('services', service(3, { name: 'Private Yoga' }));
      await ctx.db.insert('services', service(4, { name: 'นวดไทย', category: 'สุขภาพ' }));
    });
    const query = { paginationOpts: { numItems: 20, cursor: null } };
    expect((await t.query(api.publicServices.list, { ...query, category: ' Wellness ', query: ' Massage ' })).page.map(row => row.slug)).toEqual(['service-1']);
    expect((await t.query(api.publicServices.list, { ...query, category: 'wellness' })).page).toEqual([]);
    expect((await t.query(api.publicServices.list, { ...query, category: 'สุขภาพ' })).page.map(row => row.slug)).toEqual(['service-4']);
    expect((await t.query(api.publicServices.list, { ...query, query: 'missingservice' })).page).toEqual([]);
  });

  it('keeps a stored 150-character category selectable and usable as a directory cursor', async () => {
    const t = convexTest(schema, modules);
    const longCategory = 'Z'.repeat(150);
    const laterCategory = `${longCategory} after`;
    await t.run(async ctx => {
      for (let index = 0; index < 19; index++) await ctx.db.insert('services', service(index, { category: `Category ${String(index).padStart(2, '0')}` }));
      await ctx.db.insert('services', service(20, { category: longCategory }));
      await ctx.db.insert('services', service(21, { category: laterCategory }));
    });
    const first = await t.query(api.publicServices.categories, {});
    expect(first.categories[first.categories.length - 1]?.name).toBe(longCategory);
    expect(first.nextCategory).toBe(longCategory);
    const next = await t.query(api.publicServices.categories, { after: longCategory });
    expect(next).toEqual({ categories: [{ name: laterCategory }], nextCategory: null });
    const selected = await t.query(api.publicServices.list, { category: longCategory, paginationOpts: { numItems: 20, cursor: null } });
    expect(selected.page.map(row => row.slug)).toEqual(['service-20']);
    const chat = await t.query(internal.publicServices.browseForChat, { category: longCategory });
    expect(chat.services.map(row => row.slug)).toEqual(['service-20']);
  });

  it('returns empty states without inventing categories or services', async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.publicServices.categories, {})).toEqual({ categories: [], nextCategory: null });
    expect(await t.query(internal.publicServices.browseForChat, {})).toEqual({ mode: 'categories', categories: [], nextCategory: null, services: [] });
    const result = await t.query(api.publicServices.list, { paginationOpts: { numItems: 20, cursor: null } });
    expect(result.page).toEqual([]);
    expect(result.isDone).toBe(true);
    expect(await t.query(internal.publicServices.browseForChat, { category: 'Missing' })).toMatchObject({ mode: 'services', services: [], hasMore: false });
  });

  it('rejects an oversized name search before searching', async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.publicServices.list, { query: 'x'.repeat(101), paginationOpts: { numItems: 20, cursor: null } })).rejects.toThrow('too long');
    await expect(t.query(internal.publicServices.browseForChat, { query: 'x'.repeat(101) })).rejects.toThrow('too long');
  });
});

describe('chat service browsing', () => {
  it('starts with at most eight categories and signals additional categories', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      for (let index = 0; index < 12; index++) await ctx.db.insert('services', service(index, { category: `Category ${String(index).padStart(2, '0')}` }));
    });
    const result = await t.query(internal.publicServices.browseForChat, {});
    expect(result.mode).toBe('categories');
    expect(result.services).toEqual([]);
    if (result.mode !== 'categories') throw new Error('Expected category directory');
    expect(result.categories).toHaveLength(8);
    expect(result.nextCategory).toBe('Category 07');
  });

  it('returns at most five services after category selection and does not falsely mark a full page as more', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      for (let index = 0; index < 7; index++) await ctx.db.insert('services', service(index));
      for (let index = 7; index < 12; index++) await ctx.db.insert('services', service(index, { category: 'Dining' }));
    });
    const wellness = await t.query(internal.publicServices.browseForChat, { category: 'Wellness' });
    expect(wellness).toMatchObject({ mode: 'services', category: 'Wellness', hasMore: true });
    expect(wellness.services).toHaveLength(5);
    const dining = await t.query(internal.publicServices.browseForChat, { category: 'Dining' });
    expect(dining.services).toHaveLength(5);
    expect(dining).toMatchObject({ hasMore: false });
    const short = await t.query(internal.publicServices.browseForChat, { category: 'Wellness', limit: 3 });
    expect(short.services).toHaveLength(3);
    expect(short).toMatchObject({ hasMore: true });
  });

  it.each([0, -1, 6, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid chat result limit %s', async limit => {
    const t = convexTest(schema, modules);
    await expect(t.query(internal.publicServices.browseForChat, { category: 'Wellness', limit })).rejects.toThrow('limit');
  });
});
