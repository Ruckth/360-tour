# Phase 2 production cutover status

Root-reported status, 13 November 2026. This records root's live operations and acceptance; the Phase 3b schema implementer did not repeat them or modify provider/deployment configuration.

Phase 2 PR #63 merged at `d02f1c8`. Production was accepted and deployed as Vercel deployment `dpl_4AfZ8RS1RJRKECRFs4NvXW5BjBvT`, and traffic was restored. All existing **74 root tables** were preserved; no reset or reseed was performed. The scheduler was scanned twice with zero pending/running work, and the private backup including storage archive was validated.

Durable web send, duplicate delivery, reload, guest-token rotation and ownership acceptance passed. Signed ignored-event ingress probes, deduplication and bad-signature rejection passed for LINE, Facebook, Instagram and WhatsApp. These probes sent no social guest messages.

- LINE's provider callback now points directly to Convex; its provider empty-event test passed.
- Facebook and WhatsApp were verified under the same Meta app, `1010355388030396`. Original fields and active status were preserved; both callbacks now point directly to Convex.
- Instagram's existing token was confirmed expired. A temporary Vercel project rewrite forwards the old `/api/instagram/webhook` ingress to Convex. GET verification and signed POST/deduplication passed through that route. Instagram token renewal and direct provider callback verification remain outstanding.

A dedicated `MESSAGING_IMAGE_SECRET` and verified `SITE_URL` were configured. The retired server secret was removed from the production Convex backend and Vercel production/preview environments. The old development backend and its secret were intentionally retained. Temporary configuration-transfer environment/script artifacts and the operations branch were cleaned up. No credentials are recorded here.

Phase 3a PR #64 merged at `f2482a0`; root reports the source fully audited, all CI green, and 72 focused tests plus 19 source gates passing. Its routine production build was underway when root supplied this status; completion is not claimed here. Actual Clerk browser login and live social card sends are also not claimed. Root retains ownership of deployment, remaining provider verification and acceptance.
