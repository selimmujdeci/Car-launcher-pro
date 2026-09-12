/**
 * guardianTickPolicy — GUARDIAN-AI-G16 · TICK SAHİPLİĞİ KARARI (saf politika).
 *
 * Guardian çekirdeği bugüne kadar SAF yazıldı (deterministik · immutable ·
 * fail-closed · testli) ama **kimin, kaç Hz'de, hangi tier bütçesiyle
 * çalıştıracağı hiçbir yere ait değildi**. Bu dosya YALNIZ o kararı taşır:
 * kural yazmaz, sağlayıcı bağlamaz, IO yapmaz, timer kurmaz.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 1) TICK SAHİBİ — kim çalıştıracak?
 * ══════════════════════════════════════════════════════════════════════════
 * `runtimeManager.scheduleTask()` — §L.0 TEK tik-wheel'i. Guardian KENDİ
 * `setInterval`ini KURMAZ. Gerekçe (üçü de bu repoda ölçülmüş kusurlardan):
 *
 *  · **İkinci zamanlayıcı otoritesi doğmaz.** Wheel'in kendi sözleşmesi
 *    "tek yazar invaryantı" diyor; ayrı bir interval mod çarpanını, termal
 *    tavanı ve `destroy()` temizliğini GÖRMEZ → sessizce bütçe dışına çıkar.
 *  · **Görünüm sahipliği YASAK.** Navigasyon oturumunun tick'i bir zamanlar
 *    `FullMapView`a aitti; tam ekran kapanınca motor DONDU (kütük #377).
 *    Guardian bir React bileşenine, bir ekrana veya bir görünüme BAĞLANMAZ.
 *  · **Zero-leak bedava gelir.** `scheduleTask()` cleanup thunk döner; wheel
 *    son görev silinince durur (boşta uyanış yok), `_invokeTask` her görevi
 *    try/catch içine alır (bir görev fırlatınca diğerleri etkilenmez).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 2) Hz KARARI — neden 1 Hz taban?
 * ══════════════════════════════════════════════════════════════════════════
 * Guardian'ın bugün GERÇEK üç sağlayıcısı var (GPS hızı · OBD · OBD sağlığı) ve
 * üçü de kendi kadansını `runtimeConfig`ten alır. Guardian'ı sağlayıcısından
 * daha hızlı koşturmak AYNI girdiyi yeniden hesaplamaktır — sıfır gecikme
 * kazancı, tam CPU maliyeti. Ölçülü sözleşme:
 *
 *   **Guardian periyodu, aynı modda OBD anket periyodunu ASLA AŞMAZ.**
 *   (OBD = bugün fiilen kurala giren tek karar kaynağı.)
 *
 * `runtimeConfig.ts`teki GERÇEK sayılarla (uydurma yok) — taban 1000 ms,
 * kritiklik NORMAL, mod çarpanı `MODE_MULTIPLIER`:
 *
 *   | Mod         | Guardian | GPS   | OBD    | Guardian ≤ OBD? |
 *   |-------------|----------|-------|--------|-----------------|
 *   | PERFORMANCE | 1000 ×1  |   500 |   1000 | ✅ (eşit)       |
 *   | BALANCED    | 1000 ×1  |  1000 |   3000 | ✅              |
 *   | BASIC_JS    | 2000 ×2  |  2000 |   5000 | ✅              |
 *   | POWER_SAVE  | 3000 ×3  |  8000 |  15000 | ✅              |
 *   | SAFE_MODE   | 4000 ×4  |  5000 |  10000 | ✅              |
 *
 * Sonuç: Guardian zincirin EN YAVAŞ HALKASI hiçbir modda DEĞİLDİR. Uçtan uca
 * en kötü tespit gecikmesi = `obdPollingMs + guardianPeriodMs` (BASIC_JS'te
 * 5000+2000 = **7 s**). Soğutucu aşırı ısınması ve akü düşüşü dakika ölçeğinde
 * olgulardır; 7 s bütçe içindedir. Bu sayı LAB'da AÇIKÇA gösterilir — gizlenmez.
 *
 * Wheel çözünürlüğü 333 ms olduğu için 1000 ms tam 3 tike oturur (yuvarlama
 * kaybı YOK).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 3) KRİTİKLİK — neden SAFETY değil NORMAL?
 * ══════════════════════════════════════════════════════════════════════════
 * `SAFETY` kritikliği periyodu HER tier'da SABİTLER. Guardian'da bu, en zayıf
 * cihazda saf ZARAR olurdu: BASIC_JS'te OBD 5000 ms'de bir tazelenirken
 * Guardian 1000 ms'de koşar → 5 koşumun 4'ü **birebir aynı girdiyle aynı
 * çıktıyı** üretir. Gecikme kazancı SIFIR, maliyet gerçek.
 *
 * CLAUDE.md'nin "güvenlik-kritik katmanlar HER tier'da garanti AÇIK" kuralı
 * burada **ihlal edilmez, doğru okunur**: Guardian hiçbir tier'da KAPANMAZ,
 * hiçbir tier'da `deferIdle`a atılmaz, hiçbir tier'da atlanmaz — yalnız
 * GEREKSİZ tekrar hesaplama kaldırılır. Kapatmak ile gereksiz tekrarı
 * kaldırmak aynı şey değildir.
 *
 * Bu karar, veri kaynağı hızlanırsa (ör. CAN canlı akışı) YENİDEN
 * DEĞERLENDİRİLİR — sözleşme yukarıdaki tabloya bağlıdır, sayıya değil.
 *
 * `deferIdle` NEDEN KAPALI: `requestIdleCallback` yük altında görevi
 * BELİRSİZ süre erteleyebilir. Bir risk katmanının kadansı belirsiz olamaz.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 4) TIER BÜTÇESİ — tek bütçe mi, tier başına mı?
 * ══════════════════════════════════════════════════════════════════════════
 * **TEK bütçe.** Tier'a göre değişen şey PERİYOTtur (mod çarpanı), koşum
 * BAŞINA izin verilen süre değil. Tier başına ayrı bir bütçe tablosu
 * `MODE_MULTIPLIER` ile yarışan İKİNCİ bir otorite olurdu.
 *
 * Bütçe = **8 ms / koşum** — `#494`ün istediği 16 ms'in yarısı. Neden yarısı:
 * 16 ms 60 fps kare bütçesinin TAMAMIdır; tek bir arka plan görevinin bir
 * karenin tamamını yemesi kabul edilemez. 8 ms, düşük-uç hedefimizin (20 fps
 * → 50 ms kare) **%16**'sıdır.
 *
 * Bütçe aşılırsa: SAYILIR ve LAB'da görünür — katman **KAPATILMAZ**. Bir
 * güvenlik katmanının kendi kendini sessizce öldürmesi, yavaş çalışmasından
 * daha tehlikelidir. Karar insanındır; bu dosya yalnız kanıtı üretir.
 */

