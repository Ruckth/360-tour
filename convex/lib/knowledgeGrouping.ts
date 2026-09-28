import { normalizeSuggestedQuestion } from './chatSuggestions';

type UnknownStatus = 'new' | 'resolved' | 'ignored';

export type GroupableUnknownQuestion = {
	normalizedQuestion: string;
	status: UnknownStatus;
	createdAt: number;
};

export type UnknownQuestionGroup<T extends GroupableUnknownQuestion> = {
	normalizedQuestion: string;
	rows: T[];
	count: number;
	counts: Record<UnknownStatus, number>;
	latestAt: number;
	/** The newest row still waiting ("new"), else the newest row overall. */
	latest: T;
};

/** Groups identical questions (same normalized text), most-asked first, then most recent. */
export function groupUnknownQuestions<T extends GroupableUnknownQuestion>(rows: T[]) {
	const groups = new Map<string, UnknownQuestionGroup<T>>();
	for (const row of rows) {
		let group = groups.get(row.normalizedQuestion);
		if (!group) {
			group = {
				normalizedQuestion: row.normalizedQuestion,
				rows: [],
				count: 0,
				counts: { new: 0, resolved: 0, ignored: 0 },
				latestAt: row.createdAt,
				latest: row
			};
			groups.set(row.normalizedQuestion, group);
		}
		group.rows.push(row);
		group.count++;
		group.counts[row.status]++;
		group.latestAt = Math.max(group.latestAt, row.createdAt);
		const latestIsNew = group.latest.status === 'new';
		const rowIsNew = row.status === 'new';
		if ((rowIsNew && !latestIsNew) || (rowIsNew === latestIsNew && row.createdAt > group.latest.createdAt)) {
			group.latest = row;
		}
	}
	return [...groups.values()].sort((left, right) => right.count - left.count || right.latestAt - left.latestAt);
}

const STOPWORDS = new Set(
	'a an the is are was were be do does did can could would will should i you we my your our me it its this that there here to of in on at for with and or if about any have has please hi hello what which who how when where'.split(
		' '
	)
);
// Scripts written without spaces are compared by character pairs instead of words.
const UNSPACED_SCRIPT = /[\p{Script=Thai}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Lao}\p{Script=Khmer}]/u;

function matchTokens(text: string) {
	const tokens = new Set<string>();
	for (const word of normalizeSuggestedQuestion(text).split(' ')) {
		if (!word) continue;
		if (UNSPACED_SCRIPT.test(word)) {
			const chars = [...word];
			if (chars.length === 1) tokens.add(word);
			for (let index = 0; index < chars.length - 1; index++) tokens.add(chars[index] + chars[index + 1]);
			continue;
		}
		if (STOPWORDS.has(word)) continue;
		tokens.add(word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word);
	}
	return tokens;
}

export type AnswerMatchCandidate = { answerId: string; text: string };

/**
 * Cheap lexical matcher (no LLM): exact normalized match scores 1, otherwise the Dice overlap of
 * content words. Build once per request, then call per question.
 */
export function createAnswerMatcher<T extends AnswerMatchCandidate>(candidates: T[], threshold = 0.4) {
	const prepared = candidates.map((candidate) => ({
		candidate,
		normalized: normalizeSuggestedQuestion(candidate.text),
		tokens: matchTokens(candidate.text)
	}));
	return (question: string): { candidate: T; score: number } | null => {
		const normalized = normalizeSuggestedQuestion(question);
		const tokens = matchTokens(question);
		let best: { candidate: T; score: number } | null = null;
		for (const entry of prepared) {
			let score = entry.normalized === normalized ? 1 : 0;
			if (!score && tokens.size && entry.tokens.size) {
				let shared = 0;
				for (const token of tokens) if (entry.tokens.has(token)) shared++;
				score = (2 * shared) / (tokens.size + entry.tokens.size);
			}
			if (score >= threshold && (!best || score > best.score)) best = { candidate: entry.candidate, score };
		}
		return best;
	};
}
