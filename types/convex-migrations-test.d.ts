// Types for @convex-dev/migrations/test. The package ships that entry as TypeScript source with a
// `vite/client` reference, whose ImportMeta.glob clashes with the declarations in our test files;
// tsconfig `paths` points type checking here while vitest loads the real module.
import type { TestConvex } from 'convex-test';
import type { GenericSchema, SchemaDefinition } from 'convex/server';

export declare function register(t: TestConvex<SchemaDefinition<GenericSchema, boolean>>, name?: string): void;
declare const migrationsTest: { register: typeof register };
export default migrationsTest;
