/**
 * longRoadModel.ts — OTOMATİK UZUN YOL SAHA DOĞRULAMA'nın SAF modeli (P0).
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok · rastgele yok · global durum yok ·
 * React importu YOK. Zaman DAİMA çağırandan parametre gelir → gerçek birim testi mümkün.
 *
 * ── BU DOSYA NE ÜRETİR, NE ÜRETMEZ ──────────────────────────────────────────
 * ÜRETİR: oturum durum makinesi · senaryo algılama · sinyal defteri · sayaç
 *   defteri · snapshot tetik politikası (cooldown + dedupe) · kabul matrisi ·
 *   nihai karar · gizlilik süzgeci · şema göçü · depolama baskısı budaması.
 * ÜRETMEZ: hiçbir komut, bağlantı, izin isteği, ses, popup veya sistem değişikliği.
 * Bu dosya bir GÖZLEM DEFTERİDİR, bir kontrol düzlemi DEĞİLDİR (görev §0).
 *
 * ── PAZARLIKSIZ KURALLAR ────────────────────────────────────────────────────
 *  1. NOT_OBSERVED VARSAYILANDIR. Kanıt yoksa hiçbir madde PASS görünmez.
 *  2. BİLİNMEYEN 0 DEĞİLDİR. Okunamayan sayı `null`; sahte 0 / sahte tarih YASAK.
 *  3. Algılanmayan senaryo FAIL DEĞİLDİR → NOT_OBSERVED (görev §2).
 *  4. Backend yoksa FAIL üretilmez → BLOCKED_BACKEND (görev §7).
 *  5. Eşik KEYFÎ OLAMAZ: her kabul maddesi `thresholdSource` taşır (görev §15).
 *  6. Süre hesapları MONOTON delta ile yapılır (CLAUDE.md §Clock Jump Protection);
 *     duvar saati yalnız DAMGA olarak taşınır.
 *  7. PII yapısal olarak taşınmaz; dışa aktarımda ikinci kez süzülür (görev §12).
 *
 * Gözlemlenebilirlik sınıflandırması `sessionInspectorModel` sözleşmesini KULLANIR
 * (OBSERVED · DERIVED · UNAVAILABLE · STALE) — paralel sistem KURULMAZ.
 */

import type { Observability } from '../devtools/sessionInspectorModel';
import { maskVinStrict } from '../privacy/vinMask';

/* ══════════════════════════════════════════════════════════════════════════
 * 0 · Sabitler / bütçeler (görev §17 — sonsuz birikim YASAK)
 * ════════════════════════════════════════════════════════════════════════ */

export const LR_SCHEMA_VERSION = 1;
export const LR_SESSION_KEY = 'caros.lab.longRoadSession.v1';
export const LR_BLACKBOX_KEY = 'caros.lab.longRoadBlackBox.v1';
export const LR_EXPORT_SCHEMA = 'caros.fieldvalidation.longroad.v1';

/** Gözlemci örnekleme aralığı. dt ÖLÇÜLÜR — bu değer yalnız hedeftir. */
export const LR_SAMPLE_INTERVAL_MS = 1_000;

/** Kayıt sınırları — hepsi sınanır (bkz. longRoadFieldValidation testleri). */
export const LR_MAX_EVENTS = 400;
export const LR_MAX_SNAPSHOTS = 64;
export const LR_MAX_BLACKBOX_EVENTS = 24;
export const LR_MAX_SCENARIO_HITS = 500;
export const LR_MAX_TEXT_CHARS = 200;
export const LR_MAX_SESSION_BYTES = 512 * 1024;
export const LR_MAX_TOTAL_BYTES = 3 * 1024 * 1024;

/** Checkpoint sıklığı — yazma bütçesi (CLAUDE.md §I/O: yüksek frekans YASAK). */
export const LR_CHECKPOINT_INTERVAL_MS = 30_000;

/** Snapshot politikası. */
export const LR_SNAPSHOT_GLOBAL_MIN_GAP_MS = 15_000;
export const LR_SNAPSHOT_PERIODIC_MS = 30 * 60_000;
export const LR_SNAPSHOT_PERIODIC_KM = 100;

/**
 * SNAPSHOT KOTA AYRIMI (D3).
 *
 * NEDEN: tek havuzlu bütçede periyodik snapshot'lar (30 dk / 100 km) uzun yolda
 * `LR_MAX_SNAPSHOTS`i doldurup **kritik anın snapshot'ını reddettiriyordu** —
 * yani en değerli kanıt, en değersiz kanıt yüzünden kaybolabiliyordu.
 * ÇÖZÜM: iki AYRIK kota. Periyodik havuz kritik havuza DOKUNAMAZ; toplamları
 * `LR_MAX_SNAPSHOTS`e eşittir, dolayısıyla genel tavan değişmez.
 */
export const LR_SNAPSHOT_PERIODIC_QUOTA = 24;
export const LR_SNAPSHOT_CRITICAL_QUOTA = LR_MAX_SNAPSHOTS - LR_SNAPSHOT_PERIODIC_QUOTA;

/** Olay eşikleri — kaynağı `thresholdSource` ile raporda GÖSTERİLİR. */
export const LR_GPS_LOSS_SNAPSHOT_MS = 15_000;   // görev §11
export const LR_LONG_IDLE_MS = 5 * 60_000;       // görev §2 "uzun rölanti"
export const LR_BREAK_STOP_MS = 10 * 60_000;     // görev §2 "mola"
export const LR_STOP_GO_WINDOW_MS = 5 * 60_000;
export const LR_STEADY_CRUISE_MS = 5 * 60_000;

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · Oturum durum makinesi (görev §1)
 * ════════════════════════════════════════════════════════════════════════ */

export type SessionState =
  | 'IDLE' | 'STARTING' | 'ACTIVE' | 'RECOVERING'
  | 'PAUSED_BY_SYSTEM' | 'COMPLETED' | 'FAILED' | 'CORRUPT';

export const SESSION_STATE_LABEL: Readonly<Record<SessionState, string>> = {
  IDLE:             'BOŞTA',
  STARTING:         'BAŞLATILIYOR',
  ACTIVE:           'AKTİF',
  RECOVERING:       'TOPARLANIYOR',
  PAUSED_BY_SYSTEM: 'SİSTEM DURDURDU',
  COMPLETED:        'TAMAMLANDI',
  FAILED:           'DÜŞTÜ',
  CORRUPT:          'BOZUK KAYIT',
} as const;

export type SessionAction =
  | 'START' | 'ACTIVATE' | 'RESTORE' | 'SYSTEM_PAUSE'
  | 'RESUME' | 'STOP' | 'FAIL' | 'MARK_CORRUPT';

/**
 * Durum geçişi. GEÇERSİZ geçiş mevcut durumu KORUR (sessiz sıçrama YOK).
 *
 *  IDLE → (START) STARTING → (ACTIVATE) ACTIVE
 *  ACTIVE → (SYSTEM_PAUSE) PAUSED_BY_SYSTEM → (RESUME) ACTIVE
 *  ACTIVE/PAUSED → (RESTORE) RECOVERING → (ACTIVATE) ACTIVE
 *  her durum → (STOP) COMPLETED · (FAIL) FAILED · (MARK_CORRUPT) CORRUPT
 *  COMPLETED/FAILED/CORRUPT bitiştir: yalnız START yeni oturum açar.
 */
export function nextSessionState(current: SessionState, action: SessionAction): SessionState {
  if (action === 'MARK_CORRUPT') return 'CORRUPT';
  if (action === 'START') return current === 'ACTIVE' || current === 'RECOVERING' ? current : 'STARTING';

  const terminal = current === 'COMPLETED' || current === 'FAILED' || current === 'CORRUPT';
  if (terminal) return current;

  if (action === 'FAIL') return 'FAILED';
  if (action === 'STOP') return current === 'IDLE' ? 'IDLE' : 'COMPLETED';
  if (action === 'ACTIVATE') {
    return current === 'STARTING' || current === 'RECOVERING' || current === 'ACTIVE' ? 'ACTIVE' : current;
  }
  if (action === 'RESTORE') {
    return current === 'ACTIVE' || current === 'PAUSED_BY_SYSTEM' || current === 'RECOVERING'
      ? 'RECOVERING' : current;
  }
  if (action === 'SYSTEM_PAUSE') return current === 'ACTIVE' ? 'PAUSED_BY_SYSTEM' : current;
  if (action === 'RESUME') return current === 'PAUSED_BY_SYSTEM' ? 'ACTIVE' : current;
  return current;
}

/** Oturum ölçüm topluyor mu (yalnız bu iki durumda defter işlenir). */
export function isRecordingState(s: SessionState): boolean {
  return s === 'ACTIVE' || s === 'RECOVERING';
}

export type RestoreReason =
  | 'APP_RESTART' | 'PROCESS_DEATH' | 'DEVICE_REBOOT' | 'WEBVIEW_RELOAD' | 'UNKNOWN';

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · Karar matrisi (görev §15)
 * ════════════════════════════════════════════════════════════════════════ */

export type Verdict =
  | 'PASS' | 'FAIL' | 'DEGRADED' | 'NOT_OBSERVED'
  | 'BLOCKED_BACKEND' | 'BLOCKED_HARDWARE' | 'BLOCKED_POLICY' | 'INSUFFICIENT_EVIDENCE';

