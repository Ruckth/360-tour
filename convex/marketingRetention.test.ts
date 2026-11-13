// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { MARKETING_CLEANUP_BATCH_SIZE } from './marketing/maintenance';
import { ATTRIBUTION_WINDOW_MS } from './shared/marketingAttribution';
import { RAW_MARKETING_RETENTION_DAYS, RAW_MARKETING_RETENTION_MS } from "./shared/marketingPolicy";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.useRealTimers());

it("retains raw data longer than the attribution and affiliate lookback", () => {
  expect(RAW_MARKETING_RETENTION_DAYS).toBe(90);
  expect(RAW_MARKETING_RETENTION_MS).toBeGreaterThan(ATTRIBUTION_WINDOW_MS);
});

it("deletes only old raw rows in bounded pages and schedules all remaining pages", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-07T10:00:00Z"));
  const t = convexTest(schema, modules);
  const cutoff = Date.now() - RAW_MARKETING_RETENTION_MS;
  const { linkId, aggregateId, keptSessions, keptEvents } = await t.run(async ctx => {
    const campaignId = await ctx.db.insert("marketingCampaigns", {
      name: "Campaign", source: "partner", medium: "affiliate", status: "active",
      createdAt: 0, updatedAt: 0, updatedByEmail: "admin@example.com",
    });
    const linkId = await ctx.db.insert("marketingLinks", {
      campaignId, slug: "retention", name: "Link", destination: { kind: "home" },
      entry: "link", status: "active", opens: 1234,
      createdAt: 0, updatedAt: 0, updatedByEmail: "admin@example.com",
    });
    const aggregateId = await ctx.db.insert("marketingSessionDays", {
      day: "2020-01-01", linkId, campaignId, count: 1234,
    });
    // Unequal table sizes force continuation after one table has already finished.
    for (let i = 0; i < MARKETING_CLEANUP_BATCH_SIZE * 2 + 3; i++) {
      await ctx.db.insert("marketingSessions", {
        visitorKey: "old", linkId, campaignId, landingPath: "/", startedAt: cutoff - i - 1,
      });
      if (i <= MARKETING_CLEANUP_BATCH_SIZE) await ctx.db.insert("marketingEvents", {
        linkId, kind: "open", bot: false, occurredAt: cutoff - i - 1,
      });
    }
    const keptSessions = [];
    const keptEvents = [];
    for (const timestamp of [cutoff, cutoff + 1, Date.now()]) {
      keptSessions.push(await ctx.db.insert("marketingSessions", {
        visitorKey: "recent", linkId, campaignId, landingPath: "/", startedAt: timestamp,
      }));
      keptEvents.push(await ctx.db.insert("marketingEvents", {
        linkId, kind: "open", bot: false, occurredAt: timestamp,
      }));
    }
    return { linkId, aggregateId, keptSessions, keptEvents };
  });
  expect(await t.mutation(internal.marketing.maintenance.cleanRawMarketing, {})).toBe(MARKETING_CLEANUP_BATCH_SIZE * 2);
  await t.run(async ctx => {
    expect(await ctx.db.query("marketingSessions").collect()).toHaveLength(MARKETING_CLEANUP_BATCH_SIZE + 6);
    expect(await ctx.db.query("marketingEvents").collect()).toHaveLength(4);
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      name: 'marketing/maintenance:cleanRawMarketing',
      args: [{ cutoff }],
      scheduledTime: Date.now(),
    });
  });
  // The chain retains its original cutoff even when the next page runs a day later.
  vi.setSystemTime(Date.now() + 86_400_000);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await t.run(async ctx => {
    expect((await ctx.db.query("marketingSessions").collect()).map(row => row._id).sort()).toEqual(keptSessions.sort());
    expect((await ctx.db.query("marketingEvents").collect()).map(row => row._id).sort()).toEqual(keptEvents.sort());
    expect(await ctx.db.get(aggregateId)).toMatchObject({ count: 1234, day: "2020-01-01" });
    expect(await ctx.db.get(linkId)).toMatchObject({ opens: 1234 });
  });
  expect(await t.mutation(internal.marketing.maintenance.cleanRawMarketing, { cutoff })).toBe(0);
});
