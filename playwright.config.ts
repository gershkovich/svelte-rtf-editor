import { defineConfig, devices } from '@playwright/test';

// The browser tests: what a test DOM cannot show (where the caret goes, what a key press does
// after a dialog closes, what a real paste brings in). `npm run test:e2e`.
export default defineConfig({
	testDir: 'e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: 'http://localhost:4173',
		// A browser already on the machine, where the one Playwright downloads is not used.
		launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
		permissions: ['clipboard-read', 'clipboard-write']
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'npm run dev -- --port 4173 --strictPort',
		url: 'http://localhost:4173/e2e',
		reuseExistingServer: !process.env.CI
	}
});
