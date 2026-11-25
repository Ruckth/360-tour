import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type { StaffActor } from '../../auth/model';
import { bumpOrderCommerceRevision, insertVoucherCode, type CommerceSettings } from '../../commerce/model';
import { reserveWrites } from '../../lib/readBudget';
import {
  allocateGoodwillDiscount, allocateSalePayments, assertCommerceCaps, assertStandaloneVoucherPrice,
  benefitExpiresAt, COMMERCE_LIMITS, DEFAULT_COMMERCE_SETTINGS, freezePackageVatBases, freezeRowVatBase,
  quotePackageVoucherReturn, splitBenefitUse, splitPackagePrice, type PackageContent, type TenderCells,
} from '../../shared/commerce';
import { recordAppointmentChange, serviceOptions } from '../../services/model';
import { sha256 } from '../../shared/displayTokens';
import { lineNet, linePrice, type Tender } from '../../shared/orderMath';
import { checkFundingVouchers, defaultPaymentBranch, paymentError, paymentGet, paymentRange, type FundingVoucher, type PaymentCtx } from './paymentAttempt';
import { isCommerceLine } from './paymentReview';
import { openHandoversForOrder, recollectionAmount } from './handoverCustody';

type Line = Doc<'orderLines'>;
type Snapshot = NonNullable<Line['saleSnapshot']>;
type Part = Snapshot['contents'][number];
type Variant = { id: Id<'productVariants'>; productId: Id<'products'>; label: string; price: number; exempt: boolean; active: boolean };
type IssuedBenefit =
  | { kind: 'voucher'; face: number; expiresAt: number; packageVersionId?: Id<'packageVersions'> }
  | { kind: 'sessions'; ownerId: Id<'customers'>; serviceIds: Id<'services'>[]; durationMins?: number[]; expiresAt: number; allowTransfer: boolean; packageVersionId: Id<'packageVersions'> };
type DraftPart = Pick<Part, 'contentKey' | 'label' | 'units' | 'vatProfile'> & {
  paidShare: number; vatBase: number; variant?: Variant; benefit?: IssuedBenefit;
};

const utf8 = new TextEncoder();
const blankReturn = { returnedUnits: 0, returnedAmount: 0 };

export function termsOf(settings: CommerceSettings): Snapshot['terms'] {
  const terms = settings;
  return {
    preserveExpiredPackageValue: terms.preserveExpiredPackageValue, unusedFullRefundDays: terms.unusedFullRefundDays,
    refundDueDays: terms.refundDueDays, packageValidityDays: terms.packageValidityDays, voucherValidityDays: terms.voucherValidityDays,
    allowSessionTransfer: terms.allowSessionTransfer, packageSplit: terms.packageSplit, packageVatTiming: terms.packageVatTiming,
    pointsVatTreatment: terms.pointsVatTreatment, pointsExpiryMonths: terms.pointsExpiryMonths,
  };
}

function demandByVariant(rows: SaleRow[]) {
  const demand = new Map<Id<'productVariants'>, { variant: Variant; quantity: number }>();
  for (const { parts, handover } of rows) {
    if (handover) continue;
    for (const { variant, units } of parts) {
      if (!variant) continue;
      demand.set(variant.id, { variant, quantity: units + (demand.get(variant.id)?.quantity ?? 0) });
    }
  }
  return demand;
}

export type FrozenCatalogue = {
  terms: Snapshot['terms'];
  settingsRevision: number;
  variants: Variant[];
  versions: Doc<'packageVersions'>[];
  servicePrices: [Id<'services'>, number][];
  sessionPrices?: [string, number][];
};

type SaleRow = {
  line: Line; parts: DraftPart[]; handover?: Doc<'handovers'>; catalogEvidence?: unknown;
};

function assertSwitch(settings: CommerceSettings, actor: StaffActor, kind: keyof CommerceSettings['saleSwitches']) {
  const flag = settings.saleSwitches[kind];
  if (flag === 'off' || (flag === 'managers' && actor.role === 'cashier')) {
    paymentError('sale_disabled', 'This item is switched off for new sales. Remove it before paying.');
  }
}

