/**
 * AI booking eval: scripted guest conversations against a Convex deployment (use a LOCAL one:
 * it creates sessions and bookings). Checks which tools the model calls, with which args,
 * and the resulting bookings.
 *
 *   npx convex dev --configure existing --dev-deployment local   # once, then seed: pnpm seed
 *   pnpm eval:ai-booking [runs=1] [scenario-filter]               # VERBOSE=1 prints transcripts
 */
import { execFileSync } from "node:child_process";

type Trace = { name: string; args: Record<string, unknown>; result: string };
type TurnResult = { response: string; model: string; toolTrace: Trace[] };
type Booking = {
  _id: string;
  guestName: string;
  guestPhone: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  status: string;
  source?: string;
  chatSessionId?: string;
};

type Turn = {
  say: string;
  /** Tools that must be called this turn (any order). */
  calls?: string[];
  /** Tools that must not be called this turn. */
  never?: string[];
  /** Extra checks on the trace / reply; return an error string or null. */
  check?: (turn: TurnResult) => string | null;
};

type Scenario = {
  name: string;
  channel: "whatsapp" | "facebook";
  visitorName?: string;
  before?: () => void;
  turns: Turn[];
  /** Checks on this session's bookings after the conversation. */
  after?: (bookings: Booking[]) => string | null;
};

const BOOKING_TOOLS = ["prepare_booking", "confirm_booking", "cancel_booking"];

