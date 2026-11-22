import { getConvexSize, getDocumentSize, type Value } from 'convex/values';
import { sha256 } from '../shared/displayTokens';
import { MAX_CONVEX_DOCUMENT_BYTES, MAX_CONVEX_DOCUMENT_ID_LENGTH } from '../shared/documentSize';

type Snapshot = Record<string, Value>;
const LARGE_FIELD_BYTES = 64 * 1024;

type RoomAudit = {
	entityType: 'room';
	entityId: string;
	actor: string;
	kind: string;
	before: Snapshot | null;
	after: Snapshot | null;
};

export function roomAuditLabel(value: string): string {
	if (value.length <= 1024) return value;
	// Use code points so a preview can never introduce an unpaired surrogate.
	return Array.from(value.slice(0, 240)).slice(0, 120).join('') + '…';
}

/** Preserve ordinary snapshots, then exact changes, then a bounded fingerprint of a large field. */
export async function boundedRoomAudit(event: RoomAudit): Promise<RoomAudit> {
	const fits = (candidate: RoomAudit) =>
		getDocumentSize({ ...candidate, effectiveAt: 0, recordedAt: 0 }, {
			customIdLength: MAX_CONVEX_DOCUMENT_ID_LENGTH
		}) <= MAX_CONVEX_DOCUMENT_BYTES;
	if (fits(event)) return event;

	const { before, after } = event;
	const changed = new Set(Object.keys({ ...before, ...after }).filter((key) =>
		JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])
	));
	const select = (snapshot: Snapshot | null) => snapshot && Object.fromEntries(
		Object.entries(snapshot).filter(([key]) => changed.has(key))
	);
	const delta = { ...event, before: select(before), after: select(after) };
	if (fits(delta)) return delta;

	async function compact(snapshot: Snapshot | null) {
		if (!snapshot) return null;
		const fields = Object.entries(snapshot);
		return Object.fromEntries(await Promise.all(fields.map(async ([key, value]) => {
			const auditBytes = getConvexSize(value);
			if (auditBytes <= LARGE_FIELD_BYTES) return [key, value] as const;
			const serialized = JSON.stringify(value);
			return [key, {
				roomAuditPreview: typeof value === 'string' ? roomAuditLabel(value) : `${Array.isArray(value) ? value.length + ' entries' : 'Large value'}`,
				auditBytes,
				auditSha256: await sha256(serialized)
			}] as const;
		})));
	}
	return { ...delta, before: await compact(delta.before), after: await compact(delta.after) };
}
