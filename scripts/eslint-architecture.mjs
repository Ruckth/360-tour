import { relative } from 'node:path';
import { inspectArchitecture } from './lib/architecture.mjs';
import { inspectConvexAccess } from './lib/convex-access.mjs';

// One source-aware rule supplements no-restricted-imports for relative paths,
// namespace/reexports, dynamic imports and ownership of registration/ctx code.
const plugin = {
  rules: {
    ownership: {
      meta: { type: 'problem', schema: [] },
      create(context) {
        return {
          Program() {
            const path = relative(context.cwd, context.filename).replaceAll('\\', '/');
            const source = context.sourceCode.text;
            for (const issue of inspectArchitecture(path, source)) context.report({ loc: { line: issue.line, column: 0 }, message: issue.message });
            if (path.startsWith('convex/')) for (const message of inspectConvexAccess(path, source).violations) context.report({ loc: { line: Number(/:(\d+) /.exec(message)?.[1] ?? 1), column: 0 }, message });
          },
        };
      },
    },
  },
};

export default plugin;