function convex<T>(fn: string, args: unknown): T {
  const out = execFileSync("npx", ["convex", "run", fn, JSON.stringify(args)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  return JSON.parse(out) as T;
}

function allBookings(): Booking[] {
  const out = execFileSync("npx", ["convex", "data", "bookings", "--limit", "500", "--format", "jsonLines"], {
    encoding: "utf8",
  });
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Booking);
}

function argsOf(turn: TurnResult, tool: string) {
  return turn.toolTrace.find((t) => t.name === tool)?.args ?? {};
}

function expectArgs(tool: string, expected: Record<string, unknown>) {
  return (turn: TurnResult) => {
    const args = argsOf(turn, tool);
    const wrong = Object.entries(expected).filter(([key, value]) => {
      const actual = args[key];
      return typeof value === "string" && typeof actual === "string"
        ? actual.trim().toLowerCase() !== value.toLowerCase()
        : actual !== value;
    });
    return wrong.length
      ? `${tool} args ${wrong.map(([k, v]) => `${k}=${JSON.stringify(args[k])} (want ${JSON.stringify(v)})`).join(", ")}`
      : null;
  };
}

function expectArgsIfCalled(tool: string, expected: Record<string, unknown>) {
  return (turn: TurnResult) => (turn.toolTrace.some((t) => t.name === tool) ? expectArgs(tool, expected)(turn) : null);
}

function replyIncludes(...needles: string[]) {
  return (turn: TurnResult) => {
    const missing = needles.filter((n) => !turn.response.includes(n));
    return missing.length ? `reply missing ${missing.join(", ")}` : null;
  };
}

function toolSucceeded(tool: string) {
  return (turn: TurnResult) => {
    const result = turn.toolTrace.filter((t) => t.name === tool).at(-1)?.result ?? "";
    return result.startsWith("Error") ? `${tool} failed: ${result.slice(0, 160)}` : null;
  };
}

function all(...checks: Array<(turn: TurnResult) => string | null>) {
  return (turn: TurnResult) => checks.map((c) => c(turn)).find(Boolean) ?? null;
}

function oneBooking(expected: Partial<Booking>) {
  return (bookings: Booking[]) => {
    if (bookings.length !== 1) return `expected 1 booking, got ${bookings.length}`;
    const wrong = Object.entries(expected).filter(
      ([k, v]) => bookings[0][k as keyof Booking] !== v,
    );
    return wrong.length
      ? `booking ${wrong.map(([k, v]) => `${k}=${JSON.stringify(bookings[0][k as keyof Booking])} (want ${JSON.stringify(v)})`).join(", ")}`
      : null;
  };
}

const noBookings = (bookings: Booking[]) =>
  bookings.length ? `expected no bookings, got ${bookings.length}` : null;

// Today is 2026-09-23 (Wednesday) when this eval was written; dates below are absolute.
const SCENARIOS: Scenario[] = [
  {
    name: "availability question → check_availability, no booking",
    channel: "whatsapp",
    visitorName: "Rugby",
    turns: [
      {
        say: "Is the pool villa available from October 10 to October 12?",
        calls: ["check_availability"],
        never: BOOKING_TOOLS,
        check: expectArgs("check_availability", { propertySlug: "pool-villa", checkIn: "2026-10-10", checkOut: "2026-10-12" }),
      },
    ],
    after: noBookings,
  },
  {
    name: "relative dates → correct ISO dates",
    channel: "whatsapp",
    visitorName: "Rugby",
    turns: [
      {
        say: "Is the penthouse free this Friday to Sunday?",
        calls: ["check_availability"],
        never: BOOKING_TOOLS,
        check: expectArgs("check_availability", { propertySlug: "penthouse", checkIn: "2026-09-25", checkOut: "2026-09-27" }),
      },
    ],
  },
  {
    name: "price question → calculate_price",
    channel: "whatsapp",
    visitorName: "Rugby",
    turns: [
      {
        say: "How much is the penthouse for 3 nights for 5 people?",
        never: BOOKING_TOOLS,
        check: (turn) =>
          turn.toolTrace.some((t) => t.name === "calculate_price" || t.name === "check_availability")
            ? all(expectArgs("calculate_price", { propertySlug: "penthouse", nights: 3 }), replyIncludes("30,600"))(turn)
            : "no pricing tool called",
      },
    ],
  },
  {
    name: "detail question → answered from details (tool optional)",
    channel: "whatsapp",
    visitorName: "Rugby",
    turns: [
      {
        say: "Does the penthouse have a kitchen?",
        never: BOOKING_TOOLS,
        // "kitchenette" is only in the villa description, which comes from get_property_details.
        check: all(expectArgsIfCalled("get_property_details", { propertySlug: "penthouse" }), (turn) =>
          /kitchenette/i.test(turn.response) ? null : "reply does not mention the kitchenette"),
      },
    ],
  },
  {
    name: "vague question → no booking tools",
    channel: "whatsapp",
    visitorName: "Rugby",
    turns: [{ say: "Is it available?", never: [...BOOKING_TOOLS, "check_availability"] }],
    after: noBookings,
  },
  {
    name: "WhatsApp full booking: prepare → yes → confirm",
    channel: "whatsapp",
    visitorName: "Rugby",
    turns: [
      {
        say: "I'd like to book the pool villa from October 10 to 12 for 2 adults",
        calls: ["prepare_booking"],
        never: ["confirm_booking"],
        check: all(
          expectArgs("prepare_booking", { propertySlug: "pool-villa", checkIn: "2026-10-10", checkOut: "2026-10-12", guests: 2 }),
          toolSucceeded("prepare_booking"),
          replyIncludes("14,450"),
        ),
      },
      {
        say: "Yes please",
        calls: ["confirm_booking"],
        check: all(toolSucceeded("confirm_booking"), replyIncludes("CONF-", "/booking/pay?bookingId=")),
      },
    ],
    after: oneBooking({ checkIn: "2026-10-10", checkOut: "2026-10-12", guests: 2, source: "whatsapp", status: "pending" }),
  },
  {
    name: "WhatsApp unknown name → ask, then book",
    channel: "whatsapp",
    turns: [
      {
        say: "Book the garden suite 15-17 October for 2 people",
        never: ["prepare_booking", "confirm_booking"],
      },
      {
        say: "My name is Anna Lee",
        calls: ["prepare_booking"],
        never: ["confirm_booking"],
        check: all(expectArgs("prepare_booking", { guestName: "Anna Lee", propertySlug: "garden-suite" }), toolSucceeded("prepare_booking")),
      },
      { say: "yes", calls: ["confirm_booking"], check: toolSucceeded("confirm_booking") },
    ],
    after: oneBooking({ guestName: "Anna Lee", checkIn: "2026-10-15", checkOut: "2026-10-17", status: "pending" }),
  },
  {
    name: "over capacity → explains, no booking",
    channel: "whatsapp",
    visitorName: "Ken",
    turns: [
      {
        say: "Please book the garden suite October 20 to 22 for 4 people",
        never: ["confirm_booking"],
        check: (turn) =>
          /\b2\b/.test(turn.response) && /(guest|people|max|capacity)/i.test(turn.response)
            ? null
            : "reply does not explain the 2-guest limit",
      },
    ],
    after: noBookings,
  },
  {
    name: "guest changes their mind before yes → no booking",
    channel: "whatsapp",
    visitorName: "Rugby",
    turns: [
      {
        say: "Book the penthouse November 5 to 8 for 4",
        calls: ["prepare_booking"],
        never: ["confirm_booking"],
      },
      { say: "Actually no, let me think about it first", never: ["confirm_booking"] },
    ],
    after: noBookings,
  },
  {
    name: "my bookings + cancel with confirmation",
    channel: "whatsapp",
    visitorName: "Mia",
    turns: [
      { say: "Book the garden suite December 1 to 3 for 2", calls: ["prepare_booking"] },
      { say: "yes", calls: ["confirm_booking"], check: toolSucceeded("confirm_booking") },
      { say: "What bookings do I have?", calls: ["get_my_bookings"], never: ["cancel_booking", "prepare_booking"] },
      {
        say: "Please cancel it",
        calls: ["cancel_booking"],
        check: (turn) =>
          turn.toolTrace.find((t) => t.name === "cancel_booking")?.result.includes("needs_confirmation")
            ? null
            : "first cancel_booking should need confirmation",
      },
      {
        say: "yes, cancel it",
        calls: ["cancel_booking"],
        check: (turn) =>
          turn.toolTrace.some((t) => t.name === "cancel_booking" && t.result.includes('"cancelled"'))
            ? null
            : "booking was not cancelled",
      },
    ],
    after: oneBooking({ status: "cancelled" }),
  },
  {
    name: "Messenger: asks phone before booking",
    channel: "facebook",
    turns: [
      { say: "I want to book the penthouse October 25 to 27 for 4, my name is Maria Silva", never: ["prepare_booking", "confirm_booking"] },
      {
        say: "My phone is +66 81 234 5678",
        calls: ["prepare_booking"],
        never: ["confirm_booking"],
        check: all(expectArgs("prepare_booking", { propertySlug: "penthouse", guestName: "Maria Silva" }), toolSucceeded("prepare_booking")),
      },
      { say: "Yes, confirm", calls: ["confirm_booking"], check: toolSucceeded("confirm_booking") },
    ],
    after: oneBooking({ source: "messenger", guestName: "Maria Silva", checkIn: "2026-10-25", checkOut: "2026-10-27" }),
  },
  {
    name: "Thai booking",
    channel: "whatsapp",
    visitorName: "สมชาย",
    turns: [
      {
        say: "อยากจองพูลวิลล่า วันที่ 1-3 พฤศจิกายน 2 คนค่ะ",
        calls: ["prepare_booking"],
        never: ["confirm_booking"],
        check: all(
          expectArgs("prepare_booking", { propertySlug: "pool-villa", checkIn: "2026-11-01", checkOut: "2026-11-03", guests: 2 }),
          toolSucceeded("prepare_booking"),
        ),
      },
      { say: "ใช่ค่ะ ยืนยัน", calls: ["confirm_booking"], check: toolSucceeded("confirm_booking") },
    ],
    after: oneBooking({ checkIn: "2026-11-01", checkOut: "2026-11-03", status: "pending" }),
  },
];

function runScenario(scenario: Scenario) {
  scenario.before?.();
  const phone =
    scenario.channel === "whatsapp" ? `668${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}` : undefined;
  const sessionId = convex<string>("chatEval:createSession", {
    channel: scenario.channel,
    ...(phone ? { visitorPhone: phone } : {}),
    ...(scenario.visitorName ? { visitorName: scenario.visitorName } : {}),
  });
  const failures: string[] = [];
  const transcript: string[] = [];

  scenario.turns.forEach((turn, index) => {
    const result = convex<TurnResult>("chatEval:messagingTurn", {
      sessionId,
      userMessage: turn.say,
      siteUrl: "https://tour.helpgueststay.com",
    });
    const called = result.toolTrace.map((t) => t.name);
    transcript.push(
      `  guest: ${turn.say}`,
      `  tools: ${result.toolTrace.map((t) => `${t.name}(${JSON.stringify(t.args)})${t.result.startsWith("Error") ? " ✗" : ""}`).join(", ") || "—"}`,
      `  ai:    ${result.response.replace(/\s+/g, " ").slice(0, 220)}`,
    );
    const prefix = `turn ${index + 1}`;
    for (const tool of turn.calls ?? []) {
      if (!called.includes(tool)) failures.push(`${prefix}: missing ${tool} (called: ${called.join(", ") || "none"})`);
    }
    for (const tool of turn.never ?? []) {
      if (called.includes(tool)) failures.push(`${prefix}: must not call ${tool}`);
    }
    const checkError = turn.check?.(result);
    if (checkError) failures.push(`${prefix}: ${checkError}`);
  });

  const bookings = allBookings().filter((b) => b.chatSessionId === sessionId);
  if (phone && bookings.some((b) => b.guestPhone !== phone)) failures.push("after: booking phone is not the WhatsApp number");
  if (scenario.after) {
    const error = scenario.after(bookings);
    if (error) failures.push(`after: ${error}`);
  }
  return { failures, transcript };
}

const runs = Number(process.argv[2] ?? 1);
const filter = process.argv[3];
const selected = SCENARIOS.filter((s) => !filter || s.name.toLowerCase().includes(filter.toLowerCase()));
const tally = new Map<string, number>();

for (let run = 1; run <= runs; run++) {
  console.log(`\n=== run ${run}/${runs} ===`);
  for (const scenario of selected) {
    let outcome: { failures: string[]; transcript: string[] };
    try {
      outcome = runScenario(scenario);
    } catch (error) {
      outcome = { failures: [`crashed: ${String(error).slice(0, 300)}`], transcript: [] };
    }
    const ok = outcome.failures.length === 0;
    if (ok) tally.set(scenario.name, (tally.get(scenario.name) ?? 0) + 1);
    console.log(`${ok ? "PASS" : "FAIL"} ${scenario.name}`);
    if (!ok || process.env.VERBOSE) {
      console.log(outcome.transcript.join("\n"));
      for (const failure of outcome.failures) console.log(`  ✗ ${failure}`);
    }
  }
}

console.log("\n=== summary ===");
for (const scenario of selected) console.log(`${tally.get(scenario.name) ?? 0}/${runs}  ${scenario.name}`);
