// Pruebas de extremo a extremo en Chromium real: cada flujo de la app, con YouTube,
// GuitarrIA Local y el micrófono simulados. Falla (exit 1) si algo no funciona.
// Uso: npm run build && node scripts/e2e.cjs [carpeta-capturas]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OUT = path.resolve(process.argv[2] || 'e2e-out');
const PORT = 4174;
const URL = process.env.URL || `http://localhost:${PORT}/`;
fs.mkdirSync(OUT, { recursive: true });

// ---------- Audios de prueba ----------
function wav(samples, sr = 44100) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + samples.length * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  return b;
}
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
/** Nota de guitarra sencilla (armónicos que se apagan). */
function tone(out, sr, start, dur, f, amp = 0.4) {
  const i0 = Math.floor(start * sr);
  for (let i = 0; i < dur * sr && i0 + i < out.length; i++) {
    const t = i / sr;
    let v = 0;
    for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * h * t) * (1 / h) * Math.exp(-t * (1.5 + h));
    out[i0 + i] += v * amp * Math.min(1, t * 400);
  }
}
const SR = 44100;
const melody = new Float32Array(SR * 6);
[57, 60, 64, 67, 69, 67, 64, 60].forEach((m, k) => tone(melody, SR, 0.2 + k * 0.6, 0.6, hz(m)));
const melodyWav = wav(melody);
// Tono continuo de La2 desafinado +12 cents para el afinador.
const mic = new Float32Array(SR * 4);
for (let i = 0; i < mic.length; i++) {
  const t = i / SR;
  const f = 110 * 2 ** (12 / 1200);
  mic[i] = 0.3 * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t));
}
const micPath = path.join(os.tmpdir(), 'guitarria-mic.wav');
fs.writeFileSync(micPath, wav(mic));

// ---------- YouTube simulado ----------
const FAKE_YT = `
window.YT = { PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 }, Player: function (el, o) {
  const s = { t: 0, playing: false, rate: 1, wall: 0 };
  const now = () => s.playing ? s.t + (performance.now() - s.wall) / 1000 * s.rate : s.t;
  const fire = (d) => setTimeout(() => o.events.onStateChange && o.events.onStateChange({ data: d }), 0);
  const ifr = document.createElement('iframe'); (typeof el === 'string' ? document.getElementById(el) : el).replaceWith(ifr);
  window.__ytCount = (window.__ytCount || 0) + 1;
  Object.assign(this, {
    playVideo() { s.wall = performance.now(); s.playing = true; fire(1); },
    pauseVideo() { s.t = now(); s.playing = false; fire(2); },
    seekTo(t) { s.t = t; s.wall = performance.now(); },
    getCurrentTime: now, getDuration: () => 6, getPlayerState: () => (s.playing ? 1 : 2),
    setPlaybackRate(r) { s.t = now(); s.wall = performance.now(); s.rate = r; },
    getPlaybackRate: () => s.rate, getAvailablePlaybackRates: () => [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2],
    setVolume() {}, getVideoData: () => ({ title: 'Video de prueba' }), destroy() { ifr.remove(); window.__ytCount--; },
  });
  setTimeout(() => o.events.onReady && o.events.onReady(), 50);
} };
window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady();`;

