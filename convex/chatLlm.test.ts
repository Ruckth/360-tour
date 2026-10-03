import { afterEach, expect, test, vi } from 'vitest';
import { callAI, classifyComplexity, type ChatMessage } from './lib/chatLlm';
import { runConciergeTurn } from './lib/conciergeTurn';

afterEach(() => vi.unstubAllGlobals());

const tools = [{ type: 'function' as const, function: { name: 'list_services', description: 'List services', parameters: { type: 'object' as const, properties: {} } } }];

test('Luna tool requests disable reasoning and use the supported output limit', async () => {
	const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'tool-1', type: 'function', function: { name: 'list_services', arguments: '{}' } }] } }] })));
	vi.stubGlobal('fetch', fetchMock);
	const result = await callAI('https://openrouter.ai/api/v1', 'test-key', 'openai/gpt-6-luna', [{ role: 'user', content: 'What services do you offer?' }], tools);
	const body = JSON.parse(fetchMock.mock.calls[0][1].body);
	expect(body).toMatchObject({ model: 'openai/gpt-6-luna', reasoning_effort: 'none', max_completion_tokens: 500, tools, tool_choice: 'auto' });
	expect(body).not.toHaveProperty('temperature');
	expect(body).not.toHaveProperty('max_tokens');
	expect(result.tool_calls?.[0].function.name).toBe('list_services');
});

test('existing GLM requests retain their parameters and report provider usage to evals', async () => {
	const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ model: 'z-ai/glm-5.3-flash', choices: [{ finish_reason: 'stop', message: { content: 'Hello' } }], usage: { prompt_tokens: 100, completion_tokens: 10, cost: 0.00002 } })));
	vi.stubGlobal('fetch', fetchMock);
	const trace = vi.fn();
	const result = await callAI('https://openrouter.ai/api/v1', 'test-key', 'z-ai/glm-5.3-flash', [{ role: 'user', content: 'Hello' }], [], trace);
	const body = JSON.parse(fetchMock.mock.calls[0][1].body);
	expect(body).toEqual({ model: 'z-ai/glm-5.3-flash', messages: [{ role: 'user', content: 'Hello' }], temperature: 0.7, max_tokens: 500 });
	expect(trace).toHaveBeenCalledWith(expect.objectContaining({ model: 'z-ai/glm-5.3-flash', finishReason: 'stop', usage: { prompt_tokens: 100, completion_tokens: 10, cost: 0.00002 } }));
	expect(result).toEqual({ content: 'Hello', tool_calls: undefined, finishReason: 'stop' });
});

test.each([{}, { choices: [] }, { choices: [{ message: { content: 42 } }] }, { choices: [{ message: { content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'confirm_booking', arguments: {} } }] } }] }])('rejects malformed provider envelopes before any tool can execute', async envelope => {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope))));
	await expect(callAI('https://ai.test', 'test-key', 'openai/gpt-6-luna', [], tools)).rejects.toThrow('Invalid AI response');
});

test('aborts a hanging provider request at its deadline', async () => {
	vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
		options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
	})));
	await expect(callAI('https://ai.test', 'test-key', 'openai/gpt-6-luna', [], tools, undefined, { timeoutMs: 10 })).rejects.toThrow('aborted');
});

test('provider failures do not expose the provider response body', async () => {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private upstream response', { status: 500 })));
	await expect(callAI('https://ai.test', 'test-key', 'openai/gpt-6-luna', [], [])).rejects.toThrow('AI API error (500)');
});

test.each([
	'What time is check-in?', 'Compare the rooms.', 'Which villa is best for 4 adults?',
	'Help me choose a quiet villa.', 'If I book direct, then what is the price?',
	'Book the pool villa for 4 adults for 3 nights under 25000 baht.',
	'แนะนำห้องสำหรับผู้ใหญ่ 4 คน', '성인 4명에게 어떤 객실을 추천하나요?'
])('keeps ordinary questions on Luna: %s', message => {
	expect(classifyComplexity(message)).toBe('simple');
});

