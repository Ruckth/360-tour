// Test-only preload for scripts/sentry-smoke.mjs; never part of the application build.
// SIGUSR2 records a console breadcrumb containing a display pairing secret, then raises a
// synthetic unhandled rejection. The application's own Sentry init (src/start-app/server.ts)
// must capture it through its default integrations and scrub the pairing secret.
process.on('SIGUSR2', () => {
  console.log(`sentry smoke navigation http://127.0.0.1/display#pair=${process.env.SENTRY_SMOKE_SECRET}`);
  setTimeout(() => { void Promise.reject(new Error('start-sentry-smoke-server')); }, 50);
});
