import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  adjustmentConsent, adjustmentEffect, adjustmentFields, adjustmentKind, adjustmentTargets,
  benefitBalances, benefitBucket, benefitPause, catalogueStatus, commerceSaleSource,
  commerceSettingsFields, commerceTerms, handoverContent, handoverCounts, handoverKind, handoverStatus,
  ledgerGuestFact, packageContent, sessionUseKind, stockMovementKind, vatProfile, voucherCodeStatus,
  voucherEntryKind, voucherSource, voucherStatus,
} from './validators';

const reasonFields = {
  reasonCode: v.optional(v.string()),
  reasonText: v.optional(v.string()),
};

const adjustmentLogFields = {
  kind: adjustmentKind,
  before: adjustmentFields,
  after: adjustmentFields,
  revisionBefore: v.number(),
  revisionAfter: v.number(),
  paidLiabilityDelta: v.number(),
  goodwillFaceValueDelta: v.number(),
  quantityDelta: v.number(),
  ...reasonFields,
  actor: v.string(),
  actorLabel: v.string(),
  approvalId: v.optional(v.id('staffApprovalRequests')),
  consent: v.optional(adjustmentConsent),
  effects: v.optional(v.array(adjustmentEffect)),
  requesterKey: v.string(),
  clientKey: v.string(),
  fingerprint: v.string(),
  recordedAt: v.number(),
  businessDate: v.string(),
};

