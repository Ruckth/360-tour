
/** Stable snapshot identity; the model never supplies or updates this value. */
export function proposalIdentity(quote: object | undefined): string {
	return quote ? JSON.stringify(Object.entries(quote).filter(([key]) => key !== 'bookingId' && key !== 'appointmentId').sort(([a], [b]) => a.localeCompare(b))) : '';
}

export function assertSameProposal(quote: object | undefined, expected?: string) {
	if (expected !== undefined && proposalIdentity(quote) !== expected) {
		throw new Error('The booking proposal changed. Show the current summary and ask for confirmation again.');
	}
}
