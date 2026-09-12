/**
 * longRoadSelfValidator.ts — SAHA TESTİNİN KENDİ KAYITLARINI DENETLEYEN
 * İKİNCİ, SALT-OKUNUR DOĞRULAYICI (pre-road güvenlik kapısı §2) · SAF.
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok · global durum yok · React yok.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Kabul matrisi bir HÜKÜM üretir ("PASS/FAIL"). Ama o hükmün dayandığı sayaçlar
 * gerçekten ham kayıttan geliyor mu? Bu dosya bunu SORAR ve HAM OLAY DEFTERİNDEN
 * YENİDEN HESAPLAR. Eşleşmezse hükmü DEĞİŞTİRMEZ — yalnız "bu hükme güvenilemez"
 * der. Ölçen ile ölçümü denetleyen AYRI olmalıdır.
 *
 * ── PAZARLIKSIZ ────────────────────────────────────────────────────────────
 *  1. **PASS/FAIL kararına ASLA DOKUNMAZ.** Çıktısı ayrı bir yapıdır; kabul
 *     matrisini ne yükseltir ne düşürür. İki otorite yan yana raporlanır.
 *  2. Ham kanıt yoksa "doğrulandı" DEMEZ → `INSUFFICIENT_RAW_EVIDENCE`.
 *  3. Kayıt DÜŞÜRÜLMÜŞSE yeniden hesap `MISMATCH` sayılmaz — düşen kayıt zaten
 *     farkı açıklar → `INSUFFICIENT_RAW_EVIDENCE`. (Aksi hâlde bütçe budaması
 *     sahte bir "veri bozuk" alarmı üretirdi.)
 *  4. Yapısal olarak imkânsız durum (negatif sayaç, ters zaman) → `CORRUPT`.
 *  5. Hiç değerlendirilemeyen kontrol `NOT_CHECKED` kalır; sessizce VERIFIED
 *     sayılmaz.
 */

import {
  LR_SAMPLE_INTERVAL_MS, LR_SNAPSHOT_CRITICAL_QUOTA, LR_SNAPSHOT_PERIODIC_QUOTA,
  collectRecordIds, counterDelta, odometerDistanceKm, parseRecordId, scanRecordIdentity,
  snapshotClass,
  type FieldEvent, type LongRoadSession, type ScenarioId,
} from './longRoadModel';
import { BB_PRE_MS, type BlackBoxWindow } from './longRoadBlackBox';

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · Sonuç sözleşmesi
 * ════════════════════════════════════════════════════════════════════════ */

export type SelfCheckResult =
  | 'VERIFIED'
  | 'MISMATCH'
  | 'INSUFFICIENT_RAW_EVIDENCE'
  | 'CORRUPT'
  | 'NOT_CHECKED';

export const SELF_CHECK_LABEL: Readonly<Record<SelfCheckResult, string>> = {
  VERIFIED:                  'DOĞRULANDI',
  MISMATCH:                  'UYUŞMUYOR',
  INSUFFICIENT_RAW_EVIDENCE: 'HAM KANIT YETERSİZ',
  CORRUPT:                   'BOZUK',
  NOT_CHECKED:               'DENETLENMEDİ',
} as const;

/** Kötüden iyiye sıralama — genel hüküm EN KÖTÜ sonuçtur. */
const SEVERITY_RANK: Readonly<Record<SelfCheckResult, number>> = {
  CORRUPT: 0,
  MISMATCH: 1,
  INSUFFICIENT_RAW_EVIDENCE: 2,
  NOT_CHECKED: 3,
  VERIFIED: 4,
} as const;

export type SelfCheckId =
  | 'RAW_EVENT_PRESENT'
  | 'TIME_RANGE'
  | 'COUNTER_RECOMPUTE'
  | 'NULL_NOT_VERDICT'
  | 'DUPLICATE_EVENTS'
  | 'DROPPED_IMPACT'
  | 'CHECKPOINT_RING'
  | 'RESTART_COUNTER_JUMP'
  /* ── D1–D3 turunda eklenen denetimler ───────────────────────────────── */
  | 'EVENT_ID_INTEGRITY'
  | 'SEQUENCE_MONOTONICITY'
  | 'FIRST_EVENT_UNIQUENESS'
  | 'BLACKBOX_INTEGRITY'
  | 'SNAPSHOT_REFERENCE'
  | 'SNAPSHOT_QUOTA';

export const SELF_CHECK_ORDER: readonly SelfCheckId[] = [
  'RAW_EVENT_PRESENT', 'TIME_RANGE', 'COUNTER_RECOMPUTE', 'NULL_NOT_VERDICT',
  'DUPLICATE_EVENTS', 'DROPPED_IMPACT', 'CHECKPOINT_RING', 'RESTART_COUNTER_JUMP',
  'EVENT_ID_INTEGRITY', 'SEQUENCE_MONOTONICITY', 'FIRST_EVENT_UNIQUENESS',
  'BLACKBOX_INTEGRITY', 'SNAPSHOT_REFERENCE', 'SNAPSHOT_QUOTA',
] as const;

export const SELF_CHECK_TITLE: Readonly<Record<SelfCheckId, string>> = {
  RAW_EVENT_PRESENT:      'Ham olay mevcut mu',
  TIME_RANGE:             'Olay zaman aralığı tutarlı mı',
  COUNTER_RECOMPUTE:      'Sayaçlar ham kayıttan yeniden hesaplanabiliyor mu',
  NULL_NOT_VERDICT:       'Null veri hükme dönüşmüş mü',
  DUPLICATE_EVENTS:       'Kopya olay var mı',
  DROPPED_IMPACT:         'Düşürülen kayıt kararı etkiliyor mu',
  CHECKPOINT_RING:        'Checkpoint ile halka tamponu çelişiyor mu',
  RESTART_COUNTER_JUMP:   'Restart sonrası sayaç sıçraması var mı',
  EVENT_ID_INTEGRITY:     'Kayıt kimlikleri çakışıyor mu (restore dâhil)',
  SEQUENCE_MONOTONICITY:  'Sekans monoton mu, boşluk ne kadar',
  FIRST_EVENT_UNIQUENESS: '"İlk" senaryolar tekrar üretilmiş mi',
  BLACKBOX_INTEGRITY:     'BlackBox checksum ve pencere bütünlüğü',
  SNAPSHOT_REFERENCE:     'Snapshot referansları sarkıyor mu',
  SNAPSHOT_QUOTA:         'Snapshot kotası ve düşen kritik kanıt',
} as const;

