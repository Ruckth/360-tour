// Convex --cmd runs BEFORE push. Capture only its URL; do not build or seed here.
import fs from 'node:fs';
import { previewConfiguration, previewUrl } from './preview-build.mjs';
previewConfiguration(process.env);
if (!process.env.PHASE3F_TARGET_FILE) throw new Error('Missing private preview target file');
fs.writeFileSync(process.env.PHASE3F_TARGET_FILE, previewUrl(process.env.NEXT_PUBLIC_CONVEX_URL), { mode: 0o600, flag: 'wx' });
