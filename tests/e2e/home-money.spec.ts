import { expect, test } from '@playwright/test';
import { bypassDemoDisclaimer } from './demo-disclaimer';

test('@smoke homepage formats direct savings from basis points', async ({ page }) => {
  await bypassDemoDisclaimer(page);
  await page.goto('/');
  const savings = page.getByText('Direct Savings', { exact: true }).locator('..');
  await expect(savings).toContainText('15%');
  await expect(savings).not.toContainText('1500%');
});
