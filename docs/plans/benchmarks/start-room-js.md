# Start room initial JavaScript

A local production Start build ran against the isolated `demo-resort` fixture. The Vite client graph and the TanStack Start manifest came from the same Nitro build served to Chromium. Each browser sample used a fresh anonymous context. The probe waited for room hydration, then for the viewer to mount on direct tour entry. It ended the initial request window after 500 ms without an in-flight or newly finished local JavaScript request.

| Entry | Initial chunks | Raw bytes | Gzip bytes | Brotli bytes |
|---|---:|---:|---:|---:|
| Ordinary room, manifest | 10 | 727,886 | 225,044 | 191,956 |
| Ordinary room, browser | 10 | 727,886 | 225,044 | 191,956 |
| Direct tour, browser | 13 | 1,613,608 | 459,109 | 386,104 |

The ordinary room observation matched every manifest chunk and passed the 285 KiB Brotli ceiling. The direct tour requested the renderer and two supporting chunks after entry. The ordinary room never requested the renderer, and the server-only cache diagnostic was present in server output and absent from client JavaScript. The byte totals sum the local emitted files with level-9 gzip and default Brotli compression. The browser counts cover same-origin emitted JavaScript only. The locale dictionary marker check found no matching dictionary in those JavaScript chunks.

Run the room check against a fresh isolated build with the repository's local integration harness and dedicated Clerk test configuration.

```sh
VITEST_MAX_WORKERS=2 node scripts/heavy.mjs node scripts/local-integration.mjs --start -- \
  sh -c 'node scripts/bench/start-route-js-size.mjs --route room --browser-origin "$E2E_BASE_URL"'
```

For an existing local Start build, run `node scripts/bench/start-route-js-size.mjs --route room` to validate the emitted assets without a browser. Use `--vercel` to inspect the corresponding local Vercel build output. The other three route budgets apply when their Start routes exist.
