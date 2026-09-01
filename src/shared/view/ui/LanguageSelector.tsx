
import { useTranslation } from 'react-i18next';

import { languages } from '../../../i18n/languages';

export default function LanguageSelector() {
  const { i18n, t } = useTranslation('settings');

  const selectLanguage = ({ target }: React.ChangeEvent<HTMLSelectElement>) => {
    i18n.changeLanguage(target.value);
  };

  return (
    <div className="flex items-center justify-between px-4 py-3.5">
      <div>
        <div className="text-sm font-medium text-foreground">
          {t('account.languageLabel')}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {t('account.languageDescription')}
        </div>
      </div>
      <select
        value={i18n.language}
        onChange={selectLanguage}
        className="w-36 rounded-lg border border-input bg-card p-2 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary"
      >
        {languages.map(({ nativeName, value }) => (
          <option key={value} value={value}>
            {nativeName}
          </option>
        ))}
      </select>
    </div>
  );
}
