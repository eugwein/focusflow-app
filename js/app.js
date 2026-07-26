/**
 * app.js
 *
 * Main controller for FocusFlow. Wires together audio capture, Live API session,
 * transcript store, summarizer, chime, and the UI.
 */

import { AudioCapture } from './audio-capture.js';
import { LiveSession } from './live-session.js';
import { TranscriptStore } from './transcript-store.js';
import { Summarizer } from './summarizer.js';
import { Chime } from './chime.js';
import { getApiKey, setApiKey, getModel, setModel, initApiKey } from './config.js';
import { AudioSimulator } from './audio-simulator.js';

class FocusFlowApp {
  constructor() {
    this.audio = new AudioCapture();
    this.session = new LiveSession();
    this.store = new TranscriptStore();
    this.summarizer = new Summarizer();
    this.chime = new Chime();
    this.simulator = new AudioSimulator(this.session);

    this._isRunning = false;
    this._summaryIdCounter = 0;

    this._bindModules();
    this._bindUI();
    this._updateUI();
  }

  // --- Module wiring ---

  _bindModules() {
    // Audio → Live API
    this.audio.onChunk((base64) => {
      this.session.sendAudio(base64);
    });

    // Live API → Transcript Store
    this.session.onTranscript((text) => {
      this.store.addFragment(text);
    });

    this.session.onTurnComplete(() => {
      this.store.signalTurnComplete();
    });

    this.session.onError((err) => {
      this._showError(err.message);
    });

    this.session.onStatusChange((status) => {
      this._updateStatus(status);
    });

    // Transcript Store → Summarizer triggers
    this.store.onTrigger(async (data) => {
      await this.summarizer.process({
        ...data,
        // Live getter: re-fetches transcript at checklist generation time
        // instead of using the stale snapshot from trigger time
        getRecentText: () => this.store.getRecentWindow()
      });
      // Mark summarized AFTER processing — any text arriving during
      // async API calls stays in the "new" window for the next trigger
      this.store.markSummarized();
    });

    // Transcript Store → debug transcript display
    this.store.onEntry((entry) => {
      this._appendTranscript(entry);
    });

    // Summarizer → UI
    this.summarizer.onQuickAlert((alert) => {
      this._addQuickAlert(alert);
      this.chime.play();
    });

    this.summarizer.onChecklist((checklist) => {
      this._addChecklist(checklist);
      this.chime.play();
    });

    this.summarizer.onProcessing((isProcessing) => {
      const indicator = document.getElementById('processing-indicator');
      if (indicator) {
        indicator.classList.toggle('visible', isProcessing);
      }
    });
  }

  // --- UI binding ---

