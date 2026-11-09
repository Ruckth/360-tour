import { ConvexHttpClient } from 'convex/browser';
import { ConvexError } from 'convex/values';
import { describe, expect, it, vi } from 'vitest';
import { api } from 'convex/_generated/api';
import { errorText } from '@/lib/staff-bookings';

describe('checkout application errors through the installed Convex client', () => {
  it.each([
    'The order changed. Check the total and pay again.',
    { message: 'Review the current customer before paying.', code: 'CUSTOMER_CHANGED' },
  ])('shows public error data instead of request metadata', async (errorData) => {
    const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      status: 'error', errorMessage: '[Request ID: request-123] Server Error', errorData,
    }), { status: 560, headers: { 'Content-Type': 'application/json' } }));
    const client = new ConvexHttpClient('https://audit.convex.cloud', { fetch: transport, logger: false });
    const failure: unknown = await client.mutation(api.customers.createCustomer, { name: '' }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConvexError);
    expect(errorText(failure, 'Could not save')).toBe(typeof errorData === 'string' ? errorData : errorData.message);
    expect(transport).toHaveBeenCalledOnce();
  });

  it('uses the caller fallback for application errors without a readable message', () => {
    expect(errorText(new ConvexError({ code: 'UNKNOWN' }), 'Could not save')).toBe('Could not save');
    expect(errorText(null, 'Could not save')).toBe('Could not save');
  });

  it('keeps legacy development errors readable during rollout', () => {
    expect(errorText(new Error('[CONVEX M(pos:settleOrder)] Uncaught Error: Review the total\n    at handler'), 'Could not pay')).toBe('Review the total');
  });
});
