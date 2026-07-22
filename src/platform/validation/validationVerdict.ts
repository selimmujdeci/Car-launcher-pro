/**
 * validationVerdict — doğrulama testlerinin SAF karar katmanı.
 *
 * Girdi bir `ValidationSnapshot`, çıktı `ValidationSummary`. IO / saat /
 * rastgelelik YOKTUR → deterministik ve doğrudan test edilebilir.
 *
 * ── KARAR SÖZLEŞMESİ ────────────────────────────────────────────────────────
 *  - **Ölçülmedi ≠ başarısız.** Ölçüm yapılamamış (null) her metrik `skip`
 *    üretir; "her şey yolunda" YALANI söylenmez, "düştü" iftirası da atılmaz.
 *  - Eşikler dosya başında SABİT ve gerekçelidir; kod içine gömülü sihirli
 *    sayı yoktur.
 *  - `overall`: bir tane bile `fail` → `fail`; yoksa bir tane `warn` → `warn`;
 *    hiç ölçüm yoksa `skip`; aksi halde `pass` (fail-closed özet).
 */

import { isCanRecoveryApplicable } from '../obdRetryPolicy';
import type {
  ValidationSnapshot,
  ValidationStatus,
  ValidationSummary,
  ValidationTest,
} from './validationTypes';

/**
 * Çoklu ECU taraması bu protokolde UYGULANABİLİR mi? — SAF.
 *
 * `multiEcuScan`/`ecuDiscovery` fonksiyonel `0100` yanıtındaki CAN başlıklarını
 * ayrıştırır → yalnız CAN sınıfı protokollerde (ELM 6/7/8/9/A/B/C) anlamlıdır.
 * Sınıflandırma MEVCUT `isCanRecoveryApplicable` ile AYNI kaynaktan gelir
 * (ikinci bir protokol tablosu tutmamak için); o da bilinmeyen protokolde
 * fail-closed `false` döner.
 */
export function isMultiEcuScanApplicable(protocol: string | null | undefined): boolean {
  return isCanRecoveryApplicable(protocol);
}

/* ── Eşikler (gerekçeli) ───────────────────────────────────────────────────── */

/** OBD-II zorunlu PID kümesi pratikte ≥10 desteklenen PID demektir. */
export const PID_OK_MIN   = 10;
/** Tek bir kopma sahada olağandır; üçü aşan kopma kararsız hattı gösterir. */
export const DISCONNECT_WARN_MAX = 2;
/** Poll aralığı: 1.5s altı akıcı, 3s üstü göstergeyi hissedilir yavaşlatır. */
export const POLL_OK_MS   = 1_500;
export const POLL_WARN_MS = 3_000;
/** ObdHealthMonitor'ün mutlak donma eşiği (STALE_ABS_MS) ile hizalı. */
export const GAP_OK_MS    = 4_000;
export const GAP_WARN_MS  = 8_000;
/** Sürücü algısı: 45+ akıcı, 25 altı takılma. */
export const FPS_OK       = 45;
export const FPS_WARN     = 25;
/** Head unit WebView bütçesi — 350MB üstü OOM/kill riski. */
export const MEM_OK_MB    = 200;
export const MEM_WARN_MB  = 350;
/** Mavi başarı oranı. */
export const MAVI_OK_RATIO   = 0.9;
export const MAVI_WARN_RATIO = 0.6;
/** Mavi tur süresi (araç-içi konuşma bütçesi). */
export const MAVI_OK_MS   = 4_000;
export const MAVI_WARN_MS = 8_000;

/* ── Yardımcılar ───────────────────────────────────────────────────────────── */

function test(id: string, label: string, status: ValidationStatus, detail: string): ValidationTest {
  return { id, label, status, detail };
}

/** Küçük-daha-iyi eşik değerlendirmesi; `null` → `skip`. */
function gradeLower(
  value: number | null,
  okMax: number,
  warnMax: number,
  fmt: (v: number) => string,
  skipDetail: string,
): { status: ValidationStatus; detail: string } {
  if (value === null) return { status: 'skip', detail: skipDetail };
  if (value <= okMax)   return { status: 'pass', detail: fmt(value) };
  if (value <= warnMax) return { status: 'warn', detail: fmt(value) };
  return { status: 'fail', detail: fmt(value) };
}

/** Büyük-daha-iyi eşik değerlendirmesi; `null` → `skip`. */
function gradeHigher(
  value: number | null,
  okMin: number,
  warnMin: number,
  fmt: (v: number) => string,
  skipDetail: string,
): { status: ValidationStatus; detail: string } {
  if (value === null) return { status: 'skip', detail: skipDetail };
  if (value >= okMin)   return { status: 'pass', detail: fmt(value) };
  if (value >= warnMin) return { status: 'warn', detail: fmt(value) };
  return { status: 'fail', detail: fmt(value) };
}

