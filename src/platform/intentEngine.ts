/**
 * Intent Engine — semantic layer between raw command parsing and action dispatch.
 *
 * Flow (local):
 *   user text → commandParser → ParsedCommand → toIntent() → AppIntent → routeIntent()
 *
 * Flow (future Gemini):
 *   user text → Gemini API → structured JSON → fromAIResponse() → AppIntent → routeIntent()
 *
 * Both paths produce the same AppIntent shape and use the same routeIntent() call,
 * so swapping in Gemini requires no changes downstream of this module.
 *
 * Gemini prompt template (add to your system prompt):
 *   "Return a JSON object: { intent, payload, confidence }
 *    intent must be one of: OPEN_NAVIGATION | OPEN_MUSIC | OPEN_PHONE |
 *      OPEN_SETTINGS | PLAY_MEDIA | PAUSE_MEDIA | OPEN_FAVORITES |
 *      ENABLE_NIGHT_MODE | ENABLE_DRIVING_MODE | OPEN_LAST_APP | UNKNOWN
 *    payload: { targetApp?, destination?, mode?, sourceText? }
 *    confidence: 0.0–1.0"
 */
import type { ParsedCommand, CommandType } from './commandParser';

/* ── Intent types ────────────────────────────────────────── */

export type IntentType =
  | 'OPEN_NAVIGATION'
  | 'OPEN_MUSIC'
  | 'OPEN_PHONE'
  | 'OPEN_SETTINGS'
  | 'PLAY_MEDIA'
  | 'PAUSE_MEDIA'
  | 'OPEN_FAVORITES'
  | 'ENABLE_NIGHT_MODE'
  | 'SET_THEME'
  | 'SET_MUSIC'
  | 'ENABLE_DRIVING_MODE'
  | 'TOGGLE_SLEEP_MODE'
  | 'OPEN_LAST_APP'
  | 'UNKNOWN';

export interface IntentPayload {
  targetApp?:   string;   // app ID to launch (maps, spotify, phone …)
  destination?: string;   // navigation destination hint (e.g. "home")
  mode?:        string;   // theme or driving mode value
  sourceText?:  string;   // original user input — for logging / feedback
  confidence?:  number;   // 0–1 — how certain the parser was
}

export interface AppIntent {
  type:     IntentType;
  payload:  IntentPayload;
  priority: 'critical' | 'high' | 'normal';
}

/* ── Context passed to toIntent() ────────────────────────── */

/** Caller supplies current user prefs; toIntent() bakes them into the payload. */
export interface IntentContext {
  defaultNav:   string;   // 'maps' | 'waze'
  defaultMusic: string;   // 'spotify' | 'youtube'
  recentAppId?: string;   // most-recently-used non-nav/media app ID
}

/* ── Context passed to routeIntent() ────────────────────── */

/** Thin action interface — keeps intentEngine free of React / Settings imports. */
export interface RouterContext {
  launch:     (appId: string) => void;
  openDrawer: (target: 'apps' | 'settings' | 'none') => void;
  setTheme:   (theme: 'dark' | 'oled') => void;
  playMedia:  () => void;
  pauseMedia: () => void;
}

/* ── CommandType → IntentType map ────────────────────────── */

const CMD_TO_INTENT: Record<CommandType, IntentType> = {
  navigate_home:      'OPEN_NAVIGATION',
  open_maps:          'OPEN_NAVIGATION',
  open_music:         'OPEN_MUSIC',
  stop_music:         'PAUSE_MEDIA',
  open_phone:         'OPEN_PHONE',
  open_settings:      'OPEN_SETTINGS',
  open_recent:        'OPEN_LAST_APP',
  show_favorites:     'OPEN_FAVORITES',
  theme_night:        'ENABLE_NIGHT_MODE',
  theme_dark:         'SET_THEME',
  theme_oled:         'SET_THEME',
  music_spotify:      'SET_MUSIC',
  music_youtube:      'SET_MUSIC',
  driving_mode:       'ENABLE_DRIVING_MODE',
  toggle_sleep_mode:  'TOGGLE_SLEEP_MODE',
  vehicle_speed:       'UNKNOWN',
  vehicle_fuel:        'UNKNOWN',
  vehicle_temp:        'UNKNOWN',
  vehicle_maintenance: 'UNKNOWN',
};

/* ── toIntent ────────────────────────────────────────────── */

/**
 * Converts a locally-parsed command into a normalised AppIntent.
 * Resolves targetApp from user preferences so downstream code is app-ID-agnostic.
 */
