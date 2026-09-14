(() => {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const names = ['background', 'foreground', 'card', 'muted', 'muted-foreground', 'border', 'input', 'accent', 'ring', 'destructive'];
  let language = root.lang || navigator.language;
  try { language = localStorage.getItem('i18nextLng') || language; } catch { /* Recovery pages may not have app storage. */ }
  return JSON.stringify({
    colors: Object.fromEntries(names.map((name) => [name, style.getPropertyValue(`--${name}`).trim()])),
    dark: root.classList.contains('dark'),
    language,
    fontFamily: getComputedStyle(document.body).fontFamily,
  });
})()
