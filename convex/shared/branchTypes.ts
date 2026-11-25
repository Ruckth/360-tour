import { v, type Infer } from 'convex/values';

export const branchState = v.union(v.literal('setup'), v.literal('active'), v.literal('suspended'), v.literal('archived'));
export type BranchState = Infer<typeof branchState>;
