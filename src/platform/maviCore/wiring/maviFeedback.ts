/**
 * maviCore/wiring/maviFeedback.ts — MAVİ ÇEKİRDEĞİ Faz-2 · Typed FEEDBACK kanalı.
 *
 * AMAÇ (task 5 + "kullanıcı hiçbir aşamada sessiz bırakılmasın"): Eylem/plan sonuçlarını ve
 * aşama geçişlerini KULLANICIYA anlık, TİPLENMİŞ geri bildirime çevirir. TTS/UI BAĞLAMAZ —
 * yalnız typed event üretir + yayınlar; gerçek seslendirme/gösterim tüketici katmanındadır.
 *
 * İKİ İLKE (CLAUDE.md · task):
 *  - "BAŞARISIZ EYLEM YAPILMIŞ GİBİ CEVAP VERME": ok olmayan HER sonuç (denied/failed/timeout/
 *    invalid/no_handler/rejected) severity error/warning + DÜRÜST mesaj üretir; ASLA "yapıldı" demez.
 *  - "SESSİZ BIRAKMA": aşama geçişleri (listening/understanding/planning/executing) için nötr ara
 *    mesajlar sağlar (köprü, gecikme/aşama başında yayınlar). Anlama İMA eden mesaj YOK (saha dersi:
 *    "anladım deyip yapamadı" — voiceService THINKING_PHRASES nötrleştirmesiyle hizalı).
 *
 * SAF: builder'lar zaman/yan-etki taşımaz; kanal emit'te zaman damgalar. Fail-soft.
 */

import type { MaviState } from '../maviLifecycle';
import type { StepResult, StepStatus, PlanResult, PlanStatus } from '../executionEngine';

/* ══════════════════════════════════════════════════════════════════════════
 * Kontratlar
 * ════════════════════════════════════════════════════════════════════════ */

export type FeedbackSeverity = 'info' | 'success' | 'warning' | 'error';
export type FeedbackKind = 'stage' | 'action' | 'plan';

/** Zaman damgasız feedback verisi (builder çıktısı). */
export interface MaviFeedbackData {
  readonly kind: FeedbackKind;
  readonly severity: FeedbackSeverity;
  /** Makine-okur kod (telemetri/test): 'listening','executing','action_ok','action_denied'… */
  readonly code: string;
  /** Kullanıcıya gösterilecek/söylenecek KISA Türkçe metin (ISO 15008). */
  readonly message: string;
  readonly actionId?: string;
}

