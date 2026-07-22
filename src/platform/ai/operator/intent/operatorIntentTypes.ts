/**
 * operatorIntentTypes — Operatör Niyet Motoru sözleşmeleri (Faz 2).
 *
 * ⚠️ YENİ AI / SINIFLANDIRICI DEĞİL. Kullanıcının doğal Türkçe isteğini
 * DETERMİNİSTİK anahtar-kelime/kural + allowlist görev kataloğuyla MEVCUT
 * Operatör görevlerinden birine eşler. Model çıktısına GÜVENMEZ.
 *
 * ── GÜVENLİK SÖZLEŞMESİ ─────────────────────────────────────────────────────
 *  - Kullanıcı metni VERİdir: yalnız sınıflandırılır, ASLA talimat olarak
 *    yorumlanmaz (prompt injection nötr).
 *  - Fail-closed: belirsiz / araç-dışı / boş istekte görev SEÇİLMEZ.
 *  - Yazma/tehlikeli istekte niyet 'needs_approval' → operatör ÇALIŞTIRILMAZ.
 */

import type { OperatorTaskId } from '../operatorTypes';

/** Niyet çözümlemesinin sonucu (kapalı küme). */
export type OperatorIntentKind =
  | 'operator_task'   // güvenle bir operatör görevine çözüldü
  | 'clarify'         // zayıf/çelişkili eşleşme → netleştir (operatör çalışmaz)
  | 'chat'            // araç-dışı / selam / genel sohbet (operatör çalışmaz)
  | 'needs_approval'; // yazma/tehlikeli istek → onay gerekli (operatör çalışmaz)

/** Niyet gerekçesi — serbest metin DEĞİL, sabit jetonlar (kullanıcı verisi İÇERMEZ). */
export type OperatorIntentReason =
  | 'keyword_match'
  | 'dtc_code_detected'
  | 'multiple_matches_narrowed'
  | 'ambiguous_multiple'
  | 'no_vehicle_intent'
  | 'write_or_dangerous'
  | 'empty_or_too_short';

export interface OperatorIntent {
  readonly kind:        OperatorIntentKind;
  /** kind==='operator_task' iken doldurulur (allowlist görev kimliği). */
  readonly taskId?:     OperatorTaskId;
  /** knowledge_explanation için çıkarılan arıza kodu (ör. P0401). */
  readonly code?:       string;
  /** 0..100 — deterministik skor; UYDURULMAZ. */
  readonly confidence:  number;
  readonly reason:      OperatorIntentReason;
  /** clarify iken kullanıcıya sunulacak aday görevler (bounded). */
  readonly candidates?: readonly OperatorTaskId[];
}

/** YALNIZ güvenli metadata — kullanıcı metni/echo TAŞIMAZ. */
export interface OperatorIntentTelemetry {
  readonly kind:        OperatorIntentKind;
  readonly reason:      OperatorIntentReason;
  readonly confidence:  number;
  readonly hasCode:     boolean;
  readonly candidateCount: number;
}
