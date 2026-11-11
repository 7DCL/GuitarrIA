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
    await page.goto(`http://localhost:5199/eval/index.html?only=${process.env.ONLY || ''}&configs=${encodeURIComponent(JSON.stringify(CONFIGS))}`);
    await page.waitForFunction(() => window.__result, null, { timeout: 1800000 });
    const rows = await page.evaluate(() => window.__result);
    if (rows.error) throw new Error(rows.error);
    require('node:fs').writeFileSync('eval/data/last-run.json', JSON.stringify(rows));
    const pct = (x) => `${Math.round(x * 100)}%`.padStart(5);
    console.log('caso'.padEnd(24), 'config'.padEnd(16), 'cents', '   F1', ' prec', '  rec', ' notas');
    for (const r of rows.filter((x) => x.chords))
      console.log(r.case.padEnd(24), r.config.padEnd(16), 'acordes exacto', pct(r.chords.exact), '· sin bajo', pct(r.chords.noBass), '· mayor/menor', pct(r.chords.majmin), '\n   ', r.chords.got);
    for (const r of rows.filter((x) => x.rhythm))
      console.log(r.case.padEnd(24), r.config.padEnd(16), `ritmo: ${String(r.rhythm.bpm).padStart(5)} BPM`, r.rhythm.tempoOk ? 'tempo ✓' : 'tempo ✗', r.rhythm.meterOk ? 'compás ✓' : 'compás ✗', r.rhythm.downbeatOk ? '1er tiempo ✓' : '1er tiempo ✗', `cuadrícula ${pct(r.rhythm.grid)}`);
    for (const r of rows.filter((x) => !x.chords && !x.rhythm))
      console.log(r.case.padEnd(24), r.config.padEnd(16), String(r.cents).padStart(5), pct(r.f1), pct(r.precision), pct(r.recall), `${r.got}/${r.truth}`);
    const byCfg = {};
    const band = rows.filter((x) => !x.chords && !x.rhythm && x.case.startsWith('banda_'));
    for (const r of band) console.log(`Canción completa (${r.case}) con ${r.config}: F1 ${pct(r.f1)}`);
    for (const r of rows.filter((x) => !x.chords && !x.rhythm && !x.case.startsWith('banda_'))) (byCfg[r.config] ??= []).push(r.f1);
    for (const [k, v] of Object.entries(byCfg)) console.log(`F1 medio ${k}: ${pct(v.reduce((a, b) => a + b) / v.length)}`);
    const chordRows = rows.filter((x) => x.chords);
    const chordAvg = chordRows.length ? chordRows.reduce((a, r) => a + r.chords.exact, 0) / chordRows.length : null;
    if (chordAvg !== null) console.log(`Acordes exactos (media): ${pct(chordAvg)}`);
    const rr = rows.filter((x) => x.rhythm).map((x) => x.rhythm);
    const tempoRate = rr.length ? rr.filter((x) => x.tempoOk).length / rr.length : null;
    const gridAvg = rr.length ? rr.reduce((a, x) => a + x.grid, 0) / rr.length : null;
    if (rr.length)
      console.log(`Ritmo: tempo correcto ${pct(tempoRate)} · compás ${pct(rr.filter((x) => x.meterOk).length / rr.length)} · primer tiempo ${pct(rr.filter((x) => x.downbeatOk).length / rr.length)} · cuadrícula ${pct(gridAvg)}`);
    // Umbrales para CI: si la precisión baja de aquí, el deploy se bloquea.
    const minF1 = Number(process.env.MIN_F1 || 0);
    const minChords = Number(process.env.MIN_CHORDS || 0);
    const bad = [];
    for (const [k, v] of Object.entries(byCfg)) {
      const avg = v.reduce((a, b) => a + b) / v.length;
      if (avg < minF1) bad.push(`F1 ${k} ${pct(avg)} < ${pct(minF1)}`);
    }
    if (chordAvg !== null && chordAvg < minChords) bad.push(`acordes ${pct(chordAvg)} < ${pct(minChords)}`);
    const minTempo = Number(process.env.MIN_TEMPO || 0);
    const minGrid = Number(process.env.MIN_GRID || 0);
    const minBand = Number(process.env.MIN_BAND || 0);
    for (const r of band) if (r.config.includes('separar') && r.f1 < minBand) bad.push(`canción completa separando ${pct(r.f1)} < ${pct(minBand)}`);
    if (tempoRate !== null && tempoRate < minTempo) bad.push(`tempo ${pct(tempoRate)} < ${pct(minTempo)}`);
    if (gridAvg !== null && gridAvg < minGrid) bad.push(`cuadrícula ${pct(gridAvg)} < ${pct(minGrid)}`);
    if (bad.length) {
      console.error(`PRECISIÓN INSUFICIENTE: ${bad.join('; ')}`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    server.kill();
  }
})();
