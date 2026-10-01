import { afterEach, expect, test, vi } from 'vitest';
import { callAI } from './lib/chatLlm';

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
