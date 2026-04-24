/**
 * liveStyleEngine — Remote CSS custom property applier.
 *
 * PWA'dan gelen SET_STYLE komutları document.documentElement üzerinde
 * anlık olarak uygulanır. Değişiklikler 5 sn debounce ile localStorage'a yazılır.
 *
 * Zero-Leak (CLAUDE.md §1): startLiveStyleEngine() cleanup döndürür,
 *   cleanup çağrılınca bekleyen timer flush edilir + temizlenir.
 *
 * Sensor Resiliency (CLAUDE.md §2): Tüm key/value çiftleri regex ile
 *   doğrulanır — geçersiz giriş sessizce drop edilir, injection imkansız.
 *
 * Write Throttling (CLAUDE.md §3): localStorage'a en az 5 sn aralıkla
 *   yazılır (_schedulePersist leading-debounce yaklaşımı).
 */

const STORAGE_KEY      = 'clp_live_style_vars';
const PERSIST_DELAY_MS = 5_000;

// CSS custom property key: --neon-accent, --card-blur, --card-radius …
const KEY_RE     = /^--[a-z][a-z0-9-]{0,62}$/;
// Reject any value that could break out of a CSS context
const VAL_UNSAFE = /[{};><"'`\\]/;

let _current: Record<string, string> = {};
let _timer:   ReturnType<typeof setTimeout> | null = null;

function _isValidKey(key: string): boolean {
  return KEY_RE.test(key);
}

function _isValidVal(val: string): boolean {
  return !VAL_UNSAFE.test(val) && val.length < 256;
}

function _schedulePersist(): void {
  if (_timer) return; // already pending — let it fire
  _timer = setTimeout(() => {
    _timer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_current));
    } catch { /* QuotaExceeded — ignore */ }
  }, PERSIST_DELAY_MS);
}

function _flushPersist(): void {
  if (!_timer) return;
  clearTimeout(_timer);
  _timer = null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_current));
  } catch { /* ignore */ }
}

/**
 * applyVars — Apply validated CSS custom properties immediately.
 * Invalid entries are silently dropped.
 */
export function applyVars(incoming: Record<string, string>): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [key, val] of Object.entries(incoming)) {
    if (!_isValidKey(key) || !_isValidVal(val)) continue;
    root.style.setProperty(key, val);
    _current[key] = val;
  }
  _schedulePersist();
}

/**
 * removeVars — Remove CSS custom properties and clear from snapshot.
 */
export function removeVars(keys: string[]): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const key of keys) {
    if (!_isValidKey(key)) continue;
    root.style.removeProperty(key);
    delete _current[key];
  }
  _schedulePersist();
}

/**
 * applyLiveStyle — SET_STYLE komutları için commandExecutor tarafından çağrılır.
 * applyVars'ın public alias'ı; aynı key/value validasyonunu uygular.
 */
export function applyLiveStyle(styles: Record<string, string>): void {
  applyVars(styles);
}

/**
 * getCurrentVars — Snapshot of currently applied style vars.
 */
export function getCurrentVars(): Record<string, string> {
  return { ..._current };
}

/**
 * startLiveStyleEngine — Load persisted vars from localStorage, return cleanup.
 * Call once inside startVehicleDataLayer.
 */
export function startLiveStyleEngine(): () => void {
  _current = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (parsed && typeof parsed === 'object') {
        applyVars(parsed);
      }
    }
  } catch { /* corrupted storage — start fresh */ }

  return () => {
    _flushPersist();
  };
}
