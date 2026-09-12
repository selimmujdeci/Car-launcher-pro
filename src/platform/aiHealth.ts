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
 *
 * ── SAHA HATASI (2026-07-22): "internet var, anahtar geçerli, Mavi offline'a
 *    düşüyor ve kalıyor; yeniden başlatınca düzeliyor" ─────────────────────────
 * KÖK NEDEN: devre kesicinin YARI-AÇIK (half-open) durumu YOKTU. `_consecFails`
 * yalnız BAŞARI ile sıfırlanıyordu; soğuma penceresi dolduğunda sıfırlanmıyordu.
 * Eşik (2) bir kez aşıldıktan sonra sayaç ≥2'de TAKILI kalıyor, dolayısıyla
 * penceredeki her yeni TEK hata anında yeni bir 90sn penceresi açıyordu. Araçta
 * tek tük timeout (hücre devri/tünel) normaldir → asistan pratikte KALICI
 * offline oluyordu. Sayaç modül RAM'inde yaşadığı için yeniden başlatma
 * "düzeltiyor" gibi görünüyordu.
 *
 * İKİ DÜZELTME:
 *   1) YARI-AÇIK: pencere dolduğunda sayaç SIFIRLANIR → devre bir DENEME hakkı
 *      verir; toparlanma sonrası tek hata artık devreyi açmaz.
 *   2) STREAK PENCERESİ: "art arda" ZAMANSAL bir kavramdır. Aralarında
 *      `FAIL_STREAK_WINDOW_MS`'ten uzun süre olan hatalar aynı seriye SAYILMAZ
 *      (10 dakika arayla iki timeout "art arda" değildir).
 *
 * Ayrıca: her devre AÇILIŞI artık TİPLİ BİR SEBEP KODU ile kaydedilir
 * (`aiOfflineReason`) — sessizce offline'a düşmek YASAK.
 */

import {
  recordAiOfflineTransition, offlineReasonFromErrorKind,
  type AiOfflineDetail,
} from './ai/aiOfflineReason';

/* ── SAHA HATASI (2026-07-24): "sohbet ederken bir süre sonra offline'a düşüyor"
 * KÖK: `tryCompanionBrain`'in UYGULAMA BÜTÇESİ (sürüşte 4.5sn / parkta 8sn)
 * dolduğunda atılan AbortError, ağ ölümüyle AYNI ağırlıkta sayılıyordu. Oysa
 * gemini-flash DERİN SOĞUK BAŞLANGIÇTA ~7sn dönüyor (kod içi ölçüm) → sürüşte
 * neredeyse HER komut bütçeyi aşıyor → 2 komutta devre açılıp 90sn boyunca
 * asistanı (STT dahil) tamamen kapatıyordu.
 *
 * AYRIM: bir isteği KENDİ seçtiğimiz süre dolduğu için iptal etmemiz, ağın ölü
 * olduğunun KANITI DEĞİLDİR — sunucu yalnızca yavaş olabilir, cevap yolda
 * olabilir. Gerçek ulaşılamazlık (DNS/TLS/bağlantı kopması → fetch TypeError,
 * `navigator.onLine=false`) apayrı bir olaydır.
 *
 * Bu yüzden iki AYRI sayaç/eşik: gerçek ulaşılamazlık eskisi gibi 2 hatada
 * devreyi açar (2026-06-12 "ölü hotspot" regresyonu korunur); bütçe timeout'u
 * ise ancak ISRARLI olduğunda (4 art arda) açar — tek tük yavaş cevap artık
 * asistanı offline'a kilitlemez. */
const FAIL_THRESHOLD = 2;       // art arda kaç GERÇEK ulaşılamazlıkta devre açılır
/** Art arda kaç UYGULAMA BÜTÇESİ timeout'unda devre açılır (yavaş ≠ ölü). */
const TIMEOUT_FAIL_THRESHOLD = 4;
const COOLDOWN_MS    = 90_000;  // devre açık kalma süresi
/**
 * İki hatanın AYNI seriye sayılması için aralarındaki azami süre. Bundan uzun
 * bir sessizlikten sonra gelen hata seriyi BAŞTAN başlatır — aksi halde saatler
 * arayla oluşan bağımsız hıçkırıklar birikip devreyi açardı.
 */
const FAIL_STREAK_WINDOW_MS = 60_000;

let _consecFails    = 0;
/** Art arda UYGULAMA BÜTÇESİ timeout'u (kendi eşiği var — bkz. TIMEOUT_FAIL_THRESHOLD). */
let _consecTimeouts = 0;
let _blockedUntilMs = 0;
let _lastFailureAtMs = -Infinity;