export const commerceTables = {
  branches: defineTable({ key: v.string() }).index('by_key', ['key']),

  productCategories: defineTable({
    name: v.string(), parentId: v.optional(v.id('productCategories')), sort: v.number(),
  }).index('by_parentId_and_sort', ['parentId', 'sort']),

  products: defineTable({
    categoryId: v.id('productCategories'),
    name: v.string(),
    photoId: v.optional(v.id('_storage')),
    status: catalogueStatus,
    vatProfile,
    options: v.array(v.object({ key: v.string(), name: v.string(), values: v.array(v.object({ key: v.string(), label: v.string() })) })),
    minPrice: v.number(),
    maxPrice: v.number(),
    variantCount: v.number(),
    sort: v.number(),
    revision: v.number(),
  }).index('by_status_and_categoryId_and_sort', ['status', 'categoryId', 'sort'])
    .searchIndex('search_name', { searchField: 'name', filterFields: ['status', 'categoryId'] }),

  productVariants: defineTable({
    productId: v.id('products'),
    optionValueIds: v.array(v.string()),
    label: v.string(),
    sku: v.optional(v.string()),
    barcode: v.optional(v.string()),
    photoId: v.optional(v.id('_storage')),
    price: v.number(),
    status: catalogueStatus,
    revision: v.number(),
  }).index('by_productId', ['productId']).index('by_sku', ['sku']).index('by_barcode', ['barcode']),

  stockLevels: defineTable({
    branchId: v.id('branches'), productId: v.id('products'), variantId: v.id('productVariants'),
    onHand: v.number(), revision: v.number(), needsRecount: v.optional(v.boolean()),
  }).index('by_branchId_and_productId', ['branchId', 'productId'])
    .index('by_variantId_and_branchId', ['variantId', 'branchId']),

  stockMovements: defineTable({
    branchId: v.id('branches'), variantId: v.id('productVariants'),
    delta: v.number(), before: v.number(), after: v.number(), kind: stockMovementKind,
    sourceKey: v.string(), reason: v.optional(v.string()), actor: v.string(), createdAt: v.number(),
    adjustmentId: v.optional(v.id('commerceAdjustments')),
  }).index('by_variantId_and_createdAt', ['variantId', 'createdAt']).index('by_sourceKey', ['sourceKey'])
    .index('by_variantId_and_branchId_and_createdAt', ['variantId', 'branchId', 'createdAt']),

  handovers: defineTable({
    kind: handoverKind,
    bookingId: v.optional(v.id('bookings')),
    orderId: v.id('orders'),
    lineId: v.id('orderLines'),
    variantId: v.optional(v.id('productVariants')),
    originalMovementId: v.optional(v.id('stockMovements')),
    unitPrice: v.number(),
    ...handoverCounts,
    contents: v.optional(v.array(handoverContent)),
    status: handoverStatus,
    successorOrderId: v.optional(v.id('orders')),
    successorLineId: v.optional(v.id('orderLines')),
    pendingReturnId: v.optional(v.id('orderReturns')),
    movementIds: v.array(v.id('stockMovements')),
    clientKey: v.string(),
    revision: v.number(),
  }).index('by_orderId_and_status', ['orderId', 'status']).index('by_bookingId_and_status', ['bookingId', 'status']),

  packages: defineTable({
    name: v.string(), currentVersionId: v.optional(v.id('packageVersions')),
    status: catalogueStatus, sort: v.number(), revision: v.number(),
  }).index('by_status_and_sort', ['status', 'sort']),

  packageVersions: defineTable({
    packageId: v.id('packages'),
    version: v.number(),
    name: v.string(),
    price: v.number(),
    validityDays: v.number(),
    allowTransfer: v.boolean(),
    contents: v.array(packageContent),
    estimatedSplit: v.array(v.object({ contentKey: v.string(), amount: v.number() })),
  }),

  sessionGrants: defineTable({
    ownerId: v.id('customers'),
    ...commerceSaleSource,
    packageVersionId: v.id('packageVersions'),
    branchId: v.id('branches'),
    total: v.number(),
    used: v.number(),
    paidUnits: v.number(),
    goodwillUnits: v.number(),
    returnedUnits: v.number(),
    paidShare: v.number(),
    expiresAt: v.number(),
    pause: v.optional(benefitPause),
    issuedTerms: v.object({ expiresAt: v.number(), serviceIds: v.array(v.id('services')), allowTransfer: v.boolean() }),
    settingsRevision: v.number(),
    terms: commerceTerms,
    grantServiceIds: v.array(v.id('grantServices')),
    pendingReturnId: v.optional(v.id('orderReturns')),
    revision: v.number(),
  }).index('by_lineId_and_contentKey', ['lineId', 'contentKey']),

  sessionUses: defineTable({
    grantId: v.id('sessionGrants'),
    kind: sessionUseKind,
    sourceKey: v.string(),
    createdAt: v.number(),
    before: benefitBalances,
    after: benefitBalances,
    guestFact: ledgerGuestFact,
    ...reasonFields,
    actor: v.string(),
    lineId: v.optional(v.id('orderLines')),
    serviceId: v.optional(v.id('services')),
    bucket: v.optional(benefitBucket),
    beneficiaryId: v.optional(v.id('customers')),
    activeAppointmentId: v.optional(v.id('appointments')),
    restoresUseId: v.optional(v.id('sessionUses')),
    adjustmentId: v.optional(v.id('commerceAdjustments')),
  }).index('by_grantId_and_createdAt', ['grantId', 'createdAt']).index('by_sourceKey', ['sourceKey'])
    .index('by_activeAppointmentId', ['activeAppointmentId']),

  grantServices: defineTable({
    grantId: v.id('sessionGrants'), ownerId: v.id('customers'), serviceId: v.id('services'),
    branchId: v.id('branches'), usable: v.boolean(), expiresAt: v.number(),
  }).index('by_ownerId_and_serviceId_and_branchId_and_usable_and_expiresAt',
    ['ownerId', 'serviceId', 'branchId', 'usable', 'expiresAt']),

  // Presets for future sales. Custom amounts skip the template and issued vouchers keep their terms.
  voucherTemplates: defineTable({
    name: v.string(), faceValue: v.number(), validityDays: v.number(),
    status: catalogueStatus, sort: v.number(), revision: v.number(),
  }).index('by_status_and_sort', ['status', 'sort']),

  vouchers: defineTable({
    faceValue: v.number(), paidBalance: v.number(), goodwillBalance: v.number(),
    issuedExpiresAt: v.union(v.number(), v.null()), effectiveExpiresAt: v.union(v.number(), v.null()), pause: v.optional(benefitPause),
    status: voucherStatus, branchId: v.id('branches'), source: voucherSource,
    name: v.optional(v.string()), customerId: v.optional(v.id('customers')),
    activeCodeId: v.optional(v.id('voucherCodes')), revision: v.number(),
    packageUnusedPaid: v.optional(v.number()), pendingReturnId: v.optional(v.id('orderReturns')),
    settingsRevision: v.number(), terms: commerceTerms,
  }).index('by_customerId_and_status', ['customerId', 'status'])
    .index('by_status_and_effectiveExpiresAt', ['status', 'effectiveExpiresAt']),

  voucherCodes: defineTable({
    voucherId: v.id('vouchers'), code: v.string(), mask: v.string(), status: voucherCodeStatus,
  }).index('by_code', ['code']),

  voucherEntries: defineTable({
    voucherId: v.id('vouchers'), kind: voucherEntryKind, sourceKey: v.string(),
    before: benefitBalances, after: benefitBalances, guestFact: ledgerGuestFact, actor: v.string(),
    ...reasonFields,
    adjustmentId: v.optional(v.id('commerceAdjustments')), createdAt: v.number(),
  }).index('by_voucherId_and_createdAt', ['voucherId', 'createdAt']).index('by_sourceKey', ['sourceKey'])
    .index('by_createdAt', ['createdAt']),

  commerceAdjustments: defineTable(v.union(
    ...adjustmentTargets.map(target => v.object({ ...target.fields, ...adjustmentLogFields })),
  )).index('by_targetType_and_targetId_and_recordedAt', ['targetType', 'targetId', 'recordedAt'])
    .index('by_requesterKey_and_clientKey', ['requesterKey', 'clientKey'])
    .index('by_businessDate_and_kind', ['businessDate', 'kind']),

  commerceSettings: defineTable({
    key: v.literal('default'), ...commerceSettingsFields,
  }).index('by_key', ['key']),

  frequentPins: defineTable({
    key: v.literal('default'),
    pins: v.array(v.union(
      v.object({ kind: v.literal('product'), productId: v.id('products') }),
      v.object({ kind: v.literal('package'), packageId: v.id('packages') }),
    )),
  }).index('by_key', ['key']),
};
