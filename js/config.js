/**
 * config.js
 *
 * Manages configuration and API key retrieval for FocusFlow.
 * Attempts to retrieve key from URL parameters or localStorage, falling back
 * to the default hardcoded key.
 */

let apiEnvKey = '';

export async function initApiKey() {
  try {
    const response = await fetch('/api/config');
    if (response.ok) {
      const data = await response.json();
      if (data.apiKey) {
        apiEnvKey = data.apiKey;
      }
    }
  } catch (err) {
    console.warn('Failed to fetch API key from environment:', err);
  }
}

export function getApiKey() {
  const params = new URLSearchParams(window.location.search);
  const urlKey = params.get('key') || params.get('apiKey');
  
  if (urlKey) {
    localStorage.setItem('focusflow_api_key', urlKey);
    // Clean up the URL to prevent the key from sitting in history/address bar
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
    return urlKey;
  }

  const savedKey = localStorage.getItem('focusflow_api_key');
  if (savedKey) {
    return savedKey;
  }

  if (apiEnvKey) {
    return apiEnvKey;
  }

  return 'YOUR_API_KEY_HERE';
}

export function setApiKey(key) {
  if (key && key.trim()) {
    localStorage.setItem('focusflow_api_key', key.trim());
  } else {
    localStorage.removeItem('focusflow_api_key');
  }
}

export function getModel() {
  const savedModel = localStorage.getItem('focusflow_model');
  if (savedModel) {
    return savedModel;
  }
  return 'gemini-3.1-flash-lite';
}

export function setModel(model) {
  if (model && model.trim()) {
    localStorage.setItem('focusflow_model', model.trim());
  } else {
    localStorage.removeItem('focusflow_model');
  }
}

