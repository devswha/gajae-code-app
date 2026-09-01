import * as React from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../../../utils/cn';

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';
type TooltipProps = { children: React.ReactNode; content?: React.ReactNode; position?: TooltipPosition; className?: string; delay?: number; };

const arrowByPosition: Record<TooltipPosition, string> = {
  top: 'top-full left-1/2 transform -translate-x-1/2 border-t-popover',
  bottom: 'bottom-full left-1/2 transform -translate-x-1/2 border-b-popover',
  left: 'left-full top-1/2 transform -translate-y-1/2 border-l-popover',
  right: 'right-full top-1/2 transform -translate-y-1/2 border-r-popover',
};

function positionStyle(anchor: DOMRect, position: TooltipPosition): React.CSSProperties {
  const gap = 8;
  const initial: React.CSSProperties = { position: 'fixed', zIndex: 9999 };

  if (position === 'bottom') {
    initial.left = anchor.left + anchor.width / 2;
    initial.top = anchor.bottom + gap;
    initial.transform = 'translateX(-50%)';
  } else if (position === 'left') {
    initial.left = anchor.left - gap;
    initial.top = anchor.top + anchor.height / 2;
    initial.transform = 'translate(-100%, -50%)';
  } else if (position === 'right') {
    initial.left = anchor.right + gap;
    initial.top = anchor.top + anchor.height / 2;
    initial.transform = 'translateY(-50%)';
  } else {
    initial.left = anchor.left + anchor.width / 2;
    initial.top = anchor.top - gap;
    initial.transform = 'translate(-50%, -100%)';
  }

  return initial;
}

function Tooltip({ children, content, position = 'top', className = '', delay = 350 }: TooltipProps) {
  const [visible, setVisible] = React.useState(false);
  const [style, setStyle] = React.useState<React.CSSProperties | null>(null);
  const host = React.useRef<HTMLDivElement | null>(null);
  const timer = React.useRef<number | null>(null);
  const longPressShown = React.useRef(false);
  const cancelPendingShow = React.useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  const updatePosition = React.useCallback(() => {
    const element = host.current;
    if (element) setStyle(positionStyle(element.getBoundingClientRect(), position));
  }, [position]);
  const queueMouseShow = React.useCallback(() => {
    cancelPendingShow();
    timer.current = window.setTimeout(() => setVisible(true), delay);
  }, [cancelPendingShow, delay]);
  const hideFromMouse = React.useCallback(() => {
    cancelPendingShow();
    setVisible(false);
  }, [cancelPendingShow]);
  const beginLongPress = React.useCallback(() => {
    cancelPendingShow();
    longPressShown.current = false;
    timer.current = window.setTimeout(() => {
      longPressShown.current = true;
      setVisible(true);
    }, delay);
  }, [cancelPendingShow, delay]);
  const endLongPress = React.useCallback(() => {
    cancelPendingShow();
    if (!longPressShown.current) setVisible(false);
  }, [cancelPendingShow]);

  React.useEffect(() => cancelPendingShow, [cancelPendingShow]);

  React.useEffect(() => {
    if (!visible || typeof document === 'undefined') return;
    const dismissOutsideHost = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && host.current?.contains(target)) return;
      setVisible(false);
      longPressShown.current = false;
    };
    document.addEventListener('pointerdown', dismissOutsideHost, true);
    return () => document.removeEventListener('pointerdown', dismissOutsideHost, true);
  }, [visible]);

  React.useEffect(() => {
    if (!visible) {
      setStyle(null);
      return;
    }
    const frame = window.requestAnimationFrame(updatePosition);
    const refreshPosition = () => updatePosition();
    window.addEventListener('resize', refreshPosition);
    window.addEventListener('scroll', refreshPosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', refreshPosition);
      window.removeEventListener('scroll', refreshPosition, true);
    };
  }, [updatePosition, visible]);

  if (!content) return <>{children}</>;

  const offscreen: React.CSSProperties = { position: 'fixed', top: '-9999px', left: '-9999px', opacity: 0 };
  return (
    <div
      ref={host}
      className="relative inline-block"
      onMouseEnter={queueMouseShow}
      onMouseLeave={hideFromMouse}
      onTouchStart={beginLongPress}
      onTouchEnd={endLongPress}
      onTouchCancel={endLongPress}
    >
      {children}
      {visible && typeof document !== 'undefined' && createPortal(
        <div
          style={style || offscreen}
          className={cn(
            'pointer-events-none rounded bg-popover px-2 py-1 text-xs font-medium whitespace-nowrap text-popover-foreground shadow-lg',
            'animate-in fade-in-0 zoom-in-95 duration-200',
            className
          )}
        >
          {content}
          <div className={cn('absolute h-0 w-0 border-4 border-transparent', arrowByPosition[position] ?? arrowByPosition.top)} />
        </div>,
        document.body
      )}
    </div>
  );
}

export default Tooltip;
