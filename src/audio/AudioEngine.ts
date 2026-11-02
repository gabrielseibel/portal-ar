import { Storage } from '../systems/Storage';

type Vec3 = { x: number; y: number; z: number };

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
// D lydian-ish palette: dreamy, never dark
const CHORDS = [
  [50, 57, 62, 66, 69, 73], // Dmaj9
  [47, 54, 59, 62, 66, 69], // Bm9
  [43, 50, 55, 59, 62, 69], // Gmaj7(9)
  [45, 52, 57, 61, 64, 71], // A6/9
];
const PENTA = [74, 76, 78, 81, 83, 86, 88, 90];

/**
 * PORTAL's sound identity, 100% synthesized with the Web Audio API
 * (no audio files to download). Starts only after a user gesture.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private music!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private ambienceOn = false;
  private waterPanners: PannerNode[] = [];
  private timers: number[] = [];
  private padVoices: Array<{ osc: OscillatorNode[]; gain: GainNode }> = [];
  private chordIndex = 0;
  private spatialScale = 1;
  muted = Storage.get('muted', false);
  onChange: (muted: boolean) => void = () => {};

  get ready() {
    return !!this.ctx;
  }

  /** Must be called synchronously inside a user gesture handler. */
  unlock() {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor({ latencyHint: 'interactive' });
        this.build();
        document.addEventListener('visibilitychange', () => {
          if (!this.ctx) return;
          if (document.hidden) void this.ctx.suspend();
          else if (!this.muted) void this.ctx.resume();
        });
      }
      // iOS: play a silent buffer inside the gesture to fully unlock output
      const b = this.ctx.createBuffer(1, 1, 22050);
      const s = this.ctx.createBufferSource();
      s.buffer = b;
      s.connect(this.ctx.destination);
      s.start(0);
      if (this.ctx.state !== 'running') void this.ctx.resume();
    } catch (e) {
      console.warn('[audio] indisponível', e);
      this.ctx = null;
    }
  }

  private build() {
    const ctx = this.ctx!;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = gain(ctx, 0.95, this.master);
    this.amb = gain(ctx, 0.7, this.master);
    this.music = gain(ctx, 0.55, this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulse(ctx, 3.2, 2.6);
    this.reverbSend = gain(ctx, 0.5, this.reverb);
    this.reverb.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean) {
    this.muted = m;
    Storage.set('muted', m);
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, t, 0.08);
      if (!m && this.ctx.state !== 'running') void this.ctx.resume();
    }
    this.onChange(m);
  }

  toggleMuted() {
    this.setMuted(!this.muted);
  }

  /** World-space scale of the diorama, so spatial attenuation matches its real size. */
  setSpatialScale(s: number) {
    this.spatialScale = s;
    for (const p of this.waterPanners) p.refDistance = 0.35 * s;
  }

  setListener(e: ArrayLike<number>) {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const px = e[12];
    const py = e[13];
    const pz = e[14];
    const fx = -e[8];
    const fy = -e[9];
    const fz = -e[10];
    const ux = e[4];
    const uy = e[5];
    const uz = e[6];
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setTargetAtTime(px, t, 0.03);
      l.positionY.setTargetAtTime(py, t, 0.03);
      l.positionZ.setTargetAtTime(pz, t, 0.03);
      l.forwardX.setTargetAtTime(fx, t, 0.03);
      l.forwardY.setTargetAtTime(fy, t, 0.03);
      l.forwardZ.setTargetAtTime(fz, t, 0.03);
      l.upX.setTargetAtTime(ux, t, 0.03);
      l.upY.setTargetAtTime(uy, t, 0.03);
      l.upZ.setTargetAtTime(uz, t, 0.03);
    } else {
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(px, py, pz);
      (l as unknown as { setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void }).setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  private panner(pos?: Vec3, ref = 0.35): AudioNode {
    const ctx = this.ctx!;
    if (!pos) return this.sfx;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref * this.spatialScale;
    p.rolloffFactor = 0.9;
    setPannerPos(p, pos);
    p.connect(this.sfx);
    return p;
  }

  // ------------------------------------------------------------- ambience
  startAmbience(waterPositions: Vec3[]) {
    const ctx = this.ctx;
    if (!ctx || this.ambienceOn) return;
    this.ambienceOn = true;
    // wind
    const wind = this.noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    lp.Q.value = 0.7;
    const wg = gain(ctx, 0.0, this.amb);
    wind.connect(lp).connect(wg);
    wg.gain.setTargetAtTime(0.09, ctx.currentTime, 2);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = gain(ctx, 260, lp.frequency);
    lfo.connect(lfoG);
    lfo.start();
    wind.start();

    // water (spatial)
    for (const pos of waterPositions) {
      const src = this.noiseSource();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 0.5;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 350;
      const g = gain(ctx, 0, null);
      const pn = ctx.createPanner();
      pn.panningModel = 'HRTF';
      pn.distanceModel = 'inverse';
      pn.refDistance = 0.35 * this.spatialScale;
      pn.rolloffFactor = 1.1;
      setPannerPos(pn, pos);
      src.connect(bp).connect(hp).connect(g).connect(pn).connect(this.amb);
      g.gain.setTargetAtTime(0.32, ctx.currentTime, 1.5);
      src.start(0, Math.random() * 1.5);
      this.waterPanners.push(pn);
    }

    // birdsong + crickets scheduler
    const chirp = () => {
      if (!this.ambienceOn) return;
      const a = Math.random() * Math.PI * 2;
      this.birdSong({ x: Math.cos(a) * 1.2 * this.spatialScale + this.lastListener.x, y: this.lastListener.y + 0.3 * this.spatialScale, z: Math.sin(a) * 1.2 * this.spatialScale + this.lastListener.z });
      this.timers.push(window.setTimeout(chirp, 2500 + Math.random() * 6000));
    };
    this.timers.push(window.setTimeout(chirp, 1800));

    // music pad
    this.playChord();
    this.timers.push(
      window.setInterval(() => {
        this.chordIndex = (this.chordIndex + 1) % CHORDS.length;
        this.playChord();
        if (Math.random() < 0.6) this.sparkleArp();
      }, 9000),
    );
  }

  private lastListener = { x: 0, y: 0, z: 0 };

  stopAmbience() {
    if (!this.ctx || !this.ambienceOn) return;
    this.ambienceOn = false;
    for (const t of this.timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    this.timers = [];
    const now = this.ctx.currentTime;
    this.amb.gain.setTargetAtTime(0, now, 0.4);
    this.music.gain.setTargetAtTime(0, now, 0.4);
    const amb = this.amb;
    const music = this.music;
    setTimeout(() => {
      amb.disconnect();
      music.disconnect();
      if (!this.ctx) return;
      this.amb = gain(this.ctx, 0.7, this.master);
      this.music = gain(this.ctx, 0.55, this.master);
    }, 1500);
    this.padVoices = [];
    this.waterPanners = [];
  }

  private playChord() {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    for (const v of this.padVoices) {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setTargetAtTime(0, now, 1.6);
      v.osc.forEach((o) => o.stop(now + 6));
    }
    this.padVoices = [];
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    lp.connect(this.music);
    lp.connect(this.reverbSend);
    for (const n of CHORDS[this.chordIndex]) {
      const g = gain(ctx, 0, lp);
      const oscs: OscillatorNode[] = [];
      for (const det of [-6, 5]) {
        const o = ctx.createOscillator();
        o.type = n < 55 ? 'sine' : 'triangle';
        o.frequency.value = NOTE(n);
        o.detune.value = det;
        o.connect(g);
        o.start(now);
        oscs.push(o);
      }
      g.gain.setTargetAtTime(n < 55 ? 0.05 : 0.022, now, 2.2);
      this.padVoices.push({ osc: oscs, gain: g });
    }
  }

  private sparkleArp() {
    const ctx = this.ctx!;
    const base = ctx.currentTime + 0.5;
    const notes = [...PENTA].sort(() => Math.random() - 0.5).slice(0, 5);
    notes.forEach((n, i) => this.bell(NOTE(n), base + i * 0.22, 0.05, 1.6, this.music));
  }

  // ------------------------------------------------------------ primitives
  private noiseSource(loop = true) {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  private bell(freq: number, when: number, vol: number, decay: number, out: AudioNode = this.sfx, wet = 0.7) {
    const ctx = this.ctx!;
    const g = gain(ctx, 0, out);
    const send = gain(ctx, wet, this.reverbSend);
    g.connect(send);
    const ratios = [1, 2.76, 5.4, 8.93];
    const amps = [1, 0.45, 0.22, 0.1];
    ratios.forEach((r, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * r;
      const og = gain(ctx, amps[i], g);
      o.connect(og);
      o.start(when);
      o.stop(when + decay + 0.1);
    });
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
  }

  private noiseBurst(when: number, dur: number, vol: number, type: BiquadFilterType, freq: number, q = 1, out: AudioNode = this.sfx, freqEnd?: number) {
    const ctx = this.ctx!;
    const s = this.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, when);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, when + dur);
    f.Q.value = q;
    const g = gain(ctx, 0, out);
    s.connect(f).connect(g);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + Math.min(0.03, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    s.start(when, Math.random());
    s.stop(when + dur + 0.05);
    return g;
  }

  private tone(type: OscillatorType, f0: number, f1: number, when: number, dur: number, vol: number, out: AudioNode = this.sfx) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, when);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), when + dur);
    const g = gain(ctx, 0, out);
    o.connect(g);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.start(when);
    o.stop(when + dur + 0.05);
    return o;
  }

  // ------------------------------------------------------------------ sfx
  ui() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone('sine', 1250, 900, t, 0.07, 0.06);
  }

  /** The ~3 s portal opening: rumble, rising whoosh, shimmering chord, impact. */
  portalOpen() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    // sub rumble
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(48, t);
    o.frequency.linearRampToValueAtTime(70, t + 2.7);
    const og = gain(ctx, 0, this.sfx);
    o.connect(og);
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.35, t + 1.6);
    og.gain.linearRampToValueAtTime(0.0, t + 3.2);
    o.start(t);
    o.stop(t + 3.3);
    // rising whoosh
    const w = this.noiseSource(false);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(180, t);
    bp.frequency.exponentialRampToValueAtTime(3200, t + 2.7);
    const wg = gain(ctx, 0, this.sfx);
    w.connect(bp).connect(wg);
    wg.connect(this.reverbSend);
    wg.gain.setValueAtTime(0, t);
    wg.gain.linearRampToValueAtTime(0.32, t + 2.5);
    wg.gain.linearRampToValueAtTime(0, t + 2.85);
    w.start(t);
    w.stop(t + 3);
    // shimmering chord
    [74, 81, 86, 90, 93].forEach((n, i) => {
      const s = ctx.createOscillator();
      s.type = 'sine';
      s.frequency.value = NOTE(n);
      const trem = ctx.createOscillator();
      trem.frequency.value = 5 + i * 1.3;
      const tg = gain(ctx, 0.012, null);
      const sg = gain(ctx, 0, this.sfx);
      trem.connect(tg).connect(sg.gain);
      s.connect(sg);
      sg.connect(this.reverbSend);
      sg.gain.setValueAtTime(0, t);
      sg.gain.linearRampToValueAtTime(0.03, t + 0.8 + i * 0.25);
      sg.gain.linearRampToValueAtTime(0.045, t + 2.7);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + 6);
      s.start(t);
      trem.start(t);
      s.stop(t + 6.1);
      trem.stop(t + 6.1);
    });
    // impact at the flash
    const ti = t + 2.75;
    this.tone('sine', 120, 38, ti, 1.2, 0.5);
    this.noiseBurst(ti, 1.6, 0.28, 'lowpass', 2400, 0.7, this.sfx, 300);
    [62, 69, 74, 78, 81].forEach((n, i) => this.bell(NOTE(n), ti + i * 0.04, 0.08, 3.5, this.sfx, 1));
  }

  /** Short, endearing dragon call (pitch can be raised for the baby). */
  dragonRoar(pos?: Vec3, pitch = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.panner(pos);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(260 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(560 * pitch, t + 0.18);
    o.frequency.exponentialRampToValueAtTime(330 * pitch, t + 0.55);
    o.frequency.exponentialRampToValueAtTime(240 * pitch, t + 0.8);
    const vib = ctx.createOscillator();
    vib.frequency.value = 28;
    const vg = gain(ctx, 18 * pitch, o.frequency);
    vib.connect(vg);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 900 * pitch;
    f1.Q.value = 3;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1900 * pitch;
    f2.Q.value = 4;
    const g = gain(ctx, 0, out);
    o.connect(f1).connect(g);
    o.connect(f2).connect(g);
    g.connect(this.reverbSend);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.55, t + 0.06);
    g.gain.setValueAtTime(0.5, t + 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
    o.start(t);
    vib.start(t);
    o.stop(t + 0.9);
    vib.stop(t + 0.9);
    this.noiseBurst(t, 0.6, 0.06, 'bandpass', 1400 * pitch, 1.2, out);
  }

  flame(pos?: Vec3, dur = 1.2) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.05;
    const out = this.panner(pos);
    const g = this.noiseBurst(t, dur, 0.3, 'lowpass', 1600, 0.6, out, 700);
    g.gain.setValueAtTime(0.3, t + dur * 0.6);
    for (let i = 0; i < 9; i++) this.noiseBurst(t + Math.random() * dur, 0.03, 0.12, 'highpass', 3000, 1, out);
  }

  wingBeat(pos?: Vec3) {
    if (!this.ctx) return;
    this.noiseBurst(this.ctx.currentTime, 0.12, 0.12, 'lowpass', 700, 0.8, this.panner(pos));
  }

  land(pos?: Vec3) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this.panner(pos);
    this.tone('sine', 140, 60, t, 0.18, 0.25, out);
    this.noiseBurst(t, 0.15, 0.1, 'lowpass', 500, 0.7, out);
  }

  crystalChime(pos?: Vec3, seed = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this.panner(pos);
    for (let i = 0; i < 4; i++) this.bell(NOTE(PENTA[(seed + i * 2) % PENTA.length]), t + i * 0.09, 0.09, 2.6, out, 0.9);
  }

  villageBells(pos?: Vec3) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this.panner(pos);
    [69, 66, 62, 69, 74].forEach((n, i) => this.bell(NOTE(n - 12), t + i * 0.32, 0.14, 2.8, out, 0.6));
  }

  castleFanfare(pos?: Vec3) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.panner(pos);
    const notes: Array<[number, number, number]> = [
      [62, 0, 0.18],
      [66, 0.18, 0.18],
      [69, 0.36, 0.18],
      [74, 0.54, 0.7],
    ];
    for (const [n, at, d] of notes) {
      for (const det of [-4, 4]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = NOTE(n);
        o.detune.value = det;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(600, t + at);
        f.frequency.linearRampToValueAtTime(2400, t + at + 0.05);
        f.frequency.exponentialRampToValueAtTime(900, t + at + d);
        const g = gain(ctx, 0, out);
        g.connect(this.reverbSend);
        o.connect(f).connect(g);
        g.gain.setValueAtTime(0, t + at);
        g.gain.linearRampToValueAtTime(0.07, t + at + 0.03);
        g.gain.setValueAtTime(0.07, t + at + d * 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, t + at + d + 0.15);
        o.start(t + at);
        o.stop(t + at + d + 0.2);
      }
    }
    // gate creak
    const c = ctx.createOscillator();
    c.type = 'sawtooth';
    c.frequency.setValueAtTime(70, t + 0.4);
    c.frequency.linearRampToValueAtTime(110, t + 1.6);
    const cf = ctx.createBiquadFilter();
    cf.type = 'bandpass';
    cf.frequency.value = 700;
    cf.Q.value = 6;
    const cg = gain(ctx, 0, out);
    c.connect(cf).connect(cg);
    cg.gain.setValueAtTime(0, t + 0.4);
    cg.gain.linearRampToValueAtTime(0.05, t + 0.6);
    cg.gain.linearRampToValueAtTime(0.0, t + 1.6);
    c.start(t + 0.4);
    c.stop(t + 1.7);
  }

  discovery() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [74, 78, 81, 86, 90, 93].forEach((n, i) => this.bell(NOTE(n), t + i * 0.08, 0.07, 2.2, this.sfx, 1));
    this.noiseBurst(t, 1.2, 0.05, 'highpass', 5000, 0.7, this.reverbSend);
  }

  chest(pos?: Vec3) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this.panner(pos);
    this.tone('triangle', 180, 90, t, 0.2, 0.2, out);
    for (let i = 0; i < 10; i++) this.bell(2400 + Math.random() * 2400, t + 0.15 + Math.random() * 0.9, 0.035, 0.4, out, 0.4);
  }

  mushroomChoir(pos?: Vec3) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.panner(pos);
    [62, 66, 69, 74].forEach((n, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(NOTE(n) * 0.97, t + i * 0.18);
      o.frequency.linearRampToValueAtTime(NOTE(n), t + i * 0.18 + 0.2);
      const f1 = ctx.createBiquadFilter();
      f1.type = 'bandpass';
      f1.frequency.value = 480;
      f1.Q.value = 2;
      const f2 = ctx.createBiquadFilter();
      f2.type = 'bandpass';
      f2.frequency.value = 820;
      f2.Q.value = 3;
      const g = gain(ctx, 0, out);
      g.connect(this.reverbSend);
      o.connect(f1).connect(g);
      o.connect(f2).connect(g);
      const at = t + i * 0.18;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.16, at + 0.25);
      g.gain.setValueAtTime(0.16, at + 1.2);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 2.2);
      o.start(at);
      o.stop(at + 2.3);
    });
  }

  spiritChime(pos?: Vec3) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this.panner(pos);
    [86, 93, 98].forEach((n, i) => this.bell(NOTE(n), t + i * 0.12, 0.05, 2.5, out, 1));
    this.noiseBurst(t, 0.8, 0.04, 'bandpass', 3000, 2, out, 6000);
  }

  birdSong(pos?: Vec3) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.panner(pos, 0.6);
    const base = 2400 + Math.random() * 1600;
    const reps = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < reps; i++) {
      const at = t + i * (0.11 + Math.random() * 0.05);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(base, at);
      o.frequency.exponentialRampToValueAtTime(base * 1.45, at + 0.05);
      o.frequency.exponentialRampToValueAtTime(base * 0.9, at + 0.09);
      const g = gain(ctx, 0, out);
      o.connect(g);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.035, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.1);
      o.start(at);
      o.stop(at + 0.12);
    }
  }

  setListenerPosition(p: Vec3) {
    this.lastListener = { x: p.x, y: p.y, z: p.z };
  }
}

function gain(ctx: AudioContext, v: number, to: AudioNode | AudioParam | null) {
  const g = ctx.createGain();
  g.gain.value = v;
  if (to) g.connect(to as AudioNode);
  return g;
}

function setPannerPos(p: PannerNode, pos: Vec3) {
  if (p.positionX) {
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
  } else (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
}

function impulse(ctx: AudioContext, seconds: number, decay: number) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}