test.each([
	'Compare a 3-night stay for 4 adults under THB 25000 with massage options and recommend the best plan.',
	'Plan a quiet stay for a family for 3 nights, considering wheelchair access.',
	'ช่วยวางแผนพัก 3 คืน ผู้ใหญ่ 4 คน งบไม่เกิน 25000 บาท พร้อมนวด',
	'성인 4명, 3박, 예산 25000 바트 이하로 숙소와 스파 계획을 비교해 추천해주세요.'
])('routes planning with multiple constraints to Sol: %s', message => {
	expect(classifyComplexity(message)).toBe('complex');
});

const solOutput = [
	{ type: 'reasoning', id: 'reasoning-1', summary: [], encrypted_content: 'opaque-provider-state' },
	{ type: 'function_call', id: 'fc-1', call_id: 'call-1', name: 'list_services', arguments: '{}' }
];

test('Sol tools round-trip through Responses while retaining encrypted reasoning and call IDs', async () => {
	const fetchMock = vi.fn()
		.mockResolvedValueOnce(new Response(JSON.stringify({ model: 'openai/gpt-6.1-sol', status: 'completed', output: solOutput, usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300, output_tokens_details: { reasoning_tokens: 180 }, cost: 0.0022 } })))
		.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Massage costs THB 2,400.' }] }] })));
	vi.stubGlobal('fetch', fetchMock);
	const trace = vi.fn();
	const messages: ChatMessage[] = [{ role: 'system', content: 'Answer from tools.' }, { role: 'user', content: 'Compare spa packages.' }];
	const execute = vi.fn(async () => JSON.stringify({ services: [{ name: 'Massage', price: 2400 }] }));
	const result = await runConciergeTurn({ message: 'Compare spa packages.', messages, tools, deadlineAt: Date.now() + 20000,
		request: (history, offered, timeoutMs) => callAI('https://openrouter.ai/api/v1', 'test-key', 'openai/gpt-6.1-sol', history, offered, trace, { timeoutMs }), execute });
	expect(result).toEqual({ content: 'Massage costs THB 2,400.', failed: false });
	expect(execute).toHaveBeenCalledExactlyOnceWith('list_services', {});
	expect(fetchMock.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/responses');
	const body = JSON.parse(fetchMock.mock.calls[0][1].body);
	expect(body).toMatchObject({ model: 'openai/gpt-6.1-sol', reasoning: { effort: 'low' }, max_output_tokens: 4096, store: false, include: ['reasoning.encrypted_content'], tools: [{ type: 'function', name: 'list_services', strict: false }] });
	expect(body).not.toHaveProperty('temperature');
	expect(body).not.toHaveProperty('messages');
	expect(JSON.parse(fetchMock.mock.calls[1][1].body).input).toEqual([
		...body.input, ...solOutput, { type: 'function_call_output', call_id: 'call-1', output: JSON.stringify({ services: [{ name: 'Massage', price: 2400 }] }) }
	]);
	expect(trace).toHaveBeenCalledWith(expect.objectContaining({ model: 'openai/gpt-6.1-sol', finishReason: 'tool_calls', usage: expect.objectContaining({ prompt_tokens: 100, completion_tokens: 200, completion_tokens_details: { reasoning_tokens: 180 } }) }));
});

test.each([
	{ status: 'failed', output: solOutput },
	{ status: 'completed', output: [{ ...solOutput[1], arguments: {} }] },
	{ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 42 }] }] },
	{ status: 'completed', output: [{ type: 'unrecognized_tool' }] },
	{ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: solOutput }
])('Sol invalid or incomplete output never executes tools', async envelope => {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope))));
	const execute = vi.fn();
	const result = await runConciergeTurn({ message: 'help', messages: [], tools, deadlineAt: Date.now() + 20000,
		request: (history, offered, timeoutMs) => callAI('https://openrouter.ai/api/v1', 'test-key', 'openai/gpt-6.1-sol', history, offered, undefined, { timeoutMs }), execute });
	expect(result.failed).toBe(true);
	expect(execute).not.toHaveBeenCalled();
});

test('Sol provider errors and timeouts use the same bounded failure path', async () => {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private upstream response', { status: 500 })));
	await expect(callAI('https://ai.test', 'test-key', 'openai/gpt-6.1-sol', [], [])).rejects.toThrow('AI API error (500)');
	vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
		options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
	})));
	await expect(callAI('https://ai.test', 'test-key', 'openai/gpt-6.1-sol', [], [], undefined, { timeoutMs: 10 })).rejects.toThrow('aborted');
});
