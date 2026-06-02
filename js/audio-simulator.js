/**
 * audio-simulator.js
 *
 * Downloads a test audio file, decodes and resamples it to 16kHz mono PCM,
 * and streams it chunk-by-chunk to the LiveSession.
 */

export class AudioSimulator {
  constructor(session) {
    this.session = session;
    this.audioUrl = 'https://raw.githubusercontent.com/voxserv/audio_quality_testing_samples/master/testaudio/16000/test01_20s.wav';
    this.isPlaying = false;
    this.timer = null;
    this.onProgress = null;
    this.onFinished = null;
  }

  /**
   * Starts fetching and streaming the test audio.
   */
  async start(onProgress, onFinished) {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.onProgress = onProgress;
    this.onFinished = onFinished;

    try {
      if (this.onProgress) this.onProgress('Fetching test audio...');
      const response = await fetch(this.audioUrl);
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status} fetching test audio.`);
      }

      if (this.onProgress) this.onProgress('Decoding audio...');
      const arrayBuffer = await response.arrayBuffer();
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

      if (this.onProgress) this.onProgress('Resampling to 16kHz mono...');
      const offlineCtx = new OfflineAudioContext(
        1, // mono
        audioBuffer.duration * 16000,
        16000 // 16kHz
      );
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineCtx.destination);
      source.start();
      
      const resampledBuffer = await offlineCtx.startRendering();
      const channelData = resampledBuffer.getChannelData(0); // Float32Array

      if (this.onProgress) this.onProgress('Streaming test audio...');
      this._stream(channelData);
    } catch (err) {
      this.stop();
      throw err;
    }
  }

  stop() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.onFinished) {
      this.onFinished();
    }
  }

  _stream(channelData) {
    const sampleRate = 16000;
    const chunkSizeMs = 100; // Send 100ms chunks
    const chunkSamples = (sampleRate * chunkSizeMs) / 1000; // 1600 samples
    let offset = 0;

    this.timer = setInterval(() => {
      if (!this.isPlaying) return;

      if (offset >= channelData.length) {
        this.stop();
        return;
      }

      const end = Math.min(offset + chunkSamples, channelData.length);
      const slice = channelData.subarray(offset, end);
      offset = end;

      // Convert Float32 slice to 16-bit PCM
      const pcmBuffer = this._floatTo16BitPCM(slice);
      const base64 = this._arrayBufferToBase64(pcmBuffer);

      this.session.sendAudio(base64);
    }, chunkSizeMs);
  }

  _floatTo16BitPCM(float32Array) {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
      let s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
  }

  _arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
