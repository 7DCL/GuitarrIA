// Evalúa la precisión de la transcripción en audios de prueba con notas conocidas.
// Uso: python3 eval/make_data.py && node scripts/eval.cjs   (requiere playwright)
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');

const CONFIGS = JSON.parse(process.env.CONFIGS || 'null') || [
  { label: 'v1 (antes)', noise: 'off', autoTune: false, mode: 'lead', sensitivity: 0.5, clean: { merge: true } },
  { label: 'actual', noise: 'off', autoTune: true, mode: 'lead', sensitivity: 0.4 },
  { label: 'actual+ruido', noise: 'normal', autoTune: true, mode: 'lead', sensitivity: 0.4 },
];

(async () => {
  const server = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('pageerror:', e.message));
    await page.goto(`http://localhost:5199/eval/index.html?configs=${encodeURIComponent(JSON.stringify(CONFIGS))}`);
    await page.waitForFunction(() => window.__result, null, { timeout: 600000 });
    const rows = await page.evaluate(() => window.__result);
    if (rows.error) throw new Error(rows.error);
    const pct = (x) => `${Math.round(x * 100)}%`.padStart(5);
    console.log('caso'.padEnd(24), 'config'.padEnd(16), 'cents', '   F1', ' prec', '  rec', ' notas');
    for (const r of rows)
      console.log(r.case.padEnd(24), r.config.padEnd(16), String(r.cents).padStart(5), pct(r.f1), pct(r.precision), pct(r.recall), `${r.got}/${r.truth}`);
    const byCfg = {};
    for (const r of rows) (byCfg[r.config] ??= []).push(r.f1);
    for (const [k, v] of Object.entries(byCfg)) console.log(`F1 medio ${k}: ${pct(v.reduce((a, b) => a + b) / v.length)}`);
  } finally {
    await browser.close();
    server.kill();
  }
})();
