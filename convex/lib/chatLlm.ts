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
	| { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
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

export async function callAI(
	apiBase: string,
	apiKey: string,
	model: string,
	messages: ChatMessage[],
	tools: ToolDef[],
	onResponse?: (trace: LlmCallTrace) => void,
	options: { timeoutMs?: number; maxOutputTokens?: number } = {}
): Promise<LlmResponse> {
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
		if (!message || typeof message !== 'object' || (message.content != null && typeof message.content !== 'string') ||
			(message.tool_calls !== undefined && (!Array.isArray(message.tool_calls) || message.tool_calls.some((call: ToolCall) =>
				!call || typeof call.id !== 'string' || call.type !== 'function' || typeof call.function?.name !== 'string' || typeof call.function?.arguments !== 'string')))) {
			throw new Error('Invalid AI response');
		}
		onResponse?.({ model: data.model ?? model, latencyMs: Date.now() - startedAt, finishReason: data.choices?.[0]?.finish_reason, usage: data.usage });
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
	const lower = message.toLowerCase();

	const complexPatterns = [
		/compar/i,
		/which.*(better|best|recommend)/i,
		/differ.*between/i,
		/should i/i,
		/help me (choose|decide|pick)/i,
		/multiple.*dates/i,
		/if.*then/i,
		/budget.*plan/i
	];

	if (complexPatterns.some((p) => p.test(lower))) return 'complex';
	return 'simple';
}
