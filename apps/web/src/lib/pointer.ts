'use client';

import {
  useCallback,
  useRef,
  useSyncExternalStore,
  type PointerEvent,
  type MouseEvent,
} from 'react';

/**
 * Subscribes to a media query without tripping hydration: the server snapshot
 * is always `false`, so the first client render matches the prerendered HTML
 * and React swaps in the real value immediately afterwards.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** True when the primary input is touch — phones and tablets, not a mouse. */
export function useIsTouch(): boolean {
  return useMediaQuery('(pointer: coarse)');
}

const LONG_PRESS_MS = 450;
/** Finger jitter below this still counts as a press; beyond it, it's a scroll. */
const MOVE_TOLERANCE_PX = 10;

/**
 * Press-and-hold to act, the way selection works in a phone's gallery or file
 * manager. Mouse input is ignored entirely (desktop keeps its hover checkbox),
 * and any scroll or drag past a small tolerance cancels the press.
 */
export function useLongPress(onLongPress: () => void) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  /** Set when a press completed, so the click that follows can be swallowed. */
  const consumed = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      if (event.pointerType === 'mouse') {
        return;
      }
      consumed.current = false;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        consumed.current = true;
        // A short tick confirms the selection the way native pickers do.
        if ('vibrate' in navigator) {
          navigator.vibrate(12);
        }
        onLongPress();
      }, LONG_PRESS_MS);
    },
    [onLongPress],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const start = origin.current;
      if (
        start &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE_PX
      ) {
        cancel();
      }
    },
    [cancel],
  );

  const onContextMenu = useCallback((event: MouseEvent) => {
    // Only suppress the OS menu for a touch press we're handling — never for a
    // genuine right-click on desktop.
    if (origin.current || consumed.current) {
      event.preventDefault();
    }
  }, []);

  return {
    consumed,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onContextMenu,
    },
  };
}
