<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

## Architecture

Read [ARCHITECTURE.md](./ARCHITECTURE.md) before changing application code. It documents domain ownership, pure shared rules, access builders, the table/endpoint/admin-page recipe and current validation commands. Focused tests may intentionally import private implementations; production code must use the documented model interfaces.
