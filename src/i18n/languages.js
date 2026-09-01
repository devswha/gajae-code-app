const languageDetails = [
  ['en', 'English', 'English'],
  ['fr', 'French', 'Français'],
  ['ko', 'Korean', '한국어'],
  ['zh-CN', 'Simplified Chinese', '简体中文'],
  ['zh-TW', 'Traditional Chinese', '繁體中文'],
  ['ja', 'Japanese', '日本語'],
  ['ru', 'Russian', 'Русский'],
  ['de', 'German', 'Deutsch'],
  ['tr', 'Turkish', 'Türkçe'],
  ['it', 'Italian', 'Italiano'],
];

export const languages = languageDetails.map(([value, label, nativeName]) => ({ value, label, nativeName }));

export const getLanguage = (value) => languages.find(({ value: code }) => code === value);

export const getLanguageValues = () => languages.map(({ value }) => value);

export const isLanguageSupported = (value) => getLanguage(value) !== undefined;
