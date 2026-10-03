export const DEFAULT_AI_MODEL = 'openai/gpt-6-luna';
export const DEFAULT_AI_API_BASE_URL = 'https://openrouter.ai/api/v1';

export type ToolCall = {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
};

export type ChatMessage =
	| { role: 'system'; content: string }
	| { role: 'user'; content: string }
	| { role: 'assistant'; content: string | null; tool_calls?: ToolCall[]; responsesOutput?: Record<string, unknown>[] }
	| { role: 'tool'; content: string; tool_call_id: string };

export type ToolDef = {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: {
			type: 'object';
			properties: Record<string, { type: string; description?: string; minimum?: number; maximum?: number; format?: string; pattern?: string }>;
			required?: string[];
			additionalProperties?: boolean;
		};
	};
};

export type LlmResponse = {
	content: string | null;
	tool_calls?: ToolCall[];
	finishReason?: string;
	/** Responses items, including encrypted reasoning, replayed only within this turn. */
	responsesOutput?: Record<string, unknown>[];
};

export type LlmCallTrace = {
	model: string;
	latencyMs: number;
	finishReason?: string;
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
		cost?: number;
		prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
		completion_tokens_details?: { reasoning_tokens?: number };
	};
};

/** Carries only safe draft-invalidation hints, never provider text or arguments. */
export class InvalidAiResponseError extends Error {
	readonly preparationTools: string[];

	constructor(toolNames: unknown[] = []) {
		super('Invalid AI response');
		this.preparationTools = [...new Set(toolNames.filter((name): name is string =>
			name === 'prepare_booking' || name === 'prepare_service_booking'))];
	}
}

/** Reject the whole provider batch before any tool can execute. */
function validateToolCalls(calls: ToolCall[], invalid: () => InvalidAiResponseError) {
	const ids = new Set<string>();
	for (const call of calls) {
		if (!call.id.trim() || ids.has(call.id) || !call.function.name.trim()) throw invalid();
		ids.add(call.id);
		let args: unknown;
		try {
			args = JSON.parse(call.function.arguments);
		} catch {
			throw invalid();
		}
		if (!args || typeof args !== 'object' || Array.isArray(args)) throw invalid();
	}
}

export async function callAI(
	apiBase: string,
	apiKey: string,
	model: string,
	messages: ChatMessage[],
	tools: ToolDef[],
	onResponse?: (trace: LlmCallTrace) => void,
	options: { timeoutMs?: number; maxOutputTokens?: number } = {}
): Promise<LlmResponse> {
	if (model === 'openai/gpt-6.1-sol' || model === 'gpt-6.1-sol') {
		return callSol(apiBase, apiKey, model, messages, tools, onResponse, options);
	}
	const body: {
		model: string;
		messages: ChatMessage[];
		temperature?: number;
		max_tokens?: number;
		max_completion_tokens?: number;
		reasoning_effort?: 'none';
		tools?: ToolDef[];
		tool_choice?: 'auto';
	} = {
		model,
		messages,
		temperature: 0.7,
		max_tokens: options.maxOutputTokens ?? 500
	};
	// Luna's Chat Completions function calling requires reasoning to be disabled.
	if (model === 'gpt-6-luna' || model === 'openai/gpt-6-luna') {
		delete body.temperature;
		delete body.max_tokens;
		body.max_completion_tokens = options.maxOutputTokens ?? 500;
		body.reasoning_effort = 'none';
	}

	if (tools.length > 0) {
		body.tools = tools;
		body.tool_choice = 'auto';
	}

	const startedAt = Date.now();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), Math.max(1, options.timeoutMs ?? 15_000));
	try {
		const res = await fetch(`${apiBase}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`
			},
			body: JSON.stringify(body),
			signal: controller.signal
		});

		if (!res.ok) {
			throw new Error(`AI API error (${res.status})`);
		}

		const data = await res.json();
		const message = data?.choices?.[0]?.message;
		const invalid = () => new InvalidAiResponseError(Array.isArray(message?.tool_calls)
			? message.tool_calls.map((call: ToolCall | null) => call?.function?.name) : []);
		if (!message || typeof message !== 'object' || (message.content != null && typeof message.content !== 'string') ||
			(message.tool_calls !== undefined && (!Array.isArray(message.tool_calls) || message.tool_calls.some((call: ToolCall) =>
				!call || typeof call.id !== 'string' || call.type !== 'function' || typeof call.function?.name !== 'string' || typeof call.function?.arguments !== 'string')))) {
			throw invalid();
		}
		validateToolCalls(message.tool_calls ?? [], invalid);
		onResponse?.({ model: data.model ?? model, latencyMs: Date.now() - startedAt, finishReason: data.choices?.[0]?.finish_reason, usage: data.usage });
		if (['length', 'content_filter'].includes(data.choices?.[0]?.finish_reason)) throw invalid();
		const choice = data.choices?.[0]?.message;

		return {
			content: choice?.content ?? null,
			tool_calls: choice?.tool_calls,
			...(data.choices?.[0]?.finish_reason ? { finishReason: data.choices[0].finish_reason } : {})
		};
	} finally {
		clearTimeout(timeout);
	}
}