/* ── Test üretimi ──────────────────────────────────────────────────────────── */

/** OBD bölümü testleri — SAF. */
export function evaluateObdTests(snap: ValidationSnapshot): ValidationTest[] {
  const o = snap.obd;
  const out: ValidationTest[] = [];

  /* 1) Bağlantı — süre ölçülmediyse yargı YOK. */
  out.push(
    o.connectDurationMs === null
      ? test('obd_connection', 'OBD bağlantısı', 'skip', 'Bu oturumda bağlantı gözlemlenmedi.')
      : test('obd_connection', 'OBD bağlantısı', 'pass', `${Math.round(o.connectDurationMs)} ms'de kuruldu (${o.transport}).`),
  );

  /* 2) Protokol — zorlanan ile AKTİF uyuşmazlığı araç/adaptör değişimini gösterir. */
  if (!o.protocolActive && !o.protocolTried) {
    out.push(test('obd_protocol', 'Protokol', 'skip', 'Protokol bilgisi okunmadı.'));
  } else if (o.protocolActive) {
    out.push(test('obd_protocol', 'Protokol', 'pass', `Aktif: ${o.protocolActive}${o.protocolTried && o.protocolTried !== o.protocolActive ? ` (denenen: ${o.protocolTried})` : ''}.`));
  } else {
    out.push(test('obd_protocol', 'Protokol', 'warn', `Denendi (${o.protocolTried}) ama aktif protokol doğrulanmadı.`));
  }

  /* 3) VIN — okunamaması sahada olağandır (fail değil, warn). */
  out.push(
    o.vinPresent
      ? test('obd_vin', 'VIN okuma', 'pass', `VIN okundu (${o.vinMasked ?? 'maskeli'}).`)
      : test('obd_vin', 'VIN okuma', 'warn', 'VIN okunamadı — araç Mode 09 desteklemiyor olabilir.'),
  );

  /* 4) ECU keşfi — PROTOKOL FARKINDA.
     `multiEcuScan` `ATH1` + fonksiyonel `0100` ile CAN başlıklarını ayrıştırır
     (ecuDiscovery.ts: "11 = standart CAN ID, 29 = genişletilmiş adresleme") →
     KWP2000/ISO9141/J1850'de YAPISAL olarak sonuç veremez. Saha turunda bu,
     Trafic'te (proto 5) yanlışlıkla "Hiç ECU yanıt vermedi" FAIL'i üretiyordu.
     Protokol bilinmiyorsa da FAIL VERİLMEZ (fail-closed → skip). */
  const ecuScanApplies = isMultiEcuScanApplicable(o.protocolActive ?? o.protocolTried);
  if (!ecuScanApplies) {
    const p = o.protocolActive ?? o.protocolTried;
    out.push(test('obd_ecu', 'ECU keşfi', 'skip',
      p ? `Bu protokolde (${p}) çoklu ECU taraması desteklenmiyor — yargı yok.`
        : 'Protokol bilinmiyor — çoklu ECU taraması yorumlanamaz.'));
  } else {
    out.push(
      o.ecuCount === null
        ? test('obd_ecu', 'ECU keşfi', 'skip', 'Çoklu ECU taraması bu oturumda çalışmadı.')
        : o.ecuCount > 0
          ? test('obd_ecu', 'ECU keşfi', 'pass', `${o.ecuCount} ECU bulundu.`)
          : test('obd_ecu', 'ECU keşfi', 'fail', 'Hiç ECU yanıt vermedi.'),
    );
  }

  /* 5) PID kapsamı. */
  out.push(
    o.pidCount >= PID_OK_MIN
      ? test('obd_pid', 'PID kapsamı', 'pass', `${o.pidCount} PID destekleniyor.`)
      : o.pidCount > 0
        ? test('obd_pid', 'PID kapsamı', 'warn', `Yalnız ${o.pidCount} PID — kapsam dar.`)
        : test('obd_pid', 'PID kapsamı', 'fail', 'Desteklenen PID bulunamadı.'),
  );

  /* 6) DTC okuma — kod BULUNMAMASI başarıdır; okuyamamak belirsizliktir. */
  out.push(
    o.dtcCount === null
      ? test('obd_dtc', 'Arıza kodu okuma', 'skip', 'DTC okuması bu oturumda çalışmadı.')
      : test('obd_dtc', 'Arıza kodu okuma', 'pass', `${o.dtcCount} arıza kodu okundu.`),
  );

  /* 7) Hat kararlılığı. */
  const drops = o.disconnectCount;
  out.push(
    drops === 0
      ? test('obd_stability', 'Bağlantı kararlılığı', 'pass', `Kopma yok (${o.reconnectAttempts} yeniden bağlanma denemesi).`)
      : drops <= DISCONNECT_WARN_MAX
        ? test('obd_stability', 'Bağlantı kararlılığı', 'warn', `${drops} kopma / ${o.reconnectAttempts} deneme.`)
        : test('obd_stability', 'Bağlantı kararlılığı', 'fail', `${drops} kopma — hat kararsız.`),
  );

  return out;
}

