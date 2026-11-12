import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { localDateTimeUtc } from "./lib/serviceSlots";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const date = "2026-09-25";
const at = (time: string, day = date) => localDateTimeUtc(day, time);
const weekdays = [0, 1, 2, 3, 4, 5, 6];

async function setup() {
  vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({
    email: "admin@example.com",
    tokenIdentifier: "admin",
  });
  const maliId = await admin.mutation(api.services.commands.createStaff.createStaff, {
    name: "Mali",
    role: "Therapist",
    color: "#abc",
    workingHours: weekdays.map((weekday) => ({
      weekday,
      start: "09:00",
      end: "18:00",
    })),
    breaks: [],
  });
  const serviceId = await admin.mutation(api.services.commands.createService.createService, {
    slug: "thai-massage",
    name: "Thai massage",
    description: "",
    category: "Wellness",
    durationMin: 60,
    bufferMin: 15,
    price: 200000,
    currency: "THB",
    staffIds: [maliId],
  });
  const book = async (
    time: string,
    extra: Record<string, unknown> = {},
    day = date,
  ) =>
    await admin.mutation(api.services.commands.createAppointment.createAppointment, {
      serviceId,
      staffId: maliId,
      start: at(time, day),
      guestName: "Ann",
      guestPhone: "+66111",
      ...extra,
    });
  const get = async (id: Id<"appointments">) =>
    (await t.run((ctx) => ctx.db.get(id)))!;
  return { t, admin, maliId, serviceId, book, get };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-24T00:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("staff occupancy and finance consistency", () => {
  it("protects completed turnaround across hours, time off, archive and roster, then releases at its exact end", async () => {
    const { admin, maliId, book } = await setup();
    const { appointmentId } = await book("10:45");
    await admin.mutation(api.services.commands.updateAppointmentStatus.updateAppointmentStatus, {
      appointmentId,
      status: "completed",
      expectedRevision: 0,
    });
    vi.setSystemTime(at("11:50"));
    const off = await admin.mutation(api.services.commands.addTimeOff.addTimeOff, {
      staffId: maliId,
      start: at("13:00"),
      end: at("14:00"),
      label: "Leave",
    });
    const before = await admin.query(api.services.admin.listStaff, {});
    await expect(
      admin.mutation(api.services.commands.updateStaff.updateStaff, {
        staffId: maliId,
        workingHours: weekdays.map((weekday) => ({
          weekday,
          start: "09:00",
          end: "11:45",
        })),
      }),
    ).rejects.toThrow("outside the new hours");
    expect(await admin.query(api.services.admin.listStaff, {})).toEqual(before);
    const conflict = await admin.mutation(api.services.commands.addTimeOff.addTimeOff, {
      staffId: maliId,
      start: at("11:50"),
      end: at("13:00"),
      label: "Leave",
    });
    expect(conflict[0].timeOffId).toBeUndefined();
    expect(conflict[0].conflicts).toMatchObject([{ appointmentId }]);
    await expect(
      admin.mutation(api.services.commands.updateTimeOff.updateTimeOff, {
        timeOffId: off[0].timeOffId!,
        start: at("11:50"),
        end: at("14:00"),
        label: "Leave",
      }),
    ).rejects.toThrow("appointments during this time off");
    expect(
      await admin.query(api.services.admin.countUpcomingAppointments, {
        staffId: maliId,
      }),
    ).toBe(1);
    await expect(
      admin.mutation(api.services.commands.archiveStaff.archiveStaff, { staffId: maliId }),
    ).rejects.toThrow("Reassign or cancel");
    expect(
      (
        await admin.mutation(api.services.roster.applyCells, {
          cells: [{ staffId: maliId, date }],
          shifts: [{ start: "09:00", end: "11:45" }],
          breaks: [],
        })
      ).ok,
    ).toBe(false);
    vi.setSystemTime(at("12:00"));
    expect(
      await admin.query(api.services.admin.countUpcomingAppointments, {
        staffId: maliId,
      }),
    ).toBe(0);
    await admin.mutation(api.services.commands.updateStaff.updateStaff, {
      staffId: maliId,
      workingHours: weekdays.map((weekday) => ({
        weekday,
        start: "09:00",
        end: "11:45",
      })),
    });
    expect(
      (
        await admin.mutation(api.services.commands.addTimeOff.addTimeOff, {
          staffId: maliId,
          start: at("12:00"),
          end: at("13:00"),
          label: "Leave",
        })
      )[0].timeOffId,
    ).toBeDefined();
    await admin.mutation(api.services.commands.archiveStaff.archiveStaff, { staffId: maliId });
  });
  it("retains future completed occupancy and permits adjacent time off before turnaround ends", async () => {
    const { admin, maliId, serviceId, book } = await setup();
    const { appointmentId } = await book("10:45");
    await admin.mutation(api.services.commands.updateAppointmentStatus.updateAppointmentStatus, {
      appointmentId,
      status: "completed",
      expectedRevision: 0,
    });
    expect(
      await admin.query(api.services.admin.countUpcomingAppointments, {
        serviceId,
      }),
    ).toBe(1);
    expect(
      (
        await admin.mutation(api.services.commands.addTimeOff.addTimeOff, {
          staffId: maliId,
          start: at("10:00"),
          end: at("12:00"),
          label: "Leave",
        })
      )[0].conflicts,
    ).toMatchObject([{ appointmentId }]);
    await expect(
      admin.mutation(api.services.commands.archiveStaff.archiveStaff, { staffId: maliId }),
    ).rejects.toThrow("Reassign or cancel");
    vi.setSystemTime(at("11:50"));
    expect(
      (
        await admin.mutation(api.services.commands.addTimeOff.addTimeOff, {
          staffId: maliId,
          start: at("12:00"),
          end: at("13:00"),
          label: "Adjacent",
        })
      )[0].timeOffId,
    ).toBeDefined();
  });
  it("preserves the documented manual no-show payment and unreceived-payment cancellation behavior", async () => {
    const { admin, book } = await setup();
    const { appointmentId } = await book("10:00");
    vi.setSystemTime(at("10:05"));
    await admin.mutation(api.services.commands.updateAppointmentStatus.updateAppointmentStatus, {
      appointmentId,
      status: "no_show",
      expectedRevision: 0,
    });
    const { paymentId } = await admin.mutation(
      api.services.commands.markAppointmentPaid.markAppointmentPaid,
      {
        appointmentId,
        expectedRevision: 1,
        method: "cash",
        idempotencyKey: "no-show-manual-control",
      },
    );
    expect(
      (
        await admin.query(api.services.admin.getAppointmentFinancials, {
          appointmentId,
        })
      ).money,
    ).toMatchObject({ owed: 0, gross: 200000, net: 200000 });
    await admin.mutation(api.services.commands.correctAppointmentStatus.correctAppointmentStatus, {
      appointmentId,
      expectedRevision: 2,
      status: "cancelled",
      reason: "Mistaken status",
      effectiveAt: Date.now(),
    });
    await admin.mutation(api.services.commands.correctAppointmentPaymentEntry.correctAppointmentPaymentEntry, {
      appointmentId,
      expectedRevision: 3,
      paymentId,
      idempotencyKey: "cancel-unreceived-control",
      action: "cancel",
      reason: "No money received",
    });
    expect(
      (
        await admin.query(api.services.admin.getAppointmentFinancials, {
          appointmentId,
        })
      ).money,
    ).toMatchObject({ owed: 0, gross: 0, net: 0 });
  });
  it.each(["cancelled", "no_show"] as const)(
    "reports no collectible service balance for %s while preserving booked and paid controls",
    async (status) => {
      const { admin, book } = await setup();
      const { appointmentId } = await book("10:00");
      expect(
        (
          await admin.query(api.services.admin.getAppointmentFinancials, {
            appointmentId,
          })
        ).money.owed,
      ).toBe(200000);
      vi.setSystemTime(at("10:05"));
      await admin.mutation(api.services.commands.correctAppointmentStatus.correctAppointmentStatus, {
        appointmentId,
        expectedRevision: 0,
        status,
        effectiveAt: Date.now(),
      });
      const financials = await admin.query(
        api.services.admin.getAppointmentFinancials,
        { appointmentId },
      );
      const order = await admin.query(api.pos.orders.ordersForBooking, {
        appointmentId,
      });
      expect(order!.balance.owed).toBe(0);
      expect(financials.money).toMatchObject({
        owed: 0,
        gross: 0,
        net: 0,
        refunded: 0,
      });
      const paid = await book("13:00");
      await admin.mutation(api.services.commands.markAppointmentPaid.markAppointmentPaid, {
        appointmentId: paid.appointmentId,
        expectedRevision: 0,
        method: "cash",
        idempotencyKey: "preserve-paid",
      });
      await admin.mutation(api.services.commands.cancelAppointment.cancelAppointment, {
        appointmentId: paid.appointmentId,
        expectedRevision: 1,
      });
      expect(
        (
          await admin.query(api.services.admin.getAppointmentFinancials, {
            appointmentId: paid.appointmentId,
          })
        ).money,
      ).toMatchObject({ owed: 0, gross: 200000, net: 200000, refunded: 0 });
      await admin.mutation(api.services.commands.correctAppointmentStatus.correctAppointmentStatus, {
        appointmentId,
        expectedRevision: 1,
        status: "booked",
        reason: "Mistaken status",
        effectiveAt: Date.now(),
      });
      expect(
        (
          await admin.query(api.services.admin.getAppointmentFinancials, {
            appointmentId,
          })
        ).money.owed,
      ).toBe(200000);
    },
  );
});
