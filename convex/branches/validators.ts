import { v } from 'convex/values';
import { branchState } from '../shared/branchTypes';
export const branchIssuer = v.object({
  legalName: v.string(),
  taxId: v.string(),
  branchCode: v.string(),
  address: v.string(),
});
export const branchProfileFields = { name: v.string(), slug: v.string(), issuer: branchIssuer };
export const branchFields = {
  key: v.string(),
  ...branchProfileFields,
  state: branchState,
  stateReason: v.optional(v.string()),
  stateChangedAt: v.number(),
  stateChangedByEmail: v.string(),
  revision: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
};
export const branchDocument = v.object({ _id: v.id('branches'), _creationTime: v.number(), ...branchFields });