/** Performans bölümü testleri — SAF. */
export function evaluatePerfTests(snap: ValidationSnapshot): ValidationTest[] {
  const p = snap.perf;
  const out: ValidationTest[] = [];

  const poll = gradeLower(
    p.avgPollIntervalMs, POLL_OK_MS, POLL_WARN_MS,
    (v) => `Ortalama polling ${Math.round(v)} ms (${p.liveDataSamples} paket).`,
    'Canlı veri akmadı — polling ölçülemedi.',
  );
  out.push(test('perf_poll', 'Polling süresi', poll.status, poll.detail));

  const gap = gradeLower(
    p.maxLatencyMs, GAP_OK_MS, GAP_WARN_MS,
    (v) => `En büyük veri boşluğu ${Math.round(v)} ms.`,
    'Boşluk ölçülemedi (yetersiz paket).',
  );
  out.push(test('perf_gap', 'Maksimum gecikme', gap.status, gap.detail));

  out.push(
    p.timeoutCount === 0
      ? test('perf_timeout', 'Timeout', 'pass', 'Timeout gözlenmedi.')
      : p.timeoutCount <= DISCONNECT_WARN_MAX
        ? test('perf_timeout', 'Timeout', 'warn', `${p.timeoutCount} timeout / ${p.recoveryCount} kurtarma.`)
        : test('perf_timeout', 'Timeout', 'fail', `${p.timeoutCount} timeout — hat sorunlu.`),
  );

  const fps = gradeHigher(
    p.avgFps, FPS_OK, FPS_WARN,
    (v) => `Ortalama ${Math.round(v)} FPS (en düşük ${p.minFps ?? '?'}).`,
    'FPS ölçümü yapılmadı.',
  );
  out.push(test('perf_fps', 'Akıcılık (FPS)', fps.status, fps.detail));

  const mem = gradeLower(
    p.memoryPeakMb, MEM_OK_MB, MEM_WARN_MB,
    (v) => `Tepe bellek ${Math.round(v)} MB.`,
    'Bellek ölçümü bu platformda yok.',
  );
  out.push(test('perf_memory', 'Bellek', mem.status, mem.detail));

  return out;
}

/** Mavi bölümü testleri — SAF. */
export function evaluateMaviTests(snap: ValidationSnapshot): ValidationTest[] {
  const runs = snap.mavi;
  if (runs.length === 0) {
    return [
      test('mavi_success', 'Mavi başarı oranı', 'skip', 'Bu oturumda Mavi çağrısı yapılmadı.'),
      test('mavi_latency', 'Mavi yanıt süresi', 'skip', 'Bu oturumda Mavi çağrısı yapılmadı.'),
    ];
  }

  const okCount = runs.reduce((n, r) => n + (r.ok ? 1 : 0), 0);
  const ratio   = okCount / runs.length;
  const avgMs   = runs.reduce((n, r) => n + r.durationMs, 0) / runs.length;

  const success = gradeHigher(
    ratio, MAVI_OK_RATIO, MAVI_WARN_RATIO,
    (v) => `${okCount}/${runs.length} başarılı (%${Math.round(v * 100)}).`,
    '',
  );
  const latency = gradeLower(
    avgMs, MAVI_OK_MS, MAVI_WARN_MS,
    (v) => `Ortalama ${Math.round(v)} ms.`,
    '',
  );

  return [
    test('mavi_success', 'Mavi başarı oranı', success.status, success.detail),
    test('mavi_latency', 'Mavi yanıt süresi', latency.status, latency.detail),
  ];
}

/**
 * Tüm testleri değerlendirip özet üretir — SAF.
 * `overall` fail-closed: tek bir `fail` bütün raporu düşürür.
 */
export function evaluateValidation(snap: ValidationSnapshot): ValidationSummary {
  const tests = [
    ...evaluateObdTests(snap),
    ...evaluatePerfTests(snap),
    ...evaluateMaviTests(snap),
  ];

  let passed = 0, warned = 0, failed = 0, skipped = 0;
  for (const t of tests) {
    if (t.status === 'pass')      passed++;
    else if (t.status === 'warn') warned++;
    else if (t.status === 'fail') failed++;
    else                          skipped++;
  }

  const overall: ValidationStatus =
    failed > 0 ? 'fail'
    : warned > 0 ? 'warn'
    : passed > 0 ? 'pass'
    : 'skip';                    // hiç ölçüm yok → yargı YOK

  return { tests, passed, warned, failed, skipped, overall };
}
