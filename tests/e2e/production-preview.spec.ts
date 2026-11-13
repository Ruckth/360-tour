import { expect, test } from './fixtures';
import { signedInBackend } from './backend';
import { clerk } from '@clerk/testing/playwright';

test('production does not render checkout design routes, even for an owner', async ({ page }) => {
  await signedInBackend(page);
  try {
    for (const path of ['/dev/checkout-preview', '/admin/checkout/preview']) {
      await page.goto(path);
      // Next streams admin layouts with status 200; the notFound boundary must still render.
      await expect(page.getByRole('heading', { name: '404', exact: true })).toBeVisible();
      await expect(page.getByText('This page could not be found.')).toBeVisible();
      await expect(page.getByRole('combobox', { name: 'Design state' })).toHaveCount(0);
      await expect(page.getByRole('complementary', { name: 'Order', exact: true })).toHaveCount(0);
    }
  } finally { await clerk.signOut({ page }); }
});
