import { describe, expect, it } from "vitest";
import { channelConfigStatus } from "@/lib/admin/channel-config";

describe("channelConfigStatus", () => {
  it("reports presence per channel without exposing values", () => {
    const status = channelConfigStatus({
      LINE_CHANNEL_SECRET: "secret",
      LINE_CHANNEL_ACCESS_TOKEN: "token",
      META_APP_SECRET: "meta",
      FACEBOOK_VERIFY_TOKEN: "verify",
      FACEBOOK_ACCESS_TOKEN: " ",
    } as unknown as NodeJS.ProcessEnv);

    expect(status.line).toEqual({
      configured: true,
      vars: { LINE_CHANNEL_SECRET: true, LINE_CHANNEL_ACCESS_TOKEN: true },
    });
    expect(status.facebook.configured).toBe(false);
    expect(status.facebook.vars).toEqual({
      "FACEBOOK_APP_SECRET or META_APP_SECRET": true,
      FACEBOOK_VERIFY_TOKEN: true,
      FACEBOOK_ACCESS_TOKEN: false,
    });
    expect(status.whatsapp.configured).toBe(false);
    expect(JSON.stringify(status)).not.toMatch(/"(secret|token|meta|verify)"/);
  });
});
