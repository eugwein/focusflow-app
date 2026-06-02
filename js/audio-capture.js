/**
 * audio-capture.js
 * 
 * Captures microphone audio via Web Audio API, downsamples to 16kHz 16-bit PCM
 * using an AudioWorklet, and emits base64-encoded chunks for the Live API.
 */

export class AudioCapture {
  constructor() {
    this._stream = null;
    this._audioContext = null;
    this._workletNode = null;
    this._onChunkCallback = null;
    this._running = false;
  }

  /**
   * Register a callback that receives base64-encoded PCM chunks.
   * @param {function(string): void} callback
   */
  onChunk(callback) {
    this._onChunkCallback = callback;
  }

  /**
   * Request microphone permission and start capturing audio.
   * @returns {Promise<void>}
   * @throws {Error} if permission denied or AudioWorklet unavailable
   */
  async start() {
    if (this._running) return;

    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: { ideal: 16000 },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new Error('Microphone permission was denied. Please allow microphone access to use FocusFlow.');
      }
      throw new Error(`Could not access microphone: ${err.message}`);
    }

    this._audioContext = new AudioContext({ sampleRate: 48000 });

    // Load the AudioWorklet processor
    const processorUrl = new URL('./pcm-processor.js', import.meta.url).href;
    await this._audioContext.audioWorklet.addModule(processorUrl);

    const source = this._audioContext.createMediaStreamSource(this._stream);
    this._workletNode = new AudioWorkletNode(this._audioContext, 'pcm-processor');

    this._workletNode.port.onmessage = (event) => {
      if (this._onChunkCallback && event.data.pcmData) {
        const base64 = this._arrayBufferToBase64(event.data.pcmData);
        this._onChunkCallback(base64);
      }
    };

    source.connect(this._workletNode);
    // Don't connect to destination — we don't want to play the mic back
    this._workletNode.connect(this._audioContext.destination);

    this._running = true;
  }

  /**
   * Stop capturing audio and release resources.
   */
  stop() {
    if (!this._running) return;

    if (this._workletNode) {
      this._workletNode.disconnect();
      this._workletNode = null;
    }

    if (this._stream) {
      this._stream.getTracks().forEach(track => track.stop());
      this._stream = null;
    }

    if (this._audioContext) {
      this._audioContext.close();
      this._audioContext = null;
    }

    this._running = false;
  }

  get isRunning() {
    return this._running;
  }

  /**
   * Convert an ArrayBuffer to a base64 string.
   * @param {ArrayBuffer} buffer
   * @returns {string}
   */
  _arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
