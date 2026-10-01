import type { Doc } from '../_generated/dataModel';

/** Runs inside the write transaction, so takeover/deadline races cannot bypass it. */
export function assertChatWriteAllowed(session: Doc<'chatSessions'>, deadlineAt?: number) {
	if (session.aiPaused) throw new Error('AI replies are paused: staff took over this chat');
	if (deadlineAt !== undefined && Date.now() >= deadlineAt) throw new Error('AI turn deadline exceeded');
}

/** Stable snapshot identity; the model never supplies or updates this value. */
export function proposalIdentity(quote: object | undefined): string {
	return quote ? JSON.stringify(Object.entries(quote).filter(([key]) => key !== 'bookingId' && key !== 'appointmentId').sort(([a], [b]) => a.localeCompare(b))) : '';
}

export function assertSameProposal(quote: object | undefined, expected?: string) {
	if (expected !== undefined && proposalIdentity(quote) !== expected) {
		throw new Error('The booking proposal changed. Show the current summary and ask for confirmation again.');
	}
}