export function classifyComplexity(message: string): 'simple' | 'complex' {
	// This is only a routing hint for an explicitly configured complex model.
	// Constraint count is not a capability boundary; both routes default to Luna.
	const decision = /\b(?:compar\w*|recommend\w*|plan\w*|choose|decide|best|optimi[sz]\w*|trade.?offs?)\b|เปรียบเทียบ|แนะนำ|วางแผน|เลือก|คุ้มที่สุด|비교|추천|계획|선택|최적/i;
	const constraints = [
		/\b(?:budget|under|at most|no more than|cheapest|afford\w*)\b|งบ|ไม่เกิน|예산|이하/i,
		/\b\d+\s*(?:adults?|children|kids?|guests?|people|persons?)\b|\b(?:family|couple|group)\b|ผู้ใหญ่|เด็ก|ครอบครัว|성인|아이|가족|\d+\s*명/i,
		/\b\d+\s*(?:nights?|days?|weeks?)\b|\b(?:dates?|weekend|itinerary)\b|\d{4}-\d{2}-\d{2}|\d+\s*(?:คืน|วัน|박|일)|วันที่|일정/i,
		/\b(?:quiet|private|accessible|wheelchair|bedrooms?|pool|garden)\b|เงียบ|ส่วนตัว|รถเข็น|ห้องนอน|สระ|조용|프라이빗|휠체어|침실|수영장/i,
		/\b(?:spa|massage|services?|activities|treatments?)\b|สปา|นวด|กิจกรรม|스파|마사지|서비스|활동/i
	];
	if (decision.test(message) && constraints.filter(pattern => pattern.test(message)).length >= 3) return 'complex';
	return 'simple';
}

/** Sol requires Responses for function calling and reasoning across tool rounds. */
async function callSol(
	apiBase: string, apiKey: string, model: string, messages: ChatMessage[], tools: ToolDef[],
	onResponse: ((trace: LlmCallTrace) => void) | undefined,
	options: { timeoutMs?: number; maxOutputTokens?: number }
): Promise<LlmResponse> {
	const input: Record<string, unknown>[] = [];
	for (const message of messages) {
		if (message.role === 'tool') {
			input.push({ type: 'function_call_output', call_id: message.tool_call_id, output: message.content });
		} else if (message.role === 'assistant' && message.responsesOutput) {
			input.push(...message.responsesOutput);
		} else {
			if (message.content !== null) input.push({ role: message.role, content: message.content });
			if (message.role === 'assistant') {
				for (const call of message.tool_calls ?? []) input.push({ type: 'function_call', call_id: call.id, ...call.function });
			}
		}
	}
	const body = {
		model, input, store: false, include: ['reasoning.encrypted_content'], reasoning: { effort: 'low' },
		// This budget includes reasoning tokens as well as the visible reply.
		max_output_tokens: options.maxOutputTokens ?? 4096,
		...(tools.length ? {
			tools: tools.map(tool => ({ type: 'function', ...tool.function, strict: false })),
			tool_choice: 'auto'
		} : {})
	};
	const startedAt = Date.now();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), Math.max(1, options.timeoutMs ?? 15_000));
	try {
		const res = await fetch(`${apiBase}/responses`, {
			method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
			body: JSON.stringify(body), signal: controller.signal
		});
		if (!res.ok) throw new Error(`AI API error (${res.status})`);
		const data = await res.json();
		const invalid = () => new InvalidAiResponseError(Array.isArray(data?.output)
			? data.output.map((item: { type?: unknown; name?: unknown } | null) => item?.type === 'function_call' ? item.name : undefined) : []);
		if (!data || !Array.isArray(data.output) || !['completed', 'incomplete'].includes(data.status) || data.error) throw invalid();
		const toolCalls: ToolCall[] = [];
		const text: string[] = [];
		for (const item of data.output) {
			if (!item || typeof item !== 'object' || Array.isArray(item) ||
				(item.status !== undefined && item.status !== 'completed')) throw invalid();
			if (item.type === 'function_call') {
				if (typeof item.call_id !== 'string' || !item.call_id || typeof item.name !== 'string' || typeof item.arguments !== 'string') throw invalid();
				toolCalls.push({ id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } });
			} else if (item.type === 'message') {
				if (item.role !== 'assistant' || !Array.isArray(item.content)) throw invalid();
				for (const part of item.content) {
					if (part?.type === 'output_text' && typeof part.text === 'string') text.push(part.text);
					else if (part?.type === 'refusal' && typeof part.refusal === 'string') text.push(part.refusal);
					else throw invalid();
				}
			} else if (item.type === 'reasoning') {
				if (!Array.isArray(item.summary) || item.summary.some((part: { type?: unknown; text?: unknown } | null) =>
					!part || part.type !== 'summary_text' || typeof part.text !== 'string') ||
					(item.encrypted_content !== undefined && typeof item.encrypted_content !== 'string')) throw invalid();
			} else throw invalid();
		}
		validateToolCalls(toolCalls, invalid);
		// All incomplete output is unsafe for tools, even if the partial arguments parse.
		const finishReason = data.status === 'incomplete' ? 'length' : toolCalls.length ? 'tool_calls' : 'stop';
		onResponse?.({ model: data.model ?? model, latencyMs: Date.now() - startedAt, finishReason, usage: data.usage ? {
			prompt_tokens: data.usage.input_tokens, completion_tokens: data.usage.output_tokens,
			total_tokens: data.usage.total_tokens, cost: data.usage.cost,
			prompt_tokens_details: data.usage.input_tokens_details,
			completion_tokens_details: data.usage.output_tokens_details
		} : undefined });
		if (data.status === 'incomplete') throw invalid();
		return { content: text.join('\n') || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}), finishReason, responsesOutput: data.output };
	} finally {
		clearTimeout(timeout);
	}
}
