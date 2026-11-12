/** The finite set of question chips shared by browser selection and tracking. */
export const STATIC_SUGGESTION_KEYS = [
	'availability', 'totalPrice', 'direct', 'tour', 'guests', 'contact',
	'couple', 'family', 'cancellation', 'airport', 'amenitiesIncluded', 'location'
] as const;

export type StaticSuggestionKey = (typeof STATIC_SUGGESTION_KEYS)[number];

export type SuggestedQuestionStatus = "active" | "clicked" | "archived";

export const supportedSuggestionLocales = [
  "en",
  "th",
  "zh-CN",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "ru",
  "it",
  "hi",
] as const;

export type SuggestionLocale = (typeof supportedSuggestionLocales)[number];
export type SuggestedQuestionTranslations = Partial<Record<SuggestionLocale, string>>;

export type SuggestedQuestionCandidate = {
  _id?: string;
  question: string;
  normalizedQuestion?: string;
  translations?: SuggestedQuestionTranslations;
  score: number;
  createdAt: number;
  clickedAt?: number;
  status?: SuggestedQuestionStatus;
};

export type RankedQuestionSelectionInput<T extends SuggestedQuestionCandidate> = {
  candidates: T[];
  askedQuestions?: string[];
  clickedQuestions?: string[];
  limit?: number;
};

export function normalizeSuggestedQuestion(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/\bwhat['’`]?s\b/g, "what is")
    .replace(/\bwho['’`]?s\b/g, "who is")
    .replace(/\bwhere['’`]?s\b/g, "where is")
    .replace(/\bwhen['’`]?s\b/g, "when is")
    .replace(/\bhow['’`]?s\b/g, "how is")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeSuggestionLocale(locale?: string): SuggestionLocale {
  const normalized = locale?.trim();
  return supportedSuggestionLocales.includes(normalized as SuggestionLocale)
    ? (normalized as SuggestionLocale)
    : "en";
}

export function getSuggestedQuestionForLocale(
  candidate: Pick<SuggestedQuestionCandidate, "question" | "translations">,
  locale?: string,
) {
  const normalizedLocale = normalizeSuggestionLocale(locale);
  if (normalizedLocale === "en") return candidate.question;
  return (
    candidate.translations?.[normalizedLocale]?.trim() ||
    candidate.question
  );
}

function normalizedQuestionVariants(candidate: SuggestedQuestionCandidate) {
  const values = [
    candidate.question,
    candidate.normalizedQuestion,
    ...Object.values(candidate.translations ?? {}),
  ];
  return values
    .filter((value): value is string => typeof value === "string")
    .map(normalizeSuggestedQuestion)
    .filter(Boolean);
}

export function selectRankedSuggestedQuestions<T extends SuggestedQuestionCandidate>({
  candidates,
  askedQuestions = [],
  clickedQuestions = [],
  limit = 2,
}: RankedQuestionSelectionInput<T>) {
  const blocked = new Set(
    [...askedQuestions, ...clickedQuestions]
      .map(normalizeSuggestedQuestion)
      .filter(Boolean),
  );
  const seen = new Set<string>();

  return [...candidates]
    .filter((candidate) => candidate.status === undefined || candidate.status === "active")
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return right.createdAt - left.createdAt;
    })
    .filter((candidate) => {
      const variants = normalizedQuestionVariants(candidate);
      if (!variants.length) return false;
      if (variants.some((normalized) => blocked.has(normalized) || seen.has(normalized))) {
        return false;
      }
      variants.forEach((normalized) => seen.add(normalized));
      return true;
    })
    .slice(0, Math.max(0, limit));
}

export function clampSuggestionScore(score: number) {
  if (!Number.isFinite(score)) return 50;
  return Math.max(0, Math.min(100, Math.round(score)));
}
