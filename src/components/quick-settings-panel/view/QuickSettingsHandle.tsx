import type {
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from 'react';
import {
  ChevronLeft,
  ChevronRight,
  GripVertical,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { QuickSettingsHandleStyle } from '../types';

type QuickSettingsHandleProps = {
  isOpen: boolean;
  isDragging: boolean;
  style: QuickSettingsHandleStyle;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onTouchStart: (event: ReactTouchEvent<HTMLButtonElement>) => void;
};

export default function QuickSettingsHandle({
  isOpen,
  isDragging,
  style,
  onClick,
  onMouseDown,
  onTouchStart,
}: QuickSettingsHandleProps) {
  const { t } = useTranslation('settings');

  const placementClass = isOpen ? 'right-64' : 'right-0';
  const borderClass = isDragging ? 'border-primary' : 'border-border';
  const transitionClass = isDragging
    ? ''
    : 'transition-all duration-150 ease-out';
  const cursorClass = isDragging ? 'cursor-grabbing' : 'cursor-pointer';
  const ariaLabel = isDragging
    ? t('quickSettings.dragHandle.dragging')
    : isOpen
      ? t('quickSettings.dragHandle.closePanel')
      : t('quickSettings.dragHandle.openPanel');
  const title = isDragging
    ? t('quickSettings.dragHandle.draggingStatus')
    : t('quickSettings.dragHandle.toggleAndMove');

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      className={`fixed ${placementClass} z-50 ${transitionClass} border bg-card ${borderClass} rounded-l-md p-2 shadow-lg transition-colors hover:bg-accent ${cursorClass} touch-none`}
      style={{
        ...style,
        touchAction: 'none',
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
      }}
      aria-label={ariaLabel}
      title={title}
    >
      {isDragging ? (
        <GripVertical className="h-5 w-5 text-primary" />
      ) : isOpen ? (
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      ) : (
        <ChevronLeft className="h-5 w-5 text-muted-foreground" />
      )}
    </button>
  );
}