function storedCells(cells: TenderCells, voucherTenders: Array<{ voucherId: Id<'vouchers'>; amount: number }>): Snapshot['tenderCells'] {
  return [
    ...cells.vouchers.map(({ amount }, index) => ({ kind: 'voucher' as const, voucherId: voucherTenders[index].voucherId, amount })),
    { kind: 'external', amount: cells.external },
  ];
}

export async function prepareCommercePayment(
  ctx: PaymentCtx,
  input: {
    order: Doc<'orders'>; lines: Line[]; settings: CommerceSettings; actor: StaffActor; vouchers: FundingVoucher[];
    frozen?: FrozenCatalogue; planning?: true; tenders: Tender[]; appointment: (id: Id<'appointments'>) => Promise<Doc<'appointments'> | null>; now: number;
  },
) {
  const { order, lines, settings, actor, vouchers, tenders, appointment, now, frozen, planning } = input;
  const terms = frozen?.terms ?? termsOf(settings);
  const settingsRevision = frozen?.settingsRevision ?? settings.revision;
  const rules = {
    ...DEFAULT_COMMERCE_SETTINGS,
    packageSplit: terms.packageSplit === 'normalPrice' ? 'relative_standalone' as const : 'voucher_face_value' as const,
    packageVatTiming: terms.packageVatTiming === 'atUse' ? 'at_use' as const : 'at_sale' as const,
    packageValidityDays: terms.packageValidityDays, voucherValidityDays: terms.voucherValidityDays,
  };
  const hasGoods = lines.some(isCommerceLine);
  const branch = hasGoods || vouchers.length || lines.some(line => line.coverage) ? await defaultPaymentBranch(ctx) : null;
  const handovers = hasGoods ? await openHandoversForOrder(ctx, order) : [];
  const handoverByLine = new Map(handovers.map(handover => [
    // A recollection names its new row; a handover moved with its row (Pay the room first) keeps the line.
    (handover.successorOrderId === order._id ? handover.successorLineId : undefined) ?? handover.lineId, handover,
  ]));
  if (handoverByLine.size !== handovers.length || [...handoverByLine.keys()].some(id => !lines.some(line => line._id === id))) {
    paymentError('handover_changed', 'Review the handed-over items before taking payment.');
  }

  const variants = new Map(frozen?.variants.map(variant => [variant.id, variant] as const));
  const products = new Map<Id<'products'>, Doc<'products'>>();
  async function currentProduct(id: Id<'products'>) {
    const product = products.get(id) ?? await paymentGet(ctx, id);
    if (!product) paymentError('catalogue_changed', 'A product was removed. Review this item again.');
    products.set(id, product);
    return product;
  }
  async function variantFacts(id: Id<'productVariants'>, handedOver: boolean) {
    let facts = variants.get(id);
    if (!facts) {
      if (variants.size >= COMMERCE_LIMITS.sale.distinctVariants) paymentError('variant_limit', 'Split the product rows into two orders.');
      const variant = await paymentGet(ctx, id);
      if (!variant) paymentError('catalogue_changed', 'A variant was removed. Review this item again.');
      // Planning reviews the variant price. Parent availability and VAT are checked and frozen before
      // any external instruction (or at settlement for a sale without an external instruction).
      const product = planning ? undefined : await currentProduct(variant.productId);
      facts = { id, productId: variant.productId, price: variant.price, label: variant.label, exempt: product?.vatProfile === 'exempt',
        active: variant.status === 'active' && (!product || product.status === 'active') };
      variants.set(id, facts);
    }
    if (!handedOver && !facts.active) paymentError('catalogue_changed', 'A variant is no longer sold. Review this item again.');
    return facts;
  }

  const rows: SaleRow[] = [];
  const versions = new Map(frozen?.versions.map(version => [version._id, version] as const));
  const servicePrices = new Map(frozen?.servicePrices);
  const sessionPrices = new Map(frozen?.sessionPrices);
  const sessionServices = new Map<Id<'services'>, Doc<'services'> | null>();
  let coveredRows = 0;
  for (const line of lines) {
    const handover = handoverByLine.get(line._id);
    if (line.coverage) coveredRows++;
    const parts: DraftPart[] = [];
    const row: SaleRow = { line, parts, handover };
    rows.push(row);
    const net = lineNet(line);
    if (handover && (handover.pendingReturnId || handover.bookingId !== undefined && handover.bookingId !== order.bookingId)) {
      paymentError('handover_changed', 'The handover changed before payment.');
    }
    if (handover?.kind === 'recollect' && handover.contents && line.saleSnapshot) {
      const sold = new Map(line.saleSnapshot.contents.map(content => [content.contentKey, content]));
      for (const content of handover.contents) {
        if (!content.unpaid) continue;
        const frozen = sold.get(content.contentKey);
        const owed = recollectionAmount(content);
        if (!frozen || content.unpaid !== frozen.units || owed !== frozen.paidShare) {
          paymentError('handover_changed', 'Review the frozen charge before collecting payment.');
        }
        const variant = await variantFacts(content.variantId, true);
        parts.push({
          contentKey: content.contentKey, label: frozen.label, units: content.unpaid, variant,
          paidShare: owed, vatProfile: frozen.vatProfile,
          vatBase: frozen.vatProfile === 'exempt' ? 0 : owed,
        });
      }
      if (!parts.length || parts.reduce((sum, part) => sum + part.paidShare, 0) !== net ||
          (line.kind === 'product' && handover.unpaid !== line.qty)) {
        paymentError('handover_changed', 'Review the handed-over items before collecting payment.');
      }
    } else if (line.kind === 'product') {
      if (!handover) assertSwitch(settings, actor, 'products');
      if (!line.variantId) paymentError('catalogue_changed', 'Choose a product variant.');
      const variant = await variantFacts(line.variantId, !!handover);
      if (handover ? handover.unpaid !== line.qty || handover.variantId !== line.variantId || handover.unitPrice !== line.unitPrice :
          variant.price !== line.catalogUnitPrice) {
        paymentError('catalogue_changed', 'The product price or handover changed. Review it again.');
      }
      parts.push({ contentKey: 'product', label: variant.label, units: line.qty, variant, paidShare: net,
        vatProfile: variant.exempt ? 'exempt' : 'standard', vatBase: variant.exempt ? 0 : net });
    } else if (line.kind === 'voucher') {
      assertSwitch(settings, actor, 'vouchers');
      assertStandaloneVoucherPrice(line.catalogUnitPrice, net);
      if (line.qty !== 1 || line.discount || line.priceOverride || line.couponDiscount) {
        paymentError('voucher_face_value', 'Sell a voucher at its full face value.');
      }
      parts.push({ contentKey: 'voucher', label: line.name, units: 1, vatProfile: 'exempt', paidShare: net, vatBase: 0,
        benefit: { kind: 'voucher', face: net, expiresAt: benefitExpiresAt(now, 'voucher', rules)! } });
    } else if (line.kind === 'package') {
      if (!line.packageVersionId || line.qty !== 1 || !order.customerId) paymentError('package_review_required', 'Choose the package and its owner before payment.');
      const version = versions.get(line.packageVersionId) ?? await paymentGet(ctx, line.packageVersionId);
      if (!version) paymentError('catalogue_changed', 'The package version was removed.');
      if (!versions.has(version._id) && !handover) {
        const template = await paymentGet(ctx, version.packageId);
        if (template?.currentVersionId !== version._id || template.status !== 'active' || version.price !== line.catalogUnitPrice) {
          paymentError('catalogue_changed', 'The package changed. Add its current version before taking payment.');
        }
      }
      versions.set(version._id, version);
      if (!handover) assertSwitch(settings, actor, version.contents.every(content => content.kind === 'session') ? 'sessionPackages' : 'mixedPackages');
      if (version.contents.length > COMMERCE_LIMITS.package.contents) paymentError('package_limit', 'There are too many package contents.');
      const items: PackageContent[] = [];
      for (const content of version.contents) {
        const common = { contentKey: content.contentKey, paidShare: 0, vatBase: 0, vatProfile: 'standard' as const };
        if (content.kind === 'session') {
          const first = content.serviceIds[0];
          if (!first) paymentError('package_review_required', 'The package has no service for its sessions.');
          const { durationMins } = content;
          const sessionKey = `${version._id}:${content.contentKey}`;
          let price = durationMins ? sessionPrices.get(sessionKey) : servicePrices.get(first);
          if (price === undefined && durationMins) {
            for (const serviceId of content.serviceIds) {
              let service = sessionServices.get(serviceId);
              if (service === undefined) {
                service = await paymentGet(ctx, serviceId);
                sessionServices.set(serviceId, service);
              }
              if (!service) continue;
              const shortest = serviceOptions(service).find(option => durationMins.includes(option.durationMin));
              if (!shortest) continue;
              price = durationMins.includes(service.durationMin) ? service.price : shortest.price;
              break;
            }
            if (price === undefined) paymentError('catalogue_changed', 'None of the package services offers a covered duration.');
            sessionPrices.set(sessionKey, price);
          } else if (price === undefined) {
            const service = await paymentGet(ctx, first);
            if (!service) paymentError('catalogue_changed', 'A package service was removed.');
            price = service.price;
            servicePrices.set(first, price);
          }
          items.push({ kind: 'sessions', contentKey: content.contentKey, units: content.units, serviceUnitPrices: content.serviceIds.map(() => price) });
          parts.push({ ...common, label: version.name, units: content.units, benefit: { kind: 'sessions', packageVersionId: version._id,
            ownerId: order.customerId, serviceIds: content.serviceIds, ...(durationMins ? { durationMins } : {}),
            allowTransfer: version.allowTransfer && terms.allowSessionTransfer,
            expiresAt: benefitExpiresAt(now, 'sessions', rules, version.validityDays)! } });
        } else if (content.kind === 'voucher') {
          items.push({ kind: 'voucher', contentKey: content.contentKey, face: content.faceValue });
          parts.push({ ...common, label: 'Gift voucher', units: 1, vatProfile: 'exempt', benefit: { kind: 'voucher', packageVersionId: version._id,
            face: content.faceValue, expiresAt: benefitExpiresAt(now, 'voucher', rules)! } });
        } else {
          const variantId = content.kind === 'product' ? content.variantId :
            line.saleSnapshot?.chosenVariants.find(choice => choice.contentKey === content.contentKey)?.variantId;
          if (!variantId) paymentError('package_review_required', 'Choose the product variant in this package.');
          const variant = await variantFacts(variantId, !!handover);
          if (content.kind === 'chooseProduct' && variant.productId !== content.productId) {
            paymentError('package_review_required', 'Choose a variant of the product included in the package.');
          }
          items.push({ kind: 'product', contentKey: content.contentKey, quantity: content.units, variantUnitPrice: variant.price, chooseAtSale: content.kind === 'chooseProduct' });
          parts.push({ ...common, label: variant.label, variant, units: content.units, vatProfile: variant.exempt ? 'exempt' : 'standard' });
        }
      }
      const { shares, net: splitNet } = splitPackagePrice({ price: linePrice(line), contents: items, staffDiscount: line.discount }, rules);
      if (splitNet !== net) paymentError('package_review_required', 'Review the discount on the package excluding its voucher value.');
      const vat = freezePackageVatBases(shares.map((share, index) => ({ ...share, vatExempt: parts[index].vatProfile === 'exempt' })), rules);
      shares.forEach((share, index) => {
        parts[index].paidShare = share.paidShare;
        parts[index].vatBase = vat.contents[index].vatBase;
      });
      row.catalogEvidence = [version._id, items];
      if (handover) {
        const given = handover.contents ?? [];
        const products = parts.filter(part => part.variant);
        if (given.length !== products.length || products.some(part => !given.some(item =>
          item.contentKey === part.contentKey && item.variantId === part.variant?.id && item.unpaid === part.units))) {
          paymentError('handover_changed', 'The handed-over package contents changed.');
        }
      }
    }
  }

  const parts = rows.flatMap(row => row.parts);
  const voucherIssuances = parts.filter(part => part.benefit?.kind === 'voucher').length;
  assertCommerceCaps({
    kind: 'sale', rows: lines.length, packageRows: lines.filter(line => line.kind === 'package').length,
    expandedContents: rows.filter(row => row.line.kind === 'package').reduce((sum, row) => sum + row.parts.length, 0),
    distinctVariants: variants.size, sessionGrants: parts.filter(part => part.benefit?.kind === 'sessions').length,
    coveredRows, voucherIssuances, roomCharges: handovers.filter(handover => handover.kind === 'room_bill').length,
    feeRows: lines.filter(line => line.fee).length, paymentRows: tenders.length + vouchers.filter(voucher => voucher.paid).length,
    distinctFundingVouchers: vouchers.length, requestBytes: 0, commerceStays: 0, commerceStayNights: 0,
    productQuantities: parts.flatMap(part => part.variant ? [part.units] : []), rowSnapshotBytes: [],
  });

  // Check the live counts at arm (or at settlement for a zero-leg sale).
  const restock = planning ? [] : await Promise.all([...demandByVariant(rows).values()].map(async ({ variant, quantity }) => {
    const stocks = await paymentRange(ctx, () => ctx.db.query('stockLevels').withIndex('by_variantId_and_branchId',
      q => q.eq('variantId', variant.id).eq('branchId', branch!._id)).take(2));
    if (stocks.length > 1) paymentError('stock_changed', 'There is more than one stock record for this variant.');
    const [stock] = stocks;
    return { variant, quantity, stock, before: stock?.onHand ?? 0 };
  }));

  const funding = await Promise.all((await checkFundingVouchers(ctx, order, lines, vouchers, voucherIssuances > 0 || handovers.some(handover => handover.kind === 'room_bill'), now, branch))
    .map(async (entry) => {
      const { voucher, funding: debit } = entry;
      const source = voucher.source;
      if (source.kind !== 'package') return { ...entry, packageUnusedPaid: undefined };
      const original = await paymentGet(ctx, source.lineId);
      const sold = original?.saleSnapshot?.contents.find(part => part.contentKey === source.contentKey && part.voucherId === voucher._id);
      if (!sold) paymentError('voucher_changed', 'The original package voucher sale is unavailable.');
      const remaining = voucher.paidBalance - debit.paid;
      const { total } = quotePackageVoucherReturn({
        paidShare: sold.paidShare, face: voucher.faceValue, faceSpent: voucher.faceValue - remaining, faceReturned: 0, faceThrough: remaining,
      });
      return { ...entry, packageUnusedPaid: total };
    }));
  const usedGrants = new Map<Id<'sessionGrants'>, { grant: Doc<'sessionGrants'>; paid: number; goodwill: number; uses: SessionDebit[] }>();
  for (const line of lines) {
    if (!line.coverage) continue;
    const { grantId, attendeeId, useId } = line.coverage;
    if (!line.appointmentId || useId || lineNet(line) !== 0) paymentError('coverage_changed', 'Review the session on this visit.');
    const visit = await appointment(line.appointmentId);
    const [priorUse] = await paymentRange(ctx, () => ctx.db.query('sessionUses')
      .withIndex('by_activeAppointmentId', q => q.eq('activeAppointmentId', line.appointmentId!)).take(1));
    const grant = usedGrants.get(grantId)?.grant ?? await paymentGet(ctx, grantId);
    if (!visit || priorUse || !grant || visit.attendeeId !== attendeeId || visit.coverage || grant.ownerId !== attendeeId ||
        grant.branchId !== branch!._id || grant.grantServiceIds.length > COMMERCE_LIMITS.servicesPerGrant || grant.pause || grant.pendingReturnId || now >= grant.expiresAt ||
        !grant.issuedTerms.serviceIds.includes(visit.serviceId) ||
        (grant.issuedTerms.durationMins && !grant.issuedTerms.durationMins.includes((visit.end - visit.start) / 60_000))) {
      paymentError('coverage_changed', 'The session is no longer available for this attendee and visit.');
    }
    const state = usedGrants.get(grantId) ?? { grant, paid: grant.paidUnits, goodwill: grant.goodwillUnits, uses: [] };
    const before = { paid: state.paid, goodwill: state.goodwill };
    const taken = splitBenefitUse(before, 1);
    state.paid -= taken.paid;
    state.goodwill -= taken.goodwill;
    state.uses.push({ line, visit, before, after: { paid: state.paid, goodwill: state.goodwill }, bucket: taken.paid ? 'paid' : 'goodwill' });
    usedGrants.set(grantId, state);
  }

  const voucherTenders = vouchers.filter(voucher => voucher.paid > 0).map(({ voucherId, paid: amount }) => ({ method: 'voucher' as const, voucherId, amount }));
  const paymentRows = lines.map(line => ({ net: lineNet(line), deposit: line.deposit ?? 0 }));
  const goodwill = lines.map(() => [] as Snapshot['goodwillDiscounts']);
  for (const voucher of vouchers) {
    const discounts = allocateGoodwillDiscount(voucher.goodwill, paymentRows.map(({ net, deposit }) => net - deposit));
    discounts.forEach((amount, index) => {
      if (amount) goodwill[index].push({ voucherId: voucher.voucherId, amount });
      paymentRows[index].net -= amount;
    });
  }
  const shares = rows.map(({ parts }, index) => parts.length ?
    allocateGoodwillDiscount(lineNet(lines[index]) - paymentRows[index].net, parts.map(part => part.paidShare)) : []);
  const payments = [...voucherTenders, ...tenders];
  const allocation = allocateSalePayments(paymentRows.map((row, index) => ({
    ...row, contentPaidShares: rows[index].parts.length ? rows[index].parts.map((part, item) => part.paidShare - shares[index][item]) : undefined,
  })), payments);
  const snapshots = rows.map(({ line, parts }, index): Snapshot => {
    const allocated = allocation.rows[index];
    const contents = parts.map((part, item): Part => {
      const paidShare = part.paidShare - shares[index][item];
      return { contentKey: part.contentKey, label: part.label, units: part.units, vatProfile: part.vatProfile, paidShare,
        ...(shares[index][item] ? { goodwillShare: shares[index][item] } : {}),
        vatBase: part.vatBase > 0 ? freezeRowVatBase({ kind: 'taxable', net: paidShare }).vatBase : 0,
        tenderCells: storedCells(allocated.contents![item], voucherTenders), ...blankReturn };
    });
    const { net, deposit } = paymentRows[index];
    return {
      label: line.name, settingsRevision, terms, paidShare: net - deposit,
      vatBase: contents.length ? contents.reduce((sum, part) => sum + part.vatBase, 0) : freezeRowVatBase({ kind: 'taxable', net }).vatBase,
      chosenVariants: parts.flatMap(part => part.variant ? [{ contentKey: part.contentKey, variantId: part.variant.id }] : []),
      contents, tenderCells: storedCells(allocated.cells, voucherTenders), goodwillDiscounts: goodwill[index], ...blankReturn,
    };
  });
  for (const snapshot of snapshots) {
    // Reserve space for generated benefit and movement ids too.
    if (utf8.encode(JSON.stringify(snapshot)).length + snapshot.contents.length * 80 > COMMERCE_LIMITS.rowSnapshotBytes) {
      paymentError('snapshot_limit', 'A sale row is too large. Split its contents before payment.');
    }
  }
  const stockShortages = restock.filter(row => row.before < row.quantity).map(({ variant, quantity, before }) =>
    ({ variantId: variant.id, label: variant.label, quantity, onHand: before }));
  const catalogFingerprint = await sha256(JSON.stringify(rows.map(row => [
    row.line._id, row.line.name, row.catalogEvidence,
    row.parts.map(({ contentKey, label, units, paidShare, variant, benefit }) =>
      [contentKey, label, units, paidShare, variant && [variant.id, variant.productId, variant.price], benefit?.kind]),
  ])));
  const frozenCatalogue: FrozenCatalogue = {
    terms, settingsRevision, variants: [...variants.values()], versions: [...versions.values()], servicePrices: [...servicePrices],
    ...(sessionPrices.size ? { sessionPrices: [...sessionPrices] } : {}),
  };
  return { rows, snapshots, terms, payments, funding, restock, stockShortages, usedGrants, branch, catalogFingerprint, frozenCatalogue };
}

