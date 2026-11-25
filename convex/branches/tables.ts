import { defineTable } from 'convex/server';
import { branchFields } from './validators';

export const branchesTables = {
  branches: defineTable(branchFields).index('by_key', ['key']).index('by_slug', ['slug']).index('by_state', ['state']),
};
