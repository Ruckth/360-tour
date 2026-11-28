// @vitest-environment happy-dom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ServiceOptionsEditor, useServiceOptions } from '@/components/admin/ServiceOptionsEditor';

let root: Root;
let state!: ReturnType<typeof useServiceOptions>;
const capture = (next: ReturnType<typeof useServiceOptions>) => { state = next; };
function Harness() {
  const options = useServiceOptions({ durationMin: 60, price: 100000, options: [{ durationMin: 60, price: 100000 }, { durationMin: 90, price: 150000 }, { durationMin: 120, price: 200000 }] });
  useEffect(() => capture(options));
  return createElement(ServiceOptionsEditor, { state: options, bufferMin: 15, currency: 'THB', serviceName: 'Thai massage' });
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
const remove = (label: string) => act(async () => document.querySelector<HTMLButtonElement>(`[aria-label="Remove ${label}"]`)!.click());

it('F14: removing the default with several lengths left asks for a replacement instead of assigning one', async () => {
  await act(async () => root.render(createElement(Harness)));
  expect(document.body.textContent).toContain('60 min ฿1,000 (default)');
  await remove('60 min');
  expect(document.querySelector('[role="alert"]')!.textContent).toContain('Choose which remaining length');
  expect([...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].some(radio => radio.checked)).toBe(false);
  expect(document.body.textContent).not.toContain('(default)');
  let payload: ReturnType<typeof state.payload> = null;
  await act(async () => { payload = state.payload(15); });
  expect(payload).toBeNull();
  await act(async () => document.querySelector<HTMLInputElement>('[aria-label="Default length: 120 min"]')!.click());
  await act(async () => { payload = state.payload(15); });
  expect(payload).toMatchObject({ defaultDurationMin: 120 });
  expect(document.body.textContent).toContain('120 min ฿2,000 (default)');
});

it('F14: with one length left it becomes the default, which is unambiguous', async () => {
  await act(async () => root.render(createElement(Harness)));
  await remove('90 min');
  await remove('60 min');
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.querySelector<HTMLInputElement>('[aria-label="Default length: 120 min"]')!.checked).toBe(true);
});
