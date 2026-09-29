const $ = (selector) => document.querySelector(selector);
const state = { sessions: [], current: null, assignments: {}, chromeWindows: [] };
const auth = $('#auth');
const app = $('#app');

function toast(message, error = false) {
  const node = $('#toast');
  node.textContent = message;
  node.className = `show${error ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.className = ''; }, 2600);
}

async function api(path, options = {}) {
  const { apiUrl, token } = await chrome.storage.local.get(['apiUrl', 'token']);
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers }
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

async function showAuth() {
  const stored = await chrome.storage.local.get(['apiUrl', 'email']);
  if (stored.apiUrl) $('#api-url').value = stored.apiUrl;
  if (stored.email) $('#email').value = stored.email;
  auth.hidden = false;
  app.hidden = true;
}

async function authenticate(mode) {
  const apiUrl = $('#api-url').value.trim().replace(/\/$/, '');
  try {
    const response = await fetch(`${apiUrl}/v1/auth/${mode}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('#email').value, password: $('#password').value })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    await chrome.storage.local.set({ apiUrl, token: body.token, email: body.user.email });
    await start();
  } catch (error) { toast(error.message || 'Cannot reach the server.', true); }
}

async function start() {
  const stored = await chrome.storage.local.get(['token', 'email', 'assignments', 'liveSync']);
  if (!stored.token) return showAuth();
  auth.hidden = true;
  app.hidden = false;
  state.assignments = stored.assignments || {};
  $('#account-email').textContent = stored.email || '';
  $('#live-sync').checked = Boolean(stored.liveSync);
  await refresh();
}

async function refresh(preferredId = state.current?.id) {
  try {
    const [data, windows] = await Promise.all([api('/v1/sessions'), chrome.windows.getAll({ populate: true })]);
    state.sessions = data.sessions;
    state.chromeWindows = windows;
    state.current = state.sessions.find(({ id }) => id === preferredId) || state.sessions[0] || null;
    await chrome.storage.local.set({ activeSession: state.current, remoteChanges: false });
    render();
  } catch (error) {
    if (error.status === 401) { await chrome.storage.local.remove(['token', 'activeSession']); return showAuth(); }
    toast(error.message, true);
  }
}

function render() {
  $('#session-list').replaceChildren(...state.sessions.map((session) => {
    const button = document.createElement('button');
    button.className = `session-link${state.current?.id === session.id ? ' active' : ''}`;
    button.innerHTML = `<b></b><small>${session.windows.length}W</small>`;
    button.querySelector('b').textContent = session.name;
    button.onclick = async () => {
      state.current = session;
      await chrome.storage.local.set({ activeSession: session });
      render();
    };
    return button;
  }));
  const hasCurrent = Boolean(state.current);
  $('#empty').hidden = hasCurrent;
  $('#window-grid').hidden = !hasCurrent;
  $('#session-name').disabled = !hasCurrent;
  $('#save').disabled = !hasCurrent;
  $('#add-window').disabled = !hasCurrent;
  if (!hasCurrent) {
    $('#session-name').value = 'No session selected';
    $('#window-grid').replaceChildren();
    return;
  }
  $('#session-name').value = state.current.name;
  const date = new Date(state.current.updatedAt);
  $('#sync-state').textContent = `Cloud revision ${state.current.revision} · updated ${date.toLocaleString()}`;
  $('#window-grid').replaceChildren(...state.current.windows.map(renderWindow));
}

function renderWindow(slot) {
  const card = $('#window-template').content.firstElementChild.cloneNode(true);
  const name = card.querySelector('.window-name');
  name.value = slot.name;
  name.onchange = () => { slot.name = name.value.trim() || 'Window'; markDirty(); };
  card.querySelector('.tab-count').textContent = `${slot.tabs.length} tab${slot.tabs.length === 1 ? '' : 's'}`;
  const assignedId = Object.keys(state.assignments).find((id) => state.assignments[id] === slot.id);
  card.querySelector('.assignment').textContent = assignedId ? `● Assigned to browser window ${assignedId}` : '○ Not assigned on this device';
  const list = card.querySelector('.tab-list');
  if (!slot.tabs.length) list.innerHTML = '<div class="no-tabs">No saved tabs in this window</div>';
  else list.replaceChildren(...slot.tabs.map((tab) => {
    const row = document.createElement('div');
    row.className = 'tab';
    const origin = new URL(tab.url).origin;
    row.innerHTML = `<img class="favicon" alt=""><div class="tab-text"><div class="tab-title"></div><div class="tab-url"></div></div>${tab.pinned ? '<span class="pin">PIN</span>' : ''}`;
    row.querySelector('img').src = chrome.runtime.getURL(`_favicon/?pageUrl=${encodeURIComponent(origin)}&size=32`);
    row.querySelector('.tab-title').textContent = tab.title || tab.url;
    row.querySelector('.tab-url').textContent = tab.url;
    return row;
  }));
  card.querySelector('.assign').onclick = () => assignCurrentWindow(slot.id);
  card.querySelector('.open').onclick = () => openSlot(slot);
  card.querySelector('.remove-window').onclick = () => {
    if (!confirm(`Remove “${slot.name}” from this session?`)) return;
    state.current.windows = state.current.windows.filter(({ id }) => id !== slot.id);
    for (const key of Object.keys(state.assignments)) if (state.assignments[key] === slot.id) delete state.assignments[key];
    chrome.storage.local.set({ assignments: state.assignments });
    markDirty(); render();
  };
  return card;
}

