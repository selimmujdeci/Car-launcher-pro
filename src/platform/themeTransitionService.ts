/**
 * themeTransitionService — premium crossfade overlay for zero-jank theme changes.
 *
 * Mechanism:
 *  1. A fixed overlay div fades in over the current UI (120–130ms)
 *  2. The theme data-attribute change happens while overlay is opaque
 *     → no hard flash, no visible CSS cascade recalculation
 *  3. Overlay fades back out (200–320ms cubic-bezier) revealing the new theme
 *
 * Performance:
 *  - "lite" mode: overlay skipped, instant apply
 *  - "balanced": 80ms fade-in / 200ms fade-out
 *  - "premium": 130ms fade-in / 320ms fade-out
 */

import { getPerformanceMode } from './performanceMode';

/** Approximate background color for each pack — blends cleanly into the dissolve. */
const PACK_BG: Record<string, string> = {
  tesla:          '#050505',
  bmw:            '#0a0f1e',
  mercedes:       '#070500',
  audi:           '#0a0a0a',
  porsche:        '#0d0d00',
  'range-rover':  '#0c0f12',
  cyberpunk:      '#07031a',
  midnight:       '#030710',
  'glass-pro':    '#07101e',
  ambient:        '#060d1a',
  redline:        '#100505',
  electric:       '#031010',
  carbon:         '#080808',
  'minimal-dark': '#000000',
  'minimal-light':'#f0f4f8',
  monochrome:     '#0d0d0d',
  sunset:         '#0f080f',
  'night-city':   '#060a14',
  arctic:         '#e8f2fb',
  galaxy:         '#050310',
  'big-cards':    '#060d1a',
  'ai-center':    '#060d1a',
  'tesla-x-night':'#000000',
};

let overlayEl: HTMLDivElement | null = null;
let phaseTimer: ReturnType<typeof setTimeout> | null = null;

function ensureOverlay(): HTMLDivElement {
  if (!overlayEl) {
    overlayEl = document.createElement('div');
    overlayEl.id = 'theme-crossfade-overlay';
    Object.assign(overlayEl.style, {
      position:      'fixed',
      inset:         '0',
      zIndex:        '99998',
      pointerEvents: 'none',
      opacity:       '0',
      willChange:    'opacity',
    });
    document.body.appendChild(overlayEl);
  }
  return overlayEl;
}

/**
 * Triggers a premium dissolve, applies the theme change while opaque, then fades out.
 *
 * @param applyFn - Callback that updates the Zustand store (e.g. `updateSettings(...)`)
 * @param pack    - Optional target theme pack name — used to pick matching overlay color
 */
export function triggerThemeTransition(
  applyFn: () => void,
  pack?: string,
): void {
  const mode = getPerformanceMode();

  // Lite mode: skip all overhead, apply immediately
  if (mode === 'lite') {
    applyFn();
    return;
  }

  const fadeInMs  = mode === 'balanced' ? 80  : 130;
  const holdMs    = mode === 'balanced' ? 15  : 25;
  const fadeOutMs = mode === 'balanced' ? 200 : 320;

  // Cancel any in-flight transition
  if (phaseTimer !== null) {
    clearTimeout(phaseTimer);
    phaseTimer = null;
  }

  const el = ensureOverlay();
  const bg = pack ? (PACK_BG[pack] ?? '#060d1a') : '#060d1a';

  // Phase 1 — fade in
  el.style.backgroundColor = bg;
  el.style.transition = `opacity ${fadeInMs}ms ease-in`;
  // Force a reflow so the transition fires from 0
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  el.offsetHeight;
  el.style.opacity = '1';

  // Phase 2 — apply + fade out
  phaseTimer = setTimeout(() => {
    applyFn();

    // Brief hold so the browser paints the new theme under the overlay
    setTimeout(() => {
      el.style.transition = `opacity ${fadeOutMs}ms cubic-bezier(0.4, 0, 0.2, 1)`;
      el.style.opacity = '0';
      phaseTimer = null;
    }, holdMs);
  }, fadeInMs);
}