export function toIntent(cmd: ParsedCommand, ctx: IntentContext): AppIntent {
  const payload: IntentPayload = {
    sourceText: cmd.raw,
    confidence: cmd.confidence,
  };

  switch (cmd.type) {
    case 'navigate_home':
      payload.targetApp   = ctx.defaultNav;
      payload.destination = 'home';
      break;
    case 'open_maps':
      payload.targetApp = ctx.defaultNav;
      break;
    case 'open_music':
      payload.targetApp = ctx.defaultMusic;
      break;
    case 'open_phone':
      payload.targetApp = 'phone';
      break;
    case 'open_recent':
      payload.targetApp = ctx.recentAppId;
      break;
    case 'theme_night':
      payload.mode = 'oled';
      break;
    case 'theme_dark':
      payload.mode = 'dark';
      break;
    case 'theme_oled':
      payload.mode = 'oled';
      break;
    case 'music_spotify':
      payload.targetApp = 'spotify';
      break;
    case 'music_youtube':
      payload.targetApp = 'youtube';
      break;
    case 'driving_mode':
      payload.mode = 'driving';
      break;
    case 'toggle_sleep_mode':
      payload.mode = 'toggle_sleep';
      break;
  }

  return {
    type:     CMD_TO_INTENT[cmd.type] ?? 'UNKNOWN',
    payload,
    priority: cmd.priority,
  };
}

/* ── routeIntent ─────────────────────────────────────────── */

/**
 * Single entry point for all intent dispatch.
 * Works identically whether the AppIntent came from toIntent() or fromAIResponse().
 */
export function routeIntent(intent: AppIntent, ctx: RouterContext): void {
  switch (intent.type) {
    case 'OPEN_NAVIGATION':
    case 'OPEN_MUSIC':
    case 'OPEN_PHONE':
    case 'OPEN_LAST_APP': {
      const appId = intent.payload.targetApp;
      if (appId) ctx.launch(appId);
      break;
    }
    case 'OPEN_SETTINGS':
      ctx.openDrawer('settings');
      break;
    case 'OPEN_FAVORITES':
      ctx.openDrawer('apps');
      break;
    case 'PLAY_MEDIA':
      ctx.playMedia();
      break;
    case 'PAUSE_MEDIA':
      ctx.pauseMedia();
      break;
    case 'ENABLE_NIGHT_MODE':
      ctx.setTheme((intent.payload.mode as 'dark' | 'oled') ?? 'oled');
      break;
    case 'SET_THEME':
      ctx.setTheme((intent.payload.mode as 'dark' | 'oled') ?? 'dark');
      break;
    case 'SET_MUSIC':
      if (intent.payload.targetApp) ctx.launch(intent.payload.targetApp);
      break;
    case 'ENABLE_DRIVING_MODE':
      // Foundation: close all overlays for distraction-free focus
      // Future: trigger driving-mode UI override via a dedicated context flag
      ctx.openDrawer('none');
      break;
    case 'TOGGLE_SLEEP_MODE':
      // Handled in MainLayout registerCommandHandler
      break;
    case 'UNKNOWN':
      // Safe fallback — take no action; voice UI already shows the error state
      break;
  }
}

/* ── fromAIResponse — Gemini-ready bridge ────────────────── */

/** All valid intent strings — used to validate AI output before trusting it. */
const VALID_INTENTS = new Set<IntentType>([
  'OPEN_NAVIGATION', 'OPEN_MUSIC', 'OPEN_PHONE', 'OPEN_SETTINGS',
  'PLAY_MEDIA', 'PAUSE_MEDIA', 'OPEN_FAVORITES',
  'SET_THEME', 'SET_MUSIC', 'TOGGLE_SLEEP_MODE',
  'ENABLE_NIGHT_MODE', 'ENABLE_DRIVING_MODE', 'OPEN_LAST_APP', 'UNKNOWN',
]);

/**
 * Converts raw AI/Gemini JSON output into an AppIntent.
 *
 * Usage (when Gemini is connected):
 *   const raw  = await gemini.generateContent(prompt);
 *   const intent = fromAIResponse(raw.json(), userText);
 *   if (intent) routeIntent(intent, routerCtx);
 *
 * Returns null if the response is malformed or contains an unknown intent.
 * The caller should fall back to local parsing when null is returned.
 */
export function fromAIResponse(raw: unknown, sourceText: string): AppIntent | null {
  try {
    if (!raw || typeof raw !== 'object') return null;
    const obj  = raw as Record<string, unknown>;
    const type = obj['intent'] as IntentType;
    if (!VALID_INTENTS.has(type)) return null;

    const rawPayload = obj['payload'];
    const payload: IntentPayload = {
      ...(rawPayload && typeof rawPayload === 'object'
        ? (rawPayload as IntentPayload)
        : {}),
      sourceText,
      confidence: typeof obj['confidence'] === 'number' ? obj['confidence'] : 1.0,
    };

    return { type, payload, priority: 'normal' };
  } catch {
    return null;
  }
}
