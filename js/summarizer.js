/**
 * summarizer.js
 *
 * Uses @google/genai SDK (Antigravity/Jetski harness) to call Gemini Flash
 * for salience detection and child-friendly summary generation.
 * Two-stage pipeline: detect salience → generate summary (quick alert or checklist).
 */

import { getApiKey } from './config.js';

const MODEL = 'gemini-2.5-flash';
const MIN_GAP_MS = 15000; // Minimum 15s between summary calls

const SALIENCE_PROMPT = `You are an attention assistant for a student who has difficulty staying focused in class. You will receive a chunk of what the teacher just said.

Determine if this contains SALIENT content the student needs to act on or remember. Also determine if the content contains MULTIPLE STEPS or a list of instructions.

SALIENT content includes:
- Instructions or assignments ("turn to page 5", "write your name", "first do X, then do Y, then do Z")
- Warnings or rules ("don't forget to...", "this will be on the test")
- Key new concepts being taught
- Schedule changes or deadlines
- Questions directed at the class

NOT salient: general explanation flowing continuously, casual chat, greetings, filler speech ("um", "so", "okay"), repetition of previously stated info.

Respond with JSON only:
{"is_salient": true, "category": "instruction", "has_multiple_steps": false, "step_count": 0, "confidence": 0.85}`;

const QUICK_ALERT_PROMPT = `You are a friendly helper for a young student (age 5-6) who has trouble paying attention. The teacher just said something important.

Write a SHORT, CLEAR summary:
- Use simple words a 5-6 year old can read
- 1-3 sentences maximum
- Start with a matching emoji:
  📝 for instructions    ⚠️ for warnings/rules
  💡 for key concepts    📅 for deadlines
  ❓ for questions
- Tell the student what to DO or REMEMBER
- Use direct language: "You need to..." not "The teacher said..."`;

const CHECKLIST_PROMPT = `You are a friendly helper for a young student (age 5-6) who has trouble paying attention. The teacher just gave a set of instructions with multiple steps.

Create a NUMBERED CHECKLIST:
- List every step the teacher mentioned, in order
- Use simple words a 5-6 year old can read
- Keep each step to one short sentence
- Do NOT skip or combine steps — include ALL of them
- Uses direct language: "Open your book" not "The teacher said to open"

Respond with JSON only:
{"title": "short title", "steps": ["step 1", "step 2", "step 3"]}`;

export class Summarizer {
  constructor() {
    this._lastCallTime = 0;
    this._sessionSummary = '';
    this._callCount = 0;

    // Callbacks
    this._onQuickAlert = null;
    this._onChecklist = null;
    this._onProcessing = null;
  }

  /** @param {function({text: string, category: string}): void} cb */
  onQuickAlert(cb) { this._onQuickAlert = cb; }

  /** @param {function({title: string, steps: string[]}): void} cb */
  onChecklist(cb) { this._onChecklist = cb; }

  /** @param {function(boolean): void} cb - true when processing, false when done */
  onProcessing(cb) { this._onProcessing = cb; }

  /**
   * Analyze a transcript chunk for salience and generate a summary if needed.
   * @param {{recentText: string, newText: string, fullTranscript: string}} data
   * @returns {Promise<void>}
   */
  async process(data) {
    // Rate limiting
    const now = Date.now();
    if (now - this._lastCallTime < MIN_GAP_MS) return;
    this._lastCallTime = now;

    if (this._onProcessing) this._onProcessing(true);

    try {
      // Stage 1: Salience detection
      const salience = await this._detectSalience(data.newText);

      if (!salience || !salience.is_salient || salience.confidence < 0.6) {
        return; // Not salient — do nothing
      }

      // Stage 2: Generate summary
      if (salience.has_multiple_steps) {
        await this._generateChecklist(data.recentText);
      } else {
        await this._generateQuickAlert(data.recentText, salience.category);
      }

      // Periodically update session summary for context
      this._callCount++;
      if (this._callCount % 3 === 0) {
        await this._updateSessionSummary(data.fullTranscript);
      }
    } catch (err) {
      console.error('Summarizer error:', err);
    } finally {
      if (this._onProcessing) this._onProcessing(false);
    }
  }

  // --- Private API call methods ---

  async _detectSalience(text) {
    const prompt = SALIENCE_PROMPT + `\n\nTeacher just said:\n"${text}"`;

    try {
      const response = await this._callModel(prompt, true);
      return JSON.parse(response);
    } catch (err) {
      console.error('Salience detection failed:', err);
      return null;
    }
  }

  async _generateQuickAlert(recentText, category) {
    const prompt = QUICK_ALERT_PROMPT +
      `\n\nContext of session so far:\n${this._sessionSummary || '(just started)'}` +
      `\n\nTeacher just said:\n"${recentText}"`;

    try {
      const text = await this._callModel(prompt, false);
      if (text && this._onQuickAlert) {
        this._onQuickAlert({ text: text.trim(), category });
      }
    } catch (err) {
      console.error('Quick alert generation failed:', err);
    }
  }

  async _generateChecklist(recentText) {
    const prompt = CHECKLIST_PROMPT +
      `\n\nContext of session so far:\n${this._sessionSummary || '(just started)'}` +
      `\n\nTeacher just said:\n"${recentText}"`;

    try {
      const response = await this._callModel(prompt, true);
      const data = JSON.parse(response);
      if (data && data.steps && data.steps.length > 0 && this._onChecklist) {
        this._onChecklist({
          title: data.title || 'Instructions',
          steps: data.steps
        });
      }
    } catch (err) {
      console.error('Checklist generation failed:', err);
    }
  }

  async _updateSessionSummary(fullTranscript) {
    const prompt = `Summarize the following classroom session transcript in about 100 words. Focus on key topics covered and important instructions given.\n\n"${fullTranscript.slice(-3000)}"`;

    try {
      this._sessionSummary = await this._callModel(prompt, false);
    } catch (err) {
      console.error('Session summary update failed:', err);
    }
  }

  /**
   * Make a direct model call via the Gemini API (REST, no SDK import needed in browser).
   * Uses the same endpoint as the @google/genai SDK's models.generateContent.
   * 
   * @param {string} prompt
   * @param {boolean} jsonMode - if true, request JSON response
   * @returns {Promise<string>}
   */
  async _callModel(prompt, jsonMode = false) {
    const apiKey = getApiKey();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

    const body = {
      contents: [{
        parts: [{ text: prompt }]
      }]
    };

    if (jsonMode) {
      body.generationConfig = {
        responseMimeType: 'application/json'
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error ${response.status}: ${errText}`);
    }

    const result = await response.json();

    if (result.candidates && result.candidates[0] &&
        result.candidates[0].content && result.candidates[0].content.parts) {
      return result.candidates[0].content.parts[0].text;
    }

    throw new Error('Unexpected API response structure');
  }
}
