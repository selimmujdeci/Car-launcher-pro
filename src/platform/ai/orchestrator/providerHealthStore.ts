/**
 * providerHealthStore — SAĞLAYICI BAŞINA sağlık/kota durumu (süreç belleği).
 *
 * Orchestrator'ın "rate limit durumu · timeout geçmişi · son başarısız
 * denemeler" girdilerini üretir. Karar çekirdeği SAF kaldığı için ölçüm/durum
 * BURADA yaşar ve karara `ProviderHealthMap` olarak DI ile geçer.
 *
 * ── MEVCUT `aiHealth`'DEN FARKI (bilinçli) ─────────────────────────────────
 * `platform/aiHealth` GLOBAL bir devre kesicidir: bir sağlayıcının çökmesi TÜM
 * AI yollarını kapatır (araç içinde doğru davranış — ağ gerçekten ölmüş olabilir).
 * Bu depo ise SAĞLAYICI BAZLIdır: birinin kotası dolduğunda diğerine geçebilmek
 * için. İkisi birbirini EZMEZ; global kesici hâlâ üstte durur.
 *
 * ── SAAT DI ────────────────────────────────────────────────────────────────
 * `Date.now` GÖMÜLÜ DEĞİLDİR; her fonksiyon `nowMs` alır. Böylece deterministik
 * test edilebilir ve saat sıçramasına karşı çağıran tek bir kaynak kullanır.
 *
 * Kalıcı depo YOK: süreç yeniden başlayınca temiz başlar (kota pencereleri
 * zaten kısa ömürlüdür).
 */

import type { ProviderHealthMap, ProviderHealthSnapshot } from './orchestratorTypes';

/** Hata sınıfı → engel süresi (ms). Yalnız GEÇİCİ engeller pencere kurar. */
const BLOCK_MS = {
  rate_limited: 60_000,   // kota penceresi
  server:       30_000,   // sağlayıcı tarafı geçici arıza
  network:      15_000,   // ağ dalgalanması
  timeout:      15_000,
  auth:         300_000,  // geçersiz anahtar — kullanıcı düzeltene kadar denemeye değmez
  unknown:      10_000,
} as const;

export type HealthFailureKind = keyof typeof BLOCK_MS;

/** Art arda kaç hatadan sonra ceza penceresi UZATILIR. */
const ESCALATE_AFTER = 2;
/** Ceza penceresi tavanı — sağlayıcı sonsuza kadar dışlanmasın. */
const MAX_BLOCK_MS = 300_000;

interface MutableHealth {
  consecutiveFailures: number;
  blockedUntilMs:      number;
  blockReason?:        ProviderHealthSnapshot['blockReason'];
  lastTimeoutAtMs:     number;
}

const _state = new Map<string, MutableHealth>();

function ensure(providerId: string): MutableHealth {
  let entry = _state.get(providerId);
  if (!entry) {
    entry = { consecutiveFailures: 0, blockedUntilMs: 0, lastTimeoutAtMs: 0 };
    _state.set(providerId, entry);
  }
  return entry;
}

/** Başarılı çağrı — sayaç ve engel SIFIRLANIR. */
export function recordProviderSuccess(providerId: string): void {
  if (!providerId) return;
  _state.set(providerId, { consecutiveFailures: 0, blockedUntilMs: 0, lastTimeoutAtMs: 0 });
}

/**
 * Başarısız çağrı — hata sınıfına göre engel penceresi kurar.
 * Art arda hatalarda pencere KATLANIR (tavanlı) → sürekli düşen sağlayıcı
 * zincirin başında ısrar etmez.
 */
export function recordProviderFailure(providerId: string, kind: HealthFailureKind, nowMs: number): void {
  if (!providerId) return;
  const entry = ensure(providerId);
  entry.consecutiveFailures += 1;

  const base       = BLOCK_MS[kind] ?? BLOCK_MS.unknown;
  const escalation = entry.consecutiveFailures >= ESCALATE_AFTER
    ? Math.pow(2, Math.min(3, entry.consecutiveFailures - ESCALATE_AFTER + 1))
    : 1;
  const window = Math.min(MAX_BLOCK_MS, base * escalation);

  entry.blockedUntilMs = Math.max(entry.blockedUntilMs, nowMs + window);
  entry.blockReason    = kind;
  if (kind === 'timeout') entry.lastTimeoutAtMs = nowMs;
}

/** Kota penceresini sağlayıcının bildirdiği süreyle AÇIKÇA kurar (429 Retry-After). */
export function recordProviderRateLimit(providerId: string, retryAfterMs: number, nowMs: number): void {
  if (!providerId) return;
  const entry = ensure(providerId);
  const window = Number.isFinite(retryAfterMs) && retryAfterMs > 0
    ? Math.min(MAX_BLOCK_MS, retryAfterMs)
    : BLOCK_MS.rate_limited;
  entry.consecutiveFailures += 1;
  entry.blockedUntilMs = Math.max(entry.blockedUntilMs, nowMs + window);
  entry.blockReason    = 'rate_limited';
}

/** Tek sağlayıcının anlık durumu (kayıt yoksa "sağlıklı" nötr değer). */
export function getProviderHealth(providerId: string): ProviderHealthSnapshot {
  const entry = _state.get(providerId);
  return {
    providerId,
    consecutiveFailures: entry?.consecutiveFailures ?? 0,
    blockedUntilMs:      entry?.blockedUntilMs ?? 0,
    ...(entry?.blockReason ? { blockReason: entry.blockReason } : {}),
    lastTimeoutAtMs:     entry?.lastTimeoutAtMs ?? 0,
  };
}

/**
 * Orchestrator'a verilecek harita. Süresi dolmuş engeller TEMİZLENEREK döner
 * (karar çekirdeği ayrıca `nowMs` ile kontrol eder — çift güvenlik).
 */
export function getProviderHealthMap(providerIds: readonly string[], nowMs: number): ProviderHealthMap {
  const map: Record<string, ProviderHealthSnapshot> = {};
  for (const id of providerIds) {
    const snapshot = getProviderHealth(id);
    map[id] = snapshot.blockedUntilMs > nowMs
      ? snapshot
      : { ...snapshot, blockedUntilMs: 0, ...(snapshot.blockReason ? { blockReason: undefined } : {}) };
  }
  return map;
}

/** @internal — testler arası izolasyon / oturum değişimi. */
export function resetProviderHealth(): void {
  _state.clear();
}
