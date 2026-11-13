import type { Doc, Id, TableNames } from "convex/_generated/dataModel";
import type { Catalog, OrderView } from "@/components/checkout/backend";
import type { CouponRules } from "convex/shared/offers";
import { paymentDateInput } from "@/components/checkout/payment-time";
const ACTOR = "preview@example.com";
type Order = Doc<"orders">;
type Line = Doc<"orderLines">;
type Guest = { name: string; phone?: string; email?: string };
export type FixtureBooking = {
  id: Id<"bookings">;
  propertyId?: Id<"properties">;
  guest: Guest;
  name: string;
  detail: string;
  reference: string;
  price: number;
  deposit: number;
  paid: boolean;
  providerRefundWaived?: number;
  checkoutInProgress?: boolean;
  promotion?: { code: string; discount: number };
};
export type FixtureAppointment = Omit<FixtureBooking, "id"> & {
  appointmentId: Id<"appointments">;
  bookingId?: Id<"bookings">;
  serviceId: Id<"services">;
  staffId: Id<"staff">;
  start: number;
  status?: "booked" | "completed" | "no_show" | "cancelled";
  revision?: number;
  amountPaid?: number;
  amountRefunded?: number;
};

const fid = <T extends TableNames>(prefix: string, n: number) =>
  `fx${prefix}${String(n).padStart(6, "0")}` as Id<T>;
const staffId = (n: number) => fid<"staff">("staff", n);
const serviceId = (n: number) => fid<"services">("svc", n);
const propertyId = (n: number) => fid<"properties">("villa", n);

const STAFF = ["Nok", "Ploy", "Mali", "Dao"].map((name, i) => ({
  _id: staffId(i + 1),
  name,
  color: ["#0f766e", "#b45309", "#7c3aed", "#be123c"][i],
}));
// Photos are the repo's own images in /public. Like a real catalog, some services have none; one
// points at a missing file, so the preview also shows the fallback for a photo that fails to load.
const SERVICES: [string, string, number, number, number[], string, string?][] =
  [
    [
      "Thai massage 60",
      "Massage",
      60,
      1200,
      [1, 2, 3],
      "Traditional stretching and acupressure.",
    ],
    [
      "Thai massage 90",
      "Massage",
      90,
      1600,
      [1, 2],
      "The full-length traditional massage.",
    ],
    [
      "Aroma oil massage 90",
      "Massage",
      90,
      1800,
      [2, 3],
      "Warm oil with lemongrass or jasmine.",
    ],
    [
      "Four-hand massage 60",
      "Massage",
      60,
      2800,
      [1, 2, 3, 4],
      "Two therapists in sync.",
    ],
    [
      "Hot stone 60",
      "Body",
      60,
      1500,
      [3, 4],
      "Basalt stones and slow strokes.",
    ],
    [
      "Coconut body scrub 45",
      "Body",
      45,
      1100,
      [4],
      "Fresh coconut and sea salt.",
      "/experiences/coconut-scrub-missing.jpg",
    ],
    [
      "Foot spa 45",
      "Feet & hands",
      45,
      600,
      [1, 2, 3, 4],
      "Soak, scrub and foot massage.",
    ],
    [
      "Reflexology 60",
      "Feet & hands",
      60,
      900,
      [1, 4],
      "Pressure-point foot massage.",
    ],
    [
      "Herbal flower bath 30",
      "Body",
      30,
      900,
      [3, 4],
      "Open-air tub with frangipani and lemongrass.",
      "/pool-villa-spa-bathroom.webp",
    ],
    [
      "Sunrise yoga by the pool 60",
      "Wellness",
      60,
      1400,
      [2, 3],
      "Private session on the pool deck.",
      "/experiences/wellness-yoga.png",
    ],
  ];

export const CATALOG: Catalog = {
  services: SERVICES.map(
    (
      [name, category, durationMin, price, staff, description, imageUrl],
      i,
    ) => ({
      _id: serviceId(i + 1),
      name,
      category,
      description,
      durationMin,
      price: price * 100,
      currency: "THB",
      staffIds: staff.map(staffId),
      imageUrl,
    }),
  ),
  // As convex/pos/private/orderModel.ts: a villa's first image. The suite has none yet.
  rooms: (
    [
      [
        "Lagoon Pool Villa",
        "Private pool on the lagoon",
        12000,
        6,
        "/pool-villa-veranda-view.webp",
      ],
      [
        "Garden Villa",
        "Two bedrooms in the garden",
        8500,
        4,
        "/garden-image.webp",
      ],
      ["Sunrise Suite", "Sea-view suite", 6200, 2, undefined],
    ] as const
  ).map(([name, tagline, price, maxGuests, imageUrl], i) => ({
    _id: propertyId(i + 1),
    name,
    tagline,
    price: price * 100,
    currency: "THB",
    maxGuests,
    imageUrl,
  })),
  extras: [
    { name: "Airport transfer", price: 120000, category: "Transport" },
    { name: "Breakfast basket", price: 45000, category: "Food & drink" },
    { name: "Coconut water", price: 9000, category: "Food & drink" },
    { name: "Late checkout", price: 150000, category: "Stay" },
    { name: "Laundry bag", price: 30000, category: "Stay" },
  ],
  staff: STAFF,
  frequent: [
    `service:${serviceId(1)}`,
    `service:${serviceId(7)}`,
    `service:${serviceId(10)}`,
    "extra:Breakfast basket",
    `room:${propertyId(2)}`,
    `service:${serviceId(5)}`,
  ],
};

