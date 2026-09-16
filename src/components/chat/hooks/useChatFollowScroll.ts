import { useCallback, useEffect, useRef, useState } from 'react';
import type { SetStateAction } from 'react';

const BOTTOM_THRESHOLD = 50;

type UseChatFollowScrollArgs = {
  // The attached node, not a ref object: the transcript pane mounts and
  // unmounts under the landing view while this hook stays mounted, so a ref
  // read at first-effect time binds listeners to nothing and never retries.
  container: HTMLDivElement | null;
  enabled: boolean;
};

function isNearBottom(node: HTMLDivElement) {
  return node.scrollHeight - node.scrollTop - node.clientHeight < BOTTOM_THRESHOLD;
}

export function useChatFollowScroll({ container, enabled }: UseChatFollowScrollArgs) {
  const [isFollowing, setIsFollowing] = useState(true);
  const isFollowingRef = useRef(true);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const setFollowing = useCallback((value: SetStateAction<boolean>) => {
    const following = typeof value === 'function' ? value(isFollowingRef.current) : value;
    isFollowingRef.current = following;
    setIsFollowing(following);
  }, []);
  const follow = useCallback(() => setFollowing(true), [setFollowing]);
  const scrollToBottom = useCallback(() => {
    if (container) container.scrollTop = container.scrollHeight;
    setFollowing(true);
  }, [container, setFollowing]);
  const handleScroll = useCallback(() => {
    if (container && isNearBottom(container)) follow();
  }, [container, follow]);

  useEffect(() => {
    const node = container;
    if (!node) return;

    const stopFollowing = () => setFollowing(false);
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) stopFollowing();
    };
    let touchStartY: number | null = null;
    const onTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const touchY = event.touches[0]?.clientY;
      if (touchStartY !== null && touchY !== undefined && touchY > touchStartY) stopFollowing();
    };
    const onPointerDown = (event: PointerEvent) => {
      // Only a grab of the vertical scrollbar track (past the client box) is a
      // scroll intent; the pane's own gutter and padding also report the node.
      if (event.target === node && event.offsetX >= node.clientWidth) stopFollowing();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editing = target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable);
      if (!editing && ['ArrowUp', 'PageUp', 'Home'].includes(event.key)) stopFollowing();
    };

    node.addEventListener('scroll', handleScroll, { passive: true });
    node.addEventListener('wheel', onWheel, { passive: true });
    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchmove', onTouchMove, { passive: true });
    node.addEventListener('pointerdown', onPointerDown, { passive: true });
    node.addEventListener('keydown', onKeyDown);
    return () => {
      node.removeEventListener('scroll', handleScroll);
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('keydown', onKeyDown);
    };
  }, [container, handleScroll, setFollowing]);

  useEffect(() => {
    const node = container;
    if (!node || typeof ResizeObserver === 'undefined') return;
    let content = node.firstElementChild;
    const observer = new ResizeObserver(() => {
      if (isFollowingRef.current && enabledRef.current) node.scrollTop = node.scrollHeight;
    });
    if (content) observer.observe(content);
    const frame = requestAnimationFrame(() => {
      const nextContent = node.firstElementChild;
      if (nextContent && nextContent !== content) {
        if (content) observer.unobserve(content);
        content = nextContent;
        observer.observe(content);
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [container, enabled]);

  return { isFollowing, setFollowing, follow, scrollToBottom, handleScroll };
}
