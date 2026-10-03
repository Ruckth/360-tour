import { describe, expect, it } from "vitest";
import { locales, type Locale } from "@/i18n/routing";
import * as quickAnswers from "@/lib/line/quick-answers";
import {
  buildLineQuickReplyItems,
  detectQuickAnswerLocale,
  localizedGreetingReply,
  localizedTimeoutFallbackReply,
  localizedUnknownFallbackReply,
} from "@/lib/line/quick-answers";

/** Retired coded policy claims that must never come back as LINE copy in any language. */
const RETIRED_POLICY_PATTERNS = [/48/, /฿/, /\d+\s*%/, /cancel|annul|storn|cancela|отмен|キャンセル|취소|取消|ยกเลิก|रद्द/iu];

describe("LINE presentation copy after Q&A retirement", () => {
  it("no longer exports a coded quick-answer resolver", () => {
    expect("resolveLineQuickAnswer" in quickAnswers).toBe(false);
  });

  it("keeps greeting, menu, timeout and unknown copy free of policy claims in every locale", () => {
    for (const locale of locales) {
      const copy = [
        localizedGreetingReply(locale),
        localizedTimeoutFallbackReply(locale),
        localizedUnknownFallbackReply(locale),
        ...buildLineQuickReplyItems(locale).map((item) => item.action.label),
      ];
      for (const text of copy) {
        expect(text.trim(), locale).not.toBe("");
        for (const pattern of RETIRED_POLICY_PATTERNS) expect(text, `${locale}: ${text}`).not.toMatch(pattern);
      }
    }
  });

  it("detects the guest's language from short menu phrases and scripts", () => {
    const scenarios = [
      { locale: "en", question: "See prices" },
      { locale: "th", question: "ราคาเท่าไหร่" },
      { locale: "zh-CN", question: "价格是多少" },
      { locale: "ja", question: "料金はいくらですか" },
      { locale: "ko", question: "가격이 얼마인가요" },
      { locale: "fr", question: "Quel est le prix" },
      { locale: "de", question: "Wie viel kostet es" },
      { locale: "es", question: "Cuanto cuesta" },
      { locale: "ru", question: "Сколько стоит" },
      { locale: "it", question: "Quanto costa" },
      { locale: "hi", question: "कीमत कितनी है" },
    ] satisfies Array<{ locale: Locale; question: string }>;
    expect(scenarios.map((scenario) => scenario.locale).sort()).toEqual([...locales].sort());
    for (const scenario of scenarios) {
      expect(detectQuickAnswerLocale(scenario.question), scenario.locale).toBe(scenario.locale);
    }
  });

  it("localizes timeout and unknown fallbacks", () => {
    expect(localizedUnknownFallbackReply("fr")).toContain("information vérifiée");
    expect(localizedTimeoutFallbackReply("ja")).toContain("確認中");
    expect(localizedUnknownFallbackReply("not-supported")).toContain("I do not have verified information");
  });
});
