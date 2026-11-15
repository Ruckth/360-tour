import { expect, test } from '@playwright/test';

for (const timezoneId of ['America/Los_Angeles', 'Pacific/Auckland']) {
  for (const [utcTime, resortDate, historical] of [
    ['2030-01-10T16:59:59Z', '2030-01-10', false],
    ['2030-01-10T17:00:00Z', '2030-01-11', true],
  ] as const) {
    test(`resort midnight and local picker in ${timezoneId} at ${utcTime}`, async ({ browser }) => {
      const context = await browser.newContext({ timezoneId, baseURL: test.info().project.use.baseURL });
      try {
        const page = await context.newPage();
        await page.clock.setFixedTime(new Date(utcTime));
        await page.goto('/tests/browser/index.html?checkIn=2030-01-10&checkOut=2030-01-12');
        await expect(page.getByRole('dialog', { name: 'New booking' })).toBeVisible();
        await page.getByLabel('Email (optional)').fill('guest@example.test');
        // Actual dialog notification policy follows the resort day in both browser zones.
        if (historical) await expect(page.locator('#nb-notify')).not.toBeChecked();
        else await expect(page.locator('#nb-notify')).toBeChecked();
        const result = await page.evaluate(async () => {
          const timePath = '/convex/shared/time.ts';
          const valuesPath = '/src/lib/dates/values.ts';
          const datesPath = '/convex/shared/dates.ts';
          const time = await import(timePath);
          const values = await import(valuesPath);
          const dates = await import(datesPath);
          const picker = values.isoToDate('2030-01-10');
          return {
            today: time.resortTodayIso(),
            pickerDay: picker.getDate(),
            pickerHour: picker.getHours(),
            roundTrip: values.dateToIso(picker),
            nights: dates.nightsBetweenIso('2030-01-10', '2030-01-12'),
            midnight: time.resortDateTime('2030-01-11', '00:00'),
          };
        });
        expect(result).toEqual({ today: resortDate, pickerDay: 10, pickerHour: 0, roundTrip: '2030-01-10', nights: 2, midnight: Date.parse('2030-01-10T17:00:00Z') });
      } finally {
        await context.close();
      }
    });
  }
}


test('hotel calendar refuses a browser-local day that is already past at the resort', async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'America/Los_Angeles', baseURL: test.info().project.use.baseURL });
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date('2030-01-10T17:00:00Z'));
    await page.addInitScript(() => localStorage.setItem('admin.hotel.view', 'resource'));
    await page.goto('/tests/browser/index.html?mode=hotel-calendar');
    const cell = page.locator('[data-slot="event-calendar-all-day-cell"][data-ec-resource="pool-id"]');
    // Los Angeles is still Jan 10; the resort has crossed midnight into Jan 11.
    await expect(cell).toHaveAttribute('data-ec-day', String(Date.parse('2030-01-10T08:00:00Z')));
    await cell.click();
    await expect(page.getByRole('dialog', { name: 'New booking' })).not.toBeVisible();
    // The same real calendar accepts the resort's current day after navigation.
    await page.locator('[data-slot="event-calendar-nav-next"]').click();
    await expect(cell).toHaveAttribute('data-ec-day', String(Date.parse('2030-01-11T08:00:00Z')));
    await cell.click();
    await expect(page.getByRole('dialog', { name: 'New booking' })).toBeVisible();
  } finally {
    await context.close();
  }
});
