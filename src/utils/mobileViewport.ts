/**
 * Mobile viewport utilities
 * Handles keyboard detection and prevents layout shift on mobile browsers
 */

/**
 * Detect if virtual keyboard is open on mobile devices
 * Uses visualViewport API which is more reliable than monitoring window.innerHeight
 */
export const isKeyboardOpen = (): boolean => {
  if (!window.visualViewport) return false;
  
  // If visual viewport height is significantly less than window height,
  // keyboard is likely open. Using 75% threshold
  const heightRatio = window.visualViewport.height / window.innerHeight;
  return heightRatio < 0.75;
};

/**
 * Get safe viewport height accounting for mobile keyboard
 * Returns visual viewport height if available, falls back to window.innerHeight
 */
export const getSafeViewportHeight = (): number => {
  if (window.visualViewport) {
    return window.visualViewport.height;
  }
  return window.innerHeight;
};

/**
 * Subscribe to viewport changes (keyboard open/close)
 * Fires callback when viewport height changes significantly
 */
export const onViewportChange = (callback: (isOpen: boolean) => void): (() => void) => {
  if (!window.visualViewport) return () => {};

  let lastState = isKeyboardOpen();

  const handler = () => {
    const newState = isKeyboardOpen();
    if (newState !== lastState) {
      lastState = newState;
      callback(newState);
    }
  };

  window.visualViewport.addEventListener('resize', handler);

  return () => {
    window.visualViewport?.removeEventListener('resize', handler);
  };
};

/**
 * Prevent scroll restoration that can cause issues on mobile
 * Call this on mount to lock scroll position
 */
export const preventScrollRestoration = (): void => {
  if ('scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual';
  }
};

/**
 * Fix common mobile scrolling issues by preventing overscroll
 * Uses CSS containment and overscroll-behavior
 */
export const setupMobileScrolling = (element: HTMLElement | null): void => {
  if (!element) return;

  // Prevent bounce scrolling on iOS
  element.style.overscrollBehavior = 'contain';
  (element.style as any).WebkitOverflowScrolling = 'touch';
};

/**
 * Install CSS custom properties on :root that track the visual viewport.
 * Call once in MobileApp. Components use var(--vk-height) in CSS.
 *
 * Sets:
 *   --vk-height      — visualViewport.height (px)
 *   --vk-offset-top  — visualViewport.offsetTop (px)
 *   --keyboard-inset — keyboard height estimate (px), 0 when closed
 */
export function installViewportHeightVar(): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};

  const update = () => {
    const h = vv.height;
    const top = vv.offsetTop;
    document.documentElement.style.setProperty('--vk-height', `${h}px`);
    document.documentElement.style.setProperty('--vk-offset-top', `${top}px`);
    document.documentElement.style.setProperty(
      '--keyboard-inset',
      `${Math.max(0, window.innerHeight - h - top)}px`
    );
  };

  update();
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  window.addEventListener('orientationchange', update);

  return () => {
    vv.removeEventListener('resize', update);
    vv.removeEventListener('scroll', update);
    window.removeEventListener('orientationchange', update);
  };
}
