import { expect, test } from "@playwright/test";
import { openDesk } from "./helpers/desk-taps";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 1180, height: 820 } });
test('busy hotel week retains complete stay bars and tapping an empty day prefills dates', async ({ page }) => {
  await openDesk(page);
  const lena = page.locator('[data-slot=event-calendar-month-bar-overlay] [data-slot=event-calendar-event]').filter({ hasText: 'Lena Fischer' });
  await expect(lena).toHaveCount(1);
  await expect(lena).toHaveAccessibleName(/Lena Fischer, Tideglass Pool Residence, Wed 11 Nov to Sat 14 Nov, Paid/);
  const position = await lena.evaluate(el => {
    const lane = el.parentElement!;
    return { column: lane.style.gridColumn, width: lane.getBoundingClientRect().width, cellWidth: lane.closest('[data-slot=event-calendar-month-row]')!.querySelector('[role=gridcell]')!.getBoundingClientRect().width };
  });
  expect(position.width / position.cellWidth).toBeGreaterThan(3.8);
  await expect(page.locator('[data-slot=event-calendar-more]')).toHaveCount(0);
  const day = page.getByRole('gridcell', { name: /Friday.*20 November|Friday.*November 20/ });
  await day.click({ position: { x: 15, y: 45 } });
  await expect(page.getByTestId('booking-check-in')).toHaveAttribute('data-selected-date', '2026-11-20');
  await expect(page.getByTestId('booking-check-out')).toHaveAttribute('data-selected-date', '2026-11-21');
});
test('New booking guards close, Escape and outside without saving', async ({ page }) => {
  await openDesk(page);
  await page.getByRole('button', { name: 'New booking', exact: true }).click();
  await page.getByLabel('Guest name', { exact: true }).fill('Draft guest');
  const dialog = page.getByRole('dialog', { name: 'New booking', exact: true });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByLabel('Guest name', { exact: true })).toHaveValue('Draft guest');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await page.mouse.click(10, 10);
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
test('stay edits keep the reviewed revision while guarding an abandoned draft', async ({ page }) => {
  await openDesk(page);
  await page.locator('[data-slot=event-calendar-event]').filter({ hasText: 'Anna Schmidt' }).first().click();
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await page.getByRole('button', { name: 'Edit stay' }).click();
  await page.getByLabel('Guest name', { exact: true }).fill('Anna draft');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByLabel('Guest name', { exact: true })).toHaveValue('Anna draft');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit booking', exact: true })).toHaveCount(0);
});
test('chat navigation guards an unsent reply and retains it when kept', async ({ page }) => {
  await page.goto('/tests/browser/chats.html?path=/admin/chats');
  await page.locator('[data-fixture-ready]').waitFor();
  await page.getByRole('textbox', { name: 'Type an admin reply' }).fill('Unsent answer');
  await page.getByRole('complementary', { name: 'Chat list' }).getByRole('button', { name: /Somchai P/ }).first().click();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByRole('heading', { name: 'Anna Müller', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Type an admin reply' })).toHaveValue('Unsent answer');
  await page.getByRole('complementary', { name: 'Chat list' }).getByRole('button', { name: /Somchai P/ }).first().click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Somchai P.', exact: true })).toBeVisible();
});


test('Done keeps an unsent reply editable when discard is cancelled', async ({ page }) => {
  await page.goto('/tests/browser/chats.html?path=/admin/chats');
  await page.locator('[data-fixture-ready]').waitFor();
  await page.getByRole('textbox', { name: 'Type an admin reply' }).fill('Unsent answer');
  await page.getByRole('button', { name: 'No reply needed', exact: true }).click();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByRole('heading', { name: 'Anna Müller', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Type an admin reply' })).toHaveValue('Unsent answer');
  const calls = await page.evaluate(() => (window as unknown as { fixtureCalls: Array<[string, unknown]> }).fixtureCalls);
  expect(calls.filter(([name]) => name === 'setSessionStatus')).toEqual([]);
});
