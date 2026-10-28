// Prueba de humo en navegador real: transcribe la demo y comprueba que sale tab.
// Uso: npm run build && npx vite preview --port 4173 & node scripts/smoke.cjs [carpeta-capturas]
// Requiere playwright (npm i -D playwright && npx playwright install chromium).
const { chromium } = require('playwright');

(async () => {
  const out = process.argv[2] || '.';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  await page.goto(process.env.URL || 'http://localhost:4173/');
  await page.click('#demo');
  await page.waitForSelector('#workspace:not([hidden])', { timeout: 180000 });
  const cols = await page.$$eval('.col[data-i]', (c) => c.length);
  await page.screenshot({ path: `${out}/smoke.png`, fullPage: true });
  await browser.close();
  console.log(`Columnas de tab: ${cols}`);
  if (cols < 10) process.exit(1);
})();
