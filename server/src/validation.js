export const validEmail = (value) => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
export const validPassword = (value) => typeof value === 'string' && value.length >= 10 && value.length <= 200;

export function cleanName(value, fallback = 'Untitled') {
  const name = typeof value === 'string' ? value.trim().slice(0, 100) : '';
  return name || fallback;
}

export function cleanWindows(windows) {
  if (!Array.isArray(windows) || windows.length > 20) throw new Error('windows must be an array with at most 20 entries');
  return windows.map((window, index) => {
    if (!Array.isArray(window.tabs) || window.tabs.length > 500) throw new Error('each window must contain at most 500 tabs');
    return {
      id: typeof window.id === 'string' && window.id.length <= 100 ? window.id : crypto.randomUUID(),
      name: cleanName(window.name, `Window ${index + 1}`),
      tabs: window.tabs.map((tab) => {
        if (typeof tab.url !== 'string' || tab.url.length > 8192 || !/^https?:\/\//i.test(tab.url)) throw new Error('only http(s) tab URLs are accepted');
        return {
          url: tab.url,
          title: typeof tab.title === 'string' ? tab.title.slice(0, 500) : tab.url,
          pinned: Boolean(tab.pinned)
        };
      })
    };
  });
}