// ---------- Utilidades ----------
const failures = [];
async function check(name, fn) {
  // ONLY=texto ejecuta solo las pruebas cuyo nombre lo contiene (para depurar).
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  const t0 = Date.now();
  try {
    await fn();
    console.log(`  ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (err) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${String(err.message || err).split('\n')[0]}\n      ${(String(err.stack).split('\n').find((l) => l.includes('e2e.cjs')) || '').trim()}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function newPage(browser, opts = {}) {
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 }, acceptDownloads: true, permissions: ['microphone'] });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  if (opts.init) await page.addInitScript(opts.init);
  page.on('console', (m) => m.type() === 'error' && !/favicon|ERR_|net::/.test(m.text()) && page.errors.push(m.text()));
  await context.route('https://www.youtube.com/iframe_api', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_YT }));
  if (opts.local) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-Title' };
    await context.route('http://127.0.0.1:8765/**', (r) => {
      const u = new globalThis.URL(r.request().url());
      if (u.pathname === '/health')
        return r.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, version: '3', separate: opts.local === 'pro' }) });
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': '*' } });
      if (u.pathname === '/separate') {
        page.separated = (page.separated || 0) + 1;
        return r.fulfill({ headers: cors, contentType: 'audio/wav', body: melodyWav });
      }
      if (u.searchParams.get('stem') === 'guitar') page.stems = (page.stems || 0) + 1;
      assert(/^[\w-]{11}$/.test(u.searchParams.get('id') || ''), 'la web debe mandar solo el id del video');
      return r.fulfill({ headers: { ...cors, 'X-Title': encodeURIComponent('Canción: prueba/1') }, contentType: 'audio/wav', body: melodyWav });
    });
  } else await context.route('http://127.0.0.1:8765/**', (r) => r.abort());
  await page.goto(URL);
  return page;
}
const visible = (page, sel) => page.$eval(sel, (el) => getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0);
async function noErrors(page) {
  assert(!page.errors.length, `errores en la página: ${page.errors.join(' | ')}`);
}

(async () => {
  const server = process.env.URL
    ? null
    : spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  if (server) await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${micPath}`, '--autoplay-policy=no-user-gesture-required'],
  });
  console.log('Pruebas e2e de GuitarrIA');
  try {
    await check('la portada carga sin errores y sin paneles fantasma', async () => {
      const page = await newPage(browser);
      for (const sel of ['#ytPanel', '#workspace', '#progressRow', '#error', '#view-tuner'])
        assert(!(await visible(page, sel)), `${sel} se ve y debería estar oculto`);
      await noErrors(page);
      await page.close();
    });

    await check('demo: transcribe, muestra tab, acordes y diagrama, y reproduce', async () => {
      const page = await newPage(browser);
      await page.click('#demo');
      await page.waitForSelector('#workspace:not([hidden])', { timeout: 180000 });
      const cols = await page.$$eval('.col[data-i]', (c) => c.length);
      assert(cols >= 10, `solo ${cols} columnas de tab`);
      const chips = await page.$$eval('.chord-chip', (c) => c.length);
      assert(chips >= 2, `solo ${chips} acordes en la lista`);
      assert(!(await visible(page, '#progressRow')), 'la barra de progreso sigue visible');
      await page.click('.chord-chip');
      await page.waitForTimeout(200);
      const chord = await page.textContent('#chord');
      assert(chord && chord !== '–', 'al pulsar un acorde de la lista no se muestra el acorde actual');
      assert(await page.$('#chordDiagram svg'), 'no hay diagrama del acorde actual');
      await page.click('#play');
      await page.waitForTimeout(1200);
      const t = await page.evaluate(() => window.__guitarria.player.time);
      assert(t > 0.5, `no avanza la reproducción (t=${t})`);
      await page.keyboard.press('Space');
      // Velocidad y bucle
      await page.selectOption('#rate', '0.5');
      assert((await page.evaluate(() => window.__guitarria.player.rate)) === 0.5, 'la velocidad no se aplicó');
      await page.click('#loopB');
      await page.waitForTimeout(100);
      await page.click('#loopA');
      await page.evaluate(() => window.__guitarria.player.seek(2));
      await page.click('#loopB');
      assert((await page.textContent('#loopInfo')).includes('Bucle'), 'el bucle A-B no se marcó');
      // Capo: el diapasón y la tab se rehacen
      await page.fill('#capo', '30');
      await page.dispatchEvent('#capo', 'change');
      assert((await page.inputValue('#capo')) === '12', 'el capo no se limita a 12');
      await page.fill('#capo', '0');
      await page.dispatchEvent('#capo', 'change');
      // Corregir el acorde actual (y todas sus apariciones) con el editor
      const before = await page.textContent('#chord');
      await page.click('#chordEdit');
      await page.selectOption('#edRoot', '2');
      await page.selectOption('#edQuality', 'm');
      await page.click('#edApply');
      await page.waitForTimeout(150);
      assert((await page.textContent('#chord')) === 'Dm', `el acorde corregido no se muestra (antes ${before})`);
      assert((await page.$$eval('.tab .ch', (c) => c.map((x) => x.textContent))).includes('Dm'), 'la tab no muestra el acorde corregido');
      // Notación latina
      await page.selectOption('#notation', 'latin');
      const names = await page.$$eval('.chord-chip', (c) => c.map((x) => x.dataset.name).join(' '));
      assert(/Do|Re|Mi|Fa|Sol|La|Si/.test(names), `la notación no cambió: ${names}`);
      await page.selectOption('#notation', 'sharp');
      // Exportar tab con acordes
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#expTxt')]);
      const txt = fs.readFileSync(await dl.path(), 'utf8');
      assert(txt.includes('Generado con GuitarrIA') && /\|-+\d/.test(txt), 'la tab exportada está vacía');
      // Proyecto: exportar y volver a abrir
      const [dj] = await Promise.all([page.waitForEvent('download'), page.click('#expJson')]);
      const jsonPath = await dj.path();
      await page.setInputFiles('#impJson', jsonPath);
      await page.waitForTimeout(500);
      const cols2 = await page.$$eval('.col[data-i]', (c) => c.length);
      assert(Math.abs(cols2 - cols) <= 1, `al reabrir el proyecto cambió la tab (${cols} → ${cols2})`);
      assert((await page.$$eval('.chord-chip', (c) => c.length)) >= 2, 'el proyecto reabierto no tiene acordes');
      await page.click('#play');
      await page.waitForTimeout(1000);
      const tp = await page.evaluate(() => window.__guitarria.player.time);
      assert(tp > 0.5, `el proyecto reabierto no se puede reproducir (t=${tp})`);
      await page.click('#play');
      await page.screenshot({ path: `${OUT}/demo-escritorio.png`, fullPage: true });
      await noErrors(page);
      await page.close();
    });

    await check('partitura: ritmo, partitura + tab, editor con deshacer y exportaciones', async () => {
      const page = await newPage(browser);
      await page.evaluate(() => localStorage.removeItem('guitarria.sheet'));
      await page.click('#demo');
      await page.waitForSelector('#workspace:not([hidden])', { timeout: 180000 });
      const r = await page.evaluate(() => window.__guitarria.state.rhythm);
      assert(r && r.bpm > 40 && r.bpm < 250, `tempo no detectado: ${r && r.bpm}`);
      assert(Number(await page.inputValue('#bpm')) === Math.round(r.bpm), 'el campo de tempo no muestra el tempo');
      // Partitura + tab dibujada por alphaTab, con cursor que sigue la reproducción.
      await page.click('.seg[data-sheet="scoretab"]');
      await page.waitForSelector('#sheet svg', { timeout: 30000 });
      await page.waitForFunction(() => !document.getElementById('sheetMsg') || document.getElementById('sheetMsg').hidden, null, { timeout: 30000 });
      assert(!(await visible(page, '#tab')), 'la tab rápida sigue visible en la vista de partitura');
      await page.click('#play');
      await page.waitForTimeout(1200);
      await page.click('#play');
      assert(await visible(page, '.sheet-cursor'), 'no se marca en la partitura la nota que suena');
      // Tempo a mano: ×2 duplica y Deshacer vuelve.
      const bars = await page.evaluate(() => window.__guitarria.state.bars.length);
      await page.click('#bpmDouble');
      const bars2 = await page.evaluate(() => window.__guitarria.state.bars.length);
      assert(bars2 > bars, `al doblar el tempo los compases no aumentan (${bars} → ${bars2})`);
      await page.click('#undo');
      assert((await page.evaluate(() => window.__guitarria.state.bars.length)) === bars, 'Deshacer no restauró el tempo');
      await page.selectOption('#meter', '3/4');
      assert((await page.evaluate(() => window.__guitarria.state.rhythm.beatsPerBar)) === 3, 'el compás no cambió');
      // Editor: elegir la primera nota, cambiar el traste, borrar y deshacer.
      await page.check('#editMode');
      await page.click('.seg[data-sheet="quick"]');
      await page.click('.col[data-i="0"]');
      assert(await visible(page, '#editor'), 'no aparece el editor');
      const nEvents = await page.evaluate(() => window.__guitarria.state.events.length);
      const input = await page.$('#edFrets input[data-s="5"]');
      await input.fill('7');
      await input.dispatchEvent('change');
      const has7 = await page.evaluate(() => window.__guitarria.state.events[0].notes.some((n) => n.string === 5 && n.fret === 7 && n.midi === 71));
      assert(has7, 'el traste editado no está en la nota (o su altura es incorrecta)');
      assert((await page.textContent('.col[data-i="0"]')).includes('7'), 'la tab no muestra el traste editado');
      await page.click('.col[data-i="0"]');
      await page.keyboard.press('Delete');
      assert((await page.evaluate(() => window.__guitarria.state.events.length)) === nEvents - 1, 'Supr no borró la nota');
      await page.keyboard.press('Control+z');
      await page.keyboard.press('Control+z');
      const back = await page.evaluate(() => window.__guitarria.state.events);
      assert(back.length === nEvents && !back[0].notes.some((n) => n.string === 5 && n.fret === 7), `Ctrl+Z no deshizo los cambios (${back.length}/${nEvents}: ${JSON.stringify(back[0].notes.map((n) => [n.string, n.fret]))})`);
      await page.keyboard.press('Control+y');
      assert((await page.evaluate(() => window.__guitarria.state.events[0].notes.some((n) => n.fret === 7))), 'Ctrl+Y no rehízo');
      await page.selectOption('#edDur', '1');
      await page.click('#edAdd');
      assert((await page.evaluate(() => window.__guitarria.state.events.length)) === nEvents + 1, 'no se añadió la nota');
      // Exportaciones
      const read = async (id) => {
        const [d] = await Promise.all([page.waitForEvent('download'), page.click(id)]);
        return { name: d.suggestedFilename(), data: fs.readFileSync(await d.path()) };
      };
      const xml = await read('#expXml');
      const x = xml.data.toString('utf8');
      assert(xml.name.endsWith('.musicxml') && x.includes('<score-partwise') && x.includes('<fret>7</fret>') && x.includes('<beats>3</beats>'), 'MusicXML incompleto');
      const gp = await read('#expGp');
      assert(gp.name.endsWith('.gp') && gp.data.length > 1000 && gp.data.slice(0, 2).toString() === 'PK', 'el archivo de Guitar Pro no es válido');
      const mq = await read('#expMidQ');
      assert(mq.data.slice(0, 4).toString() === 'MThd' && mq.data.length > 100, 'MIDI cuantizado vacío');
      // PDF: imprime la página con solo la partitura (se simula el diálogo de impresión).
      await page.evaluate(() => {
        window.print = () => {
          const sheet = document.getElementById('sheet');
          const others = ['#tab', '#editor', '.settings', '.player', '.exports'].filter((s) => {
            const el = document.querySelector(s);
            return el && getComputedStyle(el).display !== 'none';
          });
          window.__printed = { printing: document.body.classList.contains('printing-sheet'), svgs: sheet.querySelectorAll('svg').length, width: sheet.querySelector('.sheet-host').style.width, others };
        };
      });
      await page.emulateMedia({ media: 'print' });
      await page.click('#expPdf');
      await page.waitForFunction(() => window.__printed, null, { timeout: 30000 });
      const printed = await page.evaluate(() => window.__printed);
      await page.emulateMedia({ media: 'screen' });
      assert(printed.printing && printed.svgs > 0 && printed.width === '180mm' && !printed.others.length, `PDF: la impresión no muestra solo la partitura: ${JSON.stringify(printed)}`);
      // Proyecto con correcciones: se guardan y se recuperan.
      const [dj] = await Promise.all([page.waitForEvent('download'), page.click('#expJson')]);
      await page.setInputFiles('#impJson', await dj.path());
      await page.waitForTimeout(500);
      const re = await page.evaluate(() => ({ n: window.__guitarria.state.events.length, fret7: window.__guitarria.state.events[0].notes.some((n) => n.fret === 7), m: window.__guitarria.state.rhythm.beatsPerBar }));
      assert(re.n === nEvents + 1 && re.fret7 && re.m === 3, `el proyecto no recuperó las correcciones: ${JSON.stringify(re)}`);
      await page.click('.seg[data-sheet="scoretab"]');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${OUT}/partitura-editor.png`, fullPage: true });
      await noErrors(page);
      await page.close();
    });

    await check('bajo y ukelele: afinaciones, tab y partitura con su número de cuerdas', async () => {
      const page = await newPage(browser);
      await page.click('#demo');
      await page.waitForSelector('#workspace:not([hidden])', { timeout: 180000 });
      for (const [ins, strings] of [['bass', 4], ['ukulele', 4], ['guitar', 6]]) {
        await page.selectOption('#instrument', ins);
        await page.waitForTimeout(300);
        const tuning = await page.inputValue('#tuning');
        const n = await page.$$eval('.tab .labels .cell', (c) => c.length);
        assert(n === strings, `${ins} (${tuning}): la tab tiene ${n} cuerdas, esperaba ${strings}`);
      }
      await page.selectOption('#instrument', 'bass');
      const [d] = await Promise.all([page.waitForEvent('download'), page.click('#expXml')]);
      const x = fs.readFileSync(await d.path(), 'utf8');
      assert(x.includes('<sign>F</sign>') && x.includes('<part-name>Bajo</part-name>'), 'la partitura de bajo no usa clave de fa');
      await noErrors(page);
      await page.close();
    });

    await check('móvil (375 px): sin scroll horizontal y todo usable', async () => {
      const page = await newPage(browser, { viewport: { width: 375, height: 800 } });
      await page.click('#demo');
      await page.waitForSelector('#workspace:not([hidden])', { timeout: 180000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(overflow <= 1, `la página se sale ${overflow}px a lo ancho`);
      await page.click('.seg[data-sheet="scoretab"]');
      await page.waitForSelector('#sheet svg', { timeout: 30000 });
      await page.check('#editMode');
      await page.waitForTimeout(500);
      const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(overflow2 <= 1, `con partitura y editor la página se sale ${overflow2}px a lo ancho`);
      await page.screenshot({ path: `${OUT}/demo-movil.png`, fullPage: true });
      await page.click('[data-view="tuner"]');
      await page.screenshot({ path: `${OUT}/afinador-movil.png`, fullPage: true });
      await noErrors(page);
      await page.close();
    });

    await check('enlace de YouTube no válido: avisa sin romper nada', async () => {
      const page = await newPage(browser);
      await page.fill('#ytUrl', 'esto no es un enlace');
      await page.click('#ytLoad');
      assert(await visible(page, '#error'), 'no aparece el aviso de enlace no válido');
      await noErrors(page);
      await page.close();
    });

    await check('YouTube sin GuitarrIA Local: video listo para escuchar y consejo de Local', async () => {
      const page = await newPage(browser);
      await page.fill('#ytUrl', 'https://youtu.be/dQw4w9WgXcQ');
      await page.click('#ytLoad');
      await page.waitForSelector('#ytStart:not([hidden])', { timeout: 10000 });
      assert(await visible(page, '#localTip'), 'no se ofrece GuitarrIA Local');
      assert(await visible(page, '#ytPanel iframe'), 'no se ve el video');
      // Cargar otro video destruye el anterior (no se acumulan reproductores).
      await page.fill('#ytUrl', 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
      await page.click('#ytLoad');
      await page.waitForSelector('#ytStart:not([hidden])', { timeout: 10000 });
      assert((await page.evaluate(() => window.__ytCount)) === 1, 'quedan reproductores viejos');
      await noErrors(page);
      await page.close();
    });

    await check('YouTube con GuitarrIA Local: transcribe sin reproducir', async () => {
      const page = await newPage(browser, { local: true });
      await page.click('#localUse').catch(() => {});
      await page.evaluate(() => localStorage.setItem('guitarria.local', '1'));
      await page.fill('#ytUrl', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10');
      await page.click('#ytLoad');
      await page.waitForSelector('#workspace:not([hidden])', { timeout: 180000 });
      const cols = await page.$$eval('.col[data-i]', (c) => c.length);
      assert(cols >= 5, `solo ${cols} columnas para 8 notas`);
      const isYt = await page.evaluate(() => window.__guitarria.player.constructor.name !== 'AudioPlayer');
      assert(isYt, 'no se sincroniza con el video de YouTube');
      const name = await page.evaluate(() => window.__guitarria.state.name);
      assert(!/[/:]/.test(name), `nombre de archivo inseguro: ${name}`);
      await noErrors(page);
      await page.close();
    });

    await check('GuitarrIA Local Pro: aísla la guitarra en videos y archivos subidos', async () => {
      const page = await newPage(browser, { local: 'pro', init: () => localStorage.setItem('guitarria.local', '1') });
      await page.waitForSelector('#isolateRow:not([hidden])', { timeout: 5000 });
      assert(!(await page.isChecked('#isolate')), 'aislar la guitarra (experimental) debería venir apagado');
      await page.check('#isolate');
      await page.fill('#ytUrl', 'https://youtu.be/dQw4w9WgXcQ');
      await page.click('#ytLoad');
      await page.waitForSelector('#workspace:not([hidden])', { timeout: 180000 });
      assert(page.stems === 1, 'el video no se pidió con la guitarra aislada');
      assert((await page.evaluate(() => !!window.__guitarria.state.chordPrepared)), 'los acordes no salen del audio completo');
      const file = path.join(os.tmpdir(), 'guitarria-tema.wav');
      fs.writeFileSync(file, melodyWav);
      await page.setInputFiles('#file', file);
      await page.waitForFunction(() => window.__guitarria.state.name === 'guitarria-tema', null, { timeout: 180000 });
      await page.waitForSelector('#progressRow[hidden]', { state: 'attached', timeout: 180000 });
      assert(page.separated === 1, 'el archivo no se mandó a separar');
      await noErrors(page);
      await page.close();
    });

    await check('afinador: detecta La2 +12 cents con el micrófono', async () => {
      const page = await newPage(browser);
      await page.click('[data-view="tuner"]');
      await page.click('#tunerStart');
      await page.waitForFunction(() => document.getElementById('tunerNote').textContent !== '–', null, { timeout: 8000 });
      await page.waitForTimeout(800);
      const note = await page.textContent('#tunerNote');
      const cents = parseInt(await page.textContent('#tunerCents'), 10);
      assert(note === 'A2', `nota leída ${note}, esperaba A2`);
      assert(Math.abs(cents - 12) <= 4, `cents leídos ${cents}, esperaba +12`);
      assert(await page.$('.string-btn.heard'), 'no resalta la cuerda que suena');
      // Volver a Transcribir apaga el micrófono.
      await page.click('[data-view="transcribe"]');
      assert((await page.textContent('#tunerStart')).includes('Empezar'), 'el afinador sigue encendido al salir');
      await page.click('[data-view="tuner"]');
      await page.selectOption('#tunerTuning', 'bass4');
      assert((await page.$$eval('.string-btn', (b) => b.length)) === 5, 'las cuerdas no siguen la afinación elegida');
      await page.screenshot({ path: `${OUT}/afinador.png` });
      await noErrors(page);
      await page.close();
    });
  } finally {
    await browser.close();
    server?.kill();
  }
  console.log(failures.length ? `\n${failures.length} prueba(s) fallaron.` : '\nTodo OK.');
  process.exit(failures.length ? 1 : 0);
})();
