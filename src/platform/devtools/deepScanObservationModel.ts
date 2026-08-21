/**
 * deepScanObservationModel — CAROS LAB · Derin Tarama SAF modeli.
 *
 * SAFLIK SÖZLEŞMESİ: I/O YOK · timer YOK · `Date.now()` YOK · global durum YOK ·
 * React importu YOK. Girdi YAPISALDIR (servis importu yok → mock'suz test).
 *
 * ── BU EKRANIN CEVAPLADIĞI SORU ─────────────────────────────────────────────
 * "Derin tarama neden başlamıyor / hangi akış sorumlu?" Katalogda bu araç
 * PLACEHOLDER'dı çünkü İKİ AYRI AKIŞ var ve hangisinin otorite olduğu hiçbir
 * yerde görünmüyordu. Model bunu ilk kez açıkça söyler.
 *
 * ── DÜRÜSTLÜK ───────────────────────────────────────────────────────────────
 *  · Kontak kaynağı fail-closed'dır: `null` "kapalı" DEĞİL "BİLİNMİYOR"dur.
 *  · `progressPercent` yalnız tarama gerçekten yürürken anlamlıdır; `idle`
 *    durumda 0 bir İLERLEME DEĞİL, "hiç başlamadı"dır.
 *  · Damgası olmayan (`0`) alan yaş ÜRETMEZ.
 *  · Okunamayan akış `UNAVAILABLE`; "boşta" ile KARIŞTIRILMAZ.
 */

import {
  observed, derived, unavailable, formatAge,
  type InspectorField,
} from './sessionInspectorModel';
import type { DeepScanRuntimeShape } from './deepScanObservationSources';

const SRC_RUNTIME = 'deepScan/deepScanRuntimeService.getSnapshot';
const SRC_WIRING  = 'system/platformCoreDeepScanWiring.getDeepScanWiringStatus';
const SRC_OFFLINE = 'system/platformCoreDeepScanWiring.getDeepScanOfflinePassStatus';

/* ── Otorite: iki akıştan hangisi sorumlu ────────────────────────────────── */

export type DeepScanAuthority =
  /** Wiring kurulu ve tarama runtime'ı sürüyor → asıl akış çalışıyor. */
  | 'RUNTIME_ACTIVE'
  /** Wiring kurulu ama tarama boşta — tetik bekleniyor. */
  | 'WIRING_IDLE'
  /** Wiring HİÇ kurulmamış → bu cihazda derin tarama tetiklenemez. */
  | 'NOT_WIRED'
  /** Okunamadı. */
  | 'UNAVAILABLE';

export const DEEP_SCAN_AUTHORITY_LABEL: Readonly<Record<DeepScanAuthority, string>> = {
  RUNTIME_ACTIVE: 'TARAMA YÜRÜYOR (runtime akışı)',
  WIRING_IDLE:    'KABLO KURULU — tetik bekleniyor',
  NOT_WIRED:      'KABLO YOK — bu cihazda tetiklenemez',
  UNAVAILABLE:    'OKUNAMADI',
} as const;

/** `status` değerlerinden hangileri "yürüyor" sayılır. */
const ACTIVE_STATUSES: readonly string[] = [
  'preparing', 'running', 'scanning', 'waiting_for_ignition', 'resuming',
];

export function isActiveScanStatus(status: string | null | undefined): boolean {
  return typeof status === 'string' && ACTIVE_STATUSES.includes(status);
}

export function resolveDeepScanAuthority(input: {
  readonly runtimeStatus: string | null;
  readonly wiringPresent: boolean | null;
}): DeepScanAuthority {
  if (input.wiringPresent === null && input.runtimeStatus === null) return 'UNAVAILABLE';
  if (input.wiringPresent !== true) return 'NOT_WIRED';
  return isActiveScanStatus(input.runtimeStatus) ? 'RUNTIME_ACTIVE' : 'WIRING_IDLE';
}

export type DeepScanTone = 'ok' | 'muted' | 'warn' | 'bad';

export function deepScanAuthorityTone(a: DeepScanAuthority): DeepScanTone {
  switch (a) {
    case 'RUNTIME_ACTIVE': return 'ok';
    case 'WIRING_IDLE':    return 'muted';
    case 'NOT_WIRED':      return 'warn';
    case 'UNAVAILABLE':    return 'muted';
  }
}

/* ── Alanlar ─────────────────────────────────────────────────────────────── */