/** A coupon the preview knows, with its live counters. Codes and numbers follow docs/previews/marketing/kit/data.md. */
type FixtureCoupon = {
  id: Id<"coupons">;
  rules: CouponRules;
  terms: string | null;
};

function createCoupons(): FixtureCoupon[] {
  const coupon = (
    n: number,
    code: string,
    benefit: CouponRules["benefit"],
    scope: CouponRules["scope"],
    terms: string | null,
    rules: Partial<CouponRules> = {},
  ): FixtureCoupon => ({
    id: fid("coupon", n),
    terms,
    rules: {
      code,
      version: 1,
      status: "active",
      benefit,
      scope,
      used: 0,
      discountGranted: 0,
      ...rules,
    },
  });
  return [
    coupon(
      1,
      "DCNT-SPA-500",
      { kind: "fixed", amount: 50000 },
      "services",
      "฿500 off spa services of ฿1,500 or more. Extras and stays are not included.",
      { minEligibleSubtotal: 150000, used: 14, discountGranted: 700000 },
    ),
    coupon(
      2,
      "DCNT-L-10",
      { kind: "percent", percent: 1000 },
      "accommodation_and_services",
      "10% off stays and spa services.",
      { used: 22, discountGranted: 980000 },
    ),
    coupon(
      3,
      "DCNT-RAIN-15",
      { kind: "percent", percent: 1500 },
      "services",
      null,
      { bookTo: "2026-10-31", used: 31, discountGranted: 1425000 },
    ),
    coupon(
      4,
      "DCNT-YOGA-200",
      { kind: "fixed", amount: 20000 },
      "services",
      null,
      { usageLimit: 20, used: 20, discountGranted: 400000 },
    ),
    // One use left: another till can take it while this order is at payment.
    coupon(
      5,
      "DCNT-L2-300",
      { kind: "fixed", amount: 30000 },
      "services",
      "฿300 off spa services.",
      { usageLimit: 50, used: 49, discountGranted: 1470000 },
    ),
    coupon(
      6,
      "DCNT-VILLA-10",
      { kind: "percent", percent: 1000 },
      "accommodation_and_services",
      null,
      { propertySlugs: ["tideglass-pool-residence"] },
    ),
    coupon(
      7,
      "DCNT-F1-20",
      { kind: "percent", percent: 2000 },
      "accommodation",
      null,
      { minNights: 2, maxSaving: 300000, used: 38, discountGranted: 6645000 },
    ),
  ];
}
/** Short links on this site and the code each carries (null: a link without an offer). */
/** Today in Asia/Bangkok, as the offer engine wants it. */
const ANNA: Guest = {
  name: "Anna Schmidt",
  phone: "+49 151 2345 6789",
  email: "anna@example.com",
};
const SOMCHAI: Guest = { name: "Somchai Prasert", phone: "+66 81 555 0101" };
const MIA: Guest = { name: "Mia Tanaka", phone: "+81 90 1234 5678" };

function todayAt(hour: number) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
}

