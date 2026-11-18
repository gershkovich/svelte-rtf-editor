import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	// (SvelteKit 3 takes its configuration here; there is no svelte.config.js.)
	plugins: [sveltekit({ adapter: adapter() })],
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'happy-dom',
		coverage: {
			provider: 'v8',
			include: ['src/lib/**'],
			exclude: ['src/lib/__tests__/**', 'src/lib/index.ts'],
			reporter: ['text-summary', 'json-summary'],
			// A floor a little under what the suite reaches, so coverage cannot quietly fall.
			thresholds: { lines: 90, functions: 88, statements: 88, branches: 82 }
		}
	},
	// Component tests mount Svelte in happy-dom, which needs the client build of
	// Svelte rather than the SSR one. Scoped to test runs so dev/build are unaffected.
	resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined
});
