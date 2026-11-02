import '@fontsource/cinzel/latin-400.css';
import '@fontsource/cinzel/latin-600.css';
import '@fontsource/cormorant-garamond/latin-400-italic.css';
import '@fontsource/cormorant-garamond/latin-500-italic.css';
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-600.css';
import './styles/main.css';

import { AudioEngine } from './audio/AudioEngine';
import { detectCapabilities, type Capabilities } from './ar/capabilities';
import { describeCapabilities, startMotes } from './ui/Landing';
import { loadQualityPreference, resolveQuality, saveQualityPreference, type QualityPreference } from './systems/Quality';
import { Haptics } from './systems/Haptics';
import { idle } from './utils/dom';
import { Storage } from './systems/Storage';
import { requestGyroPermission } from './ar/gyro';
import type { WorldKind } from './scenes/Stage';
import type { Experience } from './app/Experience';

const audio = new AudioEngine();
const landing = document.getElementById('landing')!;
const openBtn = document.getElementById('open-portal') as HTMLButtonElement;
const exploreBtn = document.getElementById('explore-3d') as HTMLButtonElement;
const capEl = document.getElementById('capability')!;
const qualitySel = document.getElementById('quality-select') as HTMLSelectElement;
const motes = startMotes(document.getElementById('motes') as HTMLCanvasElement);
const params = new URLSearchParams(location.search);

let caps: Capabilities | null = null;
const urlWorld = params.get('world');
const WORLDS: WorldKind[] = ['fantasia', 'vila', 'duda'];
let world: WorldKind = WORLDS.includes(urlWorld as WorldKind) ? (urlWorld as WorldKind) : Storage.get<WorldKind>('world', 'fantasia');
if (!WORLDS.includes(world)) world = 'fantasia';
const worldButtons = [...document.querySelectorAll<HTMLButtonElement>('.world-opt')];
function selectWorld(k: WorldKind) {
  world = k;
  Storage.set('world', k);
  for (const b of worldButtons) {
    const on = b.dataset.world === k;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
}
worldButtons.forEach((b) => b.addEventListener('click', () => (selectWorld(b.dataset.world as WorldKind), Haptics.tap())));
selectWorld(world);
let experience: Promise<Experience> | null = null;
let busy = false;

qualitySel.value = loadQualityPreference();
qualitySel.addEventListener('change', async () => {
  const pref = qualitySel.value as QualityPreference;
  saveQualityPreference(pref);
  if (experience) (await experience).applyQuality(resolveQuality(pref).level);
});

function getExperience() {
  if (!experience) {
    experience = import('./app/Experience')
      .then((m) => m.Experience.create(audio, resolveQuality(), world))
      .then((exp) => {
        exp.onExit = showLanding;
        return exp;
      });
    experience.catch((e) => {
      console.error(e);
      experience = null;
      setCapability('Não foi possível carregar o mundo. Recarregue a página.', 'warn');
    });
  }
  return experience;
}

function setCapability(text: string, tone: 'good' | 'ok' | 'warn') {
  capEl.querySelector('.cap-text')!.textContent = text;
  capEl.dataset.tone = tone;
}

function hideLanding() {
  landing.classList.add('leaving');
  setTimeout(() => {
    landing.classList.add('hidden');
    motes(false);
  }, 650);
}

function showLanding() {
  landing.classList.remove('hidden');
  motes(true);
  requestAnimationFrame(() => landing.classList.remove('leaving'));
  busy = false;
}

openBtn.addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  audio.unlock(); // inside the gesture
  void requestGyroPermission(); // iOS only grants motion sensors from inside the tap
  Haptics.tap();
  const c = caps ?? (await detectCapabilities());
  if (!c.webgl) {
    busy = false;
    return;
  }
  const expP = getExperience();
  hideLanding();
  const exp = await expP;
  await exp.setWorld(world);
  const forced = params.get('mode');
  if (forced === 'marker' || forced === 'manual') {
    await exp.startCamera(forced);
    return;
  }
  if (c.webxrAR) {
    await exp.startXRFlow();
    return;
  }
  // no surface detection: straight to the camera + gyroscope (3D is offered if that fails)
  await exp.startBest();
});

exploreBtn.addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  audio.unlock();
  Haptics.tap();
  const expP = getExperience();
  hideLanding();
  const exp = await expP;
  await exp.setWorld(world);
  await exp.startExplore();
});

(async () => {
  caps = await detectCapabilities();
  const d = describeCapabilities(caps);
  setCapability(d.text, d.tone);
  // the printed marker only matters on devices without WebXR surface detection
  if (caps.webxrAR) document.querySelectorAll<HTMLElement>('.marker-only').forEach((el) => (el.hidden = true));
  if (!caps.webgl) {
    openBtn.disabled = true;
    exploreBtn.disabled = true;
    return;
  }
  // build the world in the background so the portal opens instantly
  await idle(1200);
  void getExperience();
  if (params.get('autostart') === 'explore') exploreBtn.click();
})();

window.addEventListener('error', (e) => console.error('[portal]', e.message));
// A lazily-loaded chunk failed (flaky network or a new deploy replaced the files): offer a reload.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  experience = null;
  busy = false;
  showLanding();
  setCapability('Falha ao carregar parte do mundo. Toque aqui para recarregar.', 'warn');
  capEl.addEventListener('click', () => location.reload(), { once: true });
});
