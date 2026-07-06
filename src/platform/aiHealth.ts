/**
 * aiHealth — AI ağ sağlığı devre kesicisi (circuit breaker).
 *
 * SAHA HATASI (2026-06-12): yavaş/araızalı hotspot'ta `navigator.onLine` true
 * kalır ama Gemini istekleri timeout'a koşar. Her cümle 3 ardışık AI çağrısını
 * (companion 6s → semantic 5s → askAI 3s) timeout'a kadar bekliyor, sürücü
 * 10+ saniye sonra "İnternet yavaş, şunu mu demek istediniz?" duyuyordu —
 * her seferinde, yeniden.
 *
 * Çözüm: art arda AĞ kaynaklı AI hatası eşiği aşınca devre AÇILIR — soğuma
 * penceresi boyunca tüm AI yolları atlanır, deterministik YEREL zincir anında
 * cevap verir (offline-first, CLAUDE.md §2 fail-soft). Başarılı bir AI cevabı
 * devreyi kapatır ve sayacı sıfırlar.
 *
 * Süreler MONOTONİK saatten (performance.now) — clock-jump güvenli (§4).
 */

const FAIL_THRESHOLD = 2;       // art arda kaç ağ hatasında devre açılır
const COOLDOWN_MS    = 90_000;  // devre açık kalma süresi

let _consecFails    = 0;
let _blockedUntilMs = 0;

/** Gemini/Haiku çağrısı ağ hatası/timeout ile düştü — kesiciye bildir. */
export function recordAiNetFailure(): void {
  _consecFails++;
  if (_consecFails >= FAIL_THRESHOLD) {
    _blockedUntilMs = performance.now() + COOLDOWN_MS;
  }
}

/** Başarılı AI yanıtı — devre kapanır, sayaç sıfırlanır. */
export function recordAiNetSuccess(): void {
  _consecFails    = 0;
  _blockedUntilMs = 0;
}

/** false → devre açık: AI yolları atlanmalı, yerel zincir kullanılmalı. */
export function isAiNetHealthy(): boolean {
  return performance.now() >= _blockedUntilMs;
}

/**
 * Tanı raporu için devre kesici anlık görüntüsü (PII yok).
 * `blockedForMs` = devre daha ne kadar açık kalacak (0 = sağlıklı).
 */
export function getAiHealthSnapshot(): {
  healthy: boolean; consecFails: number; blockedForMs: number;
} {
  const now = performance.now();
  return {
    healthy:      now >= _blockedUntilMs,
    consecFails:  _consecFails,
    blockedForMs: _blockedUntilMs > now ? Math.round(_blockedUntilMs - now) : 0,
  };
}

/** @internal — testler arası izolasyon. */
export function _resetAiHealthForTest(): void {
  _consecFails    = 0;
  _blockedUntilMs = 0;
}
