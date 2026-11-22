// Test-only preload for scripts/sentry-sourcemap-proof.mjs; never part of the application build.
// SIGUSR2 imports a final Nitro server chunk (the same module instance the server uses) and calls
// its first-party `localizeHref` export with an undefined href, which throws a real TypeError
// inside src/i18n/routing.ts as bundled. The rejection stays unhandled so the application's own
// Sentry initialization captures it with the emitted stack and debug IDs.
import { pathToFileURL } from 'node:url';

process.on('SIGUSR2', () => {
  void import(pathToFileURL(process.env.SENTRY_PROOF_CHUNK).href).then((chunk) => chunk.localizeHref(undefined, 'en'));
});
