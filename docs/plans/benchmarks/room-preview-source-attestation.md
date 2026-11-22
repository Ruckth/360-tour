# Source attestation for the matched room Previews

Both measured Previews used the uploaded source from `aea4cc512fb037dbabd0221901d9aa88c76144dd`. The Vercel CLI populated Git metadata from the enclosing worktree at `b19581452ac1ff03732ae1b816415b76da57d351`.

I used the provider file listing and file contents endpoints to retrieve each deployment’s uploaded source archive. Its SHA-1 matched the provider’s file UID. I independently hashed each regular file in both uploaded archives and in a fresh `git archive aea4cc51`.

Each upload included 1,845 byte-identical tracked files, one intentional `vercel.json` override and no extra regular files. Vercel’s upload excluded `.gitignore` and `docs/archive/APPLICATION_DIAGRAM.md` in both arms. The archived configuration matched each staged build configuration. Both used Node 22.x and `npx --yes bun@1.4.5 install --frozen-lockfile`, with build commands `npx --yes bun@1.4.5 run build` for Next and `npx --yes bun@1.4.5 run build:start` for Start. Both were protected Preview deployments in `iad1`.

| Arm | Source archive SHA-256 | Uploaded `vercel.json` SHA-256 |
|---|---|---|
| Next | `3040d71137670739a0b16bfcdfda9e0600d4f3a52c323d6eb3e8970b54c05c37` | `93d44d82fad89d71993503628ab7cdda85b9e495d2a5de1b06381dc17a4d6b23` |
| Start | `106a10476a78e8f920c1c517f335c3f7939be6aa93df9320d5196b7362b9cc6f` | `9395936f1230c30766bdeb30bbca1f0185f6b1f4a3b39057f5227b46b2bd6196` |

Every module below matched `aea4cc51` on both uploads and had a different digest at `b1958145`.

| Module | SHA-256 in both uploads |
|---|---|
| `src/lib/server/villa-runtime-cache.ts` | `379008edd64f9cde84330c15c1ffeba587d1269ada3fa5cc399503bb3a3f6204` |
| `src/lib/server/villa-reads.ts` | `ec43f69a4637f6855f196cf6c2e86bbef3b6e8dbdefd6f3af1de922e60669c47` |
| `src/lib/server/villa-cache-benchmark.ts` | `e56dcb93dfac72ed607cb4a10e4da76d6b3ef51e05b07ee39ca9b10c82204f9b` |
| `src/lib/server/villas.ts` | `c092d57ac56779127d138984ff4e9c19d7ca2f8fb81f917fcb22b3bbdd8eac16` |
| `src/start-app/guest/room-route.ts` | `ab9c58c72c89e7d8d97fbc4a22da9e6ee0e5bd648ee7246eb8a8c2613c438177` |
| `scripts/bench/room-preview-lib.mjs` | `77631763902f7cfcc4502362d9c394f1a00034aa4b7248d0ac4561312607e295` |
| `scripts/bench/room-preview-parity.mjs` | `50a3c072ced5b1b89f2f0e412d062a396913ffb3043adf9f1c7c26ad2060ecae` |

[Vercel deployment files](https://vercel.com/docs/rest-api/deployments/list-deployment-files), [Vercel deployment file contents](https://vercel.com/docs/rest-api/deployments/get-deployment-file-contents).
