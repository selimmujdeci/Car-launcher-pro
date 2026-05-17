import type { TimeContext } from './smartTypes';

/* ── Hız kademesi tahmini (Speed decay) ── */
export const DECAY_RATE_PER_S   = 0.92;   // saniyede %8 düşüş
export const DECAY_MAX_SEC      = 20;     // bu süreden sonra hız=0 kabul edilir
export const ACCEL_MOTION_MS2   = 2.5;    // m/s² — hareket eşiği

/* ── Persistence ── */
export const USAGE_KEY = 'cl_usageMap';
export const PRUNE_KEY = 'cl_usagePruneTs';
export const DAY_MS    = 86_400_000;

export const MAX_USAGE_ENTRIES = 200;

/* ── Markov Chain ── */
export const MARKOV_KEY       = 'cl_markov';
export const MARKOV_MAX_ROWS  = 100;   // fazlası → en az kullanılanı at
export const MARKOV_MIN_COUNT = 2;     // bu eşiğin altındaki geçişler prune edilir
export const MARKOV_BLEND     = 0.45;  // Markov ağırlığı; heuristic = 1 - MARKOV_BLEND

/* ── Layout weights ── */
export const NAV_IDS   = ['maps', 'waze'];
export const MEDIA_IDS = ['spotify', 'youtube'];

/**
 * Time-of-day bias added on top of the usage score.
 * Kept small (≤ 0.4) so real usage history always wins over time heuristics.
 *
 * morning   → commute: boost nav
 * afternoon → casual: mild media boost
 * evening   → relaxation: boost media, softer nav
 * night     → checking in: boost phone / messages
 */
export const TIME_BIAS: Record<TimeContext, Partial<Record<string, number>>> = {
  morning:   { maps: 0.4, waze: 0.4, phone: 0.15 },
  afternoon: { spotify: 0.2, youtube: 0.15 },
  evening:   { spotify: 0.35, youtube: 0.25, maps: 0.15 },
  night:     { phone: 0.3, messages: 0.3, spotify: 0.15 },
};

/* ── React hook ── */
export const LAYOUT_DEBOUNCE_MS = 2_000;

/* ── Smart dock ── */
export const DOCK_POOL  = ['phone', 'maps', 'waze', 'spotify', 'youtube', 'browser', 'messages', 'weather'];
export const DOCK_SLOTS = 4;
