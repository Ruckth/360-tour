import { globSync } from "node:fs";
import path from "node:path";
import { createServer, defineConfig } from "vite";
import { bookingUIPort } from '../../scripts/worktree-ports.mjs';

export default defineConfig({
  plugins: [{
    name: 'checkout-real-function-fixtures',
    async configurePreviewServer(preview) {
      // Only the test database RPC needs Vite's SSR loader. Chromium receives
      // built files from the preview server for the lifetime of the suite.
      const backend = await createServer({
        configFile: "tests/browser/vite.config.ts",
        server: { middlewareMode: true, watch: null, hmr: false },
      });
      preview.httpServer.once("close", () => { void backend.close(); });
      preview.middlewares.use((req, res, next) => {
        if (req.url === "/__checkout-fixture") backend.middlewares(req, res, next);
        else next();
      });
    },
    configureServer(server) {
      const sessions = new Map<string, Awaited<ReturnType<typeof import('../support/checkout-backend').createFixtureBackend>>>();
      server.middlewares.use('/__checkout-fixture', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        try {
          let raw = ''; for await (const chunk of req) raw += chunk;
          const input = JSON.parse(raw);
          let value: unknown;
          if (input.kind === 'create') {
            // Return items (W2B·L3) seeds commerce receipts in its own harness.
            const fixtureModule = await server.ssrLoadModule(input.harness === 'returns' ? '/tests/support/returns-desk-harness.ts' : '/tests/support/checkout-backend.ts');
            const backend = await fixtureModule.createFixtureBackend(input.options);
            value = crypto.randomUUID(); sessions.set(String(value), backend);
          } else {
            const backend = sessions.get(input.session); if (!backend) throw new Error('Missing browser fixture database');
            const method = input.method.startsWith('action:') ? backend.useActions()[input.method.slice(7) as keyof ReturnType<typeof backend.useActions>] : backend[input.method as keyof typeof backend];
            if (typeof method !== 'function') throw new Error('Unknown fixture operation');
            value = await Reflect.apply(method, backend, input.args);
          }
          res.setHeader('content-type','application/json');res.end(JSON.stringify({value}));
        } catch (error) {
          res.statusCode = 500;res.setHeader('content-type','application/json');
          res.end(JSON.stringify({message:error instanceof Error?error.message:'Fixture operation failed',data:error&&typeof error==='object'&&'data' in error?error.data:undefined}));
        }
      });
    },
  }],
  build: {
    outDir: "node_modules/.cache/360-tour/booking-ui",
    target: "esnext",
    rolldownOptions: { input: globSync("tests/browser/**/*.html") },
  },
  define: { "process.env": "{}" },
  optimizeDeps: {
    entries: ["tests/browser/*.html"],
    // Calendar and checkout dependencies must be ready before parallel fixture pages load.
    // Discovering it later replaces shared chunks and reloads in-flight accessibility scans.
    include: [
      "@date-fns/tz",
      "@base-ui/react/button", "@base-ui/react/menu", "@base-ui/react/merge-props",
      "@base-ui/react/popover", "@base-ui/react/tooltip", "@base-ui/react/use-render",
    ],
  },
  resolve: {
    alias: [
      {
        find: "convex/react",
        replacement: path.resolve("tests/browser/convex-mock.ts"),
      },
      // Checkout's camera coupon scanner reads codes from a spec, not a camera.
      { find: /^qr-scanner$/, replacement: path.resolve("tests/browser/qr-scanner-mock.ts") },
      // Outside the router and Clerk: the route comes from the page URL, and no one signs in.
      { find: /^@\/platform\/navigation$/, replacement: path.resolve("tests/browser/navigation-mock.ts") },
      { find: /^@\/platform\/auth$/, replacement: path.resolve("tests/browser/clerk-mock.tsx") },
      { find: /^@\/platform\/link$/, replacement: path.resolve("tests/browser/link-mock.tsx") },
      { find: "@", replacement: path.resolve("src") },
      {
        find: /^convex\/(?!server$|values$|browser$|react$)/,
        replacement: `${path.resolve("convex")}/`,
      },
    ],
  },
  server: { host: "127.0.0.1", port: bookingUIPort(process.cwd()), strictPort: true },
});
