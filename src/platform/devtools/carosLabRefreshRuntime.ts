/**
 * carosLabRefreshRuntime — "TÜMÜNÜ YENİLE" turunu KOŞTURAN tek otorite.
 *
 * Neden ayrı dosya: saf model (`carosLabRefreshModel`) `Date.now`, global durum
 * ve zamanlayıcı BARINDIRAMAZ; okuma katmanı (`carosLabRefreshSources`) da
 * durum tutmaz. Tur durumu · sıralama · süre aşımı · abone bildirimi BURADADIR.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · TEK TUR AYNI ANDA: yeniden giriş engellenir (otomatik tetik ile elle tetik
 *    üst üste binmez). Devam eden tur varsa yeni istek o turu döndürür.
 *  · SIRALI koşum: native eklenti çağrıları AYNI ANDA basılmaz (K24/Mali-400
 *    gerçeği). Sıra `CAROS_LAB_REFRESH_SECTIONS` sırasıdır.
 *  · SÜRE AŞIMI: asılı kalan bir native çağrı turu kilitleyemez — bölüm
 *    `TIMEOUT` olarak işaretlenir ve tur DEVAM eder. Sessiz atlama YOKTUR.
 *  · Bu modül HİÇBİR timer KURMAZ (süre aşımı hariç, o da tur içinde temizlenir).
 *    Periyodik tetik SAHİBİ ekrandır (LAB kapanınca temizlenir → zero-leak).
 *  · SALT-OKUNUR: bağlantı kurmaz, komut göndermez — bkz. `carosLabRefreshSources`.
 */

import { getDeviceTier } from '../deviceCapabilities';
import { probeRefreshSection } from './carosLabRefreshSources';
import {
  CAROS_LAB_REFRESH_SECTIONS, initialRefreshRun, pickAutoRefreshIntervalMs,
  type CarosLabRefreshProbe, type CarosLabRefreshResult, type CarosLabRefreshRun,
  type CarosLabRefreshTrigger, type RefreshDeviceTier,
} from './carosLabRefreshModel';
import { ceilingFor, type WorkloadCeiling } from '../perf/workloadCeilings';
import { bumpPerf, getPerfCounters } from '../perf/perfCounters';

/** Bölüm başına üst sınır. Aşılırsa bölüm `TIMEOUT` olur, tur devam eder. */
export const CAROS_LAB_REFRESH_TIMEOUT_MS = 6_000;

let _run: CarosLabRefreshRun = initialRefreshRun();
let _inFlight: Promise<CarosLabRefreshRun> | null = null;

type Listener = (run: CarosLabRefreshRun) => void;
const _listeners = new Set<Listener>();

function _emit(): void {
  for (const l of [..._listeners]) {
    try { l(_run); } catch { /* fail-soft: bir abone patlarsa diğerleri bildirilir */ }
  }
}

/** Anlık tur durumu (salt-okunur kopya referansı — nesne değiştirilmez). */
export function getCarosLabRefreshRun(): CarosLabRefreshRun {
  return _run;
}

/** Abone ol; dönen fonksiyon aboneliği KALDIRIR (zero-leak sözleşmesi). */
export function subscribeCarosLabRefresh(fn: Listener): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

/** Otomatik yenileme aralığı — cihaz sınıfına abone (bütçe kuralı). */
export function getCarosLabAutoRefreshMs(): number {
  let tier: RefreshDeviceTier = 'low';
  try {
    const t = getDeviceTier();
    tier = t === 'high' || t === 'mid' ? t : 'low';
  } catch { /* fail-soft: bilinmiyorsa EN YAVAŞ aralık (bütçe lehine) */ }
  return pickAutoRefreshIntervalMs(tier);
}