type SessionDebit = { line: Line; visit: Doc<'appointments'>; before: { paid: number; goodwill: number };
  after: { paid: number; goodwill: number }; bucket: 'paid' | 'goodwill' };
type SalePlan = Awaited<ReturnType<typeof prepareCommercePayment>>;

export async function writeCommercePayment(ctx: MutationCtx, sale: SalePlan, actor: string, now: number) {
  const { rows, snapshots, usedGrants, restock, funding, branch, terms } = sale;
  const movementIds = new Map<Id<'productVariants'>, Id<'stockMovements'>>();
  const changedOrders = new Set<Id<'orders'>>([rows[0].line.orderId]);
  const settingsRevision = snapshots[0].settingsRevision;
  const branchId = branch?._id;
  for (const { variant, quantity, stock, before } of restock) {
    const after = before - quantity;
    const update = { onHand: after, needsRecount: after < 0 || stock?.needsRecount || undefined, revision: (stock?.revision ?? 0) + 1 };
    reserveWrites(ctx, 2);
    if (stock) await ctx.db.patch(stock._id, update);
    else await ctx.db.insert('stockLevels', { branchId: branchId!, variantId: variant.id, productId: variant.productId, ...update });
    const movementId = await ctx.db.insert('stockMovements', {
      branchId: branchId!, variantId: variant.id, before, after, delta: -quantity, kind: 'sale',
      sourceKey: `sale:${rows[0].line.orderId}:${variant.id}`, actor, createdAt: now,
    });
    movementIds.set(variant.id, movementId);
  }
  for (const { funding: debit, voucher, packageUnusedPaid } of funding) {
    changedOrders.add(voucher.source.orderId);
    const before = { paid: voucher.paidBalance, goodwill: voucher.goodwillBalance };
    const after = { paid: before.paid - debit.paid, goodwill: before.goodwill - debit.goodwill };
    reserveWrites(ctx, 2);
    await ctx.db.patch(voucher._id, { paidBalance: after.paid, goodwillBalance: after.goodwill, revision: voucher.revision + 1,
      ...(packageUnusedPaid === undefined ? {} : { packageUnusedPaid }) });
    await ctx.db.insert('voucherEntries', { voucherId: voucher._id, kind: 'spend', sourceKey: `sale:${rows[0].line.orderId}:${voucher._id}`,
      before, after, guestFact: 'Used at checkout', actor, createdAt: now });
  }
  const coverage = new Map<Id<'orderLines'>, Line['coverage']>();
  for (const { grant, paid, goodwill, uses } of usedGrants.values()) {
    changedOrders.add(grant.orderId);
    reserveWrites(ctx, 1 + uses.length * 3 + (paid + goodwill === 0 ? grant.grantServiceIds.length : 0));
    await ctx.db.patch(grant._id, { paidUnits: paid, goodwillUnits: goodwill, used: grant.used + uses.length, revision: grant.revision + 1 });
    if (paid + goodwill === 0) {
      for (const id of grant.grantServiceIds) await ctx.db.patch(id, { usable: false });
    }
    for (const use of uses) {
      const useId = await ctx.db.insert('sessionUses', {
        grantId: grant._id, kind: 'use', sourceKey: `sale:${use.line._id}`, createdAt: now, actor,
        before: use.before, after: use.after, bucket: use.bucket, guestFact: 'Used for a visit',
        lineId: use.line._id, serviceId: use.visit.serviceId, beneficiaryId: grant.ownerId, activeAppointmentId: use.visit._id,
      });
      coverage.set(use.line._id, { ...use.line.coverage!, useId });
      await recordAppointmentChange(ctx, use.visit, {
        paymentStatus: 'paid', amountPaid: 0, amountRefunded: 0,
        coverage: { grantId: grant._id, useId, priceBefore: use.line.coverage!.priceBefore },
      }, {
        actor, kind: 'payment', reason: 'Covered by a package session', effectiveAt: now,
        details: [{ field: 'sessionUseId', from: null, to: useId }],
      });
    }
  }
  for (const [index, { line, parts, handover }] of rows.entries()) {
    const snapshot = snapshots[index];
    for (const [partIndex, part] of parts.entries()) {
      const record = snapshot.contents[partIndex];
      const source = { orderId: line.orderId, lineId: line._id, contentKey: part.contentKey };
      if (part.variant) {
        record.stockMovementId = handover ? (handover.contents?.find(content => content.contentKey === part.contentKey)?.originalMovementId ?? handover.originalMovementId)
          : movementIds.get(part.variant.id);
      }
      if (part.benefit?.kind === 'sessions') {
        const { packageVersionId, ownerId, expiresAt, allowTransfer, serviceIds, durationMins } = part.benefit;
        reserveWrites(ctx, 3 + serviceIds.length);
        const grantId = await ctx.db.insert('sessionGrants', {
          ...source, packageVersionId, ownerId, branchId: branchId!, total: part.units, used: 0, paidUnits: part.units, goodwillUnits: 0,
          returnedUnits: 0, paidShare: record.paidShare, expiresAt, issuedTerms: { expiresAt, serviceIds, allowTransfer, ...(durationMins ? { durationMins } : {}) },
          terms, settingsRevision, grantServiceIds: [], revision: 0,
        });
        const grantServiceIds = [];
        for (const serviceId of serviceIds) {
          grantServiceIds.push(await ctx.db.insert('grantServices', { grantId, serviceId, ownerId, branchId: branchId!, usable: true, expiresAt }));
        }
        await ctx.db.patch(grantId, { grantServiceIds });
        await ctx.db.insert('sessionUses', { grantId, kind: 'issue', sourceKey: `issue:${grantId}`, createdAt: now, actor,
          before: { paid: 0, goodwill: 0 }, after: { paid: part.units, goodwill: 0 }, guestFact: 'Sessions purchased', lineId: line._id });
        record.grantId = grantId;
      } else if (part.benefit?.kind === 'voucher') {
        const { face, expiresAt, packageVersionId } = part.benefit;
        reserveWrites(ctx, 4);
        const voucherId = await ctx.db.insert('vouchers', {
          faceValue: face, paidBalance: face, goodwillBalance: 0, issuedExpiresAt: expiresAt, effectiveExpiresAt: expiresAt,
          status: 'active', branchId: branchId!, revision: 0, settingsRevision, terms,
          source: packageVersionId ? { kind: 'package', ...source, packageVersionId } : { kind: 'sale', orderId: line.orderId, lineId: line._id },
          ...(packageVersionId ? { packageUnusedPaid: record.paidShare } : {}),
        });
        const activeCodeId = await insertVoucherCode(ctx, voucherId);
        await ctx.db.patch(voucherId, { activeCodeId });
        await ctx.db.insert('voucherEntries', {
          voucherId, kind: 'issue', sourceKey: `issue:${voucherId}`, before: { paid: 0, goodwill: 0 },
          after: { paid: face, goodwill: 0 }, guestFact: 'Voucher purchased', actor, createdAt: now,
        });
        record.voucherId = voucherId;
      }
    }
    reserveWrites(ctx, handover ? 2 : 1);
    const paidCoverage = coverage.get(line._id);
    await ctx.db.patch(line._id, { saleSnapshot: snapshot, ...(paidCoverage ? { coverage: paidCoverage } : {}) });
    if (handover) {
      changedOrders.add(handover.orderId);
      if (handover.successorOrderId) changedOrders.add(handover.successorOrderId);
      await ctx.db.patch(handover._id, { paid: handover.paid + handover.unpaid, unpaid: 0, revision: handover.revision + 1,
        ...(handover.contents ? { contents: handover.contents.map(part => ({ ...part, paid: part.paid + part.unpaid, unpaid: 0 })) } : {}) });
    }
  }
  await bumpOrderCommerceRevision(ctx, changedOrders);
}
