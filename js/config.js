/**
 * config.js
 *
 * Manages configuration and API key retrieval for FocusFlow.
 * Attempts to retrieve key from URL parameters or localStorage, falling back
 * to the default hardcoded key.
 */

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

  return 'YOUR_API_KEY_HERE';
}

export function setApiKey(key) {
  if (key && key.trim()) {
    localStorage.setItem('focusflow_api_key', key.trim());
  } else {
    localStorage.removeItem('focusflow_api_key');
  }
}
