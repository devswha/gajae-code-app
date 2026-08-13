export const INTERFACE_FONT_SIZE_STORAGE_KEY = 'interfaceFontSize';

export type InterfaceFontSize = 'small' | 'medium' | 'large';

export const INTERFACE_FONT_SIZE_PIXELS: Record<InterfaceFontSize, number> = {
  small: 14,
  medium: 16,
  large: 18,
};

export const INTERFACE_FONT_SIZE_SCALES: Record<InterfaceFontSize, number> = {
  small: 0.875,
  medium: 1,
  large: 1.125,
};

export const normalizeInterfaceFontSize = (value: unknown): InterfaceFontSize => (
  value === 'small' || value === 'large' ? value : 'medium'
);

export const readInterfaceFontSize = (storage: Pick<Storage, 'getItem'> = localStorage): InterfaceFontSize => (
  normalizeInterfaceFontSize(storage.getItem(INTERFACE_FONT_SIZE_STORAGE_KEY))
);

export const applyInterfaceFontSize = (
  value: InterfaceFontSize,
  root: HTMLElement = document.documentElement,
): void => {
  root.dataset.interfaceFontSize = value;
  root.style.fontSize = `${INTERFACE_FONT_SIZE_PIXELS[value]}px`;
  root.style.setProperty('--interface-font-scale', String(INTERFACE_FONT_SIZE_SCALES[value]));
};
