import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'happy-dom'
	},
	// Component tests mount Svelte in happy-dom, which needs the client build of
	// Svelte rather than the SSR one. Scoped to test runs so dev/build are unaffected.
	resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined
});
