/**
 * chime.js
 *
 * Generates a gentle notification chime using the Web Audio API.
 * Two short, warm tones — soft enough to draw attention without startling.
 */

export class Chime {
  constructor() {
    this._audioContext = null;
    this._lastPlayTime = 0;
    this._cooldownMs = 10000; // Don't chime more than once per 10s
  }

  /**
   * Play a gentle two-tone chime.
   * Respects cooldown to avoid rapid-fire chimes.
   */
  play() {
    const now = Date.now();
    if (now - this._lastPlayTime < this._cooldownMs) return;
    this._lastPlayTime = now;

    // Create or resume AudioContext (needed for autoplay policy)
    if (!this._audioContext) {
      this._audioContext = new AudioContext();
    }

    if (this._audioContext.state === 'suspended') {
      this._audioContext.resume();
    }

    const ctx = this._audioContext;
    const now_t = ctx.currentTime;

    // Tone 1: warm low note
    this._playTone(ctx, 440, now_t, 0.12, 0.08);

    // Tone 2: slightly higher, after a tiny gap
    this._playTone(ctx, 554, now_t + 0.15, 0.15, 0.06);
  }

  /**
   * Play a single sine tone with fade-in/out envelope.
   */
  _playTone(ctx, frequency, startTime, duration, volume) {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, startTime);

    // Gentle envelope
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(volume, startTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(startTime);
    oscillator.stop(startTime + duration);
  }
}
