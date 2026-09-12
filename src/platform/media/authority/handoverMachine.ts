/**
 * handoverMachine.ts — MÜZİK HUB PAKET A · İşlemsel (transactional) kaynak devri (SAF).
 *
 * ÖNCESİ: kaynak değişimi "best-effort" idi. `playStream()` harici oturuma
 * `pause` YOLLUYOR ve sonucu BEKLEMEDEN kendi sesini başlatıyordu; benzer şekilde
 * `playAtIndex()` de öyle. Eski kaynak susmazsa iki backend aynı anda ses veriyordu
 * ve hiçbir katman bunu FARK ETMİYORDU.
 *
 * SONRASI: devir bir işlemdir. Eski kaynağın durduğu DOĞRULANMADAN yeni kaynak
 * COMMITTED olamaz. Doğrulanamazsa bu sessizce geçilmez — `source_stop_unverified`
 * açık hatası üretilir (çift ses riski görünür olur).
 *
 * SAFLIK: I/O · timer · Date.now · global durum YOK. Zaman dışarıdan verilir.
 */

import type { SourceClass } from './sourceCapabilities';

export type HandoverPhase =
  | 'IDLE'
  | 'STOPPING_CURRENT'
  | 'CURRENT_STOP_VERIFIED'
  | 'PREPARING_TARGET'
  | 'TARGET_READY'
  | 'STARTING_TARGET'
  | 'TARGET_AUDIBLE_OR_STARTED'
  | 'COMMITTED'
  | 'FAILED'
  | 'ROLLBACK';

export interface HandoverState {
  readonly phase: HandoverPhase;
  /** Devirden ÖNCE çalan kaynak (yoksa null). */
  readonly from: SourceClass | null;
  /** Devredilmeye çalışılan kaynak (IDLE'da null). */
  readonly to: SourceClass | null;
  /** COMMITTED olmuş son kaynak — rollback hedefi ve "tek audible" kaynağıdır. */
  readonly committed: SourceClass | null;
  readonly startedAtMs: number;
  readonly updatedAtMs: number;
  readonly failureCode: string | null;
  /** Devir sırasında gelen ve serileştirilmesi gereken komut sayısı. */
  readonly queuedCommands: number;
}

export const IDLE_HANDOVER: HandoverState = {
  phase: 'IDLE',
  from: null,
  to: null,
  committed: null,
  startedAtMs: 0,
  updatedAtMs: 0,
  failureCode: null,
  queuedCommands: 0,
};

export type HandoverEvent =
  | { readonly type: 'BEGIN'; readonly to: SourceClass; readonly atMs: number }
  /** Eski kaynağın GERÇEKTEN durduğu gözlendi. */
  | { readonly type: 'STOP_VERIFIED'; readonly atMs: number }
  /** Eski kaynak durdurma komutunu aldı ama durduğu DOĞRULANAMADI. */
  | { readonly type: 'STOP_UNVERIFIED'; readonly atMs: number }
  | { readonly type: 'TARGET_PREPARED'; readonly atMs: number }
  | { readonly type: 'TARGET_STARTING'; readonly atMs: number }
  | { readonly type: 'TARGET_STARTED'; readonly atMs: number }
  | { readonly type: 'COMMIT'; readonly atMs: number }
  | { readonly type: 'FAIL'; readonly code: string; readonly atMs: number }
  | { readonly type: 'TIMEOUT'; readonly atMs: number }
  /** Yeni bir devir isteği geldi — mevcut devir geçersiz kılınır. */
  | { readonly type: 'SUPERSEDE'; readonly atMs: number }
  /** Başarısızlık sonrası önceki kaynağa dönüş tamamlandı / güvenli durdu. */
  | { readonly type: 'ROLLBACK_DONE'; readonly atMs: number }
  /** Devir sürerken gelen komut kuyruğa alındı (serileştirme sayacı). */
  | { readonly type: 'ENQUEUE_COMMAND'; readonly atMs: number }
  | { readonly type: 'DRAIN_COMMANDS'; readonly atMs: number };

/** Devir bitmiş mi — bu fazlarda yeni komut doğrudan işlenebilir. */
export function isSettled(phase: HandoverPhase): boolean {
  return phase === 'IDLE' || phase === 'COMMITTED' || phase === 'FAILED';
}

/** Devir sürüyor mu — bu fazlarda gelen komutlar SERİLEŞTİRİLİR. */
export function isInFlight(phase: HandoverPhase): boolean {
  return !isSettled(phase);
}

const ALLOWED_NEXT: Readonly<Record<HandoverPhase, readonly HandoverPhase[]>> = {
  IDLE: ['STOPPING_CURRENT'],
  STOPPING_CURRENT: ['CURRENT_STOP_VERIFIED', 'FAILED', 'ROLLBACK'],
  CURRENT_STOP_VERIFIED: ['PREPARING_TARGET', 'FAILED', 'ROLLBACK'],
  PREPARING_TARGET: ['TARGET_READY', 'FAILED', 'ROLLBACK'],
  TARGET_READY: ['STARTING_TARGET', 'FAILED', 'ROLLBACK'],
  STARTING_TARGET: ['TARGET_AUDIBLE_OR_STARTED', 'FAILED', 'ROLLBACK'],
  TARGET_AUDIBLE_OR_STARTED: ['COMMITTED', 'FAILED', 'ROLLBACK'],
  COMMITTED: ['STOPPING_CURRENT'],
  FAILED: ['STOPPING_CURRENT', 'ROLLBACK'],
  ROLLBACK: ['FAILED', 'IDLE', 'COMMITTED'],
};

