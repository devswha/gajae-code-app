const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;
const language = (navigator.language || 'en').toLowerCase();
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
const text = translations[language] || translations[language.slice(0, 2)] || translations.en;
const address = document.querySelector('#address');
const message = document.querySelector('#message');
const profile = document.querySelector('#profile');
let pending = false;
let editing = false;
let currentState = null;
const buttons = [...document.querySelectorAll('button[data-action]')];
buttons.forEach((button, index) => { button.textContent = text[index]; button.setAttribute('aria-label', text[index]); });
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
  buttons.forEach((button) => { button.disabled = pending; });
  if (!tab) return;
  if (!editing) address.value = tab.url || '';
  document.querySelector('[data-action="back"]').disabled = pending || !tab.canGoBack;
  document.querySelector('[data-action="forward"]').disabled = pending || !tab.canGoForward;
  profile.textContent = currentState.profileMode === 'ephemeral' ? text[4] : text[5];
  message.textContent = tab.loading ? text[6] : '';
}
async function control(command) {
  pending = true;
  render();
  try {
    const state = await invoke('builtin_browser_control', { command });
    pending = false;
    render(state);
  } catch (error) {
    pending = false;
    render();
    message.textContent = failureMessage(error);
  }
}
buttons.forEach((button) => button.addEventListener('click', () => control({ action: button.dataset.action })));
address.addEventListener('focus', () => { editing = true; }); address.addEventListener('blur', () => { editing = false; });
document.querySelector('#url-form').addEventListener('submit', (event) => { event.preventDefault(); control({ action: 'navigate', url: address.value }); });
if (invoke) { control({ action: 'state' }); if (listen) listen('builtin-browser-state', (event) => render(event.payload)); }
