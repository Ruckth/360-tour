import { expect, it, vi } from 'vitest';
import { collectExportRows } from '@/components/admin/profitability/export-rows';

function response(page: number) {
  return {
    asOf: 1,
    detail: {
      page,
      pageSize: 1,
      count: 3,
      sum: 300,
      people: 0,
      displayedRatio: null,
      value: 300,
      categories: ['Service'],
      rows: [{ id: String(page), day: '', ref: '', service: '', customer: '', category: 'Service', amount: 100 }],
    },
  };
}

it('collects complete matching evidence in page order', async () => {
  const readPage = vi.fn(async (page: number) => response(page));
  const result = await collectExportRows(readPage, new AbortController().signal);
  expect(result?.rows.map((row) => row.id)).toEqual(['0', '1', '2']);
});

it('stops at a rejected page without returning partial evidence', async () => {
  const readPage = vi.fn(async (page: number) => {
    if (page === 1) throw new Error('Finance access changed');
    return response(page);
  });
  await expect(collectExportRows(readPage, new AbortController().signal)).rejects.toThrow('Finance access changed');
  expect(readPage.mock.calls).toEqual([[0], [1], [2]]);
});

it('discards in-flight evidence after the user changes scope', async () => {
  const controller = new AbortController();
  const readPage = vi.fn(async (page: number) => {
    if (page === 1) controller.abort();
    return response(page);
  });
  await expect(collectExportRows(readPage, controller.signal)).resolves.toBeNull();
  expect(readPage.mock.calls).toEqual([[0], [1], [2]]);
});

it('collects 400 pages with at most eight overlapping requests and preserves order', async () => {
  let active = 0;
  let peak = 0;
  const readPage = vi.fn(async (page: number) => {
    peak = Math.max(peak, ++active);
    await Promise.resolve();
    active--;
    const result = response(page);
    return { ...result, detail: { ...result.detail, count: 400, sum: 40_000 } };
  });
  const result = await collectExportRows(readPage, new AbortController().signal);
  expect(readPage).toHaveBeenCalledTimes(400);
  expect(peak).toBe(8);
  expect(result?.rows.map((row) => row.id)).toEqual(Array.from({ length: 400 }, (_, i) => String(i)));
});

it('rejects a response from a different snapshot', async () => {
  const readPage = async (page: number) => ({ ...response(page), asOf: page === 1 ? 2 : 1 });
  await expect(collectExportRows(readPage, new AbortController().signal)).rejects.toThrow('snapshot changed');
});
