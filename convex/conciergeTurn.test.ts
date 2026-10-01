import { expect, test, vi } from 'vitest';
import { runConciergeTurn } from './lib/conciergeTurn';
import { BOOKING_TOOLS, TOOLS } from './lib/chatTools';
import type { LlmResponse } from './lib/chatLlm';

const call = (name: string, finishReason = 'tool_calls'): LlmResponse => ({ content: null, finishReason, tool_calls: [{ id: 'call', type: 'function', function: { name, arguments: '{}' } }] });

test('does not execute pending writes after the round budget, even if the provider claims success', async () => {
	const replies = [call('list_properties'), call('list_properties'), call('list_properties'), { ...call('confirm_booking'), content: 'Your booking is confirmed.' }];
	const execute = vi.fn(async () => JSON.stringify({ properties: [] }));
	const result = await runConciergeTurn({ message: 'yes', messages: [], tools: [...TOOLS, ...BOOKING_TOOLS], deadlineAt: Date.now() + 20000, request: async () => replies.shift()!, execute });
		expect(result.failed).toBe(true); expect(result.content).not.toContain('Your booking is confirmed');
		expect(execute).toHaveBeenCalledTimes(1); expect(execute).not.toHaveBeenCalledWith('confirm_booking', expect.anything());
});

test('rejects an oversized batch before executing its first tool', async () => {
	const one = call('list_properties'); const execute = vi.fn();
	const result = await runConciergeTurn({ message: 'villas?', messages: [], tools: TOOLS, deadlineAt: Date.now() + 20000, request: async () => ({ ...one, tool_calls: Array(13).fill(one.tool_calls![0]) }), execute });
		expect(result.failed).toBe(true); expect(execute).not.toHaveBeenCalled();
});

test('a truncated provider tool response cannot perform a write', async () => {
	const execute = vi.fn();
	const result = await runConciergeTurn({ message: 'yes', messages: [], tools: BOOKING_TOOLS, deadlineAt: Date.now() + 20000, request: async () => call('confirm_booking', 'length'), execute });
		expect(result.failed).toBe(true); expect(execute).not.toHaveBeenCalled();
});

test('recovers a committed result when trace handling fails after the write', async () => {
	const execute = vi.fn(async () => JSON.stringify({ confirmationCode: 'SVC-TEST', service: 'Thai Massage', date: '2099-11-01', time: '15:00', staff: 'Mali', price: 2400, currency: 'THB' }));
	const result = await runConciergeTurn({ message: 'yes', messages: [], tools: BOOKING_TOOLS, deadlineAt: Date.now() + 20000, request: async () => call('confirm_service_booking'), execute, onTool: () => { throw new Error('trace failed'); } });
		expect(result.failed).toBe(false); expect(result.content).toContain('SVC-TEST'); expect(result.content).toContain('THB 2,400'); expect(execute).toHaveBeenCalledTimes(1);
});


test.each(['Your booking is confirmed.', 'Booking cancelled.', 'Your payment was refunded.', 'Your booking is confirmed and you can pay at the resort.'])('rejects unverified completion without any tool: %s', async content => {
	const execute = vi.fn();
	const result = await runConciergeTurn({ message: 'yes', messages: [], tools: BOOKING_TOOLS, deadlineAt: Date.now() + 20000, request: async () => ({ content }), execute });
	expect(result.failed).toBe(true); expect(result.content).not.toBe(content); expect(execute).not.toHaveBeenCalled();
});

test('read-only catalog data does not authorize a booking completion claim', async () => {
	let round = 0;
	const result = await runConciergeTurn({ message: 'yes', messages: [], tools: TOOLS, deadlineAt: Date.now() + 20000, request: async () => round++ ? { content: 'Your booking is confirmed.' } : call('list_properties'), execute: async () => JSON.stringify({ properties: [] }) });
	expect(result.failed).toBe(true);
});

test('reports owned status rows canonically rather than accepting invented status', async () => {
	const request = vi.fn(async () => call('get_my_bookings'));
	const result = await runConciergeTurn({ message: 'My bookings?', messages: [], tools: BOOKING_TOOLS, deadlineAt: Date.now() + 20000, request, execute: async () => JSON.stringify({ bookings: [{ reference: 'CONF-TEST', property: 'Pool Villa', checkIn: '2099-11-01', checkOut: '2099-11-04', status: 'pending', paymentStatus: 'pending', total: 21675, currency: 'THB' }], services: [] }) });
	expect(result.failed).toBe(false); expect(result.content).toContain('status: pending'); expect(result.content).toContain('THB 21,675'); expect(request).toHaveBeenCalledTimes(1);
});


test.each(['Services can be booked via LINE.', 'Your booking is not confirmed yet.', 'Paid bookings cannot be cancelled in chat.'])('preserves valid guidance and honest negatives: %s', async content => {
	const result = await runConciergeTurn({ message: 'Help?', messages: [], tools: BOOKING_TOOLS, deadlineAt: Date.now() + 20000, request: async () => ({ content }), execute: vi.fn() });
	expect(result).toEqual({ content, failed: false });
});
