// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Id } from 'convex/_generated/dataModel';
import { LinkEditor } from '@/components/admin/marketing/LinkEditor';
import type { LinkRow, SlugCheck } from '@/components/admin/marketing/types';

function deferred() {
  let resolve!: (value: SlugCheck) => void, reject!: (error: Error) => void;
  const promise = new Promise<SlugCheck>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
let root: Root;
const checkSlug = vi.fn<(args: { slug: string; linkId?: Id<'marketingLinks'> }) => Promise<SlugCheck>>();
const saveLink = vi.fn();
const actions = { checkSlug, saveLink };
const link: LinkRow = {
  _id: 'link-one' as Id<'marketingLinks'>, _creationTime: 0, slug: 'original', name: 'Test link',
  campaignId: 'campaign-one' as Id<'marketingCampaigns'>, campaignName: 'Test campaign', destination: { kind: 'home' }, entry: 'link', status: 'draft', opens: 0, createdAt: 0,
  updatedAt: 0, updatedByEmail: 'admin@example.com', shortUrlPath: '/original',
};
async function render(patch: Partial<ComponentProps<typeof LinkEditor>> = {}) {
  await act(async () => root.render(createElement(LinkEditor, {
    links: [], campaigns: [], coupons: [], properties: [], origin: 'https://example.com',
    today: '2026-11-17', campaignsHref: '/campaigns', actions,
    onDone: vi.fn(), onCancel: vi.fn(), onDuplicate: vi.fn(), ...patch,
  })));
}
async function slug(value: string) {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('input[placeholder="f2"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => vi.advanceTimersByTimeAsync(350));
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount()); document.body.innerHTML = '';
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});
it.each(['success', 'failure'] as const)('ignores an old %s after A → B → A finishes its newest check', async staleResult => {
  const first = deferred(), second = deferred(), newest = deferred();
  checkSlug.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(newest.promise);
  await render(); await slug('alpha'); await slug('beta'); await slug('alpha');
  expect(checkSlug).toHaveBeenCalledTimes(3);
  await act(async () => newest.resolve({ ok: false, slug: 'alpha', reason: 'taken' }));
  const current = document.body.textContent;
  await act(async () => {
    if (staleResult === 'success') first.resolve({ ok: true, slug: 'alpha' });
    else first.reject(new Error('Old request failed'));
    second.resolve({ ok: true, slug: 'beta' });
  });
  expect(document.body.textContent).toBe(current);
  expect(document.body.textContent).not.toContain('is free');
  expect(document.body.textContent).not.toContain('Old request failed');
});
it('ignores a response from the former link context', async () => {
  const old = deferred(), latest = deferred();
  checkSlug.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  await render({ link }); await slug('alpha');
  await render({ link: { ...link, _id: 'link-two' as Id<'marketingLinks'> } });
  await act(async () => vi.advanceTimersByTimeAsync(350));
  expect(checkSlug).toHaveBeenLastCalledWith({ slug: 'alpha', linkId: 'link-two' });
  await act(async () => latest.resolve({ ok: true, slug: 'alpha' }));
  const current = document.body.textContent;
  await act(async () => old.resolve({ ok: false, slug: 'alpha', reason: 'taken' }));
  expect(document.body.textContent).toBe(current);
  expect(document.body.textContent).toContain('is free');
});
it('discards a pending response when checking is skipped, and after unmount', async () => {
  const pending = deferred(); checkSlug.mockReturnValueOnce(pending.promise);
  await render({ link }); await slug('alpha'); await slug('original');
  await act(async () => pending.reject(new Error('Obsolete request')));
  expect(document.body.textContent).not.toContain('Obsolete request');
  const late = deferred(); checkSlug.mockReturnValueOnce(late.promise);
  await slug('beta'); await act(async () => root.render(null));
  await act(async () => late.resolve({ ok: true, slug: 'beta' }));
  expect(document.body.textContent).toBe('');
  expect(vi.getTimerCount()).toBe(0);
});
