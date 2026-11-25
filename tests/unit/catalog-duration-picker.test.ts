// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Catalog, OrderLine } from '@/components/checkout/backend';
import { CatalogPane } from '@/components/checkout/CatalogPane';

const thai = {
  _id: 'svc0thai', name: 'Thai massage', category: 'Massage', description: '', durationMin: 60, price: 80000, currency: 'THB', staffIds: [],
  options: [{ durationMin: 60, price: 80000 }, { durationMin: 90, price: 110000 }, { durationMin: 120, price: 140000 }],
};
const facial = { ...thai, _id: 'svc0facial', name: 'Facial', category: 'Beauty', durationMin: 45, price: 150000, options: [{ durationMin: 45, price: 150000 }] };
const catalog = (frequent: string[] = []) => ({ services: [thai, facial], rooms: [], extras: [], frequent }) as unknown as Catalog;

let root: Root;
const onAdd = vi.fn();
const render = (props: Partial<ComponentProps<typeof CatalogPane>> = {}) =>
  act(async () => root.render(createElement(CatalogPane, { catalog: catalog(), lines: [], onAdd, ...props })));
const tile = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('#checkout-catalog button')].find(button => button.textContent?.replace(/^\d+ on the order/, '').startsWith(name))!;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === label)!;
const picker = () => document.querySelector<HTMLElement>('[role=group][aria-label="Thai massage duration"]');

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  onAdd.mockReset();
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

it('opens an inline picker on a multi-length tile and adds the chosen length', async () => {
  await render();
  const thaiTile = tile('Thai massage');
  expect(thaiTile.textContent).toContain('60 / 90 / 120 min');
  expect(thaiTile.textContent).toContain('from ฿800');
  expect(thaiTile.getAttribute('aria-expanded')).toBe('false');
  await act(async () => thaiTile.click());
  expect(onAdd).not.toHaveBeenCalled();
  expect(thaiTile.getAttribute('aria-expanded')).toBe('true');
  expect(thaiTile.getAttribute('aria-controls')).toBe(picker()!.id);
  expect(picker()!.textContent).toContain('Thai massage: how long?');
  expect(document.activeElement?.textContent).toBe('60 min฿800');
  await act(async () => button('90 min฿1,100').click());
  expect(onAdd).toHaveBeenCalledExactlyOnceWith({ kind: 'service', serviceId: thai._id, durationMin: 90, expectedPrice: 110000 });
  expect(picker()).toBeNull();
  expect(document.activeElement).toBe(tile('Thai massage'));
});

it('closes the picker with Escape or Cancel, returning focus to the tile', async () => {
  await render();
  await act(async () => tile('Thai massage').click());
  await act(async () => picker()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(picker()).toBeNull();
  expect(document.activeElement).toBe(tile('Thai massage'));
  // Escape on the expanded tile itself closes it too, and focus stays on the tile.
  await act(async () => tile('Thai massage').click());
  tile('Thai massage').focus();
  await act(async () => tile('Thai massage').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(picker()).toBeNull();
  expect(tile('Thai massage').getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(tile('Thai massage'));
  await act(async () => tile('Thai massage').click());
  await act(async () => button('Cancel').click());
  expect(picker()).toBeNull();
  expect(onAdd).not.toHaveBeenCalled();
});

it('labels a multi-length tile without "from" when every length costs the same', async () => {
  const flat = { ...thai, options: [{ durationMin: 60, price: 80000 }, { durationMin: 90, price: 80000 }] };
  await render({ catalog: { services: [flat], rooms: [], extras: [], frequent: [] } as unknown as Catalog });
  expect(tile('Thai massage').textContent).toContain('฿800');
  expect(tile('Thai massage').textContent).not.toContain('from');
  expect(tile('Thai massage').getAttribute('aria-expanded')).toBe('false');
});

it('adds a one-length service in one tap, as before', async () => {
  await render();
  const facialTile = tile('Facial');
  expect(facialTile.hasAttribute('aria-expanded')).toBe(false);
  expect(facialTile.textContent).toContain('45 min');
  expect(facialTile.textContent).not.toContain('from');
  await act(async () => facialTile.click());
  expect(onAdd).toHaveBeenCalledExactlyOnceWith({ kind: 'service', serviceId: facial._id, expectedPrice: 150000 });
});

it('ranks Frequent per length: a ranked length is its own one-tap tile and counts only its lines', async () => {
  const lines = [{ _id: 'l1', kind: 'service', serviceId: thai._id, durationMin: 90, qty: 1 }, { _id: 'l2', kind: 'service', serviceId: thai._id, durationMin: 60, qty: 1 }] as unknown as OrderLine[];
  await render({ catalog: catalog([`service:${thai._id}:90`, `service:${facial._id}`]), lines });
  const ninety = tile('Thai massage');
  expect(ninety.textContent).toContain('90 min');
  expect(ninety.textContent).toContain('฿1,100');
  expect(ninety.textContent).toMatch(/^1 on the order/);
  await act(async () => ninety.click());
  expect(onAdd).toHaveBeenCalledExactlyOnceWith({ kind: 'service', serviceId: thai._id, durationMin: 90, expectedPrice: 110000 });
  expect(tile('Facial')).toBeDefined();
});
