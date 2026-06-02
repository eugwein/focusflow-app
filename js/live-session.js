import { getApiKey } from './config.js';

const MODEL = 'gemini-3.1-flash-live-preview';

// Reconnect before the 10-minute session limit
const SESSION_MAX_MS = 9 * 60 * 1000; // 9 minutes

export class LiveSession {
  constructor() {
    this._ws = null;
    this._setupDone = false;
    this._reconnectTimer = null;
    this._running = false;

    // Callbacks
    this._onTranscript = null;
    this._onTurnComplete = null;
    this._onError = null;
    this._onStatusChange = null;
  }

  /** @param {function(string): void} cb - called with transcript text */
  onTranscript(cb) { this._onTranscript = cb; }

  /** @param {function(): void} cb - called when a turn completes */
  onTurnComplete(cb) { this._onTurnComplete = cb; }

  /** @param {function(Error): void} cb - called on errors */
  onError(cb) { this._onError = cb; }

  /** @param {function(string): void} cb - called with status string */
  onStatusChange(cb) { this._onStatusChange = cb; }

  /**
   * Connect to the Gemini Live API and send the setup config.
   * @returns {Promise<void>}
   */
  async connect() {
    if (this._running) return;
    this._running = true;
    this._emitStatus('connecting');

    const apiKey = getApiKey();
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;

    return new Promise((resolve, reject) => {
      try {
        this._ws = new WebSocket(wsUrl);
      } catch (err) {
        this._running = false;
        this._emitStatus('error');
        reject(new Error(`WebSocket creation failed: ${err.message}`));
        return;
      }

      this._ws.onopen = () => {
        this._sendSetup();
        this._emitStatus('connected');

        // Schedule reconnection before session timeout
        this._reconnectTimer = setTimeout(() => {
          this._reconnect();
        }, SESSION_MAX_MS);

        resolve();
      };

      this._ws.onmessage = (event) => {
        this._handleMessage(event);
      };

      this._ws.onerror = (event) => {
        const err = new Error('WebSocket error occurred.');
        if (this._onError) this._onError(err);
        this._emitStatus('error');
      };

      this._ws.onclose = (event) => {
        this._setupDone = false;
        const closeMsg = `WebSocket closed (code: ${event.code}, reason: "${event.reason || 'No reason provided'}").`;
        console.warn(closeMsg);
        
        if (event.code === 403 || event.code === 1008 || (event.reason && event.reason.includes('API key'))) {
          const reasonStr = event.reason ? `: ${event.reason}` : '';
          const err = new Error(`Connection failed (code ${event.code})${reasonStr}. Please check your API key in settings.`);
          if (this._onError) this._onError(err);
          this._emitStatus('error');
          this.disconnect();
          reject(err);
          return;
        }

        if (this._running) {
          // Unexpected close — attempt reconnect
          if (this._onError) this._onError(new Error(closeMsg));
          this._emitStatus('reconnecting');
          setTimeout(() => this._reconnect(), 2000);
        } else {
          this._emitStatus('disconnected');
        }
      };
    });
  }

  /**
   * Send a base64-encoded PCM audio chunk to the Live API.
   * @param {string} base64Audio - base64-encoded 16-bit PCM audio
   */
  sendAudio(base64Audio) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN || !this._setupDone) {
      return;
    }

    const message = {
      realtimeInput: {
        audio: {
          data: base64Audio,
          mimeType: 'audio/pcm;rate=16000'
        }
      }
    };

    this._ws.send(JSON.stringify(message));
  }

  /**
   * Disconnect and clean up.
   */
  disconnect() {
    this._running = false;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (this._ws) {
      this._ws.onclose = null; // Prevent reconnect attempt
      this._ws.close();
      this._ws = null;
    }

    this._setupDone = false;
    this._emitStatus('disconnected');
  }

  get isConnected() {
    return this._ws && this._ws.readyState === WebSocket.OPEN && this._setupDone;
  }

  // --- Private methods ---

  _sendSetup() {
    const config = {
      setup: {
        model: `models/${MODEL}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
        },
        inputAudioTranscription: {},
        systemInstruction: {
          parts: [{
            text: 'You are a silent listener. Do not speak, do not respond, do not generate any audio output. Simply listen to the audio input.'
          }]
        },
        realtimeInputConfig: {
          automaticActivityDetection: {
            startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
            endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
            prefixPaddingMs: 200,
            silenceDurationMs: 1000,
          }
        }
      }
    };

    this._ws.send(JSON.stringify(config));
  }

  async _handleMessage(event) {
    let rawData = event.data;
    if (rawData instanceof Blob) {
      try {
        rawData = await rawData.text();
      } catch (e) {
        return;
      }
    } else if (rawData instanceof ArrayBuffer) {
      try {
        rawData = new TextDecoder().decode(rawData);
      } catch (e) {
        return;
      }
    }

    let data;
    try {
      data = JSON.parse(rawData);
    } catch (e) {
      return;
    }

    // Handle setup completion
    if (data.setupComplete) {
      this._setupDone = true;
      this._emitStatus('listening');
      return;
    }

    if (data.serverContent) {
      const content = data.serverContent;

      // Input transcription — this is what we want
      if (content.inputTranscription && content.inputTranscription.text) {
        if (this._onTranscript) {
          this._onTranscript(content.inputTranscription.text);
        }
      }

      // Turn complete signal
      if (content.turnComplete) {
        if (this._onTurnComplete) {
          this._onTurnComplete();
        }
      }

      // We intentionally ignore modelTurn audio data — we don't need it
    }
  }

  async _reconnect() {
    if (!this._running) return;

    this._emitStatus('reconnecting');

    // Close existing connection
    if (this._ws) {
      this._ws.onclose = null;
      this._ws.close();
      this._ws = null;
    }
    this._setupDone = false;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    // Brief pause before reconnecting
    await new Promise(r => setTimeout(r, 1000));

    if (!this._running) return;

    try {
      await this.connect();
    } catch (err) {
      if (this._onError) this._onError(err);
      // Retry after delay
      if (this._running) {
        setTimeout(() => this._reconnect(), 5000);
      }
    }
  }

  _emitStatus(status) {
    if (this._onStatusChange) {
      this._onStatusChange(status);
    }
  }
}