export interface DeepScanFieldsInput {
  readonly runtime: DeepScanRuntimeShape | null;
  readonly wiring: {
    readonly present: boolean;
    readonly started: boolean;
    readonly runtimeState: string;
    readonly scanState: string;
    readonly ignitionConfirmed: boolean | null;
    readonly progressPercent: number;
    readonly warningCount: number;
    readonly lastErrorCode: string | null;
    readonly lastTransitionAt: number | null;
  } | null;
  readonly offlinePass: {
    readonly present: boolean;
    readonly started: boolean;
    readonly running: boolean;
    readonly active: boolean;
    readonly cancelled: boolean;
    readonly triggerCount: number;
    readonly lastRun: number | null;
    readonly lastDuration: number | null;
    readonly lastResult: string | null;
    readonly lastReason: string | null;
  } | null;
  readonly nowMs: number;
}

/** Akış 1 — tarama runtime durumu. */
export function buildRuntimeFields(i: DeepScanFieldsInput): readonly InspectorField[] {
  const r = i.runtime;
  if (r === null) {
    return [unavailable({
      id: 'ds-runtime', label: 'Tarama runtime', source: SRC_RUNTIME, note: '',
    }, 'Okuma hata verdi — "boşta" ile KARIŞTIRILMAZ.')];
  }

  const active = isActiveScanStatus(r.status);
  const out: InspectorField[] = [
    observed({
      id: 'ds-status', label: 'Durum', source: SRC_RUNTIME,
      note: 'Runtime durum makinesinin anlık hâli.',
      updatedAt: r.updatedAtMs,
    }, r.status),
    r.mode === null
      ? unavailable({ id: 'ds-mode', label: 'Mod', source: SRC_RUNTIME, note: '' },
          'Henüz mod seçilmedi (tarama başlamadı).')
      : observed({
          id: 'ds-mode', label: 'Mod', source: SRC_RUNTIME,
          note: 'İlk tarama TAM, sonrakiler DEĞİŞİM kontrolü (her bağlantıda tam tarama yapılmaz).',
        }, r.mode),
    r.phase === null
      ? unavailable({ id: 'ds-phase', label: 'Faz', source: SRC_RUNTIME, note: '' },
          'Aktif faz yok.')
      : observed({
          id: 'ds-phase', label: 'Faz', source: SRC_RUNTIME,
          note: 'Çok fazlı taramanın bulunduğu adım.',
        }, r.phase),
  ];

  /* İLERLEME YALNIZ YÜRÜRKEN ANLAMLIDIR: `idle` durumda %0 bir ilerleme
     ölçümü değil, "hiç başlamadı"dır — ikisini aynı göstermek yanıltır. */
  out.push(active
    ? observed({
        id: 'ds-progress', label: 'İlerleme', source: SRC_RUNTIME,
        note: 'Monotonik: geriye gitmez.', updatedAt: r.updatedAtMs,
      }, `%${Math.round(r.progressPercent)}`)
    : unavailable({ id: 'ds-progress', label: 'İlerleme', source: SRC_RUNTIME, note: '' },
        'Tarama yürümüyor — %0 bir İLERLEME DEĞİL, "hiç başlamadı" demektir.'));

  out.push(r.ignitionConfirmed === null
    ? unavailable({ id: 'ds-ignition', label: 'Kontak', source: SRC_RUNTIME, note: '' },
        'Otoriter kontak kaynağı YOK → fail-closed BİLİNMİYOR ("kapalı" DEĞİL). Aktif fazlar kontak ister.')
    : observed({
        id: 'ds-ignition', label: 'Kontak', source: SRC_RUNTIME,
        note: r.ignitionRequired
          ? 'Aktif fazlar için kontak ZORUNLUDUR.'
          : 'Bu faz kontak gerektirmiyor.',
      }, r.ignitionConfirmed ? 'ONAYLI' : 'ONAYLANMADI'));

  out.push(observed({
    id: 'ds-found', label: 'Bulunan', source: SRC_RUNTIME,
    note: 'Yalnız ADET — ham ECU/PID/DID listesi bu ekrana GELMEZ.',
  }, `${r.ecuCount} ECU · ${r.pidCount} PID · ${r.didCount} DID`));

  out.push(observed({
    id: 'ds-new', label: 'Yeni keşif', source: SRC_RUNTIME,
    note: 'Önceki taramada olmayan anahtar sayısı.',
  }, r.newDiscoveryCount));

  out.push(observed({
    id: 'ds-changed', label: 'Değişim', source: SRC_RUNTIME,
    note: 'Firmware veya ECU kümesi değiştiyse araç değişmiş olabilir.',
  }, `firmware ${r.changedFirmware ? 'DEĞİŞTİ' : 'aynı'} · ECU ${r.changedEcu ? 'DEĞİŞTİ' : 'aynı'}`));

  out.push(r.startedAtMs === null
    ? unavailable({ id: 'ds-started', label: 'Başlangıç yaşı', source: SRC_RUNTIME, note: '' },
        'Bu oturumda hiç tarama başlamadı — damga YOK.')
    : derived({
        id: 'ds-started', label: 'Başlangıç yaşı', source: SRC_RUNTIME,
        note: 'Damgadan türetildi.', updatedAt: r.startedAtMs,
      }, formatAge(r.startedAtMs, i.nowMs)));

  out.push(r.errorCode === null
    ? observed({
        id: 'ds-error', label: 'Hata', source: SRC_RUNTIME,
        note: 'Kayıtlı hata kodu yok.',
      }, 'yok')
    : observed({
        id: 'ds-error', label: 'Hata', source: SRC_RUNTIME,
        note: 'Yalnız kod — hata MESAJI taşınmaz.',
      }, r.errorCode));

  out.push(observed({
    id: 'ds-warn', label: 'Uyarı', source: SRC_RUNTIME,
    note: 'Yalnız ADET — uyarı metinleri bu ekrana GELMEZ.',
  }, r.warningCount));

  return out;
}

