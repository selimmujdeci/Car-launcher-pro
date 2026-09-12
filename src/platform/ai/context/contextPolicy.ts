/**
 * contextPolicy — görev bazlı alan seçimi + güncellik pencereleri + fiziksel sınırlar.
 *
 * Tüm eşikler ya UYGULAMANIN KENDİ otoritesinden (OBD tazelik penceresi DI ile
 * gelir) ya da FİZİKSEL gerçeklikten türer — uydurma sabit yoktur.
 */

import type { ContextBudget, MaviTaskFieldPolicy } from './contextPolicyTypes';
import type { MaviTaskType } from '../orchestrator/orchestratorTypes';

export type { MaviTaskFieldPolicy } from './contextPolicyTypes';

/* ── Görev bazlı alan politikası ───────────────────────────────────────────── */

/**
 * Hangi görevde HANGİ alanların taşınacağı. Listelenmeyen alan TAŞINMAZ
 * (allowlist — fail-closed).
 */
export const TASK_CONTEXT_POLICY: Readonly<Record<MaviTaskType, MaviTaskFieldPolicy>> = {
  /* Genel sohbet: yalnız "araç bağlı mı" — canlı telemetri GEREKMEZ. */
  general_chat: {
    includeConnection: true,
    includeIdentity:   false,
    includeSession:    false,
    liveFields:        [],
    includeDiagnostics: false,
  },

  /* Araç sorusu: kimlik + oturum sağlığı + ilgili canlı değerler + DTC özeti. */
  vehicle_question: {
    includeConnection: true,
    includeIdentity:   true,
    includeSession:    true,
    liveFields:        ['coolantC', 'fuelPercent', 'batteryVoltage', 'rpm', 'speedKph'],
    includeDiagnostics: true,
  },

  /* Teknik analiz: protokol/sağlık/kopma nedeni + ilgili anlık değerler. */
  technical_analysis: {
    includeConnection: true,
    includeIdentity:   true,
    includeSession:    true,
    liveFields:        ['coolantC', 'batteryVoltage', 'rpm'],
    includeDiagnostics: true,
  },

  /* Kod analizi: ARAÇ TELEMETRİSİ EKLENMEZ (alakasız + gereksiz veri paylaşımı). */
  code_analysis: {
    includeConnection: false,
    includeIdentity:   false,
    includeSession:    false,
    liveFields:        [],
    includeDiagnostics: false,
  },

  /* Kısa cevap: minimum bağlam (sürüşte gecikme kritik). */
  short_answer: {
    includeConnection: true,
    includeIdentity:   false,
    includeSession:    false,
    liveFields:        [],
    includeDiagnostics: false,
  },

  /* Uzun açıklama: genişletilmiş ama yine BOUNDED bağlam. */
  long_explanation: {
    includeConnection: true,
    includeIdentity:   true,
    includeSession:    true,
    liveFields:        ['coolantC', 'fuelPercent', 'batteryVoltage'],
    includeDiagnostics: true,
  },
};

/* ── Güncellik ─────────────────────────────────────────────────────────────── */

/**
 * Sistem saati sapması payı. Küçük ileri sapmalar (ms) reddedilmez; bunun
 * ötesindeki "gelecek" damgalar GEÇERSİZ sayılır (unknown).
 */
export const CLOCK_SKEW_TOLERANCE_MS = 2_000;

/**
 * Canlı OBD değerleri için taze penceresi UYGULAMANIN KENDİ otoritesinden gelir
 * (`getObdFreshWindowMs`) — burada sabit UYDURULMAZ. Bu çarpan, pencerenin kaç
 * katına kadar verinin "stale ama taşınabilir" sayılacağını belirler; ötesi
 * TAŞINMAZ (eski değeri güncelmiş gibi göstermemek için).
 */
export const STALE_WINDOW_MULTIPLIER = 5;

/**
 * DTC taraması oturum-ömürlüdür (canlı PID gibi saniyede yenilenmez).
 * Bu pencere içinde okunmuşsa `fresh`, ötesinde `stale`.
 */
export const DTC_FRESH_WINDOW_MS = 10 * 60_000;

/* ── Fiziksel geçerlilik sınırları ─────────────────────────────────────────── */

/**
 * Fizik dışı değer AI'ya GİTMEZ. Sınırlar geniş tutulmuştur (ticari araç/
 * yarış motoru dahil) — amaç bozuk okuma/sentinel elemektir, ince ayar değil.
 */
export const PHYSICAL_LIMITS = {
  rpm:            { min: 0,    max: 12_000 },
  speedKph:       { min: 0,    max: 320 },
  coolantC:       { min: -40,  max: 200 },
  fuelPercent:    { min: 0,    max: 100 },
  batteryVoltage: { min: 6,    max: 36 },
  dtcCount:       { min: 0,    max: 500 },
} as const;

/* ── Bütçe ─────────────────────────────────────────────────────────────────── */

/**
 * Varsayılan bütçe. `maxChars` araç-içi gecikme gözetilerek KÜÇÜK tutulmuştur:
 * bağlam bloğu istemi şişirip ilk-token gecikmesini artırmamalıdır.
 */
export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  maxFields:   10,
  maxDtcCodes: 5,
  maxChars:    700,
  maxSources:  3,
};

/**
 * Bütçe aşımında DÜŞÜRME sırası (büyük sayı önce düşer).
 * Öncelik: 1) güvenlik/hata 2) doğrudan ilgili veri 3) oturum sağlığı
 *          4) araç kimliği 5) ikincil canlı değerler
 */
export const FIELD_PRIORITY: Readonly<Record<string, number>> = {
  /* 1 — güvenlik ve hata bilgisi */
  dtcCount:             1,
  boundedCodes:         1,
  coolantC:             1,   // aşırı ısınma güvenlik konusudur
  /* 2 — soruyla doğrudan ilgili canlı veri */
  fuelPercent:          2,
  batteryVoltage:       2,
  /* 3 — bağlantı/oturum sağlığı */
  sourceHealth:         3,
  lastDisconnectReason: 3,
  protocolClass:        3,
  /* 4 — araç kimliği */
  vehicleType:          4,
  /* 5 — ikincil canlı değerler */
  rpm:                  5,
  speedKph:             5,
};

/** Bilinmeyen alan adları en düşük öncelikte (ilk düşer). */
export const DEFAULT_FIELD_PRIORITY = 9;

export function priorityOf(field: string): number {
  return FIELD_PRIORITY[field] ?? DEFAULT_FIELD_PRIORITY;
}