function markDirty() { $('#sync-state').textContent = 'Unsaved changes'; }

async function assignCurrentWindow(slotId) {
  const current = await chrome.windows.getCurrent({ populate: true });
  for (const key of Object.keys(state.assignments)) {
    if (state.assignments[key] === slotId || Number(key) === current.id) delete state.assignments[key];
  }
  state.assignments[current.id] = slotId;
  await chrome.storage.local.set({ assignments: state.assignments });
  render();
  toast('Current browser window assigned.');
}

async function openSlot(slot) {
  if (!slot.tabs.length) return toast('This window slot has no tabs yet.', true);
  const created = await chrome.windows.create({ url: slot.tabs.map(({ url }) => url), focused: true });
  state.assignments[created.id] = slot.id;
  await chrome.storage.local.set({ assignments: state.assignments });
  const tabs = await chrome.tabs.query({ windowId: created.id });
  await Promise.all(tabs.map((tab, index) => chrome.tabs.update(tab.id, { pinned: Boolean(slot.tabs[index]?.pinned) })));
  toast(`Opened ${slot.tabs.length} tabs in a new window.`);
  render();
}

async function restoreLayout() {
  if (!state.current?.windows.length) return toast('This session has no window slots.', true);
  const restorable = state.current.windows.filter(({ tabs }) => tabs.length);
  if (!restorable.length) return toast('Add tabs to this session before restoring it.', true);
  if (!confirm(`Open ${restorable.length} new browser window${restorable.length === 1 ? '' : 's'}?`)) return;
  for (const slot of restorable) await openSlot(slot);
  toast(`Restored “${state.current.name}”.`);
}

async function save() {
  const result = await chrome.runtime.sendMessage({ type: 'capture' });
  if (result.error) return toast(result.error, true);
  const draft = result.session || state.current;
  draft.name = $('#session-name').value.trim() || 'Untitled session';
  const saved = await chrome.runtime.sendMessage({ type: 'save-now', session: draft });
  if (saved.error) {
    if (saved.status === 409 && saved.body?.session) {
      state.current = saved.body.session;
      toast('A newer cloud version was loaded. Review it, then save again.', true);
      render();
    } else toast(saved.error, true);
    return;
  }
  state.current = saved.session;
  const index = state.sessions.findIndex(({ id }) => id === saved.session.id);
  state.sessions[index] = saved.session;
  toast('All assigned windows saved to the cloud.');
  render();
}

async function createSession() {
  try {
    const data = await api('/v1/sessions', { method: 'POST', body: JSON.stringify({
      name: `Session ${state.sessions.length + 1}`,
      windows: [{ id: crypto.randomUUID(), name: 'Main window', tabs: [] }]
    }) });
    state.sessions.unshift(data.session);
    state.current = data.session;
    await chrome.storage.local.set({ activeSession: data.session });
    render();
    $('#session-name').focus(); $('#session-name').select();
  } catch (error) { toast(error.message, true); }
}

async function deleteSession() {
  if (!state.current || !confirm(`Delete “${state.current.name}” and all of its saved tabs?`)) return;
  try {
    await api(`/v1/sessions/${state.current.id}`, { method: 'DELETE' });
    for (const key of Object.keys(state.assignments)) {
      if (state.current.windows.some(({ id }) => id === state.assignments[key])) delete state.assignments[key];
    }
    await chrome.storage.local.set({ assignments: state.assignments });
    state.current = null;
    await refresh();
    toast('Session deleted.');
  } catch (error) { toast(error.message, true); }
}

$('#auth-form').onsubmit = (event) => { event.preventDefault(); authenticate('login'); };
$('#register').onclick = () => authenticate('register');
$('#new-session').onclick = createSession;
$('#delete-session').onclick = deleteSession;
$('.create-empty').onclick = createSession;
$('#refresh').onclick = () => refresh();
$('#restore').onclick = restoreLayout;
$('#save').onclick = save;
$('#session-name').oninput = () => { if (state.current) { state.current.name = $('#session-name').value; markDirty(); } };
$('#add-window').onclick = () => {
  state.current.windows.push({ id: crypto.randomUUID(), name: `Window ${state.current.windows.length + 1}`, tabs: [] });
  markDirty(); render();
};
$('#live-sync').onchange = async () => {
  await chrome.storage.local.set({ liveSync: $('#live-sync').checked });
  toast($('#live-sync').checked ? 'Live sync enabled.' : 'Live sync paused.');
};
$('#sign-out').onclick = async () => { await chrome.storage.local.remove(['token', 'activeSession', 'assignments']); showAuth(); };
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'sync-complete') { state.current = message.session; refresh(message.session.id); }
  if (message.type === 'sync-error') toast(message.error, true);
});

start();