export const VERDICT_LABEL: Readonly<Record<Verdict, string>> = {
  PASS:                  'GEÇTİ',
  FAIL:                  'DÜŞTÜ',
  DEGRADED:              'ZAYIFLADI',
  NOT_OBSERVED:          'GÖZLENMEDİ',
  BLOCKED_BACKEND:       'BACKEND ENGELLİ',
  BLOCKED_HARDWARE:      'DONANIM ENGELLİ',
  BLOCKED_POLICY:        'POLİTİKA ENGELLİ',
  INSUFFICIENT_EVIDENCE: 'KANIT YETERSİZ',
} as const;

/** PASS sayılan tek değer budur — "engelli" veya "gözlenmedi" BAŞARI DEĞİLDİR. */
export function isPass(v: Verdict): boolean { return v === 'PASS'; }
export function isBlocked(v: Verdict): boolean {
  return v === 'BLOCKED_BACKEND' || v === 'BLOCKED_HARDWARE' || v === 'BLOCKED_POLICY';
}

export type FinalVerdict =
  | 'FIELD_VALIDATION_PASS' | 'FIELD_VALIDATION_PARTIAL'
  | 'FIELD_VALIDATION_FAILED' | 'FIELD_VALIDATION_INSUFFICIENT_EVIDENCE';

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · Senaryo kataloğu (görev §2)
 * ════════════════════════════════════════════════════════════════════════ */

export type ScenarioId =
  | 'FIRST_VEHICLE_LINK' | 'FIRST_HANDSHAKE_OK'
  | 'CITY_STOP_GO' | 'HIGHWAY_STEADY' | 'ACCELERATION' | 'DECELERATION'
  | 'LONG_GRADE_LOAD' | 'LONG_IDLE' | 'BREAK_STOP'
  | 'IGNITION_OR_APP_SHUTDOWN' | 'RESTART' | 'APP_BACKGROUND' | 'APP_FOREGROUND'
  | 'INTERNET_LOST' | 'INTERNET_RESTORED'
  | 'GPS_LOST' | 'GPS_RESTORED' | 'TUNNEL_GNSS_LOSS'
  | 'OBD_DATA_LOST' | 'OBD_RECONNECT' | 'PROTOCOL_REESTABLISH'
  | 'TRIP_CLOSE_AFTER_STOP' | 'TRIP_START'
  | 'THERMAL_PRESSURE' | 'MEMORY_PRESSURE' | 'BATTERY_LOW_OR_CHARGE_CHANGE'
  | 'SOURCE_SWITCH'
  | 'OFFLINE_QUEUE_GROWTH' | 'QUEUE_REPLAY' | 'REALTIME_DROP_RECOVER';

export const SCENARIO_ORDER: readonly ScenarioId[] = [
  'FIRST_VEHICLE_LINK', 'FIRST_HANDSHAKE_OK',
  'CITY_STOP_GO', 'HIGHWAY_STEADY', 'ACCELERATION', 'DECELERATION',
  'LONG_GRADE_LOAD', 'LONG_IDLE', 'BREAK_STOP',
  'IGNITION_OR_APP_SHUTDOWN', 'RESTART', 'APP_BACKGROUND', 'APP_FOREGROUND',
  'INTERNET_LOST', 'INTERNET_RESTORED',
  'GPS_LOST', 'GPS_RESTORED', 'TUNNEL_GNSS_LOSS',
  'OBD_DATA_LOST', 'OBD_RECONNECT', 'PROTOCOL_REESTABLISH',
  'TRIP_CLOSE_AFTER_STOP', 'TRIP_START',
  'THERMAL_PRESSURE', 'MEMORY_PRESSURE', 'BATTERY_LOW_OR_CHARGE_CHANGE',
  'SOURCE_SWITCH',
  'OFFLINE_QUEUE_GROWTH', 'QUEUE_REPLAY', 'REALTIME_DROP_RECOVER',
] as const;

export const SCENARIO_TITLE: Readonly<Record<ScenarioId, string>> = {
  FIRST_VEHICLE_LINK:           'İlk araç bağlantısı',
  FIRST_HANDSHAKE_OK:           'İlk başarılı handshake',
  CITY_STOP_GO:                 'Şehir içi dur-kalk',
  HIGHWAY_STEADY:               'Sabit hızlı uzun yol',
  ACCELERATION:                 'Hızlanma',
  DECELERATION:                 'Yavaşlama',
  LONG_GRADE_LOAD:              'Uzun rampa / yük',
  LONG_IDLE:                    'Uzun rölanti',
  BREAK_STOP:                   'Mola',
  IGNITION_OR_APP_SHUTDOWN:     'Kontak / uygulama kapanışı',
  RESTART:                      'Yeniden başlangıç',
  APP_BACKGROUND:               'Uygulama arka plana geçti',
  APP_FOREGROUND:               'Uygulama öne geldi',
  INTERNET_LOST:                'İnternet kaybı',
  INTERNET_RESTORED:            'İnternet geri geldi',
  GPS_LOST:                     'GPS kaybı',
  GPS_RESTORED:                 'GPS geri geldi',
  TUNNEL_GNSS_LOSS:             'Tünel benzeri GNSS kaybı',
  OBD_DATA_LOST:                'OBD veri kaybı',
  OBD_RECONNECT:                'OBD yeniden bağlantı',
  PROTOCOL_REESTABLISH:         'Protokol yeniden kurulumu',
  TRIP_CLOSE_AFTER_STOP:        'Durduktan sonra trip kapanışı',
  TRIP_START:                   'Yeni trip başlangıcı',
  THERMAL_PRESSURE:             'Termal baskı',
  MEMORY_PRESSURE:              'Bellek baskısı',
  BATTERY_LOW_OR_CHARGE_CHANGE: 'Düşük pil / şarj değişimi',
  SOURCE_SWITCH:                'Kaynak değişimi',
  OFFLINE_QUEUE_GROWTH:         'Çevrimdışı kuyruk oluşması',
  QUEUE_REPLAY:                 'Kuyruk replay',
  REALTIME_DROP_RECOVER:        'Realtime kopma / toparlanma',
} as const;

export interface ScenarioRecord {
  readonly id: ScenarioId;
  /** Kaç kez GÖZLENDİ. 0 → NOT_OBSERVED (FAIL DEĞİL — görev §2). */
  readonly hits: number;
  readonly firstAt: number | null;
  readonly lastAt: number | null;
}

export function emptyScenario(id: ScenarioId): ScenarioRecord {
  return { id, hits: 0, firstAt: null, lastAt: null };
}

