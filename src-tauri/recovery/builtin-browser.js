const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;
let language = (navigator.language || 'en').toLowerCase();
const translations = {
  de: ['Zurück', 'Vor', 'Neu laden', 'Schließen', 'Temporäres Profil', 'Dauerhaftes Profil', 'Lädt…'],
  en: ['Back', 'Forward', 'Reload', 'Close', 'Ephemeral profile', 'Persistent profile', 'Loading…'],
  fr: ['Retour', 'Suivant', 'Actualiser', 'Fermer', 'Profil temporaire', 'Profil persistant', 'Chargement…'],
  it: ['Indietro', 'Avanti', 'Ricarica', 'Chiudi', 'Profilo temporaneo', 'Profilo persistente', 'Caricamento…'],
  ja: ['戻る', '進む', '再読み込み', '閉じる', '一時プロファイル', '永続プロファイル', '読み込み中…'],
  ko: ['뒤로', '앞으로', '새로 고침', '닫기', '임시 프로필', '영구 프로필', '불러오는 중…'],
  ru: ['Назад', 'Вперёд', 'Обновить', 'Закрыть', 'Временный профиль', 'Постоянный профиль', 'Загрузка…'],
  tr: ['Geri', 'İleri', 'Yenile', 'Kapat', 'Geçici profil', 'Kalıcı profil', 'Yükleniyor…'],
  'zh-cn': ['后退', '前进', '刷新', '关闭', '临时配置', '持久配置', '正在加载…'],
  'zh-tw': ['返回', '前進', '重新整理', '關閉', '暫時設定檔', '永久設定檔', '載入中…'],
};
const chromeLabels = {
  en: ['Browser', 'Address', 'Expand browser', 'Restore split view', 'Go to address'],
  ko: ['브라우저', '주소', '브라우저 확대', '분할 화면으로 복원', '주소로 이동'],
  de: ['Browser', 'Adresse', 'Browser vergrößern', 'Geteilte Ansicht wiederherstellen', 'Adresse öffnen'],
  fr: ['Navigateur', 'Adresse', 'Agrandir le navigateur', 'Rétablir la vue partagée', 'Ouvrir l’adresse'],
  it: ['Browser', 'Indirizzo', 'Espandi browser', 'Ripristina vista divisa', 'Apri indirizzo'],
  ja: ['ブラウザー', 'アドレス', 'ブラウザーを拡大', '分割表示に戻す', 'アドレスに移動'],
  ru: ['Браузер', 'Адрес', 'Развернуть браузер', 'Вернуть разделённый вид', 'Перейти по адресу'],
  tr: ['Tarayıcı', 'Adres', 'Tarayıcıyı genişlet', 'Bölünmüş görünüme dön', 'Adrese git'],
  'zh-cn': ['浏览器', '地址', '展开浏览器', '恢复分屏', '前往地址'],
  'zh-tw': ['瀏覽器', '網址', '展開瀏覽器', '恢復分割畫面', '前往網址'],
};
const resizeLabels = {
  de: 'Browserbreite', en: 'Browser width', fr: 'Largeur du navigateur',
  it: 'Larghezza del browser', ja: 'ブラウザーの幅', ko: '브라우저 너비',
  ru: 'Ширина браузера', tr: 'Tarayıcı genişliği',
  'zh-cn': '浏览器宽度', 'zh-tw': '瀏覽器寬度',
};
const localized = (values) => values[language] || values[language.slice(0, 2)] || values.en;
const address = document.querySelector('#address');
const message = document.querySelector('#message');
const profile = document.querySelector('#profile');
const pageTitle = document.querySelector('#page-title');
const expand = document.querySelector('#expand');
const go = document.querySelector('#go');
const divider = document.querySelector('#divider');
const buttons = [...document.querySelectorAll('button[data-action]')];
const actionLabels = { back: 0, forward: 1, reload: 2, close: 3 };
let pending = false;
let editing = false;
let currentState = null;
let commandFailure = null;
function label(button, value) { button.setAttribute('aria-label', value); button.title = value; }
function active(state) { return state.tabs?.find((tab) => tab.id === state.activeTabId); }
function failureMessage(error) {
  const detail = error instanceof Error ? error.message : String(error || '');
  if (/(?:browser_busy|browser_in_use|builtin_browser_in_use)/i.test(detail)) return 'The browser is busy. Try again shortly.';
  if (/(?:invalid_url|builtin_browser_invalid_url)/i.test(detail)) return 'This address cannot be opened in the built-in browser.';
  if (/(?:stale|document_changed|binding_changed)/i.test(detail)) return 'The page changed before the command finished. Try again.';
  if (/(?:builtin_browser_unavailable|unavailable|not available|unsupported)/i.test(detail)) return 'The built-in browser is unavailable. Try again after the app server reconnects.';
  return 'The browser command could not be completed. Try again.';
}
function render(state) {
  if (state) currentState = state;
  const tab = active(currentState || {});
  const text = localized(translations);
  const chrome = localized(chromeLabels);
  buttons.forEach((button) => {
    button.disabled = pending;
    label(button, text[actionLabels[button.dataset.action]]);
  });
  expand.disabled = pending;
  go.disabled = pending;
  const expanded = currentState?.expanded === true;
  document.documentElement.dataset.expanded = String(expanded);
  expand.setAttribute('aria-pressed', String(expanded));
  label(expand, chrome[expanded ? 3 : 2]);
  label(go, chrome[4]);
  address.setAttribute('aria-label', chrome[1]);
  divider?.setAttribute('aria-label', localized(resizeLabels));
  document.querySelector('.browser-chrome').setAttribute('aria-label', chrome[0]);
  const title = tab?.title?.trim() || chrome[0];
  pageTitle.textContent = title;
  pageTitle.title = title;
  document.title = title;
  message.textContent = commandFailure || '';
  message.title = commandFailure || '';
  message.hidden = !commandFailure;
  pageTitle.hidden = Boolean(commandFailure);
  document.documentElement.dataset.loading = String(tab?.loading === true);
  document.querySelector('.navigation').setAttribute('aria-busy', String(tab?.loading === true));
  if (!tab) return;
  if (!editing) address.value = tab.url || '';
  document.querySelector('[data-action="back"]').disabled = pending || !tab.canGoBack;
  document.querySelector('[data-action="forward"]').disabled = pending || !tab.canGoForward;
  profile.textContent = currentState.profileMode === 'ephemeral' ? text[4] : text[5];
}
async function control(command) {
  if (pending) return;
  pending = true;
  commandFailure = null;
  render();
  try {
    const state = await invoke('builtin_browser_control', { command });
    pending = false;
    render(state);
  } catch (error) {
    pending = false;
    commandFailure = failureMessage(error);
    render();
  }
}
buttons.forEach((button) => button.addEventListener('click', () => control({ action: button.dataset.action })));
expand.addEventListener('click', () => control({ action: 'setExpanded', expanded: currentState?.expanded !== true }));
address.addEventListener('focus', () => { editing = true; });
address.addEventListener('blur', () => { editing = false; });
address.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    address.value = active(currentState || {})?.url || '';
    address.blur();
  }
});
const focusAddress = (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'l') {
    event.preventDefault();
    address.focus();
    address.select();
  }
};
document.addEventListener('keydown', focusAddress);
document.querySelector('#url-form').addEventListener('submit', (event) => {
  event.preventDefault();
  control({ action: 'navigate', url: address.value.trim() });
});

