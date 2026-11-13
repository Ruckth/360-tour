import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [{
    name: 'checkout-real-function-fixtures',
    configureServer(server) {
      const sessions = new Map<string, Awaited<ReturnType<typeof import('../support/checkout-backend').createFixtureBackend>>>();
      server.middlewares.use('/__checkout-fixture', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        try {
          let raw = ''; for await (const chunk of req) raw += chunk;
          const input = JSON.parse(raw);
          let value: unknown;
          if (input.kind === 'create') {
            const fixtureModule = await server.ssrLoadModule('/tests/support/checkout-backend.ts');
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
      // Outside Next and Clerk: the route comes from the page URL, and no one signs in.
      { find: /^next\/navigation$/, replacement: path.resolve("tests/browser/next-navigation-mock.ts") },
      { find: /^@clerk\/nextjs$/, replacement: path.resolve("tests/browser/clerk-mock.tsx") },
      { find: "@", replacement: path.resolve("src") },
      {
        find: /^convex\/(?!server$|values$|browser$|react$)(.*)$/,
        replacement: path.resolve("convex/$1"),
      },
    ],
  },
  server: { host: "127.0.0.1", port: 4319, strictPort: true },
});