export function scenarioVerdict(rec: ScenarioRecord): Verdict {
  return rec.hits > 0 ? 'PASS' : 'NOT_OBSERVED';
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · Olaylar (görev §12)
 * ════════════════════════════════════════════════════════════════════════ */

export type Severity = 'INFO' | 'WARN' | 'CRITICAL';

export const SEVERITY_LABEL: Readonly<Record<Severity, string>> = {
  INFO: 'BİLGİ', WARN: 'UYARI', CRITICAL: 'KRİTİK',
} as const;

export interface FieldEvent {
  readonly id: string;
  readonly type: ScenarioId | 'PREFLIGHT' | 'STORAGE_PRESSURE' | 'RESTORE' | 'SESSION_STATE'
    | 'IDENTITY_INTEGRITY';
  readonly severity: Severity;
  readonly detectedAt: number;
  /** Yalnız SABİT KODLU açıklama — serbest kullanıcı metni TAŞINMAZ. */
  readonly detail: string;
}

/** BlackBox penceresi dondurulan olay tipleri (görev §12 "kritik olaylarda"). */
export const BLACKBOX_TRIGGER_TYPES: readonly FieldEvent['type'][] = [
  'OBD_DATA_LOST', 'OBD_RECONNECT', 'PROTOCOL_REESTABLISH',
  'GPS_LOST', 'TUNNEL_GNSS_LOSS',
  'INTERNET_LOST', 'MEMORY_PRESSURE', 'THERMAL_PRESSURE',
  'REALTIME_DROP_RECOVER', 'IGNITION_OR_APP_SHUTDOWN',
] as const;

export function isBlackBoxTrigger(t: FieldEvent['type']): boolean {
  return BLACKBOX_TRIGGER_TYPES.includes(t);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4.1 · KAYIT KİMLİĞİ — restore bütünlüğü (D1)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * KİMLİK ŞEMASI: `<PREFIX>-v<sessionVersion>-<sequence>`
 *
 * ── NEDEN İKİ PARÇA ────────────────────────────────────────────────────────
 * Eski şema düz `EV-<n>` idi ve sayaç process ömrüne bağlıydı: ilk process
 * death'ten sonra sayaç 0'dan başlıyor, `EV-2` İKİNCİ kez yazılıyor ve
 * öz-denetleyici defteri haklı olarak `CORRUPT` ilan ediyordu (bağımsız
 * denetim P0-1 — ölçüldü).
 *
 * İki bağımsız güvence konur:
 *  1. **`sequence`** her zaman DEFTERDE GÖRÜLEN EN BÜYÜK değerden büyük başlar
 *     (tüm geçerli kayıtlar taranır — yalnız son kayda GÜVENİLMEZ).
 *  2. **`sessionVersion`** öneki: sürüm her restore'da MONOTON artar ve asla
 *     tekrar etmez → defter TAMAMEN budansa ve (1) sıfırdan tohumlansa bile
 *     eski bir kimlikle çakışma YAPISAL OLARAK imkânsızdır.
 *
 * Eski `EV-<n>` biçimi okunmaya devam eder (geriye dönük tarama) — üretimde
 * artık yazılmaz.
 */
const _ID_PATTERN = /^(EV|SNAP)-(?:v(\d+)-)?(\d+)$/;

/** Sekans taşımayan ama MEŞRU olan kimlikler (sürüm önekiyle zaten benzersiz). */
const _UNSEQUENCED_PREFIXES: readonly string[] = ['RESTORE-'];

export function formatRecordId(prefix: 'EV' | 'SNAP', sessionVersion: number, seq: number): string {
  const v = Number.isFinite(sessionVersion) && sessionVersion > 0 ? Math.trunc(sessionVersion) : 1;
  return `${prefix}-v${v}-${seq}`;
}

export interface RecordIdParts {
  readonly prefix: 'EV' | 'SNAP';
  /** Eski düz biçimde `null` — sürüm bilgisi yoktur. */
  readonly version: number | null;
  readonly sequence: number;
}

export function parseRecordId(id: unknown): RecordIdParts | null {
  if (typeof id !== 'string') return null;
  const m = _ID_PATTERN.exec(id);
  if (!m) return null;
  const seq = Number.parseInt(m[3], 10);
  if (!Number.isFinite(seq) || seq < 0) return null;
  return {
    prefix: m[1] as 'EV' | 'SNAP',
    version: m[2] === undefined ? null : Number.parseInt(m[2], 10),
    sequence: seq,
  };
}

export type IdentityVerdict =
  | 'OK'
  | 'DEGRADED_UNPARSABLE'
  | 'FAIL_DUPLICATE_SEQUENCE'
  | 'FAIL_DUPLICATE_ID'
  | 'NOT_SCANNED';

export const IDENTITY_VERDICT_LABEL: Readonly<Record<IdentityVerdict, string>> = {
  OK:                       'BÜTÜN',
  DEGRADED_UNPARSABLE:      'ÇÖZÜLEMEYEN KİMLİK VAR',
  FAIL_DUPLICATE_SEQUENCE:  'KOPYA SEKANS',
  FAIL_DUPLICATE_ID:        'KOPYA KİMLİK',
  NOT_SCANNED:              'TARANMADI',
} as const;

export interface IdentityScan {
  readonly scanned: number;
  readonly sequenced: number;
  readonly unsequenced: number;
  /** Ne sekanslı ne de bilinen bir önekte — yok SAYILIR ama RAPORLANIR. */
  readonly unparsable: number;
  readonly maxSequence: number;
  readonly duplicateIds: number;
  readonly duplicateSequences: number;
  /**
   * Sekans boşluğu HATA DEĞİLDİR (budama/bütçe düşürmesi boşluk bırakır);
   * yalnız görünür tanı bilgisidir.
   */
  readonly sequenceGaps: number;
  readonly verdict: IdentityVerdict;
  /** İlk birkaç sorunlu kimlik — bounded, PII taşımaz. */
  readonly samples: readonly string[];
}

export function emptyIdentityScan(): IdentityScan {
  return {
    scanned: 0, sequenced: 0, unsequenced: 0, unparsable: 0,
    maxSequence: 0, duplicateIds: 0, duplicateSequences: 0, sequenceGaps: 0,
    verdict: 'NOT_SCANNED', samples: [],
  };
}

const _MAX_ID_SAMPLES = 5;

/**
 * Kimlik kümesini tarar (SAF). **Yalnız son kayda bakmaz** — verilen bütün
 * kimlikler gezilir; budanmış defterde bile en büyük sekans doğru bulunur.
 *
 * FAIL-CLOSED: aynı kimlik iki kez ya da aynı sekans iki FARKLI kimlikte
 * görülürse hüküm `FAIL_*` olur; çağıran bunu sessizce yutmamalıdır.
 */
export function scanRecordIdentity(ids: readonly string[]): IdentityScan {
  const seenIds = new Set<string>();
  const seenSeq = new Set<number>();
  const samples: string[] = [];
  let sequenced = 0;
  let unsequenced = 0;
  let unparsable = 0;
  let maxSequence = 0;
  let duplicateIds = 0;
  let duplicateSequences = 0;

  for (const raw of ids) {
    const id = typeof raw === 'string' ? raw : '';
    if (seenIds.has(id)) {
      duplicateIds += 1;
      if (samples.length < _MAX_ID_SAMPLES) samples.push(id);
      continue;
    }
    seenIds.add(id);

    const parts = parseRecordId(id);
    if (parts === null) {
      if (_UNSEQUENCED_PREFIXES.some((p) => id.startsWith(p))) {
        unsequenced += 1;
      } else {
        unparsable += 1;
        if (samples.length < _MAX_ID_SAMPLES) samples.push(id);
      }
      continue;
    }
    sequenced += 1;
    if (seenSeq.has(parts.sequence)) {
      duplicateSequences += 1;
      if (samples.length < _MAX_ID_SAMPLES) samples.push(id);
    } else {
      seenSeq.add(parts.sequence);
    }
    if (parts.sequence > maxSequence) maxSequence = parts.sequence;
  }

  /* Boşluk = beklenen aralıkta eksik sekans. Kayıp DEĞİL, TANI bilgisi. */
  const sequenceGaps = maxSequence > 0 ? Math.max(0, maxSequence - seenSeq.size) : 0;

  const verdict: IdentityVerdict =
    duplicateIds > 0 ? 'FAIL_DUPLICATE_ID'
      : duplicateSequences > 0 ? 'FAIL_DUPLICATE_SEQUENCE'
        : unparsable > 0 ? 'DEGRADED_UNPARSABLE'
          : 'OK';

  return {
    scanned: ids.length,
    sequenced,
    unsequenced,
    unparsable,
    maxSequence,
    duplicateIds,
    duplicateSequences,
    sequenceGaps,
    verdict,
    samples,
  };
}

/** Bir oturumun TÜM kimlik taşıyıcılarını tek listede toplar (D1 tarama girdisi). */
export function collectRecordIds(
  s: LongRoadSession,
  extraIds: readonly string[] = [],
): readonly string[] {
  const out: string[] = [];
  for (const e of _arr(s.events)) if (typeof e.id === 'string') out.push(e.id);
  for (const r of _arr(s.snapshots)) if (typeof r.id === 'string') out.push(r.id);
  for (const id of _arr(s.blackBoxIds)) if (typeof id === 'string') out.push(id);
  for (const id of extraIds) if (typeof id === 'string') out.push(id);
  return out;
}

/**
 * Oturumla birlikte DİSKTE saklanan kimlik defteri. Restore'da sayaç bundan VE
 * ham taramadan (ikisinin BÜYÜĞÜ) tohumlanır — biri kaybolsa diğeri korur.
 */
export interface IdentityLedger {
  /** Bu oturumda dağıtılmış EN BÜYÜK sekans. */
  readonly idHighWater: number;
  readonly lastScanVerdict: IdentityVerdict;
  readonly unparsableIds: number;
  readonly duplicateIds: number;
  readonly duplicateSequences: number;
  readonly sequenceGaps: number;
  /** Kaç kez restore tohumlaması yapıldı. */
  readonly seedCount: number;
  /** Son tohumlamada sayacın başladığı değer. */
  readonly lastSeededFrom: number;
}

export function emptyIdentity(): IdentityLedger {
  return {
    idHighWater: 0,
    lastScanVerdict: 'NOT_SCANNED',
    unparsableIds: 0,
    duplicateIds: 0,
    duplicateSequences: 0,
    sequenceGaps: 0,
    seedCount: 0,
    lastSeededFrom: 0,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · Sinyal defteri (görev §3)
 * ════════════════════════════════════════════════════════════════════════ */

export type SignalId =
  | 'speed' | 'rpm' | 'engineTemp' | 'throttle' | 'intakeTemp'
  | 'fuelLevel' | 'batteryVoltage';

export const SIGNAL_ORDER: readonly SignalId[] = [
  'speed', 'rpm', 'engineTemp', 'throttle', 'intakeTemp', 'fuelLevel', 'batteryVoltage',
] as const;

export const SIGNAL_LABEL: Readonly<Record<SignalId, string>> = {
  speed:          'Hız (km/h)',
  rpm:            'Motor devri (RPM)',
  engineTemp:     'Motor sıcaklığı (°C)',
  throttle:       'Gaz kelebeği (%)',
  intakeTemp:     'Emme havası sıcaklığı (°C)',
  fuelLevel:      'Yakıt (%)',
  batteryVoltage: '12V akü (V)',
} as const;

/**
 * Fiziksel akla-yatkınlık sınırları. KAYNAK: CLAUDE.md §2 "Input Sanitization"
 * (imkânsız sensör verisi reddedilir). Sınır dışı değer `invalid` sayılır —
 * defterden ATILMAZ, SAYILIR (kör nokta üretmemek için).
 */
export const LR_SIGNAL_BOUNDS: Readonly<Record<SignalId, { min: number; max: number }>> = {
  speed:          { min: 0,   max: 300 },
  rpm:            { min: 0,   max: 9_000 },
  engineTemp:     { min: -40, max: 200 },
  throttle:       { min: 0,   max: 100 },
  intakeTemp:     { min: -40, max: 150 },
  fuelLevel:      { min: 0,   max: 100 },
  batteryVoltage: { min: 6,   max: 18 },
} as const;

/** `-1` ve `undefined` = "bu araçta DESTEKLENMİYOR" → geçersiz DEĞİL, yok. */
export function isSignalSupported(v: number | undefined | null): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v !== -1;
}

export function isSignalPlausible(id: SignalId, v: number): boolean {
  const b = LR_SIGNAL_BOUNDS[id];
  return v >= b.min && v <= b.max;
}

export interface SignalLedgerRow {
  readonly id: SignalId;
  readonly firstSeenAt: number | null;
  readonly lastSeenAt: number | null;
  readonly samples: number;
  readonly validSamples: number;
  readonly invalidSamples: number;
  readonly staleSamples: number;
  /** Sinyalin TAZE gözlendiği toplam süre (ms, monoton delta toplamı). */
  readonly coveredMs: number;
  readonly longestGapMs: number;
  readonly min: number | null;
  readonly max: number | null;
  /** Ortalama RAPORDA `sum/validSamples` ile hesaplanır — burada saklanmaz. */
  readonly sum: number;
  readonly source: string | null;
  readonly confidence: Observability;
}

export function emptySignalRow(id: SignalId): SignalLedgerRow {
  /* Template object literal — tüm anahtarlar sabit sırada (V8 hidden-class). */
  return {
    id,
    firstSeenAt: null,
    lastSeenAt: null,
    samples: 0,
    validSamples: 0,
    invalidSamples: 0,
    staleSamples: 0,
    coveredMs: 0,
    longestGapMs: 0,
    min: null,
    max: null,
    sum: 0,
    source: null,
    confidence: 'UNAVAILABLE',
  };
}

export function signalAverage(row: SignalLedgerRow): number | null {
  return row.validSamples > 0 ? row.sum / row.validSamples : null;
}

/** Kapsama oranı = taze gözlenen süre / oturumun ölçüm süresi. */
export function signalCoverageRatio(row: SignalLedgerRow, recordedMs: number): number | null {
  if (recordedMs <= 0) return null;
  return Math.min(1, row.coveredMs / recordedMs);
}

/**
 * Tek örnekle sinyal defterini ilerletir (SAF).
 *
 * @param dtMs   ÖLÇÜLEN monoton delta (varsayılan aralık DEĞİL).
 * @param fresh  Ürünün kendi tazelik hükmü (`dataFresh`) — biz TAZELİK İCAT ETMEYİZ.
 */
export function advanceSignal(
  row: SignalLedgerRow,
  raw: number | undefined | null,
  fresh: boolean,
  source: string | null,
  nowMs: number,
  dtMs: number,
): SignalLedgerRow {
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;

  if (!isSignalSupported(raw)) {
    /* Desteklenmiyor/okunamadı: boşluk büyür ama "geçersiz" damgası VURULMAZ. */
    const gap = row.lastSeenAt === null ? row.longestGapMs : Math.max(row.longestGapMs, nowMs - row.lastSeenAt);
    return { ...row, samples: row.samples + 1, longestGapMs: gap };
  }

  const plausible = isSignalPlausible(row.id, raw);
  if (!plausible) {
    return { ...row, samples: row.samples + 1, invalidSamples: row.invalidSamples + 1, source: source ?? row.source };
  }
  if (!fresh) {
    const gap = row.lastSeenAt === null ? row.longestGapMs : Math.max(row.longestGapMs, nowMs - row.lastSeenAt);
    return {
      ...row,
      samples: row.samples + 1,
      staleSamples: row.staleSamples + 1,
      longestGapMs: gap,
      source: source ?? row.source,
      confidence: row.validSamples > 0 ? 'STALE' : row.confidence,
    };
  }

  const gap = row.lastSeenAt === null ? row.longestGapMs : Math.max(row.longestGapMs, nowMs - row.lastSeenAt);
  return {
    id: row.id,
    firstSeenAt: row.firstSeenAt === null ? nowMs : row.firstSeenAt,
    lastSeenAt: nowMs,
    samples: row.samples + 1,
    validSamples: row.validSamples + 1,
    invalidSamples: row.invalidSamples,
    staleSamples: row.staleSamples,
    coveredMs: row.coveredMs + dt,
    longestGapMs: gap,
    min: row.min === null ? raw : Math.min(row.min, raw),
    max: row.max === null ? raw : Math.max(row.max, raw),
    sum: row.sum + raw,
    source: source ?? row.source,
    confidence: 'OBSERVED',
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · Sayaç defteri — oturum kapsamlı DELTA (görev §3 · §4 · §7)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Alttaki servislerin sayaçları UYGULAMA ömrü boyuncadır; oturum ölçümü için
 * başlangıç TABANI alınır ve fark raporlanır. Taban okunamadıysa `null` kalır ve
 * ilgili metrik UNAVAILABLE olur — "0 reconnect" diye YALAN SÖYLENMEZ.
 */
export interface CounterPair {
  readonly baseline: number | null;
  readonly latest: number | null;
}

export function emptyCounter(): CounterPair { return { baseline: null, latest: null }; }

export function advanceCounter(c: CounterPair, v: number | null): CounterPair {
  if (v === null || !Number.isFinite(v)) return c;
  return { baseline: c.baseline === null ? v : c.baseline, latest: v };
}

export function counterDelta(c: CounterPair): number | null {
  if (c.baseline === null || c.latest === null) return null;
  return Math.max(0, c.latest - c.baseline);
}

export interface SessionCounters {
  readonly obdReconnectRequested: CounterPair;
  readonly obdResetRequested: CounterPair;
  readonly obdDisconnectCalled: CounterPair;
  readonly obdTransportReconnectAttempts: CounterPair;
  readonly kwpRecoveryCount: CounterPair;
  readonly kwpSuppressedCount: CounterPair;
  readonly kwpAtpcFailures: CounterPair;
  readonly canRetryCount: CounterPair;
  readonly gpsSwitchCount: CounterPair;
  readonly gpsFallbackCount: CounterPair;
  readonly tripTotalCount: CounterPair;
  /** Oturum içinde SAYILAN olaylar (taban gerekmez — biz sayarız). */
  readonly obdDataGapCount: number;
  readonly gpsLossCount: number;
  readonly internetLossCount: number;
  readonly failedReconnectCount: number;
  readonly longestObdGapMs: number;
  readonly longestGpsLossMs: number;
  readonly longestInternetLossMs: number;
}

export function emptyCounters(): SessionCounters {
  return {
    obdReconnectRequested: emptyCounter(),
    obdResetRequested: emptyCounter(),
    obdDisconnectCalled: emptyCounter(),
    obdTransportReconnectAttempts: emptyCounter(),
    kwpRecoveryCount: emptyCounter(),
    kwpSuppressedCount: emptyCounter(),
    kwpAtpcFailures: emptyCounter(),
    canRetryCount: emptyCounter(),
    gpsSwitchCount: emptyCounter(),
    gpsFallbackCount: emptyCounter(),
    tripTotalCount: emptyCounter(),
    obdDataGapCount: 0,
    gpsLossCount: 0,
    internetLossCount: 0,
    failedReconnectCount: 0,
    longestObdGapMs: 0,
    longestGpsLossMs: 0,
    longestInternetLossMs: 0,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · Yol defteri (görev §1 · §5)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Mesafe OTORİTESİ ürünün kendi trip motorudur (`tripLogService`) — burada
 * PARALEL mesafe entegrasyonu YAPILMAZ. Otorite okunamazsa `distanceKm` NULL
 * kalır; uydurma kilometre ÜRETİLMEZ (CLAUDE.md §Kanıtsız bilgi).
 */
export interface OdometryLedger {
  readonly distanceBaselineKm: number | null;
  readonly distanceLatestKm: number | null;
  readonly movingMs: number;
  readonly stoppedMs: number;
  readonly unknownMs: number;
  readonly recordedMs: number;
  readonly maxSpeedKmh: number | null;
}

export function emptyOdometry(): OdometryLedger {
  return {
    distanceBaselineKm: null,
    distanceLatestKm: null,
    movingMs: 0,
    stoppedMs: 0,
    unknownMs: 0,
    recordedMs: 0,
    maxSpeedKmh: null,
  };
}

export function odometerDistanceKm(o: OdometryLedger): number | null {
  if (o.distanceBaselineKm === null || o.distanceLatestKm === null) return null;
  return Math.max(0, o.distanceLatestKm - o.distanceBaselineKm);
}

/** Süre invaryantı: moving + stopped + unknown === recorded (görev §5). */
export function odometerInvariantHolds(o: OdometryLedger, toleranceMs = 2): boolean {
  return Math.abs(o.movingMs + o.stoppedMs + o.unknownMs - o.recordedMs) <= toleranceMs;
}

export function advanceOdometry(
  o: OdometryLedger,
  speedKmh: number | null,
  totalDistanceKm: number | null,
  dtMs: number,
): OdometryLedger {
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  const moving = speedKmh !== null && speedKmh > 0;
  const known = speedKmh !== null;

  return {
    distanceBaselineKm:
      o.distanceBaselineKm === null && totalDistanceKm !== null ? totalDistanceKm : o.distanceBaselineKm,
    distanceLatestKm: totalDistanceKm !== null ? totalDistanceKm : o.distanceLatestKm,
    movingMs: o.movingMs + (moving ? dt : 0),
    stoppedMs: o.stoppedMs + (known && !moving ? dt : 0),
    unknownMs: o.unknownMs + (known ? 0 : dt),
    recordedMs: o.recordedMs + dt,
    maxSpeedKmh: speedKmh === null ? o.maxSpeedKmh
      : o.maxSpeedKmh === null ? speedKmh : Math.max(o.maxSpeedKmh, speedKmh),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 8 · Preflight (görev §18)
 * ════════════════════════════════════════════════════════════════════════ */

export type PreflightId =
  | 'STORAGE' | 'OBD_ACCESS' | 'GPS_ACCESS' | 'BACKEND_ACCESS'
  | 'AI_POLICY' | 'SNAPSHOT_EXPORTER' | 'BLACKBOX_BUFFER' | 'SESSION_PERSISTENCE';

export const PREFLIGHT_ORDER: readonly PreflightId[] = [
  'STORAGE', 'OBD_ACCESS', 'GPS_ACCESS', 'BACKEND_ACCESS',
  'AI_POLICY', 'SNAPSHOT_EXPORTER', 'BLACKBOX_BUFFER', 'SESSION_PERSISTENCE',
] as const;

export const PREFLIGHT_LABEL: Readonly<Record<PreflightId, string>> = {
  STORAGE:             'Depolama yazılabilir',
  OBD_ACCESS:          'OBD gözlem yüzeyi okunabilir',
  GPS_ACCESS:          'Konum gözlem yüzeyi okunabilir',
  BACKEND_ACCESS:      'Fleet backend köprüsü',
  AI_POLICY:           'AI politikası / provider hazırlığı',
  SNAPSHOT_EXPORTER:   'Snapshot üretici',
  BLACKBOX_BUFFER:     'BlackBox halka tamponu',
  SESSION_PERSISTENCE: 'Oturum kalıcılığı',
} as const;

export interface PreflightRow {
  readonly id: PreflightId;
  readonly verdict: Verdict;
  readonly detail: string;
}

/**
 * Eksik kapı testi TAMAMEN ENGELLEMEZ (görev §18): yalnız ilgili alan BLOCKED
 * işaretlenir, kalan alanlar ölçülmeye devam eder.
 */
export function preflightBlocksSession(rows: readonly PreflightRow[]): boolean {
  /* YALNIZ kalıcılık ve tampon kritiktir — onlar olmadan kanıt saklanamaz. */
  for (const r of rows) {
    if ((r.id === 'SESSION_PERSISTENCE' || r.id === 'BLACKBOX_BUFFER') && r.verdict === 'FAIL') return true;
  }
  return false;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 9 · Snapshot politikası (görev §11 — cooldown + dedupe)
 * ════════════════════════════════════════════════════════════════════════ */

export type SnapshotTrigger =
  | 'SESSION_START' | 'FIRST_HANDSHAKE' | 'PERIODIC_TIME' | 'PERIODIC_DISTANCE'
  | 'OBD_DATA_LOSS' | 'RECONNECT_FAILED' | 'GPS_LOSS' | 'INTERNET_RESTORED'
  | 'REALTIME_RESYNC' | 'TRIP_CLOSE' | 'MEMORY_CRIT' | 'THERMAL_CRIT'
  | 'CRASH_RECOVERY' | 'PROCESS_RESTORE' | 'SESSION_END';

export const SNAPSHOT_TRIGGER_LABEL: Readonly<Record<SnapshotTrigger, string>> = {
  SESSION_START:      'Oturum başlangıcı',
  FIRST_HANDSHAKE:    'İlk handshake sonrası',
  PERIODIC_TIME:      'Periyodik (30 dk)',
  PERIODIC_DISTANCE:  'Periyodik (100 km)',
  OBD_DATA_LOSS:      'OBD veri kaybı',
  RECONNECT_FAILED:   'Reconnect başarısız',
  GPS_LOSS:           'GPS kaybı > 15 sn',
  INTERNET_RESTORED:  'İnternet geri geldi',
  REALTIME_RESYNC:    'Realtime resync sonrası',
  TRIP_CLOSE:         'Trip kapanışı',
  MEMORY_CRIT:        'Bellek KRİTİK',
  THERMAL_CRIT:       'Termal kritik',
  CRASH_RECOVERY:     'Crash sonrası toparlanma',
  PROCESS_RESTORE:    'Process restore',
  SESSION_END:        'Oturum bitişi',
} as const;

/**
 * Tetik başına soğuma. Olay FIRTINASINDA snapshot çoğalmasın diye (görev §11).
 * Bir kez olması beklenen tetiklerde soğuma sonsuzdur → `Infinity`.
 */
export const SNAPSHOT_COOLDOWN_MS: Readonly<Record<SnapshotTrigger, number>> = {
  SESSION_START:     Number.POSITIVE_INFINITY,
  FIRST_HANDSHAKE:   Number.POSITIVE_INFINITY,
  SESSION_END:       Number.POSITIVE_INFINITY,
  PERIODIC_TIME:     LR_SNAPSHOT_PERIODIC_MS,
  PERIODIC_DISTANCE: 60_000,
  OBD_DATA_LOSS:     120_000,
  RECONNECT_FAILED:  120_000,
  GPS_LOSS:          120_000,
  INTERNET_RESTORED: 60_000,
  REALTIME_RESYNC:   60_000,
  TRIP_CLOSE:        30_000,
  MEMORY_CRIT:       300_000,
  THERMAL_CRIT:      300_000,
  CRASH_RECOVERY:    60_000,
  PROCESS_RESTORE:   60_000,
} as const;

/* ── Sınıf ve öncelik (D3) ───────────────────────────────────────────────── */

export type SnapshotClass = 'PERIODIC' | 'CRITICAL';

/**
 * PERIODIC = yalnız zaman/mesafe tabanlı rutin çekimler. Bunlar yolda ÇOK
 * ÜRETİLİR ve doğaları gereği tekrar edilebilirdir → kendi ayrık kotalarında
 * yaşarlar. Diğer HER tetik kanıt-kritiktir (tekrarlanamaz saha anı) ve
 * rezerve kotayı kullanır.
 */
export const SNAPSHOT_CLASS: Readonly<Record<SnapshotTrigger, SnapshotClass>> = {
  PERIODIC_TIME:     'PERIODIC',
  PERIODIC_DISTANCE: 'PERIODIC',
  SESSION_START:     'CRITICAL',
  FIRST_HANDSHAKE:   'CRITICAL',
  OBD_DATA_LOSS:     'CRITICAL',
  RECONNECT_FAILED:  'CRITICAL',
  GPS_LOSS:          'CRITICAL',
  INTERNET_RESTORED: 'CRITICAL',
  REALTIME_RESYNC:   'CRITICAL',
  TRIP_CLOSE:        'CRITICAL',
  MEMORY_CRIT:       'CRITICAL',
  THERMAL_CRIT:      'CRITICAL',
  CRASH_RECOVERY:    'CRITICAL',
  PROCESS_RESTORE:   'CRITICAL',
  SESSION_END:       'CRITICAL',
} as const;

export function snapshotClass(t: SnapshotTrigger): SnapshotClass {
  return SNAPSHOT_CLASS[t] ?? 'CRITICAL';
}

/**
 * Kritik kota dolduğunda KİMİN düşeceğini belirleyen şiddet sırası
 * (büyük = daha değerli). Kaynak: kanıtın TEKRAR ÜRETİLEBİLİRLİĞİ —
 * termal/bellek/veri kaybı anı bir daha yakalanamaz; trip kapanışı yolda
 * defalarca tekrarlanır.
 */
export const SNAPSHOT_PRIORITY: Readonly<Record<SnapshotTrigger, number>> = {
  MEMORY_CRIT:       5,
  THERMAL_CRIT:      5,
  OBD_DATA_LOSS:     5,
  CRASH_RECOVERY:    5,
  SESSION_START:     4,
  SESSION_END:       4,
  PROCESS_RESTORE:   4,
  RECONNECT_FAILED:  3,
  FIRST_HANDSHAKE:   3,
  GPS_LOSS:          2,
  REALTIME_RESYNC:   2,
  INTERNET_RESTORED: 1,
  TRIP_CLOSE:        1,
  PERIODIC_TIME:     0,
  PERIODIC_DISTANCE: 0,
} as const;

export interface SnapshotPolicyState {
  readonly lastByTrigger: Readonly<Partial<Record<SnapshotTrigger, number>>>;
  readonly lastAnyAt: number | null;
  readonly count: number;
  readonly suppressedCount: number;
  /** SAKLANAN (tahliye sonrası) sınıf sayımları — kota bunlara bakar. */
  readonly periodicCount: number;
  readonly criticalCount: number;
  /** Kritik kota için kontrollü düşürülen kayıt sayısı (görünür olmalı). */
  readonly evictedCriticalCount: number;
}

export function emptySnapshotPolicy(): SnapshotPolicyState {
  return {
    lastByTrigger: {},
    lastAnyAt: null,
    count: 0,
    suppressedCount: 0,
    periodicCount: 0,
    criticalCount: 0,
    evictedCriticalCount: 0,
  };
}

export type SnapshotDecision =
  | 'ALLOW'
  /** Kritik kota dolu ama gelen kayıt saklananların en zayıfından DEĞERLİ. */
  | 'ALLOW_EVICT_CRITICAL'
  | 'SUPPRESSED_COOLDOWN'
  | 'SUPPRESSED_GLOBAL_GAP'
  | 'SUPPRESSED_BUDGET'
  | 'SUPPRESSED_CRITICAL_BUDGET';

export function isSnapshotAllowed(d: SnapshotDecision): boolean {
  return d === 'ALLOW' || d === 'ALLOW_EVICT_CRITICAL';
}

/**
 * Kritik kota doluyken TAHLİYE ADAYI: en DÜŞÜK öncelikli, eşitlikte EN ESKİ
 * kritik snapshot. Aday yoksa `null` (tahliye edilemez → bastırılır).
 */
export function chooseCriticalEvictionVictim(
  retained: readonly SnapshotIndexRow[],
  incomingPriority: number,
): SnapshotIndexRow | null {
  let victim: SnapshotIndexRow | null = null;
  for (const row of _arr(retained)) {
    if (snapshotClass(row.trigger) !== 'CRITICAL') continue;
    const p = SNAPSHOT_PRIORITY[row.trigger] ?? 0;
    if (p >= incomingPriority) continue;            // daha değerli/eşit → dokunma
    if (victim === null) { victim = row; continue; }
    const vp = SNAPSHOT_PRIORITY[victim.trigger] ?? 0;
    if (p < vp || (p === vp && row.takenAt < victim.takenAt)) victim = row;
  }
  return victim;
}

/**
 * Snapshot alınmalı mı? SAF karar — dosya yazımı çağıranın işidir.
 * Bütçe dolduysa ASLA yeni snapshot üretilmez (görev §17).
 *
 * D3: sınıf kotaları AYRIKTIR. Periyodik havuz dolduğunda kritik havuza
 * TAŞMAZ; kritik havuz dolduğunda ise gelen kayıt saklananların en zayıfından
 * değerliyse kontrollü tahliye yapılır.
 *
 * @param retained  Hâlihazırda SAKLANAN snapshot indeksleri (tahliye kararı için).
 */
export function decideSnapshot(
  policy: SnapshotPolicyState,
  trigger: SnapshotTrigger,
  nowMs: number,
  retained: readonly SnapshotIndexRow[] = [],
): SnapshotDecision {
  if (policy.count >= LR_MAX_SNAPSHOTS) return 'SUPPRESSED_BUDGET';

  const last = policy.lastByTrigger[trigger];
  if (typeof last === 'number') {
    const cd = SNAPSHOT_COOLDOWN_MS[trigger];
    if (!Number.isFinite(cd)) return 'SUPPRESSED_COOLDOWN';       // tek atışlık tetik
    if (nowMs - last < cd) return 'SUPPRESSED_COOLDOWN';
  }
  /* Farklı tetikler aynı anda patlarsa da global asgari aralık korunur —
     oturum başlangıcı bunun DIŞINDADIR (ilk snapshot beklemez). */
  if (trigger !== 'SESSION_START' && policy.lastAnyAt !== null
      && nowMs - policy.lastAnyAt < LR_SNAPSHOT_GLOBAL_MIN_GAP_MS) {
    return 'SUPPRESSED_GLOBAL_GAP';
  }

  if (snapshotClass(trigger) === 'PERIODIC') {
    /* Periyodik havuz KENDİ kotasıyla sınırlıdır — kritik rezerve DOKUNAMAZ. */
    return policy.periodicCount >= LR_SNAPSHOT_PERIODIC_QUOTA ? 'SUPPRESSED_BUDGET' : 'ALLOW';
  }

  if (policy.criticalCount >= LR_SNAPSHOT_CRITICAL_QUOTA) {
    const incoming = SNAPSHOT_PRIORITY[trigger] ?? 0;
    return chooseCriticalEvictionVictim(retained, incoming) === null
      ? 'SUPPRESSED_CRITICAL_BUDGET'
      : 'ALLOW_EVICT_CRITICAL';
  }
  return 'ALLOW';
}

/**
 * Bastırma bir KANIT KAYBI mı, yoksa politika davranışı mı?
 * Cooldown/global-gap = politika (kayıp DEĞİL). Kota = kayıp → sınıfıyla sayılır.
 */
export function classifySnapshotDrop(
  trigger: SnapshotTrigger,
  decision: SnapshotDecision,
): SnapshotClass | null {
  if (decision === 'SUPPRESSED_CRITICAL_BUDGET') return 'CRITICAL';
  if (decision === 'SUPPRESSED_BUDGET') return snapshotClass(trigger);
  return null;
}

export function applySnapshotDecision(
  policy: SnapshotPolicyState,
  trigger: SnapshotTrigger,
  decision: SnapshotDecision,
  nowMs: number,
): SnapshotPolicyState {
  if (!isSnapshotAllowed(decision)) {
    return { ...policy, suppressedCount: policy.suppressedCount + 1 };
  }
  /* Tahliyeli kabul: bir kayıt gitti, bir kayıt geldi → SAKLANAN sayı sabit. */
  const evicting = decision === 'ALLOW_EVICT_CRITICAL';
  const cls = snapshotClass(trigger);
  return {
    lastByTrigger: { ...policy.lastByTrigger, [trigger]: nowMs },
    lastAnyAt: nowMs,
    count: evicting ? policy.count : policy.count + 1,
    suppressedCount: policy.suppressedCount,
    periodicCount: cls === 'PERIODIC' ? policy.periodicCount + 1 : policy.periodicCount,
    criticalCount: cls === 'CRITICAL' && !evicting ? policy.criticalCount + 1 : policy.criticalCount,
    evictedCriticalCount: evicting ? policy.evictedCriticalCount + 1 : policy.evictedCriticalCount,
  };
}

export interface SnapshotIndexRow {
  readonly id: string;
  readonly trigger: SnapshotTrigger;
  readonly takenAt: number;
  /** Snapshot gövdesinin BAYT boyutu — gövde oturum kaydında TAŞINMAZ. */
  readonly bytes: number;
  readonly distanceKm: number | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 10 · Depolama baskısı (görev §17)
 * ════════════════════════════════════════════════════════════════════════ */

export type StoragePressure = 'OK' | 'WARN' | 'CRITICAL';

export interface StorageLedger {
  readonly pressure: StoragePressure;
  readonly usedBytes: number | null;
  readonly prunedSnapshots: number;
  readonly prunedEvents: number;
  readonly prunedBlackBox: number;
}

export function emptyStorage(): StorageLedger {
  return { pressure: 'OK', usedBytes: null, prunedSnapshots: 0, prunedEvents: 0, prunedBlackBox: 0 };
}

export interface DroppedLedger {
  readonly droppedSamples: number;
  readonly droppedEvents: number;
  readonly droppedBlackBoxRecords: number;
  /**
   * Kota nedeniyle ALINAMAYAN snapshot'lar — sınıf başına AYRI sayılır (D3).
   * Periyodik düşüş bir bütçe davranışıdır; **kritik düşüş bir kanıt kaybıdır**
   * ve raporda ayrı görünmek ZORUNDADIR (tek sayaçta toplanırsa görünmez olur).
   */
  readonly droppedPeriodicSnapshots: number;
  readonly droppedCriticalSnapshots: number;
}

export function emptyDropped(): DroppedLedger {
  return {
    droppedSamples: 0,
    droppedEvents: 0,
    droppedBlackBoxRecords: 0,
    droppedPeriodicSnapshots: 0,
    droppedCriticalSnapshots: 0,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 11 · Oturum gövdesi
 * ════════════════════════════════════════════════════════════════════════ */

/** Ortam kimliği — MASKELİ. TAM VIN · konum · seri no · anahtar TAŞINMAZ. */
export interface SessionEnv {
  readonly appVersion: string | null;
  readonly buildType: string | null;
  readonly apkSha256: string | null;
  readonly gitRevision: string | null;
  readonly deviceModel: string | null;
  readonly androidRelease: string | null;
  readonly sdkInt: number | null;
  readonly obdAdapter: string | null;
  readonly transport: string | null;
  readonly protocolActive: string | null;
  /** Araç için YALNIZ maskeli referans (son 6 hane) — TAM VIN ASLA. */
  readonly vehicleRef: string | null;
  /** Başlangıç konumu için ŞEHİR/BÖLGE düzeyi — koordinat ASLA. */
  readonly startRegion: string | null;
}

export function emptyEnv(): SessionEnv {
  return {
    appVersion: null, buildType: null, apkSha256: null, gitRevision: null,
    deviceModel: null, androidRelease: null, sdkInt: null,
    obdAdapter: null, transport: null, protocolActive: null,
    vehicleRef: null, startRegion: null,
  };
}

export interface LongRoadSession {
  readonly schemaVersion: number;
  readonly sessionId: string;
  /** Her restore'da artar — "yeni test" gibi GÖRÜNMEZ (görev §13). */
  readonly sessionVersion: number;
  readonly state: SessionState;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly lastCheckpointAt: number | null;
  readonly restoreCount: number;
  readonly lastRestoreReason: RestoreReason | null;
  readonly env: SessionEnv;
  readonly odometry: OdometryLedger;
  readonly scenarios: readonly ScenarioRecord[];
  readonly signals: readonly SignalLedgerRow[];
  readonly counters: SessionCounters;
  readonly events: readonly FieldEvent[];
  readonly snapshots: readonly SnapshotIndexRow[];
  readonly blackBoxIds: readonly string[];
  readonly preflight: readonly PreflightRow[];
  readonly storage: StorageLedger;
  readonly dropped: DroppedLedger;
  readonly snapshotPolicy: SnapshotPolicyState;
  /** Kayıt kimliği bütünlüğü (D1) — restore tohumlaması bunu KULLANIR ve YAZAR. */
  readonly identity: IdentityLedger;
}

export function createSession(sessionId: string, nowMs: number): LongRoadSession {
  return {
    schemaVersion: LR_SCHEMA_VERSION,
    sessionId,
    sessionVersion: 1,
    state: 'STARTING',
    startedAt: nowMs,
    endedAt: null,
    lastCheckpointAt: null,
    restoreCount: 0,
    lastRestoreReason: null,
    env: emptyEnv(),
    odometry: emptyOdometry(),
    scenarios: SCENARIO_ORDER.map(emptyScenario),
    signals: SIGNAL_ORDER.map(emptySignalRow),
    counters: emptyCounters(),
    events: [],
    snapshots: [],
    blackBoxIds: [],
    preflight: [],
    storage: emptyStorage(),
    dropped: emptyDropped(),
    snapshotPolicy: emptySnapshotPolicy(),
    identity: emptyIdentity(),
  };
}

/* ── bounded yardımcılar ─────────────────────────────────────────────────── */

function _clamp(v: unknown): string {
  const s = typeof v === 'string' ? v : String(v ?? '');
  return s.length > LR_MAX_TEXT_CHARS ? s.slice(0, LR_MAX_TEXT_CHARS) : s;
}

function _arr<T>(v: readonly T[] | undefined | null): readonly T[] {
  return Array.isArray(v) ? v : [];
}

function _num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function _int0(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0;
}

/**
 * Olay ekler. Tampon dolduğunda EN ESKİ **INFO** kayıt düşürülür; CRITICAL kayıt
 * ASLA düşürülmez (görev §17: "kritik olay kanıtlarını koru"). Hepsi kritikse
 * yeni kayıt reddedilir ve `droppedEvents` artar — sessiz kayıp YOK.
 */
export function pushEvent(
  s: LongRoadSession,
  ev: FieldEvent,
): LongRoadSession {
  const events = [..._arr(s.events)];
  if (events.length < LR_MAX_EVENTS) {
    events.push(ev);
    return { ...s, events };
  }
  const victim = events.findIndex((e) => e.severity === 'INFO');
  if (victim >= 0) {
    events.splice(victim, 1);
    events.push(ev);
    return { ...s, events, dropped: { ...s.dropped, droppedEvents: s.dropped.droppedEvents + 1 } };
  }
  const warnVictim = events.findIndex((e) => e.severity === 'WARN');
  if (warnVictim >= 0 && ev.severity === 'CRITICAL') {
    events.splice(warnVictim, 1);
    events.push(ev);
    return { ...s, events, dropped: { ...s.dropped, droppedEvents: s.dropped.droppedEvents + 1 } };
  }
  return { ...s, dropped: { ...s.dropped, droppedEvents: s.dropped.droppedEvents + 1 } };
}

/** Senaryo isabetini işler (bounded). */
export function markScenario(s: LongRoadSession, id: ScenarioId, nowMs: number): LongRoadSession {
  const scenarios = _arr(s.scenarios).map((r) => {
    if (r.id !== id) return r;
    if (r.hits >= LR_MAX_SCENARIO_HITS) return { ...r, lastAt: nowMs };
    return {
      id: r.id,
      hits: r.hits + 1,
      firstAt: r.firstAt === null ? nowMs : r.firstAt,
      lastAt: nowMs,
    };
  });
  return { ...s, scenarios };
}

export function findScenario(s: LongRoadSession, id: ScenarioId): ScenarioRecord {
  for (const r of _arr(s.scenarios)) if (r.id === id) return r;
  return emptyScenario(id);
}

export function findSignal(s: LongRoadSession, id: SignalId): SignalLedgerRow {
  for (const r of _arr(s.signals)) if (r.id === id) return r;
  return emptySignalRow(id);
}

/** Oturumun geçen süresi — duvar saati damgalarından (görüntüleme amaçlı). */
export function elapsedMs(s: LongRoadSession, nowMs: number): number {
  const end = s.endedAt ?? nowMs;
  return Math.max(0, end - s.startedAt);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 12 · Depolama baskısı budaması (görev §17)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * KRİTİK baskıda düşük öncelikli veriyi KONTROLLÜ siler.
 *
 * SIRA: (1) INFO olaylar → (2) en eski periyodik snapshot indeksleri.
 * ASLA silinmez: CRITICAL olaylar · BlackBox kayıtları · kabul matrisinin
 * dayandığı sayaç/sinyal defterleri. Kullanıcıya sürüş sırasında POPUP YOK —
 * yalnız raporda `STORAGE_PRESSURE` belirtilir.
 */
export function applyStoragePressure(
  s: LongRoadSession,
  pressure: StoragePressure,
  usedBytes: number | null,
): LongRoadSession {
  const base: LongRoadSession = {
    ...s,
    storage: { ...s.storage, pressure, usedBytes },
  };
  if (pressure !== 'CRITICAL') return base;

  const events = _arr(base.events).filter((e) => e.severity !== 'INFO');
  const prunedEvents = base.events.length - events.length;

  /* D3: YALNIZ periyodik sınıf budanır. Kritik kanıt (veri kaybı, termal,
     restore, oturum sınırları) depolama baskısında bile KORUNUR. */
  const keep: SnapshotIndexRow[] = [];
  let prunedSnapshots = 0;
  for (const row of _arr(base.snapshots)) {
    if (snapshotClass(row.trigger) === 'PERIODIC'
        && prunedSnapshots < Math.floor(base.snapshots.length / 2)) {
      prunedSnapshots += 1;
      continue;
    }
    keep.push(row);
  }

  /* Budanan periyodik kayıtlar kotayı SERBEST BIRAKIR — aksi hâlde disk boşalır
     ama kota dolu kalır ve sonraki periyodik çekimler sessizce reddedilirdi. */
  const policy: SnapshotPolicyState = {
    ...base.snapshotPolicy,
    count: Math.max(0, base.snapshotPolicy.count - prunedSnapshots),
    periodicCount: Math.max(0, base.snapshotPolicy.periodicCount - prunedSnapshots),
  };

  return {
    ...base,
    events,
    snapshots: keep,
    snapshotPolicy: policy,
    storage: {
      pressure,
      usedBytes,
      prunedSnapshots: base.storage.prunedSnapshots + prunedSnapshots,
      prunedEvents: base.storage.prunedEvents + prunedEvents,
      prunedBlackBox: base.storage.prunedBlackBox,
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 13 · Gizlilik süzgeci + şema göçü (görev §12 · §13)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * VIN → yalnız WMI açık. TAM VIN hiçbir katmana GİRMEZ.
 *
 * Eski uygulama **son 6 haneyi** açıyordu; o haneler ISO 3779 seri numarasıdır
 * ve aracı tekilleştirir — üstelik bu değer `longRoadStore` üzerinden **kalıcı
 * diske** yazılıyordu. Tek otorite: `platform/privacy/vinMask`.
 */
export function maskVehicleRef(vin: unknown): string | null {
  if (typeof vin !== 'string' || vin.length < 6) return null;
  return maskVinStrict(vin);
}

/* ── Eski maske artığı (#507 devamı) ──────────────────────────────────────── */

/**
 * 2026-08-09 ÖNCESİ maskenin imzası: `…891234` / `•••891234` — yani üç nokta
 * veya madde işaretinden sonra gelen VIN alfabesinde 5+ hane.
 *
 * O maske WMI'yi SİLİP seri numarasını BIRAKIYORDU. Bu yüzden diskteki değerden
 * doğru maske **yeniden ÜRETİLEMEZ** (üretici hanesi kaydın içinde artık yok) —
 * tek dürüst işlem değeri düşürmektir, "yeniden maskeledim" demek yalan olurdu.
 */
const LEGACY_VIN_MASK_RE = /[…•]{1,3}[A-HJ-NPR-Z0-9]{5,}/g;

/** Düşürülen değerin yerine yazılan işaret — sessiz silme YOK. */
export const LEGACY_MASK_MARKER = '[ESKI_MASKE_TEMIZLENDI]';

/** Metinde eski maske artığı var mı — SAF. */
export function hasLegacyVinMask(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  LEGACY_VIN_MASK_RE.lastIndex = 0;
  return LEGACY_VIN_MASK_RE.test(value);
}

/**
 * Oturum gövdesindeki eski maske artıklarını temizler — SAF, throw ETMEZ.
 *
 * Yalnız `env.vehicleRef` değil, gövdedeki HER metin taranır: aynı değer
 * serbest metin alanına (olay/preflight `detail`) da düşmüş olabilir.
 * `purged` = temizlenen ALAN sayısı; 0 ise nesne kimliği DEĞİŞMEZ (gereksiz
 * disk yazımı doğmasın).
 */
export function purgeLegacyVinMasks(
  s: LongRoadSession,
): { readonly session: LongRoadSession; readonly purged: number } {
  let purged = 0;

  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 8) return v;
    if (typeof v === 'string') {
      if (!hasLegacyVinMask(v)) return v;
      purged += 1;
      LEGACY_VIN_MASK_RE.lastIndex = 0;
      return v.replace(LEGACY_VIN_MASK_RE, LEGACY_MASK_MARKER);
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = walk(val, depth + 1);
      }
      return out;
    }
    return v;
  };

  const next = walk(s, 0);
  /* Şekil korunur — yürüyücü YALNIZ metin değiştirir, alan eklemez/silmez. */
  return purged === 0
    ? { session: s, purged: 0 }
    : { session: next as unknown as LongRoadSession, purged };
}

/**
 * Dışa aktarımın İKİNCİ gizlilik kapısı. Model tipleri zaten PII taşımaz, ama
 * diske/rapora giden gövdeye GÜVENİLMEZ: metinler kırpılır, tanınan hassas
 * anahtarlar düşürülür.
 */
export function sanitizeForExport(s: LongRoadSession): LongRoadSession {
  return {
    ...s,
    env: {
      ...s.env,
      /* Tam VIN yanlışlıkla yazılmışsa burada maskelenir. */
      vehicleRef: s.env.vehicleRef && s.env.vehicleRef.length > 10
        ? maskVehicleRef(s.env.vehicleRef) : s.env.vehicleRef,
      startRegion: s.env.startRegion ? _clamp(s.env.startRegion) : null,
    },
    events: _arr(s.events).map((e) => ({ ...e, detail: _clamp(e.detail) })),
    preflight: _arr(s.preflight).map((p) => ({ ...p, detail: _clamp(p.detail) })),
  };
}

const _STATES: readonly SessionState[] = [
  'IDLE', 'STARTING', 'ACTIVE', 'RECOVERING', 'PAUSED_BY_SYSTEM', 'COMPLETED', 'FAILED', 'CORRUPT',
];

function _state(v: unknown): SessionState {
  return _STATES.includes(v as SessionState) ? (v as SessionState) : 'CORRUPT';
}

/**
 * Diskten gelen gövdeyi göç ettirir. BOZUK kayıt fail-closed reddedilir (`null`)
 * — yarım kayıt "sağlam" gibi kabul EDİLMEZ (görev §13).
 */
export function migrateSession(raw: unknown): LongRoadSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const sessionId = typeof o.sessionId === 'string' && o.sessionId.length > 0 ? o.sessionId : null;
  const startedAt = _num(o.startedAt);
  if (sessionId === null || startedAt === null) return null;

  const version = _num(o.schemaVersion);
  if (version !== null && version > LR_SCHEMA_VERSION) return null;   // GELECEK şema → reddet

  const base = createSession(sessionId, startedAt);

  /* Senaryo/sinyal defterleri: bilinen id'ler korunur, bilinmeyen ATILIR,
     eksik olan boş satırla TAMAMLANIR → dizi uzunluğu her zaman katalog kadar. */
  const rawScenarios = _arr(o.scenarios as ScenarioRecord[] | undefined);
  const scenarios = SCENARIO_ORDER.map((id) => {
    const hit = rawScenarios.find((r) => r && r.id === id);
    return hit
      ? { id, hits: _int0(hit.hits), firstAt: _num(hit.firstAt), lastAt: _num(hit.lastAt) }
      : emptyScenario(id);
  });

  const rawSignals = _arr(o.signals as SignalLedgerRow[] | undefined);
  const signals = SIGNAL_ORDER.map((id) => {
    const hit = rawSignals.find((r) => r && r.id === id);
    if (!hit) return emptySignalRow(id);
    return {
      id,
      firstSeenAt: _num(hit.firstSeenAt),
      lastSeenAt: _num(hit.lastSeenAt),
      samples: _int0(hit.samples),
      validSamples: _int0(hit.validSamples),
      invalidSamples: _int0(hit.invalidSamples),
      staleSamples: _int0(hit.staleSamples),
      coveredMs: _int0(hit.coveredMs),
      longestGapMs: _int0(hit.longestGapMs),
      min: _num(hit.min),
      max: _num(hit.max),
      sum: _num(hit.sum) ?? 0,
      source: typeof hit.source === 'string' ? _clamp(hit.source) : null,
      confidence: (['OBSERVED', 'DERIVED', 'UNAVAILABLE', 'STALE'] as const)
        .includes(hit.confidence as Observability) ? hit.confidence : 'UNAVAILABLE',
    };
  });

  const events = _arr(o.events as FieldEvent[] | undefined)
    .filter((e) => e && typeof e.id === 'string' && _num(e.detectedAt) !== null)
    .slice(0, LR_MAX_EVENTS)
    .map((e): FieldEvent => ({
      id: e.id,
      type: e.type,
      severity: e.severity === 'CRITICAL' || e.severity === 'WARN' ? e.severity : 'INFO',
      detectedAt: _num(e.detectedAt) as number,
      detail: _clamp(e.detail),
    }));

  const snapshots = _arr(o.snapshots as SnapshotIndexRow[] | undefined)
    .filter((r) => r && typeof r.id === 'string')
    .slice(0, LR_MAX_SNAPSHOTS);

  return {
    ...base,
    schemaVersion: LR_SCHEMA_VERSION,
    sessionVersion: Math.max(1, _int0(o.sessionVersion)),
    state: _state(o.state),
    endedAt: _num(o.endedAt),
    lastCheckpointAt: _num(o.lastCheckpointAt),
    restoreCount: _int0(o.restoreCount),
    lastRestoreReason: (o.lastRestoreReason as RestoreReason | null) ?? null,
    env: { ...emptyEnv(), ...(o.env && typeof o.env === 'object' ? o.env as SessionEnv : {}) },
    odometry: { ...emptyOdometry(), ...(o.odometry && typeof o.odometry === 'object' ? o.odometry as OdometryLedger : {}) },
    scenarios,
    signals,
    counters: { ...emptyCounters(), ...(o.counters && typeof o.counters === 'object' ? o.counters as SessionCounters : {}) },
    events,
    snapshots,
    blackBoxIds: _arr(o.blackBoxIds as string[] | undefined)
      .filter((x) => typeof x === 'string').slice(0, LR_MAX_BLACKBOX_EVENTS),
    preflight: _arr(o.preflight as PreflightRow[] | undefined).filter((p) => p && typeof p.id === 'string'),
    storage: { ...emptyStorage(), ...(o.storage && typeof o.storage === 'object' ? o.storage as StorageLedger : {}) },
    dropped: { ...emptyDropped(), ...(o.dropped && typeof o.dropped === 'object' ? o.dropped as DroppedLedger : {}) },
    snapshotPolicy: _migrateSnapshotPolicy(o.snapshotPolicy, snapshots),
    identity: _migrateIdentity(o.identity),
  };
}

/**
 * Snapshot politikası göçü (D3). Sınıf sayaçları eksikse (eski şema) SAKLANAN
 * indeksten YENİDEN türetilir — "0" yazmak kotayı sahte biçimde boşaltırdı.
 */
function _migrateSnapshotPolicy(
  raw: unknown,
  snapshots: readonly SnapshotIndexRow[],
): SnapshotPolicyState {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};

  let periodic = 0;
  let critical = 0;
  for (const row of _arr(snapshots)) {
    if (snapshotClass(row.trigger) === 'PERIODIC') periodic += 1; else critical += 1;
  }

  const lastByTrigger: Partial<Record<SnapshotTrigger, number>> = {};
  const rawLast = o.lastByTrigger;
  if (rawLast && typeof rawLast === 'object') {
    for (const [k, v] of Object.entries(rawLast as Record<string, unknown>)) {
      if (k in SNAPSHOT_COOLDOWN_MS && typeof v === 'number' && Number.isFinite(v)) {
        lastByTrigger[k as SnapshotTrigger] = v;
      }
    }
  }

  return {
    lastByTrigger,
    lastAnyAt: _num(o.lastAnyAt),
    count: Math.max(_int0(o.count), snapshots.length),
    suppressedCount: _int0(o.suppressedCount),
    /* Kayıtlı sayaç ile indeksten türetilen arasındaki BÜYÜK olan alınır:
       kota asla sahte biçimde boşaltılmaz (fail-closed bütçe). */
    periodicCount: Math.max(_int0(o.periodicCount), periodic),
    criticalCount: Math.max(_int0(o.criticalCount), critical),
    evictedCriticalCount: _int0(o.evictedCriticalCount),
  };
}

function _migrateIdentity(raw: unknown): IdentityLedger {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const verdicts: readonly IdentityVerdict[] = [
    'OK', 'DEGRADED_UNPARSABLE', 'FAIL_DUPLICATE_SEQUENCE', 'FAIL_DUPLICATE_ID', 'NOT_SCANNED',
  ];
  return {
    idHighWater: _int0(o.idHighWater),
    lastScanVerdict: verdicts.includes(o.lastScanVerdict as IdentityVerdict)
      ? o.lastScanVerdict as IdentityVerdict : 'NOT_SCANNED',
    unparsableIds: _int0(o.unparsableIds),
    duplicateIds: _int0(o.duplicateIds),
    duplicateSequences: _int0(o.duplicateSequences),
    sequenceGaps: _int0(o.sequenceGaps),
    seedCount: _int0(o.seedCount),
    lastSeededFrom: _int0(o.lastSeededFrom),
  };
}

/**
 * Kaldığı yerden devam eden oturum. `sessionId` KORUNUR, `sessionVersion` ARTAR
 * ve restore nedeni kaydedilir → rapor "aynı oturum" olduğunu KANITLAR.
 */
export function resumeSession(
  s: LongRoadSession,
  reason: RestoreReason,
  nowMs: number,
): LongRoadSession {
  const resumed: LongRoadSession = {
    ...s,
    sessionVersion: s.sessionVersion + 1,
    restoreCount: s.restoreCount + 1,
    lastRestoreReason: reason,
    state: nextSessionState(s.state, 'RESTORE'),
  };
  return pushEvent(resumed, {
    id: `RESTORE-${s.sessionId}-${resumed.sessionVersion}`,
    type: 'RESTORE',
    severity: 'WARN',
    detectedAt: nowMs,
    detail: `Oturum geri yüklendi (neden=${reason}, sürüm=${resumed.sessionVersion})`,
  });
}