import { RuntimeMode } from '../../../../core/runtime/runtimeTypes';
import { RUNTIME_CONFIGS } from '../../../../core/runtime/runtimeConfig';

/* ── Kimlik ──────────────────────────────────────────────────────────────── */

/** Wheel üstündeki görev kimliği — çift kayıt öncekini DEĞİŞTİRİR (idempotent). */
export const GUARDIAN_TASK_ID = 'guardian-ai';

/** Politika sürümü — LAB'da gösterilir; eşik/kadans değişince ARTIRILIR. */
export const GUARDIAN_TICK_POLICY_VERSION = 'G16.1';

/* ── Kadans ──────────────────────────────────────────────────────────────── */

/**
 * Taban periyot (ms). BALANCED/PERFORMANCE'ta (mod çarpanı=1) AYNEN uygulanır.
 * Wheel çözünürlüğü 333 ms → tam 3 tik (yuvarlama kaybı yok).
 * Gerekçe: bkz. dosya başlığı §2 tablosu.
 */
export const GUARDIAN_BASE_PERIOD_MS = 1000;

/** Kritiklik — bkz. §3. NORMAL: hiçbir tier'da kapanmaz, yalnız yavaşlar. */
export const GUARDIAN_TASK_CRITICALITY = 'NORMAL' as const;

/** `requestIdleCallback`e ÖTELENMEZ — risk katmanının kadansı belirsiz olamaz. */
export const GUARDIAN_DEFER_IDLE = false;

