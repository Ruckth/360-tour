// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { expect, it } from 'vitest';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

it('removes root marketing modules rather than leaving compatibility registrations', async () => {
  const t = convexTest(schema, modules);
  for (const [module, endpoint] of [
    ['marketing', 'listCampaigns'],
    ['marketingAccess', 'current'],
    ['marketingAffiliates', 'listAffiliates'],
    ['marketingReport', 'getReport'],
  ]) {
    await expect(t.query(makeFunctionReference<'query'>(`${module}:${endpoint}`), {}))
      .rejects.toThrow('Could not find module for:');
  }
  await expect(t.mutation(makeFunctionReference<'mutation'>(['crons', 'cleanRawMarketing'].join(':')), {}))
    .rejects.toThrow('there is no such export');
});
