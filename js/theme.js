const THEME_KEY = 'travel-pin:theme';

export function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const theme = saved === 'light' || saved === 'dark' ? saved : 'dark';
  applyTheme(theme);
  return theme;
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  window.dispatchEvent(new CustomEvent('travel-theme', { detail: { theme } }));
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}

export function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}
