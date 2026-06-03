/**
 * transcript-store.js
 *
 * Buffers incoming transcription fragments, maintains a rolling window,
 * and triggers summarization at appropriate moments.
 */

export class TranscriptStore {
  constructor() {
    /** Full session transcript entries: { text, timestamp } */
    this._entries = [];

    /** Index of last entry sent to summarizer */
    this._lastSummarizedIndex = -1;

    /** Timestamp of last summarizer trigger */
    this._lastTriggerTime = 0;

    /** Callbacks */
    this._onTrigger = null;
    this._onEntry = null;

    /** Timer for silence-based triggers */
    this._silenceTimer = null;

    /** Config */
    this.SUMMARY_INTERVAL_MS = 30000;     // Min 30s between time-based triggers
    this.SILENCE_TRIGGER_MS = 6000;        // Trigger after 6s silence (teachers pause naturally for 3-5s)
    this.WINDOW_SECONDS = 180;             // 3-minute rolling window
    this.MIN_NEW_CHARS = 50;               // Min new chars before triggering
  }

  /**
   * Called when summarization should be triggered.
   * @param {function({recentText: string, newText: string, fullTranscript: string}): void} cb
   */
  onTrigger(cb) { this._onTrigger = cb; }

  /**
   * Called when a new transcript entry is added (for UI updates).
   * @param {function({text: string, timestamp: number}): void} cb
   */
  onEntry(cb) { this._onEntry = cb; }

  /**
   * Add a transcript fragment from the Live API.
   * @param {string} text
   */
  addFragment(text) {
    if (!text || !text.trim()) return;

    const entry = {
      text: text.trim(),
      timestamp: Date.now()
    };

    this._entries.push(entry);

    if (this._onEntry) {
      this._onEntry(entry);
    }

    // Reset silence timer
    this._resetSilenceTimer();

    // Check for time-based trigger
    this._checkTimeTrigger();
  }

  /**
   * Signal that a turn has completed (from Live API).
   * Can trigger summarization.
   */
  signalTurnComplete() {
    this._checkTrigger('turn_complete');
  }

  /**
   * Get transcript entries from the last N seconds.
   * @param {number} seconds
   * @returns {string}
   */
  getRecentWindow(seconds = this.WINDOW_SECONDS) {
    const cutoff = Date.now() - (seconds * 1000);
    return this._entries
      .filter(e => e.timestamp >= cutoff)
      .map(e => e.text)
      .join(' ');
  }

  /**
   * Get all transcript text since the last summarization.
   * @returns {string}
   */
  getNewSinceLastSummary() {
    const startIndex = this._lastSummarizedIndex + 1;
    if (startIndex >= this._entries.length) return '';

    return this._entries
      .slice(startIndex)
      .map(e => e.text)
      .join(' ');
  }

  /**
   * Get the full session transcript.
   * @returns {string}
   */
  getFullTranscript() {
    return this._entries.map(e => e.text).join(' ');
  }

  /**
   * Get all entries for debug display.
   * @returns {Array<{text: string, timestamp: number}>}
   */
  getEntries() {
    return [...this._entries];
  }

  /**
   * Mark current position as summarized.
   */
  markSummarized() {
    this._lastSummarizedIndex = this._entries.length - 1;
    this._lastTriggerTime = Date.now();
  }

  /**
   * Clear all stored transcript data.
   */
  clear() {
    this._entries = [];
    this._lastSummarizedIndex = -1;
    this._lastTriggerTime = 0;
    if (this._silenceTimer) {
      clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
    }
  }

  // --- Private ---

  _resetSilenceTimer() {
    if (this._silenceTimer) {
      clearTimeout(this._silenceTimer);
    }
    this._silenceTimer = setTimeout(() => {
      this._checkTrigger('silence');
    }, this.SILENCE_TRIGGER_MS);
  }

  _checkTimeTrigger() {
    const now = Date.now();
    if (now - this._lastTriggerTime >= this.SUMMARY_INTERVAL_MS) {
      this._checkTrigger('time');
    }
  }

  _checkTrigger(reason) {
    const newText = this.getNewSinceLastSummary();
    if (newText.length < this.MIN_NEW_CHARS) return;

    if (this._onTrigger) {
      this._onTrigger({
        reason,
        recentText: this.getRecentWindow(),
        newText,
        fullTranscript: this.getFullTranscript()
      });
    }
  }
}
