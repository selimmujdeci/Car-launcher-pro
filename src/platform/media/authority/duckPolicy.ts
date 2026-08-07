/**
 * duckPolicy.ts — MÜZİK HUB PAKET A · Merkezî ducking otoritesi (SAF).
 *
 * ÖNCESİ: `audioService.duckMedia()` yalnız bir SAYAÇ tutuyordu. Sayaç neyin
 * duck ettiğini bilmiyordu; navigasyon anonsu sürerken başlayıp biten bir Mavi
 * cevabı sayacı sıfıra indirip sesi TAM AÇIYORDU (navigasyon hâlâ konuşurken).
 * Ayrıca geç gelen bir `unduckMedia()` (bayat çağrı) sesi yükseltebiliyordu.
 *
 * SONRASI: her duck bir TOKEN'dır. Kaldırma yalnız kendi token'ıyla olur; bayat
 * token sesi YÜKSELTEMEZ. İç içe (nested) duck'ta en agresif seviye kazanır ve
 * bir sebep bitince ses TAM seviyeye değil, hâlâ aktif olan sebebin seviyesine
 * döner.
 *
 * SAFLIK: I/O · timer · Date.now · global durum YOK. Durum çağıran tarafından
 * taşınır (immutable state + saf geçiş fonksiyonları).
 */

export type DuckReason =
  | 'EMERGENCY'
  | 'SAFETY'
  | 'REVERSE_ATTENTION'
  | 'PARKING_SENSOR'
  | 'PHONE'
  | 'NAVIGATION'
  | 'MAVI'
  | 'SYSTEM_DUCK';

/**
 * Sebep → ses çarpanı. Native CarosAudioFocusManager.DUCK_VOLUMES ile BİREBİR
 * aynı olmalıdır (iki otorite farklı seviye uygularsa ses zıplar).
 */
export const DUCK_LEVELS: Readonly<Record<DuckReason, number>> = {
  EMERGENCY: 0.0,
  SAFETY: 0.15,
  REVERSE_ATTENTION: 0.2,
  PARKING_SENSOR: 0.25,
  PHONE: 0.0,
  NAVIGATION: 0.3,
  MAVI: 0.3,
  SYSTEM_DUCK: 0.2,
};

/** Eşit seviyede çakışırsa baskın sebebi seçmek için öncelik. */
const DUCK_PRIORITY: Readonly<Record<DuckReason, number>> = {
  EMERGENCY: 60,
  SAFETY: 50,
  REVERSE_ATTENTION: 45,
  PARKING_SENSOR: 40,
  PHONE: 35,
  NAVIGATION: 30,
  SYSTEM_DUCK: 25,
  MAVI: 20,
};

/** Aynı anda tutulabilecek en fazla duck kaydı — sızıntı/DoS sınırı. */
export const MAX_DUCK_ENTRIES = 16;

export interface DuckEntry {
  readonly token: number;
  readonly reason: DuckReason;
}

export interface DuckState {
  readonly entries: readonly DuckEntry[];
  readonly nextToken: number;
}

export const EMPTY_DUCK_STATE: DuckState = { entries: [], nextToken: 1 };

export function isDuckReason(v: unknown): v is DuckReason {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(DUCK_LEVELS, v);
}

export interface DuckResult {
  readonly state: DuckState;
  /** 0 = kabul edilmedi (bilinmeyen sebep veya sınır aşımı). */
  readonly token: number;
}

/** Yeni duck kaydı açar. */
export function applyDuck(state: DuckState, reason: DuckReason): DuckResult {
  if (!isDuckReason(reason)) return { state, token: 0 };
  if (state.entries.length >= MAX_DUCK_ENTRIES) return { state, token: 0 };
  const token = state.nextToken;
  return {
    state: {
      entries: [...state.entries, { token, reason }],
      nextToken: token + 1,
    },
    token,
  };
}

export interface UnduckResult {
  readonly state: DuckState;
  /** Kayıt bulunup kaldırıldı mı — false = BAYAT token (ses yükseltilmez). */
  readonly removed: boolean;
}

/** Duck'ı yalnız kendi token'ıyla kaldırır. Bayat token ETKİSİZDİR. */
export function releaseDuck(state: DuckState, token: number): UnduckResult {
  const idx = state.entries.findIndex((e) => e.token === token);
  if (idx < 0) return { state, removed: false };
  const entries = state.entries.slice(0, idx).concat(state.entries.slice(idx + 1));
  return { state: { ...state, entries }, removed: true };
}

/** Bir sebebe ait TÜM kayıtları kaldırır (ör. sistem duck'ı sona erdi). */
export function releaseReason(state: DuckState, reason: DuckReason): UnduckResult {
  const entries = state.entries.filter((e) => e.reason !== reason);
  return { state: { ...state, entries }, removed: entries.length !== state.entries.length };
}

/** Etkin duck çarpanı — 1.0 = kısma yok. En AGRESİF seviye kazanır. */
export function effectiveDuckLevel(state: DuckState): number {
  let level = 1.0;
  for (const e of state.entries) {
    const v = DUCK_LEVELS[e.reason];
    if (v < level) level = v;
  }
  return level;
}

/** Etkin seviyeyi yaratan baskın sebep (yoksa null). */
export function dominantReason(state: DuckState): DuckReason | null {
  let best: DuckReason | null = null;
  let bestLevel = 1.0;
  let bestPriority = -1;
  for (const e of state.entries) {
    const v = DUCK_LEVELS[e.reason];
    const p = DUCK_PRIORITY[e.reason];
    if (v < bestLevel || (v === bestLevel && p > bestPriority)) {
      bestLevel = v;
      bestPriority = p;
      best = e.reason;
    }
  }
  return best;
}

/** Aktif sebepler (tekilleştirilmiş) — gözlemlenebilirlik için. */
export function activeReasons(state: DuckState): readonly DuckReason[] {
  const seen = new Set<DuckReason>();
  const out: DuckReason[] = [];
  for (const e of state.entries) {
    if (!seen.has(e.reason)) { seen.add(e.reason); out.push(e.reason); }
  }
  return out;
}

/** Bu sebep medyayı TAMAMEN susturur mu (kısmak yerine)? */
export function isSilencing(reason: DuckReason): boolean {
  return DUCK_LEVELS[reason] === 0;
}