/* ── Bütçe ───────────────────────────────────────────────────────────────── */

/**
 * Koşum başına bütçe (ms) — TEK bütçe, tier'a göre değişmez (bkz. §4).
 * `#494` kabul ölçütü 16 ms; biz yarısını hedefliyoruz.
 */
export const GUARDIAN_TICK_BUDGET_MS = 8;

/** `#494`ün kütükteki mutlak tavanı (ms) — bunu aşmak KABUL ÖLÇÜTÜNÜ DÜŞÜRÜR. */
export const GUARDIAN_TICK_HARD_LIMIT_MS = 16;

/** Süre dağılımı için tutulan örnek sayısı (bounded — sınırsız defter YOK). */
export const GUARDIAN_DURATION_SAMPLE_SIZE = 64;

/* ── Mod çarpanı (AdaptiveRuntimeManager ile PARİTE) ──────────────────────── */

/**
 * `AdaptiveRuntimeManager.MODE_MULTIPLIER`ın SALT-OKUNUR aynası.
 *
 * ⚠️ Bu bir İKİNCİ OTORİTE DEĞİLDİR: gerçek zamanlama kararını her zaman
 * manager verir. Bu tablo yalnız **gözlem/ölçüm** içindir (LAB "etkin periyot"
 * alanı ve bütçe testleri). Manager'ın tablosu değişirse parite testi DÜŞER —
 * sessizce ayrışamaz.
 */
const MODE_MULTIPLIER_MIRROR: Readonly<Record<RuntimeMode, number>> = Object.freeze({
  [RuntimeMode.PERFORMANCE]: 1,
  [RuntimeMode.BALANCED]:    1,
  [RuntimeMode.BASIC_JS]:    2,
  [RuntimeMode.POWER_SAVE]:  3,
  [RuntimeMode.SAFE_MODE]:   4,
});

/** Wheel çözünürlüğü (`AdaptiveRuntimeManager.MASTER_TICK_MS`) aynası. */
const MASTER_TICK_MS_MIRROR = 333;

/* ── Türetmeler (saf) ────────────────────────────────────────────────────── */

/**
 * Bir moddaki ETKİN Guardian periyodu (ms) — manager'ın uygulayacağı değer.
 * Wheel en yakın tike yuvarladığı için sonuç tam katıdır (min 1 tik).
 */
export function guardianEffectivePeriodMs(mode: RuntimeMode): number {
  const multiplier = MODE_MULTIPLIER_MIRROR[mode] ?? 1;
  const ticks = Math.max(1, Math.round((GUARDIAN_BASE_PERIOD_MS * multiplier) / MASTER_TICK_MS_MIRROR));
  return ticks * MASTER_TICK_MS_MIRROR;
}

/**
 * Uçtan uca EN KÖTÜ tespit gecikmesi (ms) = OBD anket periyodu + Guardian
 * periyodu. Sensörün kendi tazelenme süresi Guardian'ın kontrolünde DEĞİLDİR;
 * bu sayı ikisini birlikte, dürüstçe gösterir.
 */
export function guardianWorstCaseDetectionLatencyMs(mode: RuntimeMode): number {
  const obdMs = RUNTIME_CONFIGS[mode]?.obdPollingMs ?? 0;
  return obdMs + guardianEffectivePeriodMs(mode);
}

/**
 * §2 sözleşmesi: Guardian aynı modda OBD'den YAVAŞ olmamalı.
 * `false` dönerse kadans kararı BOZULMUŞ demektir (test bunu kilitler).
 */
export function guardianKeepsUpWithObd(mode: RuntimeMode): boolean {
  const obdMs = RUNTIME_CONFIGS[mode]?.obdPollingMs;
  if (typeof obdMs !== 'number' || !Number.isFinite(obdMs)) return false;
  return guardianEffectivePeriodMs(mode) <= obdMs;
}

/** Ölçülen süre bütçeyi aştı mı (yalnız sınıflandırma — eylem üretmez). */
export function isGuardianTickOverBudget(durationMs: number): boolean {
  return Number.isFinite(durationMs) && durationMs > GUARDIAN_TICK_BUDGET_MS;
}