/* ══════════════════════════════════════════════════════════════════════════
   ARCH-06/F7 — LAB ÖRNEKLEMESİ BASKI TAVANINA BAĞLI
   ══════════════════════════════════════════════════════════════════════════
   Aralık ZATEN cihaz sınıfına aboneydi (`getCarosLabAutoRefreshMs`), ama bu
   MOUNT ANINDA bir kez seçiliyordu: cihaz 65 °C'ye çıktığında LAB dokuz
   bölümü aynı hızda yoklamaya devam ediyordu.

   ÇÖZÜM — yeni zamanlayıcı YOK: mevcut tik korunur, tavana göre **adım
   atlanır**. Bu deterministik, saf ve test edilebilir bir karardır.

   ⚠️ **ELLE YENİLE TAVANDAN ETKİLENMEZ.** Kullanıcı düğmeye bastığında iş
   yapılır — baskı, kullanıcının bilinçli niyetini kısmaz. Kısılan yalnız
   kullanıcının İSTEMEDİĞİ otomatik turdur. */

/** Kaç tikte bir otomatik tur koşulacağı. `null` = otomatik tur YOK. */
export function labSamplingStride(ceiling: WorkloadCeiling): number | null {
  if (ceiling === 'OFF') return null;
  if (ceiling === 'MINIMAL') return 4;
  if (ceiling === 'REDUCED') return 2;
  return 1;
}

/**
 * Otomatik tur adımı — tavan izin veriyorsa turu koşar.
 *
 * Bileşen bunu SABİT aralıkla çağırır; kısıtlama burada, tek yerde ve
 * ölçülebilir biçimde uygulanır.
 */
/* Adım sırası — bir SAYAÇ değil, modulo için konum göstergesidir.
   Ölçüm sayaçları `perfCounters`ta TEK yerde tutulur (çift kaynak yasağı). */
let _tickIndex = 0;

export function stepCarosLabAutoRefresh(): boolean {
  _tickIndex += 1;
  let stride: number | null;
  try {
    stride = labSamplingStride(ceilingFor('labSampling'));
  } catch {
    stride = 1;   // fail-soft: tavan okunamazsa LAB çalışmaya DEVAM eder
  }
  if (stride === null || _tickIndex % stride !== 0) {
    bumpPerf('lab.autoRefreshSkipped');
    return false;
  }
  bumpPerf('lab.autoRefreshRan');
  void runCarosLabRefreshAll('auto');
  return true;
}

/**
 * LAB KAPALI DAVRANIŞI — sözleşme (ARCH-06/F7, kilit testiyle korunur).
 *
 * "Gözlemlenemeyen özellik tamamlanmış değildir" kuralının bedeli, LAB'ın
 * ürünü YAVAŞLATMASI olamaz. LAB kapalıyken maliyeti **sıfır** olmalıdır.
 */
export const LAB_CLOSED_BEHAVIOR = Object.freeze({
  /** LAB kapalıyken otomatik tur zamanlayıcısı YOK (unmount → cleanup). */
  autoRefreshTimer: 'STOPPED' as const,
  /** LAB kapalıyken tur durumuna abonelik YOK. */
  subscriptions: 'DETACHED' as const,
  /** LAB kapalıyken hiçbir kanıt yoklaması ÇAĞRILMAZ. */
  probes: 'NOT_INVOKED' as const,
  /** Uygulama arka plandayken de durur (`visibilitychange`). */
  backgrounded: 'STOPPED' as const,
  /** LAB'ın açık/kapalı olması ÜRETİM davranışını DEĞİŞTİRMEZ. */
  productionEffect: 'NONE' as const,
  rationale: 'LAB salt-okunur gözlem yüzeyidir; açıkken bile yalnız MEVCUT '
    + 'okuma çağrılarını tetikler, kapalıyken hiçbir maliyeti yoktur.',
});

/**
 * Otomatik tur kanıtı — salt-okunur, hiçbir sayacı sıfırlamaz.
 *
 * ⚠️ Sayılar `perfCounters`tan TÜRETİLİR; bu modül kendi ölçüm sayacını
 * TUTMAZ. Aynı olgu için iki sayaç tutmak, ikisinin ayrışması demektir.
 */
