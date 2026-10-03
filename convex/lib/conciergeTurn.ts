import type { ChatMessage, LlmResponse, ToolDef } from './chatLlm';
import { bookingStatusReply, committedReply, hasTransactionCompletionClaim, isCancellationRequest, isGuestConfirmation, proposalReply, toolFailureReply } from './conciergePolicy';
import { toolError } from './chatTools';

type TurnOptions = {
	message: string;
	messages: ChatMessage[];
	tools: ToolDef[];
	request: (messages: ChatMessage[], tools: ToolDef[], timeoutMs: number) => Promise<LlmResponse>;
	execute: (name: string, args: unknown) => Promise<string>;
	onTool?: (trace: { name: string; args: Record<string, unknown>; result: string }) => void | Promise<void>;
	invalidateProposal?: (name: string) => Promise<void>;
	deadlineAt: number;
	/** Optional metrics sink. Records each model request (ms) and each tool (name, ms, ok). */
	metrics?: {
		recordModelRequest?: (ms: number) => void;
		recordTool?: (name: string, ms: number, ok: boolean) => void;
	};
};

/** Bounded model/tool orchestration; writes stay sequential and are never retried here. */
export async function runConciergeTurn(options: TurnOptions): Promise<{ content: string | null; failed: boolean; committedTool?: string }> {
	const { messages, tools, message } = options;
	const allowed = new Set(tools.map(tool => tool.function.name));
	const prepared = new Set<string>();
	let toolCount = 0;
	let failedTool = false;
	let committed: string | null = null;
	let committedTool: string | undefined;
	let proposal: string | null = null;
	let status: string | null = null;
	const reads = new Map<string, string>();
	const request = async (offeredTools: ToolDef[]) => {
		const remaining = options.deadlineAt - Date.now();
		if (remaining <= 0) throw new Error('AI turn deadline exceeded');
		const startedAt = Date.now();
		try {
			return await options.request(messages, offeredTools, Math.min(remaining, 15_000));
		} finally {
			options.metrics?.recordModelRequest?.(Date.now() - startedAt);
		}
	};
	try {
		let response = await request(tools);
		for (let round = 0; response.tool_calls?.length && round < 3; round++) {
			if (response.finishReason === 'length') return { content: toolFailureReply(message), failed: true };
			if (response.tool_calls.length > 12) return { content: toolFailureReply(message), failed: true };
			messages.push({ role: 'assistant', content: response.content, tool_calls: response.tool_calls, ...(response.responsesOutput ? { responsesOutput: response.responsesOutput } : {}) });
			for (const call of response.tool_calls) {
				const name = call.function.name;
				let args: unknown;
				let result: string;
				const toolStartedAt = Date.now();
				try {
					if (++toolCount > 12) throw new Error('Tool call budget exceeded');
					if (!allowed.has(name)) throw new Error(`Unknown function: ${name}`);
					if (Date.now() >= options.deadlineAt) throw new Error('AI turn deadline exceeded');
					if (committed && /^(?:prepare|confirm|cancel)_/.test(name)) throw new Error('A transaction already completed in this turn');
					if (name.startsWith('prepare_')) {
						prepared.add(name);
						await options.invalidateProposal?.(name);
					}
					args = JSON.parse(call.function.arguments);
					if (name.startsWith('confirm_')) {
						if (prepared.has(name.replace('confirm_', 'prepare_'))) throw new Error('Ask the guest to confirm the summary first; confirm after they reply yes.');
						if (!isGuestConfirmation(message)) throw new Error('Ask the guest to explicitly confirm the current summary first.');
					}
					if (name === 'cancel_booking' && !isGuestConfirmation(message) && !isCancellationRequest(message)) throw new Error('Ask the guest to confirm cancellation first.');
					const writes = /^(?:prepare|confirm|cancel)_/.test(name);
					const key = JSON.stringify([name, args]);
					if (writes) reads.clear();
					result = !writes && reads.has(key) ? reads.get(key)! : await options.execute(name, args);
					if (!writes) {
						const value = JSON.parse(result);
						if (!value.error && value.ok !== false) reads.set(key, result);
					}
				} catch (error) {
					result = toolError('TOOL_REJECTED', error instanceof Error ? error.message : 'Tool failed');
				}
				const payload = JSON.parse(result) as Record<string, unknown>;
				const toolOk = !(payload.error || payload.ok === false);
				options.metrics?.recordTool?.(name, Date.now() - toolStartedAt, toolOk);
				failedTool ||= !toolOk;
				if (name.startsWith('prepare_')) proposal = null;
				proposal = proposalReply(name, payload, message) ?? proposal;
				if (!committed) {
					committed = committedReply(name, payload, message);
					if (committed) committedTool = name;
				}
				if (name === 'get_my_bookings') status = bookingStatusReply(payload, message);
				await options.onTool?.({ name, args: args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {}, result });
				messages.push({ role: 'tool', content: result, tool_call_id: call.id });
			}
			// A committed transaction has an authoritative reply and needs no further model call.
			if (committed) return { content: committed, failed: false, committedTool };
			if (proposal) return { content: proposal, failed: false };
			if (status && !failedTool) return { content: status, failed: false };
			response = await request(tools);
		}
		if (response.tool_calls?.some(call => /^(?:prepare|confirm|cancel)_/.test(call.function.name))) return { content: toolFailureReply(message), failed: true };
		if (response.tool_calls?.length || !response.content?.trim()) {
			messages.push({ role: 'system', content: 'Tool budget ended. No remaining tool requests were executed. Explain verified results only; never claim an unexecuted or failed action succeeded.' });
			response = await request([]);
		}
		if (response.finishReason === 'length' || response.tool_calls?.length || hasTransactionCompletionClaim(response.content ?? '')) {
			return { content: toolFailureReply(message), failed: true };
		}
		return { content: response.content, failed: false };
	} catch {
		return committed ? { content: committed, failed: false, committedTool } : { content: toolFailureReply(message), failed: true };
	}
}
