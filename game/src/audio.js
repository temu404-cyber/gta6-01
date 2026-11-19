// Procedural sound for Solmar Bay: every effect is synthesised with the
// Web Audio API (oscillators and filtered noise), and the music is a tiny
// sequenced bass-and-hat loop written for this game. No audio files.
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.sirenOn = false;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.musicTimer = null;
    this.musicStep = 0;
    this.musicOn = false;
  }

  /** Create the context on the first user gesture; safe to call any time. */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  /** Short noise burst through a low-pass filter (gunshot, crash, thud). */
  noiseBurst(duration, filterFreq, gainValue, type = 'lowpass') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
  }

  /** A single oscillator blip with a pitch slide. */
  blip(freqA, freqB, duration, gainValue, type = 'sine') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqA, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqB), t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  shoot() {
    this.noiseBurst(0.14, 2400, 0.5, 'highpass');
    this.blip(180, 60, 0.09, 0.25, 'square');
  }

  punch() {
    this.noiseBurst(0.08, 500, 0.4);
  }

  pickup() {
    this.blip(660, 660, 0.07, 0.22);
    setTimeout(() => this.blip(990, 990, 0.1, 0.22), 70);
  }

  coin() {
    this.blip(1175, 1175, 0.06, 0.2);
    setTimeout(() => this.blip(1568, 1568, 0.12, 0.2), 60);
  }

  cash() {
    this.blip(523, 523, 0.08, 0.22);
    setTimeout(() => this.blip(659, 659, 0.08, 0.22), 80);
    setTimeout(() => this.blip(784, 784, 0.14, 0.22), 160);
  }

  crash() {
    this.noiseBurst(0.25, 700, 0.5);
  }

  click() {
    this.blip(800, 600, 0.05, 0.15, 'square');
  }

  denied() {
    this.blip(220, 160, 0.12, 0.2, 'square');
  }

  /** Continuous engine hum whose pitch follows speed (0..1). */
  setEngine(speed01, on) {
    if (!this.ctx) return;
    if (!on) {
      if (this.engineGain) this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      return;
    }
    if (!this.engineOsc) {
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 420;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
      this.engineOsc.start();
    }
    const t = this.ctx.currentTime;
    this.engineOsc.frequency.setTargetAtTime(55 + speed01 * 130, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(320 + speed01 * 900, t, 0.1);
    this.engineGain.gain.setTargetAtTime(0.05 + speed01 * 0.05, t, 0.1);
  }

  /** Two-tone police siren while any wanted stars are up. */
  setSiren(on) {
    if (!this.ctx) return;
    if (on === this.sirenOn) return;
    this.sirenOn = on;
    if (!on) {
      if (this.sirenGain) this.sirenGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
      return;
    }
    if (!this.sirenOsc) {
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'triangle';
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain).connect(this.master);
      this.sirenOsc.start();
    }
    const t = this.ctx.currentTime;
    this.sirenGain.gain.setTargetAtTime(0.045, t, 0.2);
    // Wail: glide between two tones every 0.45 s.
    const wail = () => {
      if (!this.sirenOn || !this.sirenOsc) return;
      const now = this.ctx.currentTime;
      const hi = this.sirenOsc.frequency.value > 800;
      this.sirenOsc.frequency.setTargetAtTime(hi ? 620 : 920, now, 0.05);
      setTimeout(wail, 450);
    };
    wail();
  }

  /** Start the low-key bass-and-hat loop written for Solmar Bay. */
  startMusic() {
    if (this.musicOn || !this.ensure()) return;
    this.musicOn = true;
    // A minor-key bass walk with a soft hat tick; 8 steps a bar, 132 bpm.
    const bass = [55, 0, 55, 65.4, 55, 0, 49, 58.3, 55, 0, 55, 65.4, 82.4, 0, 73.4, 65.4];
    const stepMs = 60000 / 132 / 2;
    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.muted) {
        this.musicStep += 1;
        return;
      }
      const i = this.musicStep % bass.length;
      const freq = bass[i];
      if (freq > 0) this.blip(freq, freq * 0.99, 0.22, 0.16, 'triangle');
      if (this.musicStep % 2 === 0) this.noiseBurst(0.03, 6000, 0.05, 'highpass');
      this.musicStep += 1;
    }, stepMs);
  }

  stopMusic() {
    this.musicOn = false;
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }
}
