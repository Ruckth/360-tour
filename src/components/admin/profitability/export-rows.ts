import type { Report } from './report-model';

type ExportPage = Pick<Report, 'asOf' | 'detail'>;

export async function collectExportRows(readPage: (page: number) => Promise<ExportPage>, signal: AbortSignal) {
  const { asOf, detail } = await readPage(0);
  if (signal.aborted) return null;
  if (!detail || detail.page !== 0) throw new Error('Missing supporting records.');

  const rows = [...detail.rows];
  const pages = Math.ceil(detail.count / detail.pageSize);
  const concurrency = 8;
  for (let start = 1; start < pages; start += concurrency) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(concurrency, pages - start) }, (_, index) => readPage(start + index)),
    );
    if (signal.aborted) return null;
    for (const [index, next] of batch.entries()) {
      if (
        next.asOf !== asOf ||
        next.detail?.page !== start + index ||
        next.detail.count !== detail.count ||
        next.detail.sum !== detail.sum ||
        next.detail.pageSize !== detail.pageSize
      )
        throw new Error('The export snapshot changed.');
      rows.push(...next.detail.rows);
    }
  }

  if (rows.length !== detail.count || rows.reduce((sum, row) => sum + (row.amount ?? 0), 0) !== detail.sum)
    throw new Error('The export did not reconcile with the matching records.');
  return { asOf, detail, rows };
}