export interface SelfCheckRow {
  readonly id: SelfCheckId;
  readonly title: string;
  readonly result: SelfCheckResult;
  /** Neyin nasıl ölçüldüğü — tek cümle. */
  readonly detail: string;
  /** Sayısal kanıt satırları (PII YOK). */
  readonly evidence: readonly string[];
}

export interface SelfValidationReport {
  readonly rows: readonly SelfCheckRow[];
  /** EN KÖTÜ satır — genel doğrulayıcı hükmü. */
  readonly verdict: SelfCheckResult;
  readonly verifiedCount: number;
  readonly problemCount: number;
  /**
   * DAİMA `false`. Doğrulayıcı kabul matrisine dokunmadığını YAPISAL olarak
   * beyan eder; testte kilitlidir.
   */
  readonly affectsAcceptanceVerdict: false;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · Yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function _arr<T>(v: readonly T[] | undefined | null): readonly T[] {
  return Array.isArray(v) ? v : [];
}

function _worst(rows: readonly SelfCheckRow[]): SelfCheckResult {
  let worst: SelfCheckResult = 'VERIFIED';
  for (const r of rows) {
    if (SEVERITY_RANK[r.result] < SEVERITY_RANK[worst]) worst = r.result;
  }
  return worst;
}

function _row(
  id: SelfCheckId, result: SelfCheckResult, detail: string, evidence: readonly string[] = [],
): SelfCheckRow {
  return { id, title: SELF_CHECK_TITLE[id], result, detail, evidence };
}

/** Olay defteri budanmış mı — budanmışsa yeniden hesap KESİN olamaz. */
function _ledgerPruned(s: LongRoadSession): boolean {
  return s.dropped.droppedEvents > 0 || s.storage.prunedEvents > 0;
}

/** Belirli tipteki ham olayları sayar. */
function _countEvents(events: readonly FieldEvent[], type: string): number {
  let n = 0;
  for (const e of events) if (e.type === type) n += 1;
  return n;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · Kontroller
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * 1 · Gözlendiği İDDİA EDİLEN her senaryonun ham olay defterinde karşılığı var mı?
 *
 * Senaryo sayacı türetilmiş veridir; ham olay ise kaydın kendisidir. Sayaç
 * doluyken olay yoksa hüküm havada demektir.
 */
function _checkRawEventPresent(s: LongRoadSession): SelfCheckRow {
  const events = _arr(s.events);
  const claimed = _arr(s.scenarios).filter((x) => x.hits > 0);

  if (claimed.length === 0) {
    return _row('RAW_EVENT_PRESENT', 'NOT_CHECKED',
      'Hiçbir senaryo gözlendiği iddia edilmedi — denetlenecek hüküm yok.',
      [`gözlenen senaryo=0`, `ham olay=${events.length}`]);
  }
  if (events.length === 0) {
    /* Defter budanmışsa BOŞLUK budamayla açıklanır — suçlama YAPILMAZ. */
    const pruned = _ledgerPruned(s);
    return _row('RAW_EVENT_PRESENT', pruned ? 'INSUFFICIENT_RAW_EVIDENCE' : 'MISMATCH',
      pruned
        ? 'Ham olay defteri boş AMA kayıt düşürülmüş/budanmış — boşluk bütçe davranışıyla açıklanabilir.'
        : 'Senaryo sayacı doluyken ham olay defteri BOŞ — hüküm ham kayıtla desteklenmiyor.',
      [`gözlenen senaryo=${claimed.length}`, 'ham olay=0',
       `düşen olay=${s.dropped.droppedEvents}`, `budanan olay=${s.storage.prunedEvents}`]);
  }

  const orphans: string[] = [];
  for (const sc of claimed) {
    if (_countEvents(events, sc.id) === 0) orphans.push(sc.id);
  }

  if (orphans.length === 0) {
    return _row('RAW_EVENT_PRESENT', 'VERIFIED',
      'Gözlendiği iddia edilen her senaryonun ham olay defterinde karşılığı var.',
      [`gözlenen senaryo=${claimed.length}`, `ham olay=${events.length}`]);
  }
  /* Budama olay silmiş olabilir → suçlamadan önce bunu dikkate al. */
  const result: SelfCheckResult = _ledgerPruned(s) ? 'INSUFFICIENT_RAW_EVIDENCE' : 'MISMATCH';
  return _row('RAW_EVENT_PRESENT', result,
    _ledgerPruned(s)
      ? 'Bazı senaryoların ham olayı yok AMA defter budanmış — fark budamayla açıklanabilir.'
      : 'Bazı senaryolar gözlendi sayılmış ama ham olayları YOK.',
    [`karşılıksız senaryo=${orphans.length}`, `örnek: ${orphans.slice(0, 5).join(', ')}`,
     `düşen olay=${s.dropped.droppedEvents}`, `budanan olay=${s.storage.prunedEvents}`]);
}

/**
 * 2 · Zaman tutarlılığı: her damga oturum penceresinde mi, sıralar ters mi?
 */
function _checkTimeRange(s: LongRoadSession, nowMs: number): SelfCheckRow {
  const start = s.startedAt;
  const end = s.endedAt ?? nowMs;

  if (!Number.isFinite(start) || start <= 0) {
    return _row('TIME_RANGE', 'CORRUPT', 'Oturum başlangıç damgası geçersiz.', [`startedAt=${start}`]);
  }
  if (end < start) {
    return _row('TIME_RANGE', 'CORRUPT', 'Bitiş damgası başlangıçtan ÖNCE.',
      [`startedAt=${start}`, `endedAt=${s.endedAt}`]);
  }

  const events = _arr(s.events);
  const snaps = _arr(s.snapshots);
  let outOfRange = 0;
  let reversedScenario = 0;

  for (const e of events) {
    if (e.detectedAt < start || e.detectedAt > end) outOfRange += 1;
  }
  for (const sn of snaps) {
    if (sn.takenAt < start || sn.takenAt > end) outOfRange += 1;
  }
  for (const sc of _arr(s.scenarios)) {
    if (sc.firstAt !== null && sc.lastAt !== null && sc.lastAt < sc.firstAt) reversedScenario += 1;
    if (sc.hits > 0 && sc.firstAt === null) reversedScenario += 1;   // damgasız isabet
  }

  if (reversedScenario > 0) {
    return _row('TIME_RANGE', 'CORRUPT',
      'Senaryo damgaları yapısal olarak imkânsız (son < ilk veya isabet var damga yok).',
      [`bozuk senaryo=${reversedScenario}`]);
  }
  if (events.length === 0 && snaps.length === 0) {
    return _row('TIME_RANGE', 'NOT_CHECKED', 'Denetlenecek damga yok.', []);
  }
  if (outOfRange > 0) {
    return _row('TIME_RANGE', 'MISMATCH',
      'Bazı damgalar oturum penceresinin DIŞINDA (saat sıçraması veya kayıt karışması).',
      [`pencere dışı damga=${outOfRange}`, `olay=${events.length}`, `snapshot=${snaps.length}`]);
  }

  /* Ölçüm süresi duvar saatiyle geçen süreyi AŞAMAZ. */
  const wall = end - start;
  if (s.odometry.recordedMs > wall + LR_SAMPLE_INTERVAL_MS * 2) {
    return _row('TIME_RANGE', 'MISMATCH',
      'Ölçüm süresi duvar saatiyle geçen süreden BÜYÜK — çift sayım şüphesi.',
      [`recordedMs=${s.odometry.recordedMs}`, `duvar=${wall}`]);
  }

  return _row('TIME_RANGE', 'VERIFIED',
    'Tüm damgalar oturum penceresinde; ölçüm süresi duvar saatini aşmıyor.',
    [`olay=${events.length}`, `snapshot=${snaps.length}`,
     `recordedMs=${s.odometry.recordedMs}`, `duvar=${wall}`]);
}

/**
 * 3 · Kararın kullandığı sayaçlar ham olay defterinden YENİDEN hesaplanabiliyor mu?
 *
 * Kabul matrisi `obdDataGapCount` · `gpsLossCount` · `internetLossCount`
 * sayaçlarını kullanır. Bunların her biri ilgili ham olayın ADEDİNE eşit OLMALI.
 */
function _checkCounterRecompute(s: LongRoadSession): SelfCheckRow {
  const events = _arr(s.events);
  if (events.length === 0) {
    return _row('COUNTER_RECOMPUTE', 'INSUFFICIENT_RAW_EVIDENCE',
      'Ham olay defteri boş — sayaçlar yeniden hesaplanamaz.', []);
  }

  const pairs: { name: string; stored: number; recomputed: number }[] = [
    { name: 'obdDataGapCount', stored: s.counters.obdDataGapCount,
      recomputed: _countEvents(events, 'OBD_DATA_LOST' satisfies ScenarioId) },
    { name: 'gpsLossCount', stored: s.counters.gpsLossCount,
      recomputed: _countEvents(events, 'GPS_LOST' satisfies ScenarioId) },
    { name: 'internetLossCount', stored: s.counters.internetLossCount,
      recomputed: _countEvents(events, 'INTERNET_LOST' satisfies ScenarioId) },
  ];

  const evidence = pairs.map((p) => `${p.name}: kayıtlı=${p.stored} · yeniden=${p.recomputed}`);
  const negative = pairs.some((p) => p.stored < 0);
  if (negative) {
    return _row('COUNTER_RECOMPUTE', 'CORRUPT', 'Negatif sayaç — yapısal olarak imkânsız.', evidence);
  }

  const mismatched = pairs.filter((p) => p.stored !== p.recomputed);
  if (mismatched.length === 0) {
    return _row('COUNTER_RECOMPUTE', 'VERIFIED',
      'Kararın kullandığı üç sayaç da ham olay defterinden birebir yeniden üretildi.', evidence);
  }

  if (_ledgerPruned(s)) {
    return _row('COUNTER_RECOMPUTE', 'INSUFFICIENT_RAW_EVIDENCE',
      'Sayaç ile ham defter uyuşmuyor AMA defter budanmış — fark budamayla açıklanabilir, ' +
      'yeniden hesap KESİN DEĞİLDİR.',
      [...evidence, `düşen olay=${s.dropped.droppedEvents}`, `budanan olay=${s.storage.prunedEvents}`]);
  }
  return _row('COUNTER_RECOMPUTE', 'MISMATCH',
    'Sayaç ham olay defterinden yeniden üretilemedi ve budama YOK — sayaç güvenilmez.',
    evidence);
}

/**
 * 4 · Null veri hükme dönüşmüş mü?
 *
 * En tehlikeli hata sınıfı: okunamayan alanın sessizce bir değere (çoğu zaman 0)
 * dönüşüp karara girmesi. Burada YAPISAL çelişkiler aranır.
 */
function _checkNullNotVerdict(s: LongRoadSession): SelfCheckRow {
  const problems: string[] = [];

  for (const row of _arr(s.signals)) {
    if (row.validSamples > 0 && row.confidence === 'UNAVAILABLE') {
      problems.push(`${row.id}: geçerli örnek var ama güven UNAVAILABLE`);
    }
    if (row.validSamples === 0 && (row.min !== null || row.max !== null)) {
      problems.push(`${row.id}: geçerli örnek YOK ama min/max dolu`);
    }
    if (row.validSamples > 0 && row.min === null) {
      problems.push(`${row.id}: geçerli örnek var ama min null`);
    }
    if (row.coveredMs > 0 && row.validSamples === 0) {
      problems.push(`${row.id}: kapsama süresi var ama geçerli örnek yok`);
    }
  }

  /* Sayaç deltası ancak TABAN okunmuşsa üretilebilir. */
  const counterFields = [
    ['obdReconnectRequested', s.counters.obdReconnectRequested],
    ['kwpRecoveryCount', s.counters.kwpRecoveryCount],
    ['gpsSwitchCount', s.counters.gpsSwitchCount],
    ['tripTotalCount', s.counters.tripTotalCount],
  ] as const;
  for (const [name, c] of counterFields) {
    const d = counterDelta(c);
    if (d !== null && (c.baseline === null || c.latest === null)) {
      problems.push(`${name}: taban okunmadığı hâlde delta üretilmiş`);
    }
    if (d !== null && d < 0) problems.push(`${name}: negatif delta`);
  }

  /* Mesafe otoritesi yoksa mesafe ÜRETİLEMEZ. */
  const km = odometerDistanceKm(s.odometry);
  if (km !== null && (s.odometry.distanceBaselineKm === null || s.odometry.distanceLatestKm === null)) {
    problems.push('mesafe: otorite okunmadığı hâlde km üretilmiş');
  }
  /* Hız hiç okunmadıysa "hareket süresi" olamaz. */
  if (s.odometry.movingMs > 0 && s.odometry.maxSpeedKmh === null) {
    problems.push('hareket süresi var ama hiç hız örneği yok');
  }

  if (problems.length > 0) {
    return _row('NULL_NOT_VERDICT', 'MISMATCH',
      'Okunamayan alan bir değere dönüşüp deftere girmiş görünüyor.', problems.slice(0, 8));
  }
  return _row('NULL_NOT_VERDICT', 'VERIFIED',
    'Bilinmeyen alanların hiçbiri sayıya/hükme dönüşmemiş (sahte 0 yok).',
    [`sinyal satırı=${_arr(s.signals).length}`, `mesafe=${km === null ? 'UNAVAILABLE' : km.toFixed(1)}`]);
}

/**
 * 5 · Kopya olay: aynı kimlik iki kez, veya aynı tip aynı milisaniyede iki kez.
 */
function _checkDuplicateEvents(s: LongRoadSession): SelfCheckRow {
  const events = _arr(s.events);
  if (events.length === 0) {
    return _row('DUPLICATE_EVENTS', 'NOT_CHECKED', 'Ham olay defteri boş.', []);
  }

  const ids = new Set<string>();
  const stamps = new Set<string>();
  let dupId = 0;
  let dupStamp = 0;
  for (const e of events) {
    if (ids.has(e.id)) dupId += 1; else ids.add(e.id);
    const key = `${e.type}@${e.detectedAt}`;
    if (stamps.has(key)) dupStamp += 1; else stamps.add(key);
  }

  if (dupId > 0) {
    return _row('DUPLICATE_EVENTS', 'CORRUPT',
      'Aynı olay kimliği birden çok kez kayıtlı — defter bütünlüğü bozuk.',
      [`kopya kimlik=${dupId}`, `olay=${events.length}`]);
  }
  if (dupStamp > 0) {
    return _row('DUPLICATE_EVENTS', 'MISMATCH',
      'Aynı tip olay aynı milisaniyede birden çok kez yazılmış — çift sayım şüphesi.',
      [`kopya damga=${dupStamp}`, `olay=${events.length}`]);
  }
  return _row('DUPLICATE_EVENTS', 'VERIFIED',
    'Olay kimlikleri benzersiz; aynı tip aynı damgada tekrar etmiyor.',
    [`olay=${events.length}`, `benzersiz kimlik=${ids.size}`]);
}

/**
 * 6 · Düşürülen kayıt kararı etkiliyor mu?
 *
 * Düşen kayıt tek başına hata DEĞİLDİR (bütçe sözleşmesi). Ama düşen kayıt VARSA
 * yeniden hesaba dayanan hükümler artık KESİN değildir — bu açıkça söylenmelidir.
 */
function _checkDroppedImpact(s: LongRoadSession): SelfCheckRow {
  const d = s.dropped;
  const total = d.droppedSamples + d.droppedEvents + d.droppedBlackBoxRecords;
  const pruned = s.storage.prunedEvents + s.storage.prunedSnapshots;
  const suppressed = s.snapshotPolicy.suppressedCount;

  const evidence = [
    `düşen örnek=${d.droppedSamples}`,
    `düşen olay=${d.droppedEvents}`,
    `düşen BlackBox kaydı=${d.droppedBlackBoxRecords}`,
    `budanan olay/snapshot=${s.storage.prunedEvents}/${s.storage.prunedSnapshots}`,
    `bastırılan snapshot=${suppressed} (politika gereği — kayıp DEĞİL)`,
    `depolama baskısı=${s.storage.pressure}`,
  ];

  if (total < 0 || pruned < 0) {
    return _row('DROPPED_IMPACT', 'CORRUPT', 'Negatif kayıp sayacı.', evidence);
  }
  if (total === 0 && pruned === 0) {
    return _row('DROPPED_IMPACT', 'VERIFIED',
      'Hiçbir kayıt düşürülmedi veya budanmadı — yeniden hesaplar tam defter üzerinde yapıldı.',
      evidence);
  }
  return _row('DROPPED_IMPACT', 'INSUFFICIENT_RAW_EVIDENCE',
    'Kayıt düşürülmüş/budanmış — bu bir bütçe davranışıdır, hata değil; ancak ham defterden ' +
    'yapılan yeniden hesaplar bu oturum için KESİN sayılamaz.',
    evidence);
}

/**
 * 7 · Checkpoint ile halka tamponu çelişiyor mu?
 *
 * BlackBox penceresi diske yazılmış bir olaya ait olmalı ve `preWindowComplete`
 * iddiası gerçekten 60 sn'lik geçmişle desteklenmeli.
 */
function _checkCheckpointRing(
  s: LongRoadSession,
  windows: readonly BlackBoxWindow[],
  nowMs: number,
): SelfCheckRow {
  if (windows.length === 0) {
    return _row('CHECKPOINT_RING', 'NOT_CHECKED', 'Hiç BlackBox penceresi açılmadı.', []);
  }

  const start = s.startedAt;
  const end = s.endedAt ?? nowMs;
  const problems: string[] = [];
  let lyingPreWindow = 0;
  let orphanWindow = 0;

  const eventIds = new Set(_arr(s.events).map((e) => e.id));

  for (const w of windows) {
    if (w.detectedAt < start || w.detectedAt > end) {
      problems.push(`${w.eventId}: damga oturum penceresi dışında`);
    }
    /* `preWindowComplete=true` iddiası ölçülebilir olmalı: en eski ön kare
       olaydan EN AZ 60 sn önce olmalı. */
    if (w.preWindowComplete && w.preFrames.length > 0) {
      const oldest = w.preFrames[0].t;
      if (w.detectedMono - oldest < BB_PRE_MS - LR_SAMPLE_INTERVAL_MS * 2) {
        lyingPreWindow += 1;
      }
    }
    if (w.preWindowComplete && w.preFrames.length === 0) lyingPreWindow += 1;
    /* Pencere bir ham olaya bağlı olmalı (defter budanmadıysa). */
    if (!eventIds.has(w.eventId) && !_ledgerPruned(s)) orphanWindow += 1;
  }

  const evidence = [
    `pencere=${windows.length}`,
    `kapalı=${windows.filter((w) => w.postWindowComplete).length}`,
    `ön pencere TAM iddiası=${windows.filter((w) => w.preWindowComplete).length}`,
    `yalancı ön pencere=${lyingPreWindow}`,
    `ham olaya bağlanamayan pencere=${orphanWindow}`,
  ];

  if (problems.length > 0) {
    return _row('CHECKPOINT_RING', 'CORRUPT',
      'BlackBox penceresi oturum zaman penceresiyle çelişiyor.', [...problems.slice(0, 5), ...evidence]);
  }
  if (lyingPreWindow > 0) {
    return _row('CHECKPOINT_RING', 'MISMATCH',
      '`preWindowComplete=TAM` denmiş ama halkada o kadar geçmiş YOK — eksik pencere tam gösterilmiş.',
      evidence);
  }
  if (orphanWindow > 0) {
    return _row('CHECKPOINT_RING', 'MISMATCH',
      'Bazı pencereler ham olay defterindeki hiçbir olaya bağlanamıyor.', evidence);
  }
  return _row('CHECKPOINT_RING', 'VERIFIED',
    'Her pencere ham bir olaya bağlı; "ön pencere tam" iddiaları halkadaki geçmişle desteklenmiş.',
    evidence);
}

/**
 * 8 · Restart sonrası sayaç sıçraması.
 *
 * Restore edilen oturumda sayaçlar SIFIRLANMAMALI ama ANİDEN de büyümemeli;
 * ayrıca `sessionVersion` ile `restoreCount` birbirini tutmalı.
 */
function _checkRestartCounterJump(s: LongRoadSession, nowMs: number): SelfCheckRow {
  const evidence = [
    `sessionVersion=${s.sessionVersion}`,
    `restoreCount=${s.restoreCount}`,
    `restore olayı=${_countEvents(_arr(s.events), 'RESTORE')}`,
    `recordedMs=${s.odometry.recordedMs}`,
  ];

  if (s.sessionVersion < 1 || s.restoreCount < 0) {
    return _row('RESTART_COUNTER_JUMP', 'CORRUPT', 'Oturum sürümü/restore sayacı geçersiz.', evidence);
  }
  /* Sözleşme: her restore sürümü BİR artırır → sürüm = restore + 1. */
  if (s.sessionVersion !== s.restoreCount + 1) {
    return _row('RESTART_COUNTER_JUMP', 'MISMATCH',
      'Oturum sürümü ile restore sayısı uyuşmuyor — sessiz bir yeniden başlatma olmuş olabilir.',
      evidence);
  }
  if (s.restoreCount === 0) {
    return _row('RESTART_COUNTER_JUMP', 'NOT_CHECKED',
      'Bu oturumda hiç restore yaşanmadı — sıçrama denetlenemedi.', evidence);
  }

  /* Restore edilmiş oturumda defter boş olamaz (kaldığı yerden devam etmeli). */
  if (s.odometry.recordedMs === 0) {
    return _row('RESTART_COUNTER_JUMP', 'MISMATCH',
      'Restore edildiği hâlde ölçüm defteri SIFIR — devamlılık kopmuş.', evidence);
  }
  /* Duvar saatini aşan ölçüm = çift sayım (restore'da en tipik hata). */
  const wall = (s.endedAt ?? nowMs) - s.startedAt;
  if (s.odometry.recordedMs > wall + LR_SAMPLE_INTERVAL_MS * 2) {
    return _row('RESTART_COUNTER_JUMP', 'MISMATCH',
      'Restore sonrası ölçüm süresi duvar saatini aşmış — sayaç sıçraması.',
      [...evidence, `duvar=${wall}`]);
  }
  /* Restore olayı defterde iz bırakmalı (budanmadıysa). */
  if (_countEvents(_arr(s.events), 'RESTORE') === 0 && !_ledgerPruned(s)) {
    return _row('RESTART_COUNTER_JUMP', 'MISMATCH',
      'Restore sayacı artmış ama defterde RESTORE olayı YOK.', evidence);
  }

  return _row('RESTART_COUNTER_JUMP', 'VERIFIED',
    'Restore defteri sürdürmüş; sayaçlarda sıçrama veya çift sayım yok.', evidence);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3.1 · D1 — KAYIT KİMLİĞİ (bağımsız yeniden hesap)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * 9 · Kimlik çakışması. Kaydedicinin `identity` defterine GÜVENİLMEZ: tarama
 * burada HAM kimlik listesinden BAŞTAN yapılır ve kaydedilen hükümle ayrıca
 * karşılaştırılır. (Ölçen ile denetleyen ayrı olmalı — bu dosyanın varlık
 * sebebi budur.)
 */
function _checkEventIdIntegrity(
  s: LongRoadSession,
  windows: readonly BlackBoxWindow[],
): SelfCheckRow {
  const ids = collectRecordIds(s, windows.map((w) => w.eventId));
  if (ids.length === 0) {
    return _row('EVENT_ID_INTEGRITY', 'NOT_CHECKED', 'Denetlenecek kayıt kimliği yok.', []);
  }
  const scan = scanRecordIdentity(ids);
  const stored = s.identity;
  const evidence = [
    `taranan kimlik=${scan.scanned}`,
    `sekanslı=${scan.sequenced} · sekanssız=${scan.unsequenced} · çözülemeyen=${scan.unparsable}`,
    `kopya kimlik=${scan.duplicateIds} · kopya sekans=${scan.duplicateSequences}`,
    `en büyük sekans=${scan.maxSequence}`,
    `kayıtlı hüküm=${stored?.lastScanVerdict ?? 'NOT_SCANNED'} · yeniden=${scan.verdict}`,
    `restore tohumlaması=${stored?.seedCount ?? 0} kez · son tohum=${stored?.lastSeededFrom ?? 0}`,
  ];

  if (scan.duplicateIds > 0) {
    return _row('EVENT_ID_INTEGRITY', 'CORRUPT',
      'Aynı kayıt kimliği birden çok kez kullanılmış — restore tohumlaması ÇALIŞMAMIŞ.',
      [...evidence, `örnek: ${scan.samples.slice(0, 3).join(', ')}`]);
  }
  if (scan.duplicateSequences > 0) {
    return _row('EVENT_ID_INTEGRITY', 'CORRUPT',
      'Aynı sekans iki farklı kimlikte görüldü — sayaç iki kez dağıtılmış.',
      [...evidence, `örnek: ${scan.samples.slice(0, 3).join(', ')}`]);
  }
  if (scan.unparsable > 0) {
    return _row('EVENT_ID_INTEGRITY', 'INSUFFICIENT_RAW_EVIDENCE',
      'Çözülemeyen kayıt kimliği var — çakışma denetimi bu kayıtlar için YAPILAMADI.',
      [...evidence, `örnek: ${scan.samples.slice(0, 3).join(', ')}`]);
  }
  /* Kaydedici "OK" derken ham tarama sorun buluyorsa (veya tersi) hüküm havada. */
  if (stored && stored.lastScanVerdict !== 'NOT_SCANNED' && stored.duplicateIds !== scan.duplicateIds) {
    return _row('EVENT_ID_INTEGRITY', 'MISMATCH',
      'Kaydedilen kimlik defteri ham taramayla uyuşmuyor.', evidence);
  }
  return _row('EVENT_ID_INTEGRITY', 'VERIFIED',
    'Tüm kayıt kimlikleri benzersiz; hiçbir sekans iki kez dağıtılmamış.', evidence);
}

/**
 * 10 · Sekans monotonluğu ve boşluk.
 *
 * BOŞLUK HATA DEĞİLDİR (bütçe düşürmesi/budama boşluk bırakır) — yalnız
 * görünür tanı bilgisidir. Denetlenen şey şudur: aynı `sessionVersion` içinde
 * kimlikler ARTAN sırada mı yazılmış (defter sırası bozulmamış mı) ve
 * restore sonrası sekans GERİYE düşmüş mü.
 */
function _checkSequenceMonotonicity(s: LongRoadSession): SelfCheckRow {
  const events = _arr(s.events);
  const parsed = events
    .map((e) => ({ e, p: parseRecordId(e.id) }))
    .filter((x): x is { e: FieldEvent; p: NonNullable<ReturnType<typeof parseRecordId>> } => x.p !== null);

  if (parsed.length < 2) {
    return _row('SEQUENCE_MONOTONICITY', 'NOT_CHECKED',
      'Sekanslı kayıt sayısı monotonluk denetimi için yetersiz.',
      [`sekanslı olay=${parsed.length}`, `toplam olay=${events.length}`]);
  }

  let descending = 0;
  let versionRegression = 0;
  for (let i = 1; i < parsed.length; i += 1) {
    const prev = parsed[i - 1].p;
    const cur = parsed[i].p;
    if (cur.sequence <= prev.sequence) descending += 1;
    if (prev.version !== null && cur.version !== null && cur.version < prev.version) {
      versionRegression += 1;
    }
  }

  const maxSeq = parsed.reduce((m, x) => Math.max(m, x.p.sequence), 0);
  const gaps = Math.max(0, maxSeq - new Set(parsed.map((x) => x.p.sequence)).size);
  const evidence = [
    `sekanslı olay=${parsed.length}`,
    `azalan geçiş=${descending}`,
    `sürüm gerilemesi=${versionRegression}`,
    `en büyük sekans=${maxSeq}`,
    `boşluk=${gaps} (snapshot kimlikleri aynı sayacı paylaşır — boşluk BEKLENİR, hata DEĞİL)`,
    `düşen olay=${s.dropped.droppedEvents} · budanan olay=${s.storage.prunedEvents}`,
  ];

  if (versionRegression > 0) {
    return _row('SEQUENCE_MONOTONICITY', 'CORRUPT',
      'Oturum sürümü defterde GERİYE gitmiş — kayıtlar karışmış.', evidence);
  }
  if (descending > 0) {
    return _row('SEQUENCE_MONOTONICITY', 'MISMATCH',
      'Olay defteri sekans sırası ARTAN değil — kayıt sırası bozulmuş.', evidence);
  }
  return _row('SEQUENCE_MONOTONICITY', 'VERIFIED',
    'Sekans defter boyunca artıyor; sürüm gerilemesi yok. Boşluklar bütçe davranışıyla açıklanır.',
    evidence);
}

/**
 * 11 · "İlk" senaryoların tekilliği.
 *
 * `FIRST_VEHICLE_LINK` ve `FIRST_HANDSHAKE_OK` tanım gereği oturum başına EN
 * FAZLA BİR kez olabilir. Restore'da algılayıcı sıfırlanıp tekrar üretirse
 * bu iki senaryo "her açılışta ilk bağlantı" gibi sayılır (denetim §5/7).
 */
function _checkFirstEventUniqueness(s: LongRoadSession): SelfCheckRow {
  const events = _arr(s.events);
  const pairs: { id: ScenarioId; events: number; hits: number }[] = [
    {
      id: 'FIRST_VEHICLE_LINK',
      events: _countEvents(events, 'FIRST_VEHICLE_LINK'),
      hits: _arr(s.scenarios).find((x) => x.id === 'FIRST_VEHICLE_LINK')?.hits ?? 0,
    },
    {
      id: 'FIRST_HANDSHAKE_OK',
      events: _countEvents(events, 'FIRST_HANDSHAKE_OK'),
      hits: _arr(s.scenarios).find((x) => x.id === 'FIRST_HANDSHAKE_OK')?.hits ?? 0,
    },
  ];
  const evidence = pairs.map((p) => `${p.id}: ham olay=${p.events} · senaryo isabeti=${p.hits}`);
  evidence.push(`restore=${s.restoreCount} · sürüm=${s.sessionVersion}`);

  const repeated = pairs.filter((p) => p.hits > 1 || p.events > 1);
  if (repeated.length > 0) {
    return _row('FIRST_EVENT_UNIQUENESS', 'MISMATCH',
      '"İlk" senaryo birden çok kez sayılmış — restore sonrası algılayıcı tohumlanmamış olabilir.',
      evidence);
  }
  if (pairs.every((p) => p.hits === 0 && p.events === 0)) {
    return _row('FIRST_EVENT_UNIQUENESS', 'NOT_CHECKED',
      'Hiç ilk-bağlantı/handshake gözlenmedi — tekillik denetlenemedi.', evidence);
  }
  return _row('FIRST_EVENT_UNIQUENESS', 'VERIFIED',
    '"İlk" senaryolar oturum boyunca birer kez sayılmış (restore tekrar üretmemiş).', evidence);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3.2 · D2/D3 — BlackBox bütünlüğü ve snapshot kotası
 * ════════════════════════════════════════════════════════════════════════ */

/** Öz-denetime dışarıdan verilen ham kanıt (kaydediciden okunur, ÜRETİLMEZ). */
export interface SelfValidationEvidence {
  /** `longRoadStore.loadBlackBoxOutcome()` hükmü — checksum burada sınanmıştır. */
  readonly blackBoxLoad?: {
    readonly kind: string;
    readonly formatVersion: number | null;
    readonly checksumOk: boolean | null;
    readonly reason: string | null;
    readonly rejectedWindows: number;
  } | null;
  /** Bellekte TUTULAN snapshot gövdelerinin kimlikleri (sarkan referans denetimi). */
  readonly snapshotBodyIds?: readonly string[];
}

/**
 * 12 · BlackBox bütünlüğü: checksum hükmü + pencere tamamlanma iddiaları.
 *
 * Checksum hükmü BU DOSYADA hesaplanmaz (gövde burada yok); kaydediciden gelen
 * ölçüm SONUCU denetlenir. Ölçüm verilmemişse `NOT_CHECKED` kalır — sessizce
 * "doğrulandı" SAYILMAZ.
 */
function _checkBlackBoxIntegrity(
  windows: readonly BlackBoxWindow[],
  evidence: SelfValidationEvidence | undefined,
): SelfCheckRow {
  const load = evidence?.blackBoxLoad ?? null;
  const lines: string[] = [
    `pencere=${windows.length}`,
    `format=${load?.formatVersion ?? 'UNAVAILABLE'}`,
    `checksum=${load === null || load.checksumOk === null ? 'DENETLENMEDİ' : load.checksumOk ? 'TUTUYOR' : 'TUTMUYOR'}`,
    `okuma hükmü=${load?.kind ?? 'UNAVAILABLE'}${load?.reason ? ` (${load.reason})` : ''}`,
    `şekil reddi=${load?.rejectedWindows ?? 0}`,
  ];

  /* Yapısal YALAN: "ön pencere TAM" denmiş ama hiç ön kare yok. Bu, eksik
     kanıtın tam gösterilmesidir ve tolere EDİLEMEZ. */
  let lyingPre = 0;
  /* "Post tamamlandı" ama hiç post karesi yok: mümkündür (gözlemci o pencerede
     hiç tick atmamış olabilir) → yalan değil, KANIT ZAYIFLIĞIDIR. */
  let emptyPost = 0;
  for (const w of windows) {
    if (w.preWindowComplete && w.preFrames.length === 0) lyingPre += 1;
    if (w.postWindowComplete && w.postFrames.length === 0) emptyPost += 1;
  }
  const openEnded = windows.filter((w) => !w.postWindowComplete).length;
  lines.push(`post penceresi TAMAMLANMAMIŞ=${openEnded} (process death dürüst raporu)`);
  lines.push(`yalancı ön pencere=${lyingPre} · karesiz kapanmış post=${emptyPost}`);

  if (load !== null && load.kind === 'CORRUPT') {
    return _row('BLACKBOX_INTEGRITY', 'CORRUPT',
      'BlackBox gövdesi bütünlük denetimini geçemedi ve FAIL-CLOSED reddedildi.', lines);
  }
  if (load !== null && load.checksumOk === false) {
    return _row('BLACKBOX_INTEGRITY', 'CORRUPT', 'BlackBox checksum TUTMUYOR.', lines);
  }
  if (lyingPre > 0) {
    return _row('BLACKBOX_INTEGRITY', 'MISMATCH',
      '"Ön pencere TAM" denmiş ama hiç ön kare yok — eksik pencere tam gösterilmiş.', lines);
  }
  if (emptyPost > 0) {
    return _row('BLACKBOX_INTEGRITY', 'INSUFFICIENT_RAW_EVIDENCE',
      'Kapanmış pencerede hiç post karesi yok — bütünlük iddiası zayıf.', lines);
  }
  if (windows.length === 0 && load === null) {
    return _row('BLACKBOX_INTEGRITY', 'NOT_CHECKED', 'Denetlenecek BlackBox kanıtı yok.', lines);
  }
  if (load === null || load.checksumOk === null) {
    return _row('BLACKBOX_INTEGRITY', 'INSUFFICIENT_RAW_EVIDENCE',
      'Pencere yapısı tutarlı AMA checksum hükmü yok (eski format ya da ölçüm verilmedi) — '
      + 'bütünlük KANITLANMIŞ sayılamaz.', lines);
  }
  return _row('BLACKBOX_INTEGRITY', 'VERIFIED',
    'BlackBox checksum tutuyor ve pencere tamamlanma iddiaları karelerle uyumlu.', lines);
}

/**
 * 13 · Sarkan referans: bellekteki her snapshot gövdesinin indekste karşılığı,
 * BlackBox penceresinin ham olayda karşılığı olmalı. Kota tahliyesi bir kaydı
 * düşürdüğünde ikisinin de birlikte düşmesi ŞARTTIR.
 */
function _checkSnapshotReference(
  s: LongRoadSession,
  windows: readonly BlackBoxWindow[],
  evidence: SelfValidationEvidence | undefined,
): SelfCheckRow {
  const index = new Set(_arr(s.snapshots).map((r) => r.id));
  const bodyIds = evidence?.snapshotBodyIds;
  const eventIds = new Set(_arr(s.events).map((e) => e.id));

  const dangling = bodyIds === undefined
    ? 0
    : bodyIds.filter((id) => !index.has(id)).length;
  const orphanWindows = windows.filter((w) => !eventIds.has(w.eventId) && !_ledgerPruned(s)).length;
  const duplicateIndex = _arr(s.snapshots).length - index.size;

  const lines = [
    `indeks=${_arr(s.snapshots).length} · benzersiz=${index.size}`,
    `bellekteki gövde=${bodyIds === undefined ? 'DENETLENMEDİ' : bodyIds.length}`,
    `indekste karşılığı olmayan gövde=${bodyIds === undefined ? 'DENETLENMEDİ' : dangling}`,
    `ham olaya bağlanamayan BlackBox penceresi=${orphanWindows}`,
    `tahliye edilen kritik snapshot=${s.snapshotPolicy.evictedCriticalCount}`,
  ];

  if (duplicateIndex > 0) {
    return _row('SNAPSHOT_REFERENCE', 'CORRUPT',
      'Snapshot indeksinde kopya kimlik var.', lines);
  }
  if (dangling > 0) {
    return _row('SNAPSHOT_REFERENCE', 'MISMATCH',
      'Bellekte indekste OLMAYAN snapshot gövdesi var — tahliye referansı sarkmış.', lines);
  }
  if (orphanWindows > 0) {
    return _row('SNAPSHOT_REFERENCE', 'MISMATCH',
      'BlackBox penceresi hiçbir ham olaya bağlanamıyor.', lines);
  }
  if (bodyIds === undefined) {
    return _row('SNAPSHOT_REFERENCE', 'NOT_CHECKED',
      'Snapshot gövde kimlikleri verilmedi — sarkan referans denetimi yapılamadı.', lines);
  }
  return _row('SNAPSHOT_REFERENCE', 'VERIFIED',
    'Her snapshot gövdesinin indekste karşılığı var; sarkan referans yok.', lines);
}

/**
 * 14 · Kota defteri: sınıf sayaçları saklanan indeksten yeniden üretilebilmeli
 * ve KRİTİK kanıt kaybı görünür olmalı.
 */
function _checkSnapshotQuota(s: LongRoadSession): SelfCheckRow {
  const rows = _arr(s.snapshots);
  let periodic = 0;
  let critical = 0;
  for (const r of rows) {
    if (snapshotClass(r.trigger) === 'PERIODIC') periodic += 1; else critical += 1;
  }
  const p = s.snapshotPolicy;
  const d = s.dropped;
  const lines = [
    `periyodik: saklanan=${periodic} · sayaç=${p.periodicCount} · kota=${LR_SNAPSHOT_PERIODIC_QUOTA}`,
    `kritik: saklanan=${critical} · sayaç=${p.criticalCount} · kota=${LR_SNAPSHOT_CRITICAL_QUOTA}`,
    `düşen periyodik=${d.droppedPeriodicSnapshots} · düşen kritik=${d.droppedCriticalSnapshots}`,
    `tahliye=${p.evictedCriticalCount} · bastırılan (politika)=${p.suppressedCount}`,
    `budanan snapshot=${s.storage.prunedSnapshots}`,
  ];

  if (p.periodicCount < 0 || p.criticalCount < 0
      || d.droppedPeriodicSnapshots < 0 || d.droppedCriticalSnapshots < 0) {
    return _row('SNAPSHOT_QUOTA', 'CORRUPT', 'Negatif kota/kayıp sayacı.', lines);
  }
  /* Sayaç saklanandan KÜÇÜK olamaz: kota sahte biçimde boşaltılmış demektir. */
  if (p.periodicCount < periodic || p.criticalCount < critical) {
    return _row('SNAPSHOT_QUOTA', 'MISMATCH',
      'Sınıf sayacı saklanan snapshot sayısından küçük — kota defteri güvenilmez.', lines);
  }
  if (d.droppedCriticalSnapshots > 0) {
    return _row('SNAPSHOT_QUOTA', 'INSUFFICIENT_RAW_EVIDENCE',
      'KRİTİK snapshot düşürülmüş — o anların ham kanıtı bu oturumda YOK.', lines);
  }
  if (rows.length === 0) {
    return _row('SNAPSHOT_QUOTA', 'NOT_CHECKED', 'Hiç snapshot alınmadı.', lines);
  }
  return _row('SNAPSHOT_QUOTA', 'VERIFIED',
    'Sınıf sayaçları saklanan indeksle tutarlı; kritik kanıt kaybı yok.', lines);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · Giriş noktası
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Oturumu KENDİ ham kayıtlarına karşı denetler.
 *
 * SALT-OKUNUR: hiçbir alanı değiştirmez, hiçbir hükmü yükseltmez/düşürmez.
 * Çıktısı kabul matrisinden AYRI raporlanır.
 */
export function validateSelf(
  session: LongRoadSession,
  windows: readonly BlackBoxWindow[],
  nowMs: number,
  evidence?: SelfValidationEvidence,
): SelfValidationReport {
  const rows: SelfCheckRow[] = [];

  if (session.state === 'CORRUPT') {
    for (const id of SELF_CHECK_ORDER) {
      rows.push(_row(id, 'CORRUPT', 'Oturum kaydı BOZUK olarak işaretli — denetim yapılamaz.'));
    }
    return {
      rows,
      verdict: 'CORRUPT',
      verifiedCount: 0,
      problemCount: rows.length,
      affectsAcceptanceVerdict: false,
    };
  }

  rows.push(_checkRawEventPresent(session));
  rows.push(_checkTimeRange(session, nowMs));
  rows.push(_checkCounterRecompute(session));
  rows.push(_checkNullNotVerdict(session));
  rows.push(_checkDuplicateEvents(session));
  rows.push(_checkDroppedImpact(session));
  rows.push(_checkCheckpointRing(session, windows, nowMs));
  rows.push(_checkRestartCounterJump(session, nowMs));
  rows.push(_checkEventIdIntegrity(session, windows));
  rows.push(_checkSequenceMonotonicity(session));
  rows.push(_checkFirstEventUniqueness(session));
  rows.push(_checkBlackBoxIntegrity(windows, evidence));
  rows.push(_checkSnapshotReference(session, windows, evidence));
  rows.push(_checkSnapshotQuota(session));

  const verifiedCount = rows.filter((r) => r.result === 'VERIFIED').length;
  const problemCount = rows.filter(
    (r) => r.result === 'MISMATCH' || r.result === 'CORRUPT',
  ).length;

  return {
    rows,
    verdict: _worst(rows),
    verifiedCount,
    problemCount,
    affectsAcceptanceVerdict: false,
  };
}