export function createState() {
  const now = Date.now();
  const bookings: FixtureBooking[] = [
    // Deposit taken online by Stripe; the rest is paid at checkout.
    {
      id: fid("bkg", 1),
      propertyId: propertyId(1),
      guest: ANNA,
      name: "Stay · Lagoon Pool Villa",
      detail: "3 nights · CONF-2026-A1B2C3",
      reference: "CONF-2026-A1B2C3",
      price: 3600000,
      deposit: 1000000,
      paid: false,
    },
    {
      id: fid("bkg", 2),
      propertyId: propertyId(3),
      guest: MIA,
      name: "Stay · Sunrise Suite",
      detail: "1 night · CONF-2026-MIA",
      reference: "CONF-2026-MIA",
      price: 620000,
      deposit: 0,
      paid: false,
      checkoutInProgress: true,
    },
  ];
  const appointments: FixtureAppointment[] = [
    {
      appointmentId: fid("appt", 1),
      bookingId: fid("bkg", 1),
      guest: ANNA,
      serviceId: serviceId(5),
      staffId: staffId(3),
      start: todayAt(16),
      name: "Hot stone 60",
      detail: "",
      reference: "SVC-0001",
      price: 150000,
      deposit: 0,
      paid: false,
    },
    {
      appointmentId: fid("appt", 2),
      guest: SOMCHAI,
      serviceId: serviceId(2),
      staffId: staffId(1),
      start: todayAt(11),
      name: "Thai massage 90",
      detail: "",
      reference: "SVC-0002",
      price: 160000,
      deposit: 0,
      paid: false,
    },
  ];
  for (const a of appointments)
    a.detail = `${paymentDateInput(a.start).replace("T", " ")} · ${a.reference}`;

  const customers: Doc<"customers">[] = [
    {
      _id: fid("cust", 1),
      _creationTime: now,
      name: "Anna Schmidt",
      phone: ANNA.phone,
      phoneDigits: "4915123456789",
      email: ANNA.email,
      emailNormalized: ANNA.email,
      createdBy: ACTOR,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: fid("cust", 2),
      _creationTime: now,
      name: "Somchai Prasert",
      phone: SOMCHAI.phone,
      phoneDigits: "66815550101",
      createdBy: ACTOR,
      createdAt: now,
      updatedAt: now,
    },
    // A namesake: a different person, listed separately.
    {
      _id: fid("cust", 3),
      _creationTime: now,
      name: "Anna Schmidt",
      phone: "+41 79 000 1122",
      phoneDigits: "41790001122",
      createdBy: ACTOR,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const base = {
    currency: "THB",
    createdBy: ACTOR,
    hasItems: false,
    itemCount: 0,
    total: 0,
    due: 0,
    revision: 0,
  } as const;
  // Anna's stay has its order from booking time; nothing is charged until it is opened.
  const stayOrder: Order = {
    _id: fid("bill", 1),
    _creationTime: now - 86_400_000,
    ...base,
    status: "draft",
    orderNumber: 1041,
    bookingId: fid("bkg", 1),
    createdAt: now - 86_400_000,
    updatedAt: now - 86_400_000,
  };
  // A standalone sale saved earlier, for Somchai.
  const saved: Order = {
    _id: fid("bill", 2),
    _creationTime: now - 3_600_000,
    ...base,
    status: "draft",
    orderNumber: 1042,
    customerId: fid("cust", 2),
    itemCount: 3,
    total: 78000,
    due: 78000,
    hasItems: true,
    revision: 2,
    createdAt: now - 3_600_000,
    updatedAt: now - 1_800_000,
  };
  const savedLines: Line[] = [
    {
      _id: fid("line", 1),
      _creationTime: now,
      orderId: saved._id,
      kind: "service",
      serviceId: serviceId(7),
      name: "Foot spa 45",
      detail: "45 min",
      unitPrice: 60000,
      catalogUnitPrice: 60000,
      currency: "THB",
      qty: 1,
      staffId: staffId(2),
      createdAt: now,
    },
    {
      _id: fid("line", 2),
      _creationTime: now,
      orderId: saved._id,
      kind: "extra",
      name: "Coconut water",
      unitPrice: 9000,
      catalogUnitPrice: 9000,
      currency: "THB",
      qty: 2,
      createdAt: now,
    },
  ];
  return {
    orders: new Map<Id<"orders">, Order>([
      [stayOrder._id, stayOrder],
      [saved._id, saved],
    ]),
    lines: savedLines,
    payments: [] as Doc<"orderPayments">[],
    audit: [] as Doc<"orderAudit">[],
    orderHistory: [] as Doc<"recordChanges">[],
    corrections: [] as Doc<"orderCorrections">[],
    links: [] as Doc<"orderLineLinks">[],
    refunds: [] as (OrderView["refunds"][number] & { orderId: Id<"orders"> })[],
    /** POS line refunds (orderRefunds), in satang. */
    posRefunds: [] as Doc<"orderRefunds">[],
    mergeJobs: [] as Doc<"customerMergeJobs">[],
    sourcePayments: new Map<
      Id<"orders">,
      {
        bookingId?: Id<"bookings">;
        appointmentId?: Id<"appointments">;
        amount: number;
        effectiveAt: number;
        originalPrice: number;
      }[]
    >(),
    counters: new Map([
      ["order", 1042],
      ["receipt", 141],
    ]),
    customers,
    customerHistory: [] as Doc<"recordChanges">[],
    bookings,
    appointments,
    coupons: createCoupons(),
    seq: 10,
  };
}
