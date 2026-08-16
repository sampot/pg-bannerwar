const SFX = {
  click: "./assets/audio/click.ogg",
  ok: "./assets/audio/ok.ogg",
  hit: "./assets/audio/hit.ogg",
  soft: "./assets/audio/soft.ogg",
  error: "./assets/audio/error.ogg",
  win: "./assets/audio/win.ogg",
};

export class GameAudio {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.buffers = new Map();
    this.music = null;
    this.musicGain = null;
  }

  async start() {
    this.ctx ??= new AudioContext();
    await this.ctx.resume();
    await Promise.all(Object.entries(SFX).map(([name, url]) => this.#load(name, url)));
    await this.#startMusic();
  }

  async #load(name, url) {
    if (this.buffers.has(name)) return;
    try {
      const res = await fetch(url);
      const data = await res.arrayBuffer();
      this.buffers.set(name, await this.ctx.decodeAudioData(data));
    } catch {
      this.buffers.set(name, null);
    }
  }

  async #startMusic() {
    if (this.music || !this.ctx) return;
    try {
      const res = await fetch("./assets/audio/music.ogg");
      const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
      const source = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      gain.gain.value = this.enabled ? 0.22 : 0;
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain).connect(this.ctx.destination);
      source.start();
      this.music = source;
      this.musicGain = gain;
    } catch {}
  }

  play(name, { volume = 0.5, rate = 1 } = {}) {
    const buffer = this.buffers.get(name);
    if (!this.enabled || !this.ctx || !buffer) return;
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = volume;
    source.connect(gain).connect(this.ctx.destination);
    source.start();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.musicGain) this.musicGain.gain.value = on ? 0.22 : 0;
  }
}
