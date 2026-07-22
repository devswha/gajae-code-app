// Driver-level fallback configuration: this repository does not bundle a Playwright browser.
export default {
  testDir: '.',
  testMatch: 'gjc-slice4.browser.e2e.ts',
  use: { headless: true },
};
