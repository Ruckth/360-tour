import { expect, test } from '@playwright/test';
const localIntegration = process.env.E2E_MODE === 'integration' && process.env.E2E_CHAT_LOCAL === '1';
test.use({ video: 'on' });
test.describe('durable web chat on an isolated local backend', () => {
  test.skip(!localIntegration, 'Requires an explicitly running isolated local Convex and Next server');
  test.beforeEach(async ({ baseURL }) => {
    expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL!).hostname);
  });
  test('restores the server transcript after refresh without a browser transcript cache', async ({ page }) => {
    await page.goto('/en/chat');
    const notice = page.getByRole('button', { name: 'I understand', exact: true });
    if (await notice.isVisible()) await notice.click();
    const decline = page.getByRole('button', { name: 'No thanks', exact: true });
    if (await decline.isVisible()) await decline.click();
    const input = page.getByRole('textbox', { name: 'Ask a question', exact: true }).last();
    await expect(input).toBeEnabled();
    await input.fill('What time is check-in?');
    await input.press('Enter');
    await expect(page.getByText(/Check-in is from/)).toBeVisible();
    const before = await page.locator('[data-testid="chat-panel"]').innerText();
    await page.reload();
    await expect(page.getByText('What time is check-in?', { exact: true })).toBeVisible();
    await expect(page.getByText(/Check-in is from/)).toBeVisible();
    const cacheKeys = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('sv_chat_messages:')));
    expect(cacheKeys).toEqual([]);
    await page.locator('[data-testid="chat-messages"]').evaluateAll(nodes => { for (const node of nodes) node.scrollTop = 0; });
    await page.screenshot({ path: 'output/phase2-chat-server.png', fullPage: true });
    expect(before).toContain('What time is check-in?');
  });
  test('keeps IME composition and multiline drafts from submitting early', async ({ page }) => {
    await page.goto('/en/chat');
    const notice = page.getByRole('button', { name: 'I understand', exact: true });
    if (await notice.isVisible()) await notice.click();
    const decline = page.getByRole('button', { name: 'No thanks', exact: true });
    if (await decline.isVisible()) await decline.click();
    const input = page.getByRole('textbox', { name: 'Ask a question', exact: true }).last();
    await expect(input).toBeEnabled();
    await input.fill('เช็คอิน');
    await input.dispatchEvent('compositionstart');
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
    await expect(input).toHaveValue('เช็คอิน');
    await input.dispatchEvent('compositionend');
    await input.press('Shift+Enter');
    await expect(input).toHaveValue(/เช็คอิน/);
  });
  test('recovers the old browser after handoff rotation while keeping its unsent draft', async ({ page }) => {
    await page.goto('/en/chat');
    const notice = page.getByRole('button', { name: 'I understand', exact: true });
    if (await notice.isVisible()) await notice.click();
    const decline = page.getByRole('button', { name: 'No thanks', exact: true });
    if (await decline.isVisible()) await decline.click();
    const input = page.getByRole('textbox', { name: 'Ask a question', exact: true });
    await expect(input).toBeEnabled();
    await input.fill('Keep my unsent draft');
    const rotated = await page.evaluate(async () => {
      const sessionId = localStorage.getItem('sv_chat_session_id')!;
      const guestToken = localStorage.getItem(`sv_chat_session_id:token:${sessionId}`)!;
      const mutation = async (path: string, args: Record<string, string>) => {
        const response = await fetch('http://127.0.0.1:3210/api/mutation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, args, format: 'json' }) });
        const result = await response.json();
        if (result.status !== 'success') throw new Error('Local handoff failed');
        return result.value;
      };
      const token = await mutation('messaging/chat:createBrowserHandoff', { sessionId, guestToken });
      const claimed = await mutation('messaging/chat:claimBrowserHandoff', { token });
      return !!claimed?.guestToken && claimed.guestToken !== guestToken;
    });
    expect(rotated).toBe(true);
    await expect(input).toHaveValue('Keep my unsent draft');
    await expect(input).toBeEnabled();
    await expect.poll(() => page.evaluate(() => !!localStorage.getItem('sv_chat_session_id'))).toBe(true);
  });

});
