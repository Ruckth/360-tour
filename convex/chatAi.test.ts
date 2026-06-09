import { describe, expect, it } from "vitest";
import { getResortRealityDisclosure } from "./chatAi";

describe("chat AI guardrails", () => {
  it("does not claim real-world verification for English reality questions", () => {
    const reply = getResortRealityDisclosure(
      "Is Auralis Cove a real luxury villa resort?",
      "https://tour.helpgueststay.com/api/line/webhook",
    );

    expect(reply).toContain("demo/preview experience");
    expect(reply).toContain("should not claim it is a real-world verified resort");
    expect(reply).not.toContain("is a real luxury villa resort");
    expect(reply).not.toContain("/api/line/webhook");
  });

  it("does not claim real-world verification for Thai reality questions", () => {
    const reply = getResortRealityDisclosure("ที่พักนี้มีอยู่จริงไหม");

    expect(reply).toContain("เดโม/พรีวิว");
    expect(reply).toContain("ไม่ควรยืนยันว่าเป็นรีสอร์ตจริง");
  });

  it("does not intercept ordinary villa questions", () => {
    expect(getResortRealityDisclosure("Which villa is best for 4 adults?")).toBeNull();
  });
});
