const APP_URL = chrome.runtime.getURL('app.html');

chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: APP_URL }));
chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-dashboard') chrome.tabs.create({ url: APP_URL });
});

async function api(path, options = {}) {
  const settings = await chrome.storage.local.get(['apiUrl', 'token']);
  if (!settings.apiUrl || !settings.token) throw new Error('Not signed in');
  const response = await fetch(`${settings.apiUrl.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.token}`, ...options.headers }
  });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(body?.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

const syncable = (tab) => /^https?:\/\//i.test(tab.url || '') && tab.url !== APP_URL;
async function captureAssignments() {
  const { activeSession, assignments = {} } = await chrome.storage.local.get(['activeSession', 'assignments']);
  if (!activeSession) return null;
  const windows = await Promise.all(activeSession.windows.map(async (slot) => {
    const chromeWindowId = Number(Object.keys(assignments).find((key) => assignments[key] === slot.id));
    if (!Number.isInteger(chromeWindowId)) return slot;
    try {
      const tabs = await chrome.tabs.query({ windowId: chromeWindowId });
      return { ...slot, tabs: tabs.filter(syncable).map(({ url, title, pinned }) => ({ url, title, pinned })) };
    } catch {
      return slot;
    }
  }));
  return { ...activeSession, windows };
}

async function saveLiveSession() {
  const { liveSync } = await chrome.storage.local.get('liveSync');
  if (!liveSync) return;
  const session = await captureAssignments();
  if (!session) return;
  try {
    const data = await api(`/v1/sessions/${session.id}`, { method: 'PUT', body: JSON.stringify(session) });
    await chrome.storage.local.set({ activeSession: data.session, lastSync: Date.now(), syncError: null });
    chrome.runtime.sendMessage({ type: 'sync-complete', session: data.session }).catch(() => {});
  } catch (error) {
    await chrome.storage.local.set({ syncError: error.message });
    chrome.runtime.sendMessage({ type: 'sync-error', error: error.message }).catch(() => {});
  }
}

function scheduleSave() {
  // An alarm survives Manifest V3 service-worker suspension; a regular timeout may not.
  chrome.alarms.create('debounced-save', { delayInMinutes: 0.05 });
}

chrome.tabs.onCreated.addListener(scheduleSave);
chrome.tabs.onRemoved.addListener(scheduleSave);
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.url || change.pinned || change.title) scheduleSave();
});
chrome.tabs.onMoved.addListener(scheduleSave);
chrome.tabs.onAttached.addListener(scheduleSave);
chrome.tabs.onDetached.addListener(scheduleSave);
chrome.windows.onRemoved.addListener(async (windowId) => {
  const { assignments = {} } = await chrome.storage.local.get('assignments');
  if (assignments[windowId]) {
    delete assignments[windowId];
    await chrome.storage.local.set({ assignments });
  }
  scheduleSave();
});
chrome.alarms.create('pull', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name === 'debounced-save') return saveLiveSession();
  if (name !== 'pull') return;
  const { activeSession } = await chrome.storage.local.get('activeSession');
  if (!activeSession) return;
  try {
    const { sessions } = await api('/v1/sessions');
    const fresh = sessions.find(({ id }) => id === activeSession.id);
    if (fresh && fresh.revision > activeSession.revision) {
      await chrome.storage.local.set({ activeSession: fresh, remoteChanges: true });
    }
  } catch { /* Surface connection errors only for explicit actions. */ }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === 'capture') sendResponse({ session: await captureAssignments() });
    else if (message.type === 'save-now') {
      const data = await api(`/v1/sessions/${message.session.id}`, { method: 'PUT', body: JSON.stringify(message.session) });
      await chrome.storage.local.set({ activeSession: data.session, lastSync: Date.now(), syncError: null });
      sendResponse(data);
    } else sendResponse({});
  })().catch((error) => sendResponse({ error: error.message, status: error.status, body: error.body }));
  return true;
});
