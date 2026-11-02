/**
 * PORTAL — end-to-end checks in headless Chromium (Playwright).
 *
 * Serves the production build from a sub-directory (/portal-ar/), exactly like
 * GitHub Pages does, and walks through the experience:
 *   1  page opens            7  world renders
 *   2  camera permission     8  interactions (dragon, village, castle, crystals, discoveries)
 *   3  WebXR detection       9  audio context
 *   4  entering AR mode      10 resize / orientation
 *   5  placement             11 back to the landing page
 *   6  portal opening        12 sub-directory hosting (no 404s)
 *
 * Requirements: `npm run build` first, Playwright with Chromium, Python 3 + numpy
 * (to synthesize the fake camera video with the printed marker).
 * Run: npm test
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
const out = path.join(root, 'tests', 'output');
fs.mkdirSync(out, { recursive: true });

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  const g = execSync('npm root -g').toString().trim();
  ({ chromium } = createRequire(g + '/')('playwright'));
}

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('dist/ not found — run `npm run build` first');
  process.exit(1);
}
const video = path.join(root, 'tests', 'fixtures', 'marker.y4m');
if (!fs.existsSync(video)) execSync(`python3 ${path.join(root, 'tests', 'make-marker-video.py')}`, { stdio: 'inherit' });

// ---------------------------------------------------------------- static server under /portal-ar/
const BASE = '/portal-ar/';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const notFound = [];
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (!url.startsWith(BASE)) {
    notFound.push(url);
    res.writeHead(404).end('not found');
    return;
  }
  let file = path.join(dist, url.slice(BASE.length));
  if (url.endsWith('/')) file = path.join(file, 'index.html');
  if (!file.startsWith(dist) || !fs.existsSync(file)) {
    notFound.push(url);
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const ORIGIN = `http://localhost:${server.address().port}`;
const URL_ = `${ORIGIN}${BASE}?quality=economico&timescale=3`;

// ---------------------------------------------------------------- harness
const results = [];
let currentPage = null; // page of the running suite, for failure diagnostics
async function diagnose(name) {
  if (!currentPage) return '';
  try {
    const file = path.join(out, 'fail-' + name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40) + '.png');
    await currentPage.screenshot({ path: file });
    const st = await currentPage.evaluate(() => ({
      lastTap: window.__portal?.lastTap,
      overlays: [...document.querySelectorAll('#ui-root .on')].map((e) => e.className),
      contextLost: window.__portal?.engine.renderer.getContext().isContextLost(),
    }));
    return ' | state ' + JSON.stringify(st);
  } catch (e) {
    return ' | (no diagnostics: ' + e.message + ')';
  }
}
async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    const extra = await diagnose(name);
    results.push({ name, ok: false, error: String(e?.message || e) + extra });
    console.log(`  ✗ ${name}\n      ${String(e?.message || e).split('\n')[0]}${extra}`);
  }
}
const assert = (c, msg) => {
  if (!c) throw new Error(msg);
};
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'];
const CAM_ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${video}`];

const THROTTLE = Number(process.env.E2E_CPU_THROTTLE || 0);
async function maybeThrottle(page) {
  if (!THROTTLE) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
}

function watchErrors(page, bag) {
  page.on('pageerror', (e) => bag.push(e.message));
  page.on('console', (m) => m.type() === 'error' && bag.push(m.text()));
}

async function tapObject(page, expr) {
  const pos = await page.evaluate((expr) => {
    const p = window.__portal;
    // eslint-disable-next-line no-eval
    const o = eval(expr);
    const cam = p.currentMode === 'explore' ? p.engine.camera : p.engine.activeCamera;
    // matrixWorldInverse is only refreshed when a frame renders; on slow machines the camera may
    // have moved since the last frame, so refresh it before projecting (the app does the same).
    cam.updateMatrixWorld();
    const v = o.getWorldPosition(new o.position.constructor());
    v.project(cam);
    const r = document.getElementById('ui-root').getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
  }, expr);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(250);
  return page.evaluate(() => window.__portal.lastTap);
}

console.log(`\nPORTAL e2e — serving dist at ${ORIGIN}${BASE}\n`);

// ================================================================ suite A: camera + marker AR
{
  const browser = await chromium.launch({ args: [...GL_ARGS, ...CAM_ARGS] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, permissions: ['camera'], hasTouch: false });
  const page = await ctx.newPage();
  currentPage = page;
  const errors = [];
  watchErrors(page, errors);

  await test('1. abertura da página (landing, título, botões)', async () => {
    await page.goto(URL_);
    await page.waitForSelector('#open-portal');
    assert(await page.isVisible('#landing'), 'landing hidden');
    assert((await page.textContent('#title')).replace(/\s/g, '') === 'PORTAL', 'title');
    assert((await page.textContent('.subtitle')).includes('Existe outro mundo logo abaixo da sua realidade.'), 'subtitle');
    assert((await page.textContent('#open-portal')).includes('ABRIR MEU PORTAL'), 'cta');
    assert(await page.isVisible('#explore-3d'), 'explore button');
    await page.screenshot({ path: path.join(out, 'e2e-01-landing.png') });
  });

  await test('3. detecção de suporte WebXR (honesta: sem WebXR no headless)', async () => {
    await page.waitForFunction(() => !document.querySelector('.cap-text').textContent.includes('Verificando'));
    const txt = await page.textContent('.cap-text');
    assert(!txt.includes('com detecção de superfícies'), 'should not claim surface detection: ' + txt);
    assert(txt.includes('Sem detecção de superfícies'), 'honest capability text: ' + txt);
    assert(await page.isVisible('.marker-only'), 'marker link visible on devices without WebXR');
  });

  await test('2+4. sem WebXR: opções explicadas → marcador → câmera ativa', async () => {
    await page.click('#open-portal');
    await page.waitForSelector('.sheet-wrap.on', { timeout: 60000 });
    assert((await page.textContent('.sheet-title')).includes('não detecta superfícies'), 'choice sheet');
    await page.click('.sheet .pill:has-text("Tenho o marcador impresso")');
    await page.waitForFunction(() => window.__portal?.currentMode === 'marker', null, { timeout: 60000 });
    const live = await page.evaluate(() => {
      const v = document.querySelector('video.camera-feed');
      return { w: v.videoWidth, playing: !v.paused, tracks: v.srcObject?.getVideoTracks().length };
    });
    assert(live.w > 0 && live.tracks === 1, 'camera stream not live ' + JSON.stringify(live));
    // the fake camera shows the marker right away, so placement may already be underway
    const title = await page.textContent('.ins-title');
    assert(/Procure uma superfície plana para abrir seu portal\.|Marcador encontrado/.test(title), 'placement instruction: ' + title);
  });

  await test('5. posicionamento: marcador impresso detectado e pose estimada', async () => {
    await page.waitForFunction(() => window.__portal.phase !== 'hidden', null, { timeout: 60000 });
    const a = await page.evaluate(() => window.__portal.stage.anchor.position.toArray());
    assert(a[2] < -0.5, 'anchor should be in front of camera: ' + a);
  });

  await test('6. abertura do portal (hidden → opening → open)', async () => {
    const ph = await page.evaluate(() => window.__portal.phase);
    assert(ph === 'opening' || ph === 'open', 'phase ' + ph);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, 'e2e-06-opening.png') });
    await page.waitForFunction(() => window.__portal.phase === 'open', null, { timeout: 120000 });
    assert(await page.isVisible('.dock.on'), 'dock should appear after reveal');
  });

  await test('7. renderização do mundo (draw calls, objetos visíveis)', async () => {
    await page.waitForTimeout(800);
    const info = await page.evaluate(() => {
      const p = window.__portal;
      const r = p.engine.renderer.info;
      return { calls: r.render.calls, tris: r.render.triangles, island: p.stage.world.group.visible, dragon: p.stage.dragon.isVisible, geos: r.memory.geometries };
    });
    assert(info.calls > 40 && info.tris > 20000, 'too little rendered ' + JSON.stringify(info));
    assert(info.island && info.dragon, 'world/dragon hidden');
    await page.screenshot({ path: path.join(out, 'e2e-07-world-marker.png') });
  });

  await test('9. áudio (Web Audio iniciado após gesto)', async () => {
    const st = await page.evaluate(() => window.__portal.audio?.ctx?.state ?? (window.__portal['audio'] && window.__portal['audio'].ctx?.state));
    assert(st === 'running', 'audio state ' + st);
  });

  await test('10. redimensionamento / orientação', async () => {
    await page.setViewportSize({ width: 860, height: 412 });
    await page.waitForTimeout(700);
    const s = await page.evaluate(() => {
      const c = window.__portal.engine.canvas;
      return { cw: c.clientWidth, ch: c.clientHeight, aspect: window.__portal.engine.camera.aspect };
    });
    assert(s.cw === 860 && s.ch === 412 && Math.abs(s.aspect - 860 / 412) < 0.01, 'resize ' + JSON.stringify(s));
    await page.screenshot({ path: path.join(out, 'e2e-10-landscape.png') });
    await page.setViewportSize({ width: 412, height: 860 });
    await page.waitForTimeout(500);
  });

  await test('5b. modo manual: tocar posiciona o portal na superfície assumida', async () => {
    await page.click('.dock-btn[aria-label="Reposicionar"]');
    // the fake feed always shows the marker (it is re-found instantly), so switch modes programmatically —
    // the same call the "Sem marcador" button makes
    await page.evaluate(() => window.__portal.runCameraMode('manual'));
    await page.waitForFunction(() => window.__portal.currentMode === 'manual', null, { timeout: 30000 });
    await page.waitForTimeout(400);
    assert((await page.textContent('.ins-title')).includes('Procure uma superfície plana para abrir seu portal.'), 'placement instruction');
    assert((await page.textContent('.ins-text')).includes('Sem detecção de superfícies'), 'manual mode must be honest about detection');
    await page.mouse.click(206, 600);
    await page.waitForFunction(() => window.__portal.phase !== 'hidden', null, { timeout: 30000 });
    await page.waitForFunction(() => window.__portal.phase === 'open', null, { timeout: 120000 });
    await page.screenshot({ path: path.join(out, 'e2e-05-manual.png') });
  });

  await test('11. retorno à tela inicial (câmera liberada)', async () => {
    await page.click('.topbar .icon-btn[aria-label="Sair da experiência"]');
    await page.waitForSelector('#landing:not(.hidden):not(.leaving)');
    const s = await page.evaluate(() => ({ mode: window.__portal.currentMode, cam: !!document.querySelector('video.camera-feed').srcObject }));
    assert(s.mode === null && !s.cam, 'should release camera ' + JSON.stringify(s));
  });

  await test('sem erros de JavaScript (suite câmera)', async () => {
    assert(errors.length === 0, errors.join(' | '));
  });
  await browser.close();
}

// ================================================================ suite B: explore + interactions
{
  const browser = await chromium.launch({ args: GL_ARGS });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  currentPage = page;
  const errors = [];
  watchErrors(page, errors);
  await test('explorar sem câmera (modo 3D)', async () => {
    await page.goto(URL_);
    await page.click('#explore-3d');
    await page.waitForFunction(() => window.__portal?.phase === 'open', null, { timeout: 120000 });
    await page.waitForFunction(() => !window.__portal.stage.dragon.isFlying, null, { timeout: 120000 });
    await page.evaluate(() => {
      const p = window.__portal;
      p.explore.controls.autoRotate = false;
      p.explore.controls.enableDamping = false; // no leftover camera momentum between projection and click
      p.engine.camera.position.set(1.5, 1.6, 3.4);
      p.explore.controls.target.set(0.4, 0.7, 0.4);
      p.explore.controls.update();
    });
    await page.waitForTimeout(400);
  });

  await test('8. tocar no dragão → olha, chama, mensagem', async () => {
    assert((await tapObject(page, 'p.stage.dragon.hitProxy')) === 'dragon', 'dragon not hit');
    await page.waitForSelector('.speech.on');
    assert((await page.textContent('.speech')).includes('Finalmente alguém encontrou meu mundo!'), 'speech text');
    await page.screenshot({ path: path.join(out, 'e2e-08-dragon.png') });
  });
  await test('8. tocar na vila → luzes + informações', async () => {
    assert((await tapObject(page, 'p.stage.world.village.hitProxy')) === 'village', 'village not hit');
    await page.waitForSelector('.card.on');
    assert((await page.textContent('.card-title')).includes('Lumenvale'), 'village card');
  });
  await test('8. tocar no castelo → portões abrem', async () => {
    assert((await tapObject(page, 'p.stage.world.castle.hitProxy')) === 'castle', 'castle not hit');
    await page.waitForTimeout(1200);
    const open = await page.evaluate(() => window.__portal.stage.world.castle.open);
    assert(open > 0.3, 'gates should be opening: ' + open);
  });
  await test('8. tocar nos cristais → brilho e partículas', async () => {
    assert((await tapObject(page, 'p.stage.world.crystals.hitProxy')) === 'crystals', 'crystals not hit');
  });
  await test('descobertas: baú e coro dos cogumelos + painel', async () => {
    await page.evaluate(() => window.__portal.discoveries.reset());
    assert((await tapObject(page, 'p.stage.world.props.chestProxy')) === 'chest', 'chest not hit');
    assert((await tapObject(page, 'p.stage.world.singingProxy')) === 'mushrooms', 'mushrooms not hit');
    const n = await page.evaluate(() => window.__portal.discoveries.count);
    assert(n === 2, 'discoveries ' + n);
    await page.waitForSelector('.toast.on');
    await page.click('.dock-btn[aria-label="Descobertas"]');
    await page.waitForSelector('.panel-wrap.on');
    assert((await page.textContent('.panel-title')).includes('Descobertas do Portal'), 'panel title');
    assert((await page.textContent('.panel-eyebrow')).includes('2 de 7'), 'progress text');
    await page.screenshot({ path: path.join(out, 'e2e-08-discoveries.png') });
    await page.click('.panel-close');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('portal.discoveries') || '[]').length);
    assert(stored === 2, 'localStorage persistence ' + stored);
  });
  await test('controles: escala, girar, reiniciar', async () => {
    await page.click('.dock-btn[aria-label="Escala"]');
    await page.waitForSelector('.pop-scale.on');
    await page.click('.pop-scale .mini-btn[aria-label="Aumentar"]');
    const s = await page.evaluate(() => window.__portal.stage.userScale);
    assert(s > 1.05, 'scale ' + s);
    await page.click('.dock-btn[aria-label="Explorar"]');
    await page.waitForSelector('.pop-explore.on');
    await page.click('.pop-explore .mini-btn[aria-label="Reiniciar experiência"]');
    await page.waitForFunction(() => window.__portal.phase === 'opening');
  });
  await test('sem erros de JavaScript (suite exploração)', async () => {
    assert(errors.length === 0, errors.join(' | '));
  });
  await browser.close();
}

// ================================================================ suite C: permission denied + WebXR fallback
{
  const browser = await chromium.launch({ args: GL_ARGS });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    // Simulate an Android browser that *reports* immersive-ar but fails to start it,
    // and a user who denies the camera.
    Object.defineProperty(navigator, 'xr', {
      value: {
        isSessionSupported: async (m) => m === 'immersive-ar',
        requestSession: async () => {
          throw new DOMException('denied', 'NotAllowedError');
        },
      },
    });
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Permission denied', 'NotAllowedError');
    };
  });
  const page = await ctx.newPage();
  currentPage = page;
  const errors = [];
  watchErrors(page, errors);
  await test('3b. WebXR reportado → texto de detecção de superfícies', async () => {
    await page.goto(URL_);
    await page.waitForFunction(() => document.querySelector('.cap-text').textContent.includes('com detecção de superfícies'));
  });
  await test('2b. falha do WebXR → fallback → câmera negada → orientação clara', async () => {
    await page.click('#open-portal');
    await page.waitForSelector('.sheet-wrap.on', { timeout: 60000 });
    assert((await page.textContent('.sheet-title')).includes('câmera'), 'denied sheet title');
    await page.screenshot({ path: path.join(out, 'e2e-02-denied.png') });
    await page.click('.sheet .pill:has-text("Explorar sem câmera")');
    await page.waitForFunction(() => window.__portal.currentMode === 'explore', null, { timeout: 60000 });
  });
  await test('sem erros de JavaScript (suite permissões)', async () => {
    const real = errors.filter((e) => !/xr|NotAllowed/i.test(e));
    assert(real.length === 0, real.join(' | '));
  });
  await browser.close();
}

// ================================================================ suite D: WebXR path asks for the camera *before* the AR session
{
  const browser = await chromium.launch({ args: [...GL_ARGS, ...CAM_ARGS] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] });
  await ctx.addInitScript(() => {
    window.__calls = [];
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => (window.__calls.push('getUserMedia'), gum(c));
    Object.defineProperty(navigator, 'xr', {
      value: {
        isSessionSupported: async (m) => m === 'immersive-ar',
        requestSession: async () => {
          window.__calls.push('requestSession');
          throw new DOMException('no ARCore here', 'NotSupportedError');
        },
      },
    });
  });
  const page = await ctx.newPage();
  currentPage = page;
  const errors = [];
  watchErrors(page, errors);
  await test('2c. WebXR: câmera pedida na página antes da sessão AR (evita bloqueio do Android)', async () => {
    await page.goto(URL_);
    await page.waitForFunction(() => document.querySelector('.cap-text').textContent.includes('com detecção de superfícies'));
    await page.click('#open-portal');
    await page.waitForSelector('.instruction.on .pill.primary', { timeout: 60000 });
    assert((await page.textContent('.ins-title')).includes('Câmera liberada'), 'camera-ready step');
    let calls = await page.evaluate(() => window.__calls);
    assert(calls.join() === 'getUserMedia', 'camera must be requested before any AR session: ' + calls);
    await page.click('.instruction .pill.primary');
    await page.waitForSelector('.sheet-wrap.on', { timeout: 60000 });
    calls = await page.evaluate(() => window.__calls);
    assert(calls[0] === 'getUserMedia' && calls.includes('requestSession'), 'order ' + calls);
  });
  await test('2d. AR falhou → explicação clara (sem trocar de modo sozinho) → escolha do usuário', async () => {
    assert((await page.textContent('.sheet-title')).includes('não iniciou'), 'xr failure sheet');
    assert((await page.evaluate(() => window.__portal.currentMode)) === null, 'must not silently switch to marker');
    assert(!(await page.isVisible('.marker-only')), 'marker link hidden on WebXR devices');
    await page.click('.sheet .pill:has-text("Explorar em 3D")');
    await page.waitForFunction(() => window.__portal.currentMode === 'explore', null, { timeout: 60000 });
  });
  await test('sem erros de JavaScript (suite WebXR)', async () => {
    assert(errors.length === 0, errors.join(' | '));
  });
  await browser.close();
}

// ================================================================ suite E: Vale Alecrim (second world)
{
  const browser = await chromium.launch({ args: GL_ARGS });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  currentPage = page;
  const errors = [];
  watchErrors(page, errors);
  const W = 'p.stage.world';
  await maybeThrottle(page);
  await test('vale: seletor de mundo e abertura do portal', async () => {
    await page.goto(URL_);
    await page.click('.world-opt[data-world="vila"]');
    assert((await page.getAttribute('.world-opt[data-world="vila"]', 'aria-checked')) === 'true', 'picker');
    await page.click('#explore-3d');
    await page.waitForFunction(() => window.__portal?.phase === 'open', null, { timeout: 180000 });
    assert((await page.evaluate(() => window.__portal.stage.kind)) === 'vila', 'world kind');
    await page.evaluate(() => {
      const p = window.__portal;
      p.explore.controls.autoRotate = false;
      p.explore.controls.enableDamping = false; // no leftover camera momentum between projection and click
      p.engine.camera.position.set(0.1, 2.5, 2.2);
      p.explore.controls.target.set(0, 1.0, 0);
      p.explore.controls.update();
      p.stage.world.timeScale = 0;
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, 'e2e-vale.png') });
  });
  await test('vale: moradores falam ao toque', async () => {
    await page.evaluate(() => { const v = window.__portal.stage.world.villagers.find((x) => x.name === 'Dalva'); v.speed = 0; });
    const hit = await tapObject(page, `${W}.villagers.find((v) => v.name === 'Dalva').p.hitProxy`);
    assert(hit === 'npc:Dalva', 'hit ' + hit);
    await page.waitForSelector('.speech.on');
    assert((await page.textContent('.speech')).startsWith('Dalva:'), 'speech');
  });
  await test('vale: colheita, galinheiro, estações e relógio', async () => {
    await page.evaluate(() => window.__portal.discoveries.reset());
    await page.evaluate(() => window.__portal.stage.world.crops.forEach((c) => c.plots.forEach((pl) => (pl.g = 1))));
    assert((await tapObject(page, `${W}.proxies.field`)) === 'field', 'field');
    const left = await page.evaluate(() => window.__portal.stage.world.crops.flatMap((c) => c.plots).filter((pl) => pl.g > 0.7).length);
    assert(left === 0, 'harvested ' + left);
    assert((await tapObject(page, `${W}.proxies.coop`)) === 'coop', 'coop');
    const season = await page.evaluate(() => window.__portal.stage.world.season);
    assert((await tapObject(page, `${W}.proxies.ancient`)) === 'ancient', 'ancient tree');
    assert((await page.evaluate(() => window.__portal.stage.world.season)) === (season + 1) % 4, 'season advanced');
    const t0 = await page.evaluate(() => window.__portal.stage.world.timeOfDay);
    assert((await tapObject(page, `${W}.proxies.tower`)) === 'tower', 'tower');
    const t1 = await page.evaluate(() => window.__portal.stage.world.timeOfDay);
    assert(Math.abs(((t1 - t0 + 1) % 1) - 0.25) < 0.01, 'time skipped ' + t0 + '→' + t1);
  });
  await test('vale: segredos (carta misteriosa, tesouro, mina) + painel', async () => {
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => (window.__portal.stage.world.letterReady = true));
      assert((await tapObject(page, `${W}.proxies.mailbox`)) === 'mailbox', 'mailbox');
    }
    assert(await page.evaluate(() => window.__portal.discoveries.has('vale-carta')), 'letter discovery');
    await page.click('.card .card-close');
    await page.waitForTimeout(450);
    assert((await tapObject(page, `${W}.proxies.treasure`)) === 'treasure', 'treasure');
    await page.waitForTimeout(1200);
    assert(await page.evaluate(() => window.__portal.discoveries.has('vale-tesouro')), 'treasure discovery');
    await page.evaluate(() => { const p = window.__portal; p.engine.camera.position.set(0.0, 1.45, 0.4); p.explore.controls.target.set(-0.09, 1.1, -0.5); p.explore.controls.update(); });
    await page.waitForTimeout(300);
    { const hit = await tapObject(page, `${W}.proxies.mine`); assert(hit === 'mine', 'mine tap hit: ' + hit); }
    assert(await page.evaluate(() => window.__portal.discoveries.has('vale-mina')), 'mine discovery');
    await page.click('.dock-btn[aria-label="Descobertas"]');
    await page.waitForSelector('.panel-wrap.on');
    assert((await page.textContent('.panel-eyebrow')).includes('3 de 7'), 'panel ' + (await page.textContent('.panel-eyebrow')));
    await page.click('.panel-close');
  });
  await test('vale: pesca no lago', async () => {
    await page.evaluate(() => { const p = window.__portal; p.engine.camera.position.set(-0.5, 1.7, 1.4); p.explore.controls.target.set(-0.45, 1.05, 0.6); p.explore.controls.update(); });
    await page.waitForTimeout(300);
    { const hit = await tapObject(page, `${W}.proxies.pond`); assert(hit === 'pond', 'pond tap hit: ' + hit); }
    await page.waitForFunction(() => /Fisgou|Dourado/.test(document.querySelector('.hint')?.textContent + document.querySelector('.card')?.textContent), null, { timeout: 30000 });
  });
  await test('troca de mundo sem recarregar (vale → ilha)', async () => {
    await page.click('.topbar .icon-btn[aria-label="Sair da experiência"]');
    await page.waitForSelector('#landing:not(.hidden):not(.leaving)');
    await page.click('.world-opt[data-world="fantasia"]');
    await page.click('#explore-3d');
    await page.waitForFunction(() => window.__portal?.stage.kind === 'fantasia' && window.__portal.phase !== 'hidden', null, { timeout: 120000 });
  });
  await test('sem erros de JavaScript (suite Vale Alecrim)', async () => {
    assert(errors.length === 0, errors.join(' | '));
  });
  await browser.close();
}

// ================================================================ 12. GitHub Pages sub-directory
await test('12. publicação em subdiretório (/portal-ar/): nenhum 404, marcador acessível', async () => {
  const res = await fetch(`${ORIGIN}${BASE}marcador.html`);
  assert(res.ok, 'marcador.html');
  const svg = await fetch(`${ORIGIN}${BASE}marker.svg`);
  assert(svg.ok, 'marker.svg');
  const bad = notFound.filter((u) => !u.endsWith('favicon.ico'));
  assert(bad.length === 0, '404s: ' + bad.join(', '));
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  assert(!/(src|href)="\/(?!\/)/.test(html), 'absolute asset paths in index.html would break on GitHub Pages');
});

server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
fs.writeFileSync(path.join(out, 'e2e-report.json'), JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