export function canTransition(from: HandoverPhase, to: HandoverPhase): boolean {
  return ALLOWED_NEXT[from].includes(to);
}

/**
 * Saf geçiş fonksiyonu. Geçersiz olay YOK SAYILIR (durum aynen döner) — durum
 * makinesi hiçbir koşulda tanımsız faza düşmez (fail-closed).
 */
export function reduceHandover(state: HandoverState, event: HandoverEvent): HandoverState {
  const at = event.atMs;

  switch (event.type) {
    case 'BEGIN': {
      if (!canTransition(state.phase, 'STOPPING_CURRENT')) return state;
      return {
        phase: 'STOPPING_CURRENT',
        from: state.committed,
        to: event.to,
        committed: state.committed,
        startedAtMs: at,
        updatedAtMs: at,
        failureCode: null,
        queuedCommands: 0,
      };
    }

    case 'STOP_VERIFIED': {
      if (!canTransition(state.phase, 'CURRENT_STOP_VERIFIED')) return state;
      return { ...state, phase: 'CURRENT_STOP_VERIFIED', updatedAtMs: at };
    }

    case 'STOP_UNVERIFIED': {
      // KRİTİK: eski kaynağın sustuğu doğrulanamadı → ÇİFT SES RİSKİ.
      // Sessizce devam ETMEYİZ; işlem açık hata ile düşer.
      if (state.phase !== 'STOPPING_CURRENT') return state;
      return {
        ...state,
        phase: 'FAILED',
        failureCode: 'source_stop_unverified',
        updatedAtMs: at,
      };
    }

    case 'TARGET_PREPARED': {
      if (state.phase === 'CURRENT_STOP_VERIFIED') {
        return { ...state, phase: 'PREPARING_TARGET', updatedAtMs: at };
      }
      if (state.phase === 'PREPARING_TARGET') {
        return { ...state, phase: 'TARGET_READY', updatedAtMs: at };
      }
      return state;
    }

    case 'TARGET_STARTING': {
      if (!canTransition(state.phase, 'STARTING_TARGET')) return state;
      return { ...state, phase: 'STARTING_TARGET', updatedAtMs: at };
    }

    case 'TARGET_STARTED': {
      if (!canTransition(state.phase, 'TARGET_AUDIBLE_OR_STARTED')) return state;
      return { ...state, phase: 'TARGET_AUDIBLE_OR_STARTED', updatedAtMs: at };
    }

    case 'COMMIT': {
      // COMMIT yalnız hedefin BAŞLADIĞI gözlendikten sonra verilebilir.
      if (state.phase !== 'TARGET_AUDIBLE_OR_STARTED') return state;
      return {
        ...state,
        phase: 'COMMITTED',
        committed: state.to,
        failureCode: null,
        updatedAtMs: at,
        queuedCommands: 0,
      };
    }

    case 'FAIL': {
      if (state.phase === 'COMMITTED' || state.phase === 'IDLE') return state;
      return { ...state, phase: 'FAILED', failureCode: event.code, updatedAtMs: at };
    }

    case 'TIMEOUT': {
      if (isSettled(state.phase)) return state;
      return { ...state, phase: 'FAILED', failureCode: 'handover_timeout', updatedAtMs: at };
    }

    case 'SUPERSEDE': {
      if (isSettled(state.phase)) return state;
      return { ...state, phase: 'FAILED', failureCode: 'superseded', updatedAtMs: at };
    }

    case 'ROLLBACK_DONE': {
      if (state.phase !== 'FAILED' && state.phase !== 'ROLLBACK') return state;
      // Önceki kaynağa dönülebildiyse o COMMITTED kalır; dönülemediyse güvenli durdu.
      return state.from
        ? { ...state, phase: 'COMMITTED', committed: state.from, to: state.from, updatedAtMs: at }
        : { ...IDLE_HANDOVER, updatedAtMs: at };
    }

    case 'ENQUEUE_COMMAND': {
      if (!isInFlight(state.phase)) return state;
      return { ...state, queuedCommands: state.queuedCommands + 1, updatedAtMs: at };
    }

    case 'DRAIN_COMMANDS': {
      if (state.queuedCommands === 0) return state;
      return { ...state, queuedCommands: 0, updatedAtMs: at };
    }

    default:
      return state;
  }
}

/** Devir bu anda zaman aşımına uğradı mı (bounded timeout kontrolü). */
export function isTimedOut(state: HandoverState, nowMs: number, timeoutMs: number): boolean {
  if (isSettled(state.phase)) return false;
  return nowMs - state.startedAtMs >= timeoutMs;
}

/**
 * Aynı anda kaç audible backend olabileceğini döner.
 * Sözleşme: bu değer HER ZAMAN ≤ 1 olmalıdır; 2 dönerse bu bir İHLALDİR ve
 * çağıran hatayı görünür kılmalıdır (sessizce düzeltmemelidir).
 */
export function audibleBackendCount(state: HandoverState): number {
  // Devir sırasında eski kaynak DURDURULMUŞ, yeni kaynak HENÜZ başlamamıştır.
  switch (state.phase) {
    case 'IDLE':
    case 'FAILED':
      return state.committed ? 1 : 0;
    case 'STOPPING_CURRENT':
      // Durdurma emri verildi, doğrulanmadı → hâlâ eski kaynak sayılır.
      return state.from ? 1 : 0;
    case 'CURRENT_STOP_VERIFIED':
    case 'PREPARING_TARGET':
    case 'TARGET_READY':
      return 0;
    case 'STARTING_TARGET':
    case 'TARGET_AUDIBLE_OR_STARTED':
    case 'COMMITTED':
      return 1;
    case 'ROLLBACK':
      return 0;
    default:
      return 0;
  }
}