export function getLabSamplingEvidence(): {
  readonly ticks: number; readonly ran: number; readonly skipped: number;
  readonly ceiling: WorkloadCeiling | null; readonly stride: number | null;
} {
  let ceiling: WorkloadCeiling | null = null;
  try { ceiling = ceilingFor('labSampling'); } catch { /* fail-soft */ }
  const c = getPerfCounters();
  const ran = c['lab.autoRefreshRan'];
  const skipped = c['lab.autoRefreshSkipped'];
  return Object.freeze({
    ticks: ran + skipped, ran, skipped,
    ceiling,
    stride: ceiling === null ? null : labSamplingStride(ceiling),
  });
}

/**
 * Söz süre aşımına uğrarsa `TIMEOUT` probu döndürür. Zamanlayıcı HER YOLDA
 * temizlenir (sözün geç dönmesi artık kimseyi uyandırmaz).
 */
function _withTimeout(
  p: Promise<CarosLabRefreshProbe>, ms: number,
): Promise<CarosLabRefreshProbe | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);                       // null = süre aşımı
    }, ms);
    p.then(
      (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } },
      (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const msg = e instanceof Error ? e.message : String(e);
        resolve({ status: 'FAILED', detail: `Okuma hata verdi: ${msg.slice(0, 120)}` });
      },
    );
  });
}

function _patch(id: string, next: Partial<CarosLabRefreshResult>): void {
  _run = {
    ..._run,
    results: _run.results.map((r) => (r.id === id ? { ...r, ...next } : r)),
  };
}

/**
 * Tüm bölümleri SIRAYLA tazeler. Aynı anda ikinci tur BAŞLAMAZ.
 *
 * Not: bu fonksiyon HİÇBİR koşulda reject ETMEZ — her bölüm kendi sonucunu
 * taşır, tur her zaman tamamlanır.
 */
export function runCarosLabRefreshAll(
  trigger: CarosLabRefreshTrigger,
): Promise<CarosLabRefreshRun> {
  if (_inFlight) return _inFlight;

  const startedAtMs = Date.now();
  _run = {
    ..._run,
    running: true,
    trigger,
    startedAtMs,
    finishedAtMs: null,
    results: _run.results.map((r) => ({ ...r, status: 'RUNNING' as const })),
  };
  _emit();

  _inFlight = (async () => {
    for (const section of CAROS_LAB_REFRESH_SECTIONS) {
      const t0 = Date.now();
      const probe = await _withTimeout(
        Promise.resolve().then(() => probeRefreshSection(section.id)),
        CAROS_LAB_REFRESH_TIMEOUT_MS,
      );
      const t1 = Date.now();

      if (probe === null) {
        _patch(section.id, {
          status: 'TIMEOUT',
          detail: `Süre aşımı (${CAROS_LAB_REFRESH_TIMEOUT_MS / 1000} sn) — yanıt gelmedi.`,
          attemptedAtMs: t1,
          durationMs: t1 - t0,
        });
      } else {
        const prev = _run.results.find((r) => r.id === section.id);
        _patch(section.id, {
          status: probe.status,
          detail: probe.detail,
          attemptedAtMs: t1,
          durationMs: t1 - t0,
          // Yalnız GERÇEKTEN tazelenen bölümün "son başarı" damgası ilerler.
          okAtMs: probe.status === 'REFRESHED' ? t1 : (prev?.okAtMs ?? null),
        });
      }
      _emit();
    }

    _run = { ..._run, running: false, finishedAtMs: Date.now(), cycle: _run.cycle + 1 };
    _emit();
    return _run;
  })().finally(() => { _inFlight = null; });

  return _inFlight;
}

/** @internal testler için — modül durumunu sıfırlar. */
export function _resetCarosLabRefreshForTest(): void {
  _tickIndex = 0;   // ölçüm sayaçları perfCounters'ın kendi sıfırlamasına ait
  _run = initialRefreshRun();
  _inFlight = null;
  _listeners.clear();
}