  _bindUI() {
    const startBtn = document.getElementById('btn-start');
    const stopBtn = document.getElementById('btn-stop');
    const testBtn = document.getElementById('btn-test');
    const clearBtn = document.getElementById('btn-clear');
    const transcriptToggle = document.getElementById('transcript-toggle');
    
    const settingsBtn = document.getElementById('btn-settings');
    const settingsModal = document.getElementById('settings-modal');
    const apiKeyInput = document.getElementById('input-api-key');
    const selectModel = document.getElementById('select-model');
    const settingsCancelBtn = document.getElementById('btn-settings-cancel');
    const settingsSaveBtn = document.getElementById('btn-settings-save');

    startBtn.addEventListener('click', () => this.start());
    stopBtn.addEventListener('click', () => this.stop());
    testBtn.addEventListener('click', () => this.startTestAudio());
    clearBtn.addEventListener('click', () => this.clear());

    transcriptToggle.addEventListener('click', () => {
      const panel = document.getElementById('transcript-panel');
      const isOpen = panel.classList.toggle('open');
      transcriptToggle.textContent = isOpen ? '▼ Hide live transcript' : '▶ Show live transcript';
    });

    this._openSettingsModal = () => {
      apiKeyInput.value = localStorage.getItem('focusflow_api_key') || '';
      selectModel.value = getModel();
      settingsModal.classList.add('visible');
      apiKeyInput.focus();
    };

    settingsBtn.addEventListener('click', () => {
      this._openSettingsModal();
    });

    settingsCancelBtn.addEventListener('click', () => {
      settingsModal.classList.remove('visible');
    });

    settingsSaveBtn.addEventListener('click', () => {
      setApiKey(apiKeyInput.value);
      setModel(selectModel.value);
      settingsModal.classList.remove('visible');
    });

    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        settingsModal.classList.remove('visible');
      }
    });
  }

  // --- App lifecycle ---

  async start() {
    if (this._isRunning) return;

    try {
      await this.session.connect();
      await this.audio.start();
      this._isRunning = true;
      this._updateUI();
    } catch (err) {
      this._showError(err.message);
      this.stop();
    }
  }

  async startTestAudio() {
    if (this._isRunning) return;

    try {
      await this.session.connect();
      this._isRunning = true;
      this._updateUI();

      const statusEl = document.getElementById('status');
      statusEl.textContent = 'Preparing test audio...';

      await this.simulator.start(
        (progressMsg) => {
          statusEl.textContent = progressMsg;
        },
        () => {
          this.stop();
        }
      );
    } catch (err) {
      this._showError(err.message);
      this.stop();
    }
  }

  stop() {
    if (!this._isRunning) return;

    this.simulator.stop();
    this.audio.stop();
    this.session.disconnect();
    this._isRunning = false;
    this._updateUI();
  }

  clear() {
    this.store.clear();

    // Clear UI
    document.getElementById('pinned-cards').innerHTML = '';
    document.getElementById('recent-cards').innerHTML = '';
    document.getElementById('transcript-content').textContent = '';
    document.getElementById('pinned-section').classList.add('hidden');

    this._updateEmptyState();
  }

  // --- UI rendering ---

  _updateUI() {
    const startBtn = document.getElementById('btn-start');
    const stopBtn = document.getElementById('btn-stop');
    const testBtn = document.getElementById('btn-test');

    startBtn.disabled = this._isRunning;
    stopBtn.disabled = !this._isRunning;
    testBtn.disabled = this._isRunning;

    startBtn.classList.toggle('hidden', this._isRunning);
    stopBtn.classList.toggle('hidden', !this._isRunning);
    testBtn.classList.toggle('hidden', this._isRunning);
  }

  _updateStatus(status) {
    const el = document.getElementById('status');
    const dot = document.getElementById('status-dot');

    const labels = {
      connecting: 'Connecting...',
      connected: 'Connected',
      listening: 'Listening',
      reconnecting: 'Reconnecting...',
      error: 'Error',
      disconnected: 'Ready',
    };

    el.textContent = labels[status] || status;

    dot.className = 'status-dot';
    if (status === 'listening') {
      dot.classList.add('active');
    } else if (status === 'connecting' || status === 'reconnecting') {
      dot.classList.add('connecting');
    } else if (status === 'error') {
      dot.classList.add('error');
    }
  }

  _appendTranscript(entry) {
    const el = document.getElementById('transcript-content');
    const time = new Date(entry.timestamp).toLocaleTimeString();
    el.textContent += `[${time}] ${entry.text}\n`;
    el.scrollTop = el.scrollHeight;
  }

  _addQuickAlert({ text, category }) {
    const container = document.getElementById('recent-cards');

    const card = document.createElement('div');
    card.className = `summary-card alert-card category-${category || 'instruction'}`;
    card.id = `summary-${this._summaryIdCounter++}`;

    const content = document.createElement('p');
    content.className = 'card-text';
    content.textContent = text;

    card.appendChild(content);

    // Insert at top of recent section
    container.insertBefore(card, container.firstChild);

    // Trigger fade-in animation
    requestAnimationFrame(() => card.classList.add('visible'));

    // Fade after 5 minutes
    setTimeout(() => card.classList.add('faded'), 5 * 60 * 1000);

    // Remove after 15 minutes
    setTimeout(() => {
      card.classList.add('removing');
      setTimeout(() => card.remove(), 300);
    }, 15 * 60 * 1000);

    this._updateEmptyState();
  }

  _addChecklist({ title, steps }) {
    const container = document.getElementById('pinned-cards');
    const section = document.getElementById('pinned-section');

    // --- Option C: Collapse any existing expanded checklists ---
    container.querySelectorAll('.checklist-card:not(.collapsed)').forEach(existing => {
      this._collapseChecklist(existing);
    });

    const card = document.createElement('div');
    card.className = 'summary-card checklist-card';
    card.id = `checklist-${this._summaryIdCounter++}`;

    // Header with title, expand indicator, and dismiss button
    const header = document.createElement('div');
    header.className = 'card-header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'card-header-left';

    const titleEl = document.createElement('h3');
    titleEl.className = 'card-title';
    titleEl.textContent = `📋 ${title}`;

    const expandIndicator = document.createElement('span');
    expandIndicator.className = 'expand-indicator';
    expandIndicator.textContent = '▶';

    headerLeft.appendChild(titleEl);
    headerLeft.appendChild(expandIndicator);

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'btn-dismiss';
    dismissBtn.textContent = '✕';
    dismissBtn.setAttribute('aria-label', 'Dismiss checklist');
    dismissBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      card.classList.add('removing');
      setTimeout(() => {
        card.remove();
        // Hide section if no more pinned cards
        if (container.children.length === 0) {
          section.classList.add('hidden');
        }
        this._updateEmptyState();
      }, 300);
    });

    // Collapse summary line (hidden until collapsed)
    const collapseSummary = document.createElement('div');
    collapseSummary.className = 'collapse-summary';
    // Will be updated dynamically
    collapseSummary.textContent = `${steps.length} steps`;

    // Click header to toggle expand/collapse
    header.addEventListener('click', () => {
      if (card.classList.contains('collapsed')) {
        // Expanding this card — collapse all others first
        container.querySelectorAll('.checklist-card:not(.collapsed)').forEach(other => {
          if (other !== card) this._collapseChecklist(other);
        });
        card.classList.remove('collapsed');
      } else {
        this._collapseChecklist(card);
      }
    });

    header.appendChild(headerLeft);
    header.appendChild(dismissBtn);
    card.appendChild(header);
    card.appendChild(collapseSummary);

    // Steps as checkboxes
    const list = document.createElement('ul');
    list.className = 'checklist';

    steps.forEach((step, index) => {
      const li = document.createElement('li');
      li.className = 'checklist-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `${card.id}-step-${index}`;
      checkbox.className = 'checklist-checkbox';

      const label = document.createElement('label');
      label.htmlFor = checkbox.id;
      label.className = 'checklist-label';
      const cleanStep = step.replace(/^\d+[\.\)\s-]+\s*/, '');
      label.textContent = `${index + 1}. ${cleanStep}`;

      checkbox.addEventListener('change', () => {
        li.classList.toggle('checked', checkbox.checked);
        // --- Option A: Auto-collapse when all steps are checked ---
        this._updateCollapseSummary(card);
        const allChecked = list.querySelectorAll('.checklist-checkbox');
        const allAreChecked = [...allChecked].every(cb => cb.checked);
        if (allAreChecked) {
          this._collapseChecklist(card);
        }
      });

      li.appendChild(checkbox);
      li.appendChild(label);
      list.appendChild(li);
    });

    card.appendChild(list);

    // Insert at top of pinned section
    container.insertBefore(card, container.firstChild);
    section.classList.remove('hidden');

    // Trigger fade-in
    requestAnimationFrame(() => card.classList.add('visible'));

    this._updateEmptyState();
  }

  _collapseChecklist(card) {
    card.classList.add('collapsed');
    this._updateCollapseSummary(card);
  }

  _updateCollapseSummary(card) {
    const summary = card.querySelector('.collapse-summary');
    if (!summary) return;
    const total = card.querySelectorAll('.checklist-checkbox').length;
    const checked = card.querySelectorAll('.checklist-checkbox:checked').length;
    if (checked === total && total > 0) {
      summary.textContent = `✅ All ${total} steps done`;
    } else if (checked > 0) {
      summary.textContent = `${checked}/${total} steps done`;
    } else {
      summary.textContent = `${total} steps`;
    }
  }

  _updateEmptyState() {
    const empty = document.getElementById('empty-state');
    const hasPinned = document.getElementById('pinned-cards').children.length > 0;
    const hasRecent = document.getElementById('recent-cards').children.length > 0;

    empty.classList.toggle('hidden', hasPinned || hasRecent);
  }

  _showError(message) {
    const container = document.getElementById('recent-cards');
    const card = document.createElement('div');
    card.className = 'summary-card error-card visible';

    const content = document.createElement('p');
    content.className = 'card-text';
    content.textContent = `⚠️ ${message}`;

    card.appendChild(content);
    container.insertBefore(card, container.firstChild);

    const msgLower = (message || '').toLowerCase();
    if (msgLower.includes('api key') || msgLower.includes('403') || msgLower.includes('1008')) {
      if (typeof this._openSettingsModal === 'function') {
        this._openSettingsModal();
      }
    }

    // Auto-remove after 30s
    setTimeout(() => {
      card.classList.add('removing');
      setTimeout(() => card.remove(), 300);
    }, 30000);
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  await initApiKey();
  window.app = new FocusFlowApp();
});
