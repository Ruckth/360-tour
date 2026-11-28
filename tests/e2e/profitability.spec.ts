import { readFile } from 'node:fs/promises';
import { clerk } from '@clerk/testing/playwright';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../convex/_generated/api';
import { expect, test } from './fixtures';

test('@smoke finance enters historical costs and expenses and reconciles the filtered report', async ({
  page,
}, info) => {
  test.setTimeout(100_000);
  page.setDefaultTimeout(10_000);
  const from = '2024-08-01',
    to = '2024-08-31',
    at = Date.parse('2024-08-15T10:00:00+07:00');
  const path = '/admin/marketing/profitability?from=' + from + '&to=' + to;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL!;
  expect(new URL(url).hostname).toBe('127.0.0.1');
  await page.goto('/admin/chats');
  await clerk.signIn({ page, emailAddress: process.env.E2E_OWNER_EMAIL! });
  try {
    const session = await page.evaluate(() => window.Clerk.session!.getToken({ template: 'convex' }));
    const client = new ConvexHttpClient(url);
    client.setAuth(session!);
    const { staff } = await client.query(api.pos.catalog.stableCatalog, {});
    const service = 'Historical service · นวดแผนไทยและประคบสมุนไพร ' + Date.now();
    const serviceId = await client.mutation(api.services.commands.createService.createService, {
      name: service,
      slug: 'finance-' + Date.now(),
      description: 'Report acceptance visit',
      category: 'Spa',
      durationMin: 60,
      bufferMin: 0,
      price: 107000,
      currency: 'THB',
      staffIds: [staff[0]._id],
    });
    // Historical entries can reference an archived service without changing the live catalog under test.
    await client.mutation(api.services.commands.archiveService.archiveService, { serviceId, expectedRevision: 0 });
    const visit = await client.mutation(api.services.commands.createAppointment.createAppointment, {
      serviceId,
      staffId: staff[0]._id,
      start: at,
      guestName: 'Report guest',
      guestPhone: '',
      historicalReason: 'Historical report acceptance',
    });
    await client.mutation(api.services.commands.markAppointmentPaid.markAppointmentPaid, {
      appointmentId: visit.appointmentId,
      method: 'cash',
      effectiveAt: at,
      expectedRevision: 0,
      idempotencyKey: 'finance-report-payment',
    });
    const name = 'Finance Attendee ' + Date.now();
    const customer = await client.mutation(api.pos.customers.createCustomer, { name });
    await page.goto(path);
    const card = (text: string) =>
      page
        .getByRole('main')
        .last()
        .getByRole('link')
        .filter({ has: page.getByText(text, { exact: true }) })
        .first();
    await expect(card('Revenue')).toContainText('฿1,000');
    await expect(card('Net profit')).toContainText('Unavailable');
    const grossMargin = page.getByRole('region', { name: 'Gross margin' });
    await expect(grossMargin).toContainText('2024-08-01 – 2024-08-31');
    await expect(grossMargin).toContainText('Costed records only');
    await page.getByLabel('Through').fill('2024-08-30');
    await expect(page.getByText('Applied dates · 2024-08-01 – 2024-08-31 · Date edits pending')).toBeVisible();
    await page.getByLabel('Through').fill(to);
    const invalid = ['{broken', JSON.stringify({
      join: 'and',
      rules: Array.from({ length: 13 }, () => ({ field: 'service', operator: 'is', value: serviceId })),
    })];
    for (const rules of invalid) {
      await page.goto(path + '&rules=' + encodeURIComponent(rules));
      await expect(page.getByRole('alert').filter({ hasText: 'contains invalid filter rules' })).toBeVisible();
      await expect(card('Revenue')).toHaveCount(0);
      await page.getByRole('button', { name: 'Clear invalid filters' }).click();
      await expect(card('Revenue')).toContainText('฿1,000');
    }
    const cogs = page.getByRole('heading', { name: 'Service COGS', exact: true }).locator('..');
    await expect(cogs).toContainText('Unavailable');
    await cogs.getByRole('link', { name: /missing costs/ }).click();
    await expect(page.getByLabel('Record category')).toHaveValue('Awaiting cost');
    await expect(page.getByRole('row').filter({ hasText: visit.confirmationCode })).toContainText('Awaiting cost');
    await page.getByRole('link', { name: 'Profitability overview' }).click();
    await page.getByRole('link', { name: 'Review missing costs for ' + service }).click();
    await expect(page.getByLabel('Record category')).toHaveValue('Awaiting cost');
    await expect(page.getByRole('button', { name: 'Record actual costs' })).toBeVisible();
    await page.getByRole('link', { name: 'Profitability overview' }).click();
    await page.getByRole('button', { name: 'Finance inputs', exact: true }).click();
    await page.getByLabel('Effective from').fill(from);
    await page.getByRole('combobox', { name: 'Service', exact: true }).selectOption(serviceId);
    for (const [k, v] of [
      ['Staff', '250'],
      ['Materials', '150'],
      ['Tools', '100'],
    ])
      await page.getByLabel(k + ' (฿)', { exact: true }).fill(v);
    await page.getByRole('button', { name: 'Save cost schedule' }).click();
    await expect(card('Gross profit')).toContainText('฿500');
    await expect(grossMargin).toContainText('50%');
    await expect(grossMargin.getByRole('link', { name: 'View gross profit transactions' })).toHaveAttribute('href', /from=2024-08-01.*to=2024-08-31.*metric=gross/);
    await expect(cogs).toContainText('฿500');
    await expect(cogs.getByRole('link', { name: /missing costs/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Finance inputs', exact: true }).click();
    await page.getByRole('button', { name: 'Review monthly accounts for 2024-08' }).click();
    await expect(page.getByLabel('Accounting month')).toHaveValue('2024-08');
    const monthInput = page.getByLabel('Accounting month');
    const overhead = page.getByLabel('Operating overhead (฿)', { exact: true });
    await overhead.fill('12000');
    await monthInput.fill('2024-07');
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(monthInput).toHaveValue('2024-08');
    await expect(overhead).toHaveValue('12000');
    await page.getByRole('button', { name: 'Close finance inputs' }).click();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(overhead).toHaveValue('12000');
    for (const [k, v] of [
      ['Operating overhead', '80'],
      ['Other expenses', '10'],
      ['Income tax', '5'],
      ['Other income', '0'],
    ])
      await page.getByLabel(k + ' (฿)', { exact: true }).fill(v);
    await page.getByRole('checkbox', { name: /I have included/ }).check();
    await page.getByRole('button', { name: 'Confirm monthly accounts' }).click();
    await expect(card('Net profit')).toContainText('฿405');
    await page.getByRole('button', { name: 'Finance inputs', exact: true }).click();
    await page.getByRole('link', { name: /without an identified attendee/ }).click();
    await page.getByRole('button', { name: 'Identify customer' }).click();
    await page.getByLabel('Find customer').fill(name);
    await page.getByRole('combobox', { name: 'Matching profiles', exact: true }).selectOption(customer);
    await page.getByRole('button', { name: 'Confirm customer' }).last().click();
    await expect(page.getByText('No records match the selected rules and search.')).toBeVisible();
    await page.getByRole('link', { name: 'Profitability overview' }).click();
    await card('Revenue').click();
    await expect(page.getByRole('cell', { name: new RegExp(name) })).toBeVisible();
    await page.getByRole('button', { name: 'Record actual costs' }).click();
    await page.getByLabel('Staff (฿)', { exact: true }).fill('200');
    await page.getByLabel('Reason', { exact: true }).fill('Checked staff ledger');
    await page.getByRole('button', { name: 'Save actual costs' }).click();
    await expect(page.getByText('Actual', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Profitability overview' }).click();
    await expect(card('Net profit')).toContainText('฿455');
    await expect(card('Revenue LTV')).toContainText('฿1,000');
    await expect(card('Acquisition cost')).toContainText('฿0');
    const dimensions = [
      [360, 800],
      [390, 844],
      [820, 1180],
      [1180, 820],
      [1440, 900],
    ];
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    for (const [width, height] of dimensions) {
      await page.setViewportSize({ width, height });
      await expect(card('Net profit')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: info.outputPath('overview-' + width + '.png') });
      const trigger = page.getByRole('button', { name: 'Add filter' });
      await trigger.scrollIntoViewIfNeeded();
      const bounds = await trigger.boundingBox();
      if (!bounds) throw new Error('Filter trigger is outside the viewport');
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }],
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(page.getByRole('button', { name: 'Apply rule' })).toBeVisible();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Add filter' }).click();
    await expect(page.getByRole('button', { name: 'Apply rule' })).toBeDisabled();
    await page.getByLabel('Search service values').fill(service);
    await page.getByRole('checkbox', { name: service, exact: true }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Apply rule' }).click();
    await expect(card('Net profit')).toContainText('Unavailable');
    await card('Revenue').click();
    await expect(page.getByText('From overview')).toBeVisible();
    await page.getByLabel('Search records').fill(visit.confirmationCode);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/lookup=/);
    expect(page.url()).not.toContain(visit.confirmationCode);
    await page.reload();
    await expect(page.getByLabel('Search records')).toHaveValue(visit.confirmationCode);
    const order = page.getByRole('combobox', { name: 'Transaction sort' });
    await order.selectOption('asc');
    await expect(order).toHaveValue('asc');
    await page.goBack();
    await expect(order).toHaveValue('desc');
    await page.getByRole('button', { name: 'Record actual costs' }).click();
    await page.getByLabel('Reason', { exact: true }).fill('Unsaved correction');
    await page.getByLabel('Record category').selectOption('Service');
    await expect(page.getByText('Discard this correction?')).toBeVisible();
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await expect(page.getByRole('heading', { name: /Actual costs for/ })).toHaveCount(0);
    await expect(page.getByText(/Matching evidence · Service · Search/)).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const operational = await download;
    expect(operational.suggestedFilename()).toBe('service-revenue-' + from + '-' + to + '.csv');
    const operationalCsv = await readFile((await operational.path())!, 'utf8');
    expect(operationalCsv).toContain('Asia/Bangkok');
    expect(operationalCsv).toContain('Evidence basis');
    expect(operationalCsv).toContain('Applied (private)');
    expect(operationalCsv).not.toContain(name);
    expect(operationalCsv).not.toContain(visit.confirmationCode);
    expect(operationalCsv).toContain('Date,Reference,Service,Category,Evidence basis,Amount (THB)');
    await page.getByLabel('CSV export scope').selectOption('identifiable');
    const identifiable = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const identifiableCsv = await readFile((await (await identifiable).path())!, 'utf8');
    expect(identifiableCsv).toContain(name);
    expect(identifiableCsv).toContain(visit.confirmationCode);
    expect(identifiableCsv).toContain('Date,Reference,Service,Customer,Category,Evidence basis,Amount (THB)');
    await page.getByLabel('Record category').selectOption('');
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
    await expect(page.getByLabel('CSV export scope')).toHaveValue('operational');
    const resetDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const resetCsv = await readFile((await (await resetDownload).path())!, 'utf8');
    expect(resetCsv).toContain('Date,Reference,Service,Category,Evidence basis,Amount (THB)');
    expect(resetCsv).not.toContain(name);
    expect(resetCsv).not.toContain(visit.confirmationCode);
    for (const [width, height] of dimensions) {
      await page.setViewportSize({ width, height });
      await expect(page.getByRole('table')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: info.outputPath('records-' + width + '.png') });
    }
    await page.getByRole('button', { name: 'Add filter' }).click();
    await page.getByRole('combobox', { name: 'Field', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Add filter' })).toBeFocused();
  } finally {
    await clerk.signOut({ page }).catch(() => undefined);
  }
});
