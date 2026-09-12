/**
 * bootResilienceGuard.ts — beklenmeyen (crash / güç kesintisi) yeniden
 * başlatma SONRASI kısa bir bilinçli-düşük-yük penceresi.
 *
 * ── NEDEN (saha kanıtı) ──────────────────────────────────────────────────
 * 2026-09-03 K24 saha turunda tekrarlayan, log'a HİÇ uyarı düşürmeyen ani
 * cihaz reset'leri gözlemlendi (uptime birkaç dakikada sıfırlanıyor,
 * `logcat` "Reboot starting" gibi yazılımsal bir istek GÖSTERMİYOR). Aynı
 * anda vendor telemetrisi (`nwdapp_CpuTempMonitor`) PMU sıcaklığının
 * 91-95°C'ye çıktığını gösteriyordu — ama bu değer uygulamaya HİÇBİR
 * yoldan erişilebilir DEĞİL (doğrulandı: `/sys/class/hwmon` altında PMIC
 * sıcaklık düğümü yok, yalnız alakasız bir NoC performans sayacı var).
 *
 * ── BİLİNÇLİ OLARAK DOKUNULMAYAN ─────────────────────────────────────────
 * `thermalWatchdog.ts`'in SoC die kademeleri (100/105/110°C) ve genel kasa
 * kademeleri (45/55/65°C) bu SoC için ÖLÇÜLEREK kalibre edilmiştir (kütük
 * #139/#141) — sıkılaştırmak daha önce SAĞLIKLI cihazlarda kalıcı L3
 * kilitlenmesine yol açmış ve geri alınmıştır. Bu modül o kalibrasyonu
 * DEĞİŞTİRMEZ; tamamen AYRI ve EKLEMELİ bir güvenlik ağıdır.
 *
 * ── NE YAPAR ──────────────────────────────────────────────────────────────
 * Uygulama çalışırken düşük frekansta ("hâlâ hayattayım") bir zaman damgası
 * yazar. Bir sonraki soğuk açılışta bu damga "az önce"ye çok yakınsa —
 * yani uygulama birkaç dakika önce hâlâ AYAKTAYDI ve şimdi TAZE bir süreç
 * başlangıcındayız — bu normal bir kapat/aç DEĞİL, beklenmeyen bir
 * ölüm/reset işaretidir. Böyle bir açılışta runtime moduna TEK SEFERLİK bir
 * anlık downgrade isteği gönderilir (`runtimeManager.setMode` — ki bu zaten
 * çok-çağıranlı bir API'dir, `CognitivePriorityEngine` de aynı şekilde
 * çağırır); yeni bir paylaşılan durum/tavan İCAT EDİLMEZ.
 *
 * Sağlıklı bir cihazda bu yol neredeyse HİÇ tetiklenmez: normal kapat/aç
 * (kontak kapama, uygulama kapatma) dakikalar değil saatler/günler sürer.
 *
 * Zero-Leak: `startBootHeartbeat()`'in döndürdüğü durdurma fonksiyonu
 * ÇAĞRILMALI (SystemBoot LIFO cleanup'ına kayıtlıdır).
 * Write Throttling: heartbeat en fazla `HEARTBEAT_WRITE_INTERVAL_MS`'te bir
 * yazılır (CLAUDE.md §3 — eMMC ömrü).
 */

import { safeGetRaw, safeSetRaw } from '../../utils/safeStorage';

const HEARTBEAT_KEY = 'car-launcher-boot-heartbeat-v1';

/** Heartbeat'in gerçekten diske yazılma sıklığı — eMMC ömrü korunur. */
export const HEARTBEAT_WRITE_INTERVAL_MS = 60_000;

/**
 * Son heartbeat "şimdi"ye bu kadar yakınsa yeniden başlatma ŞÜPHELİ sayılır.
 * Gerçek kapat/aç (kontak kapatma, uygulamayı elle kapatma) neredeyse hep
 * bundan uzun sürer; kısa bir errand molası bile genelde birkaç dakikadan
 * uzundur — bu yüzden pencere BİLEREK dar tutulur (yanlış-pozitif düşük).
 */
export const ABNORMAL_RESTART_WINDOW_MS = 5 * 60_000;

/** Fail-soft: bozuk/ayrıştırılamayan değer OKUNMAMIŞ sayılır, TAHMİN edilmez. */
export function readLastHeartbeatMs(): number | null {
  try {
    const raw = safeGetRaw(HEARTBEAT_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Fail-soft: yazım hatası sessizce yutulur — bu bir kritik veri yolu DEĞİLDİR. */
export function writeHeartbeatNow(nowMs: number): void {
  try {
    safeSetRaw(HEARTBEAT_KEY, String(nowMs));
  } catch {
    /* fail-soft */
  }
}

/**
 * Saf karar fonksiyonu — I/O yok, `Date.now()` çağırmaz (nowMs dışarıdan
 * gelir; testte ve gerçek çağrıda AYNI kod yolu).
 *
 * `lastHeartbeatMs === null` → hiç heartbeat yok (ilk kurulum / eski
 * sürüm / depo temizlendi) → normal karşılanır, ANORMAL SAYILMAZ.
 * `nowMs < lastHeartbeatMs` → saat geriye sıçramış (CLAUDE.md §4 clock-jump
 * koruması) → güvenilmez, ANORMAL SAYILMAZ (fail-closed DEĞİL, fail-soft:
 * yanlış-pozitif ile sağlıklı cihazı kısıtlamaktansa sessiz kalmak tercih
 * edilir — bu yalnız bir EK koruma katmanıdır, ana güvenlik değil).
 */
export function wasAbnormalRestart(lastHeartbeatMs: number | null, nowMs: number): boolean {
  if (lastHeartbeatMs === null) return false;
  const age = nowMs - lastHeartbeatMs;
  return age >= 0 && age <= ABNORMAL_RESTART_WINDOW_MS;
}

export interface BootResilienceDecision {
  readonly abnormalRestart:  boolean;
  readonly lastHeartbeatMs:  number | null;
  readonly heartbeatAgeMs:   number | null;
}

/** Boot anında BİR KEZ çağrılır — kararı ve gözlem alanlarını birlikte döner. */
export function evaluateBootResilience(nowMs: number): BootResilienceDecision {
  const lastHeartbeatMs = readLastHeartbeatMs();
  const abnormal = wasAbnormalRestart(lastHeartbeatMs, nowMs);
  return Object.freeze({
    abnormalRestart: abnormal,
    lastHeartbeatMs,
    heartbeatAgeMs: lastHeartbeatMs === null ? null : nowMs - lastHeartbeatMs,
  });
}

/**
 * Düşük frekanslı "hâlâ hayattayım" zamanlayıcısı — bu modülün TEK sahip
 * olduğu timer (Zero-Leak: dönen fonksiyon SystemBoot LIFO'sunda saklanır).
 * İlk yazım anında da yapılır (kısa oturumlar heartbeat'siz kalmasın).
 */
export function startBootHeartbeat(clock: { nowMs(): number } = { nowMs: () => Date.now() }): () => void {
  writeHeartbeatNow(clock.nowMs());
  const timer = setInterval(() => {
    writeHeartbeatNow(clock.nowMs());
  }, HEARTBEAT_WRITE_INTERVAL_MS);
  return () => clearInterval(timer);
}