// The native reader only returns computed colors/font and UI language from
// the trusted app view. No page URL, markup or browser capability is involved.
const colorTokens = ['background', 'foreground', 'card', 'muted', 'muted-foreground', 'border', 'input', 'accent', 'ring', 'destructive'];
function applyAppearance(appearance) {
  if (!appearance || typeof appearance !== 'object') return;
  const root = document.documentElement;
  for (const name of colorTokens) {
    const token = appearance.colors?.[name];
    if (typeof token === 'string' && /^[\d.\s%/-]+$/.test(token)) {
      root.style.setProperty(`--browser-${name}`, `hsl(${token})`);
    }
  }
  if (typeof appearance.fontFamily === 'string') root.style.setProperty('--browser-font', appearance.fontFamily);
  root.style.colorScheme = appearance.dark ? 'dark' : 'light';
  if (typeof appearance.language === 'string' && appearance.language) {
    language = appearance.language.toLowerCase();
    root.lang = language;
  }
  render();
}
let disposed = false;
let appearancePending = false;
async function refreshAppearance() {
  if (!invoke || disposed || document.hidden || appearancePending) return;
  appearancePending = true;
  try {
    const appearance = await invoke('builtin_browser_appearance');
    if (!disposed) applyAppearance(appearance);
  } catch { /* Keep the last app palette while its view is reconnecting. */ }
  finally { appearancePending = false; }
}
let unlisten;
if (invoke) {
  control({ action: 'state' });
  refreshAppearance();
  if (listen) listen('builtin-browser-state', (event) => render(event.payload)).then((stop) => {
    if (disposed) stop(); else unlisten = stop;
  });
}
// Poll only the small appearance snapshot while this native panel is visible,
// including when Appearance settings change without focusing the browser.
const appearanceTimer = invoke ? setInterval(refreshAppearance, 1500) : null;
window.addEventListener('focus', refreshAppearance);
window.addEventListener('pagehide', () => {
  disposed = true;
  if (appearanceTimer !== null) clearInterval(appearanceTimer);
  document.removeEventListener('keydown', focusAddress);
  window.removeEventListener('focus', refreshAppearance);
  unlisten?.();
}, { once: true });

// Coalesce pointer movement so only one native resize is pending at a time.
let drag = null;
let nextWidth = null;
let resizing = false;
async function resizePanel(width) {
  nextWidth = Math.max(0, Math.min(16384, width));
  if (resizing || !invoke) return;
  resizing = true;
  try {
    while (nextWidth !== null) {
      const requested = nextWidth;
      nextWidth = null;
      await invoke('builtin_browser_control', { command: { action: 'resize', width: requested } });
    }
  } catch (error) {
    nextWidth = null;
    commandFailure = failureMessage(error);
    render();
  } finally {
    resizing = false;
  }
}
if (divider) {
  divider.setAttribute('aria-label', localized(resizeLabels));
  const reflectWidth = () => divider.setAttribute('aria-valuenow', String(Math.round(window.innerWidth)));
  reflectWidth();
  window.addEventListener('resize', reflectWidth);
  window.addEventListener('pagehide', () => window.removeEventListener('resize', reflectWidth), { once: true });
  divider.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    divider.focus();
    drag = { x: event.screenX, width: window.innerWidth, pointer: event.pointerId };
    divider.setPointerCapture(event.pointerId);
    divider.dataset.dragging = '';
  });
  divider.addEventListener('pointermove', (event) => {
    if (drag && event.pointerId === drag.pointer) void resizePanel(drag.width + drag.x - event.screenX);
  });
  const endDrag = () => { drag = null; delete divider.dataset.dragging; };
  divider.addEventListener('pointerup', endDrag);
  divider.addEventListener('pointercancel', endDrag);
  divider.addEventListener('lostpointercapture', endDrag);
  divider.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    void resizePanel(window.innerWidth + (event.key === 'ArrowLeft' ? 40 : -40));
  });
}
