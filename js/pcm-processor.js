/**
 * AudioWorklet processor that receives raw audio from the microphone,
 * downsamples from the browser's native rate (usually 48kHz) to 16kHz,
 * and converts float32 samples to 16-bit signed integer PCM.
 *
 * Accumulates samples and posts a message every ~100ms worth of audio.
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    // We'll calculate the downsample ratio once we know the actual sample rate
    this._downsampleRatio = sampleRate / 16000;
    this._samplesPerChunk = Math.floor(16000 * 0.1); // 1600 samples = 100ms at 16kHz
    this._sampleIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0]; // mono channel

    // Downsample and convert to 16-bit PCM
    for (let i = 0; i < channelData.length; i++) {
      this._sampleIndex++;
      // Pick every Nth sample for downsampling
      if (this._sampleIndex >= this._downsampleRatio) {
        this._sampleIndex -= this._downsampleRatio;

        // Clamp and convert float32 [-1, 1] to int16 [-32768, 32767]
        const s = Math.max(-1, Math.min(1, channelData[i]));
        const int16 = s < 0 ? s * 0x8000 : s * 0x7FFF;
        this._buffer.push(int16);
      }
    }

    // When we have enough samples for one chunk, send it
    if (this._buffer.length >= this._samplesPerChunk) {
      const samples = this._buffer.splice(0, this._samplesPerChunk);
      const pcmData = new Int16Array(samples);
      this.port.postMessage({ pcmData: pcmData.buffer }, [pcmData.buffer]);
    }

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
