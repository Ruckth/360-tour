import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	resolve: {
		alias: {
			'convex/_generated': fileURLToPath(new URL('./convex/_generated', import.meta.url))
		}
	},
	server: {
		port: 3000,
		fs: {
			allow: ['..']
		}
	},
	ssr: {
		noExternal: ['three', '@threlte/core', '@threlte/extras']
	}
});