/** Akış 2 — SystemBoot wiring + çevrimdışı geçiş. */
export function buildWiringFields(i: DeepScanFieldsInput): readonly InspectorField[] {
  const out: InspectorField[] = [];
  const w = i.wiring;

  if (w === null) {
    out.push(unavailable({
      id: 'dsw-status', label: 'Wiring', source: SRC_WIRING, note: '',
    }, 'Okunamadı.'));
  } else {
    out.push(observed({
      id: 'dsw-status', label: 'Wiring', source: SRC_WIRING,
      note: w.present
        ? 'Kablo kurulu — tetik bu akıştan gelir (ignition-tetikli, fail-closed).'
        : 'Kablo YOK → derin tarama bu cihazda TETİKLENEMEZ (ekran bunu gizlemez).',
      updatedAt: w.lastTransitionAt,
    }, `${w.present ? 'KURULU' : 'YOK'} · ${w.started ? 'başlatıldı' : 'başlatılmadı'}`));

    out.push(observed({
      id: 'dsw-state', label: 'Durum eşleşmesi', source: SRC_WIRING,
      note: 'İki akışın durumu AYRIŞIRSA teşhis buradan başlar.',
    }, `runtime=${w.runtimeState} · orchestrator=${w.scanState}`));

    out.push(w.lastErrorCode === null
      ? observed({ id: 'dsw-error', label: 'Wiring hatası', source: SRC_WIRING,
          note: 'Kurulum/temizlik hatası yok.' }, 'yok')
      : observed({ id: 'dsw-error', label: 'Wiring hatası', source: SRC_WIRING,
          note: 'Yalnız kod.' }, w.lastErrorCode));
  }

  const o = i.offlinePass;
  if (o === null) {
    out.push(unavailable({
      id: 'dso-pass', label: 'Çevrimdışı geçiş', source: SRC_OFFLINE, note: '',
    }, 'Okunamadı.'));
  } else {
    out.push(observed({
      id: 'dso-pass', label: 'Çevrimdışı geçiş', source: SRC_OFFLINE,
      note: 'Tetik sayacı DEDUP kanıtıdır: guard çalışıyorsa 1\'i aşmamalıdır.',
    }, `${o.triggerCount} tetik · ${o.running ? 'YÜRÜYOR' : 'durdu'}${o.cancelled ? ' · iptal edildi' : ''}`));

    out.push(o.lastRun === null
      ? unavailable({ id: 'dso-last', label: 'Son geçiş yaşı', source: SRC_OFFLINE, note: '' },
          'Hiç çalışmadı — damga YOK.')
      : derived({
          id: 'dso-last', label: 'Son geçiş yaşı', source: SRC_OFFLINE,
          note: 'Damgadan türetildi.', updatedAt: o.lastRun,
        }, formatAge(o.lastRun, i.nowMs)));

    out.push(o.lastResult === null
      ? unavailable({ id: 'dso-result', label: 'Son sonuç', source: SRC_OFFLINE, note: '' },
          'Sonuç yok.')
      : observed({
          id: 'dso-result', label: 'Son sonuç', source: SRC_OFFLINE,
          note: o.lastReason ? `Engel sebebi: ${o.lastReason}` : 'Engel sebebi bildirilmedi.',
        }, o.lastResult));
  }

  return out;
}