/** Yayınlanmış feedback (kanal zaman damgalar). */
export interface MaviFeedback extends MaviFeedbackData {
  readonly at: number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Aşama feedback'i (sessiz bırakmama) — nötr, kısa
 * ════════════════════════════════════════════════════════════════════════ */

const STAGE_TABLE: Partial<Record<MaviState, { code: string; message: string }>> = {
  listening:     { code: 'stage_listening',     message: 'Dinliyorum' },
  understanding: { code: 'stage_understanding', message: 'Bir saniye' },
  planning:      { code: 'stage_planning',      message: 'Bakıyorum' },
  executing:     { code: 'stage_executing',     message: 'Yapıyorum' },
};

/**
 * Aşama geçişi için nötr ara feedback (yoksa null → o durumda sessizlik uygun: idle/speaking/
 * cancelled/error kendi sonuç mesajını üretir). Köprü bunu YALNIZ gerekince (aşama başında /
 * yavaş aşamada) yayınlar — her geçişte gevezelik ETMEZ.
 */
export function buildStageFeedback(state: MaviState): MaviFeedbackData | null {
  const row = STAGE_TABLE[state];
  if (!row) return null;
  return { kind: 'stage', severity: 'info', code: row.code, message: row.message };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Eylem sonucu feedback'i — DÜRÜST (yapılmış gibi cevap verme)
 * ════════════════════════════════════════════════════════════════════════ */

/** Başarısız/kısıtlı durum kodları → dürüst, kısa kullanıcı mesajı. */
const FAILURE_MESSAGE: Record<Exclude<StepStatus, 'ok'>, { severity: FeedbackSeverity; code: string; message: string }> = {
  failed:             { severity: 'error',   code: 'action_failed',       message: 'Bunu yapamadım' },
  timeout:            { severity: 'error',   code: 'action_timeout',      message: 'Zaman aşımı oldu, yapamadım' },
  denied:             { severity: 'error',   code: 'action_denied',       message: 'Bu işlemi yapamam' },
  needs_confirmation: { severity: 'warning', code: 'action_confirm',      message: 'Onaylıyor musun?' },
  invalid:            { severity: 'error',   code: 'action_invalid',      message: 'Bunu anlayamadım' },
  unknown_action:     { severity: 'error',   code: 'action_unknown',      message: 'Bunu yapamam' },
  no_handler:         { severity: 'error',   code: 'action_no_handler',   message: 'Bu özellik şu an bağlı değil' },
  duplicate:          { severity: 'info',    code: 'action_duplicate',    message: 'Bunu az önce yaptım' },
  rolled_back:        { severity: 'warning', code: 'action_rolled_back',  message: 'Yapamadım, geri aldım' },
};

/**
 * Bir eylem sonucunu typed feedback'e çevirir. ok → success (opsiyonel özel başarı metni, ör.
 * araç sağlığı özeti); aksi halde DÜRÜST hata/uyarı — ASLA "yapıldı" demez.
 */
export function buildActionFeedback(
  result: StepResult,
  opts: { successText?: string } = {},
): MaviFeedbackData {
  if (!result || typeof result.status !== 'string') {
    return { kind: 'action', severity: 'error', code: 'action_unknown', message: 'Bunu yapamam' };
  }
  if (result.status === 'ok') {
    return {
      kind: 'action', severity: 'success', code: 'action_ok',
      message: opts.successText && opts.successText.trim().length > 0 ? opts.successText.trim() : 'Tamam',
      actionId: result.actionId,
    };
  }
  const f = FAILURE_MESSAGE[result.status];
  return { kind: 'action', severity: f.severity, code: f.code, message: f.message, actionId: result.actionId };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Plan sonucu feedback'i
 * ════════════════════════════════════════════════════════════════════════ */

const PLAN_MESSAGE: Record<PlanStatus, { severity: FeedbackSeverity; code: string; message: string }> = {
  completed: { severity: 'success', code: 'plan_completed', message: 'Tamam' },
  partial:   { severity: 'warning', code: 'plan_partial',   message: 'Bir kısmını yapamadım' },
  failed:    { severity: 'error',   code: 'plan_failed',    message: 'Bunu yapamadım' },
  rejected:  { severity: 'error',   code: 'plan_rejected',  message: 'Bunu şu an yapamadım' },
};

/**
 * Plan bütününe göre feedback. Stale reddi (barge-in) kullanıcı zaten yeni komuta geçtiğinden
 * SESSİZ geçilir (null) — eski turun "yapamadım"ı yeni turu bölmez.
 */
export function buildPlanFeedback(result: PlanResult): MaviFeedbackData | null {
  if (!result || typeof result.status !== 'string') {
    return { kind: 'plan', severity: 'error', code: 'plan_failed', message: 'Bunu yapamadım' };
  }
  if (result.status === 'rejected' && result.reason === 'stale_generation') return null; // barge-in → sessiz
  const p = PLAN_MESSAGE[result.status];
  return { kind: 'plan', severity: p.severity, code: p.code, message: p.message };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yayın kanalı (TTS/UI tüketici DIŞARIDA — bu kanal yalnız typed event taşır)
 * ════════════════════════════════════════════════════════════════════════ */

export interface MaviFeedbackChannelDeps {
  readonly now?: () => number;
}

export class MaviFeedbackChannel {
  private readonly _now: () => number;
  private readonly _listeners = new Set<(fb: MaviFeedback) => void>();
  private _last: MaviFeedback | null = null;

  constructor(deps: MaviFeedbackChannelDeps = {}) {
    this._now = typeof deps.now === 'function' ? deps.now : Date.now;
  }

  /** Typed feedback'i yayınla (zaman damgalar). null/geçersiz veri sessizce yok sayılır. */
  emit(data: MaviFeedbackData | null | undefined): MaviFeedback | null {
    if (!data || typeof data.message !== 'string') return null;
    const fb: MaviFeedback = Object.freeze({ ...data, at: this._safeNow() });
    this._last = fb;
    for (const fn of this._listeners) {
      try { fn(fb); } catch { /* tüketici hatası kanalı bozmaz (fail-soft) */ }
    }
    return fb;
  }

  subscribe(listener: (fb: MaviFeedback) => void): () => void {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  last(): MaviFeedback | null { return this._last; }

  /** İdempotent temizlik (dispose). */
  reset(): void {
    this._listeners.clear();
    this._last = null;
  }

  private _safeNow(): number {
    try {
      const t = this._now();
      return typeof t === 'number' && Number.isFinite(t) ? t : 0;
    } catch { return 0; }
  }
}

export function createFeedbackChannel(deps: MaviFeedbackChannelDeps = {}): MaviFeedbackChannel {
  return new MaviFeedbackChannel(deps);
}
