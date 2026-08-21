/**
 * backgroundPowerLabSources — Arka Plan Gücü ekranının TEK OKUMA KATMANI (senkron).
 *
 * NEDEN VAR (kütük #667 açık borcu): arka plan güç politikası sahada ölçülen
 * 612 mAh/h sızıntıyı kapatmak için yazıldı ama **gözlem yüzeyi yoktu** — yani
 * "kapı çalışıyor mu, kısma gerçekten uygulandı mı" sorusunun cihazda yanıtı yoktu.
 * Gözlemlenemeyen özellik tamamlanmış sayılmaz (CLAUDE.md).
 *
 * ⚠️ İKİNCİ MOTOR KURULMAZ: burada poll, timer, abonelik YOKTUR ve
 * `reevaluateBackgroundPower()` **ÇAĞRILMAZ** — ekran gözlemler, karar tetiklemez.
 * Okuma tamamen mevcut senkron getter'lardan yapılır.
 *
 * ⚠️ KARARIN YANINDA GERÇEK DE OKUNUR: kapının verdiği karar (`lastApplied`) ile
 * donanım servislerinin GERÇEK durumu (`getGpsPowerMode`, `isWakeWordPowerPaused`)
 * AYRI AYRI okunur. Bu depoda defalarca yaşanan kusur tam buydu: karar üretiliyor
 * ama uygulanmıyordu. İki taraf birleştirilmez — çeliştiklerinde ikisi de gösterilir.
 */
import {
  getBackgroundPowerSnapshot,
  type BackgroundPowerSnapshot,
} from '../power/backgroundPowerGate';
import { BACKGROUND_GPS_INTERVAL_MS } from '../power/backgroundPowerModel';
import { getGpsPowerMode } from '../gpsService';
import { isWakeWordPowerPaused, getWakeWordState } from '../wakeWordService';
import { getNavGpsPowerLastSent } from '../navigation/navGpsPowerBridge';

export interface BackgroundPowerRawSnapshot {
  readonly readAt: number;
  /** Kapının kendi görüntüsü. `null` = okunamadı (kapı hiç kurulmamış olabilir). */
  readonly gate: BackgroundPowerSnapshot | null;
  /** `gpsService`'in GERÇEK güç modu — kararın uygulandığının kanıtı. */
  readonly gpsModeActual: 'high' | 'low' | null;
  /** `wakeWordService` native dinlemeyi güç nedeniyle askıya aldı mı. */
  readonly micPausedActual: boolean | null;
  /** Wake ayarı açık mı (kullanıcı ayarı — kapı bunu DEĞİŞTİRMEZ). */
  readonly wakeEnabled: boolean | null;
  /** Navigasyon köprüsünün NATIVE tarafa gönderdiği son değer. */
  readonly navPowerLastSent: boolean | null;
  /** Kısık moddaki konum aralığı (ms) — sabit, gösterim için. */
  readonly lowIntervalMs: number;
  /** Okuma sırasında hata olduysa ham mesaj — sessizce yutulmaz. */
  readonly error: string | null;
}

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

/**
 * Tek seferlik senkron okuma. Her getter kendi try/catch'inde: biri patlarsa
 * diğerleri okunmaya devam eder (ekran boş kalmaz, eksik alan KAYNAK YOK olur).
 */
export function readBackgroundPowerSnapshot(): BackgroundPowerRawSnapshot {
  const readAt = Date.now();
  let error: string | null = null;

  const gate = safe(() => getBackgroundPowerSnapshot());
  if (gate === null) error = 'backgroundPowerGate okunamadı';

  return {
    readAt,
    gate,
    gpsModeActual:    safe(() => getGpsPowerMode()),
    micPausedActual:  safe(() => isWakeWordPowerPaused()),
    wakeEnabled:      safe(() => getWakeWordState().enabled === true),
    navPowerLastSent: safe(() => getNavGpsPowerLastSent()),
    lowIntervalMs:    BACKGROUND_GPS_INTERVAL_MS,
    error,
  };
}
