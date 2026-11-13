import type { Doc, Id } from '../_generated/dataModel';

export type AffiliateRow = Doc<"marketingAffiliates"> & {
  canonicalPath: string;
  linkStatus: Doc<"marketingLinks">["status"] | null;
  campaignName: string;
  coupons: { _id: Id<"coupons">; code: string }[];
  summary: {
    pending: number;
    approved: number;
    rejected: number;
    reversed: number;
    approvedNet: number;
    partial: boolean;
  };
};

export type CreditRow = Omit<Doc<"affiliateCredits">, "reason"> & {
  reason?: string | null;
  reasonHidden?: boolean;
  label: string;
  ref: string;
  candidates: Doc<"affiliateCredits">["snapshot"]["candidates"];
  flags: string[];
  affiliateName: string | null;
};