/**
 * Devre AÇIKSA ve süresi DOLMUŞSA yarı-açık duruma geçer (sayaçlar sıfırlanır).
 * Okuma yollarının hepsi bu geçişten önce çağırır → tek noktada tutarlılık.
 */
function _settle(now: number): void {
  if (_blockedUntilMs !== 0 && now >= _blockedUntilMs) {
    _blockedUntilMs = 0;
    _consecFails    = 0;   // YARI-AÇIK: yeni bir deneme hakkı
    _consecTimeouts = 0;
  }
}

/**
 * Gemini/Haiku/gateway çağrısı GERÇEK ağ hatası/timeout ile düştü — kesiciye
 * bildir. HTTP yanıtı alınan durumlar (429/4xx/5xx) buraya GELMEMELİDİR: onlar
 * ağın canlı olduğunun kanıtıdır (bkz. gatewayChatBridge NET_DEATH_KINDS).
 *
 * @param detail Opsiyonel künye (sağlayıcı/model/istek/gecikme/HTTP/deneme) —
 *               yalnız devre AÇILDIĞINDA offline sebep kaydına yazılır. Verilmezse
 *               davranış birebir eskisi (geriye dönük uyumlu).
 */
export function recordAiNetFailure(detail?: AiOfflineDetail): void {
  const now = performance.now();
  _settle(now);

  // "Art arda" zamansaldır: uzun sessizlikten sonraki hata yeni seri başlatır.
  if (now - _lastFailureAtMs > FAIL_STREAK_WINDOW_MS) { _consecFails = 0; _consecTimeouts = 0; }
  _lastFailureAtMs = now;

  // Bütçe timeout'u AYRI kovada, daha yüksek eşikle sayılır: kendi süre
  // bütçemizin dolması ağın öldüğünü kanıtlamaz (yavaş ≠ ulaşılamaz).
  // Sınıflandırılamayan ('unknown') hatalar muhafazakâr biçimde sert kovada
  // kalır — bilinmeyen bir arıza için eşiği gevşetmek YASAK.
  if (detail?.exceptionType === 'timeout') {
    _consecTimeouts++;
    if (_consecTimeouts >= TIMEOUT_FAIL_THRESHOLD && _blockedUntilMs === 0) {
      _blockedUntilMs = now + COOLDOWN_MS;
      recordAiOfflineTransition('NETWORK_TIMEOUT', COOLDOWN_MS, detail);
    }
    return;
  }

  _consecFails++;
  if (_consecFails >= FAIL_THRESHOLD && _blockedUntilMs === 0) {
    _blockedUntilMs = now + COOLDOWN_MS;
    // SESSİZ OFFLINE YASAK: geçişin sebebi + künyesi tek satır kaydedilir.
    recordAiOfflineTransition(
      offlineReasonFromErrorKind(detail?.exceptionType ?? 'unknown'),
      COOLDOWN_MS,
      detail,
    );
  }
}

/** Başarılı AI yanıtı — devre kapanır, sayaç sıfırlanır. */
export function recordAiNetSuccess(): void {
  _consecFails     = 0;
  _consecTimeouts  = 0;
  _blockedUntilMs  = 0;
  _lastFailureAtMs = -Infinity;
}

/** false → devre açık: AI yolları atlanmalı, yerel zincir kullanılmalı. */
export function isAiNetHealthy(): boolean {
  const now = performance.now();
  _settle(now);
  return _blockedUntilMs === 0;
}

/**
 * Tanı raporu için devre kesici anlık görüntüsü (PII yok).
 * `blockedForMs` = devre daha ne kadar açık kalacak (0 = sağlıklı).
 */
export function getAiHealthSnapshot(): {
  healthy: boolean; consecFails: number; consecTimeouts: number; blockedForMs: number;
} {
  const now = performance.now();
  _settle(now);
  return {
    healthy:        _blockedUntilMs === 0,
    consecFails:    _consecFails,
    consecTimeouts: _consecTimeouts,
    blockedForMs:   _blockedUntilMs > now ? Math.round(_blockedUntilMs - now) : 0,
  };
}

/** @internal — testler arası izolasyon. */
export function _resetAiHealthForTest(): void {
  _consecFails     = 0;
  _consecTimeouts  = 0;
  _blockedUntilMs  = 0;
  _lastFailureAtMs = -Infinity;
}
