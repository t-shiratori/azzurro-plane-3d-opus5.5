/** Tiny procedural soundscape: sea breeze, a distant propeller drone and the odd gull. */
export class Soundscape {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private gullTimer = 0;
  enabled = false;

  toggle(): boolean {
    if (!this.ctx) this.start();
    else if (this.enabled) void this.ctx.suspend();
    else void this.ctx.resume();
    this.enabled = !this.enabled;
    return this.enabled;
  }

  private start() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.0;
    master.gain.linearRampToValueAtTime(0.6, ctx.currentTime + 2.5);
    master.connect(ctx.destination);
    this.master = master;

    // wind & surf: brown noise through a slowly breathing band-pass
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.5;
      }
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.value = 500;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 250;
    lfo.connect(lfoGain).connect(bp.frequency);
    const windGain = ctx.createGain();
    windGain.gain.value = 0.5;
    noise.connect(bp).connect(windGain).connect(master);
    noise.start();
    lfo.start();

    // propeller drone
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0.05;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    for (const f of [58, 58.7, 116.5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start();
    }
    const trem = ctx.createOscillator();
    trem.frequency.value = 19;
    const tremGain = ctx.createGain();
    tremGain.gain.value = 0.015;
    trem.connect(tremGain).connect(engineGain.gain);
    trem.start();
    lp.connect(engineGain).connect(master);
    this.engineGain = engineGain;
  }

  /** proximity: 0 (far) .. 1 (camera right next to the plane) */
  update(dt: number, proximity: number) {
    if (!this.ctx || !this.enabled || !this.engineGain) return;
    const target = 0.015 + proximity * 0.1;
    this.engineGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.5);
    this.gullTimer -= dt;
    if (this.gullTimer < 0) {
      this.gullTimer = 6 + Math.random() * 14;
      this.gull();
    }
  }

  private gull() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const calls = 2 + Math.floor(Math.random() * 3);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.master);
    for (let i = 0; i < calls; i++) {
      const t0 = ctx.currentTime + i * 0.32 + Math.random() * 0.05;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1800;
      f.Q.value = 1.5;
      o.frequency.setValueAtTime(1500, t0);
      o.frequency.exponentialRampToValueAtTime(2300, t0 + 0.06);
      o.frequency.exponentialRampToValueAtTime(1100, t0 + 0.26);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.05, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
      o.connect(f).connect(g).connect(pan);
      o.start(t0);
      o.stop(t0 + 0.3);
    }
  }
}
