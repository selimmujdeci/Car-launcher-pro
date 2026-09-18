/**
 * ARAÇ SAĞLIĞI — tüketiciye dönük TEK projeksiyon (F2.2).
 *
 * ── İKİNCİ OTORİTE KURULMADI ─────────────────────────────────────────────
 * Hüküm otoritesi `@/lib/console/evidenceModel`tir (`judge` · `Verdict` ·
 * `VERDICT_RANK` · `ENGINE_RULE` · `BATTERY_RULE`); tazelik otoritesi
 * `vehicleTelemetryFreshness`; DTC ölçüm otoritesi ARAÇ tarafı ve onun
 * telefondaki yorumu F2.1 `classifyDtcCommand`. Bu dosya YENİ BİR MOTOR
 * DEĞİLDİR: mevcut hükümleri seçer, birleştirir ve düz Türkçeye çevirir.
 * Yeni eşik, yeni enum, yeni severity tablosu ÜRETİLMEZ.
 *
 * Neden yine de ayrı bir seçim katmanı var: konsol hükmü GPS tazeliğini de
 * sağlık metriği gibi sayar. Bu FİLO için doğrudur (veri akmıyorsa filo kör
 * kalır) ama tüketici için YANLIŞTIR — "GPS 4 sn gecikti" aracın sağlığı
 * değildir. Burada yapılan tek şey, hangi mevcut hükmün SAĞLIK hangisinin
 * BAĞLANTI olduğunu ayırmaktır (§11).
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK.
 */

import {
  judge,
  NO_EVIDENCE,
  VERDICT_RANK,
  BATTERY_RULE,
  ENGINE_RULE,
  agoLabel,
  type EvidenceReading,
  type ThresholdRule,
  type Verdict,
} from '@/lib/console/evidenceModel';
import {
  freshnessLabel,
  measurementLabel,
  type FreshnessState,
  type Measurement,
  type VehicleFreshness,
} from '@/lib/fleet/vehicleTelemetryFreshness';
import type { DtcCode, DtcOutcome, VoltageOutcome } from './dtcResultContract';

/* ── Sözleşme ──────────────────────────────────────────────────────────── */

/** Sağlık hükmüne katılan kanıt türleri. Yeni tür eklemek AÇIK karardır. */
export type HealthEvidenceId = 'dtc' | 'engineTemp' | 'battery';

export interface HealthEvidenceItem {
  readonly id: HealthEvidenceId;
  readonly label: string;
  readonly verdict: Verdict;
  /** Kullanıcıya gösterilecek değer/durum. Veri yoksa "Veri yok". */
  readonly detail: string;
  /** Kanıtın kaynağı — ölçüm mü, kullanıcı kaydı mı (§12). */
  readonly provenance: string;
  /** Ölçüm anı (epoch ms); bilinmiyorsa `null` (uydurma tarih YOK). */
  readonly measuredAt: number | null;
  readonly freshness: FreshnessState;
  /** Bu kanıt üst hükme katıldı mı? `false` → yalnız bilgi olarak gösterilir. */
  readonly countedInVerdict: boolean;
}

export type HealthConfidence = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface VehicleHealthSummary {
  readonly verdict: Verdict;
  /** Tek satır ana sonuç. */
  readonly headline: string;
  /** Kapsamı dürüstçe söyleyen ikinci satır. */
  readonly explanation: string;
  readonly evidence: readonly HealthEvidenceItem[];
  /** Hükmün NEYİ KAPSAMADIĞI — boş liste "her şey kapsandı" demek değildir. */
  readonly limitations: readonly string[];
  /** Hükme katılan EN YENİ kanıtın ölçüm anı. */
  readonly measuredAt: number | null;
  readonly freshness: FreshnessState;
  readonly confidence: HealthConfidence;
  /** BAĞLANTI gerçeği — SAĞLIK DEĞİLDİR (§11). */
  readonly connection: {
    readonly state: FreshnessState;
    readonly label: string;
    readonly lastSeenLabel: string;
  };
  /** Araçtan gelen arıza kodları (varsa) — telefon EKLEME YAPMAZ. */
  readonly dtcs: readonly DtcCode[];
}

/* ── Yardımcılar ───────────────────────────────────────────────────────── */

/**
 * Ölçümün EŞİK hükmü — tazelik cezası HARİÇ.
 *
 * `judge()` bayat ölçümü `VERIFIED`ten `WARNING`e düşürür; bu konsol için
 * doğrudur ("sağlıklı diyemem"). Ama tüketiciye bunu "kontrol edilmesi gereken
 * durum" diye sunmak YANLIŞ olur: bayatlık aracın arızası değildir.
 *
 * Bu yüzden aynı ölçüm bir de `LIVE` varsayımıyla tartılır. Sonuç:
 *   · eşik aşılmışsa → gerçek sinyal, tazelikten BAĞIMSIZ olarak korunur
 *   · aşılmamışsa    → bayatlık yalnız "güncel veri yok"tur, uyarı değil
 * Yeni eşik tanımlanmaz; `judge()` ve mevcut kurallar aynen kullanılır.
 */
function thresholdVerdict(m: Measurement | null | undefined, rule: ThresholdRule): Verdict {
  if (!m || m.value === null) return 'NO_EVIDENCE';
  return judge({ ...m, state: 'LIVE' }, rule).verdict;
}

/** Ölçüm gerçekten canlı mı? Bayat/çevrimdışı/görülmemiş ölçüm canlı değildir. */
function isLive(m: Measurement | null | undefined): boolean {
  return m?.state === 'LIVE' && m.value !== null;
}

/**
 * Komut sonucunun tazeliği.
 *
 * `LIVE` PENCERESİ küçük tutulur: ölçüm anı bilinmiyorsa `UNKNOWN` — "az önce"
 * VARSAYILMAZ. Bu, kart üstünde "Canlı" yazarken saatler öncesinden gelmiş bir
 * okumayı canlı göstermeyi engeller.
 */
const COMMAND_LIVE_WINDOW_MS = 5 * 60_000;

function commandFreshness(measuredAt: number | null, now: number): FreshnessState {
  if (measuredAt === null) return 'UNKNOWN';
  return now - measuredAt <= COMMAND_LIVE_WINDOW_MS ? 'LIVE' : 'STALE';
}

/* ── DTC → sağlık kanıtı ───────────────────────────────────────────────── */

/**
 * F2.1 sonucunu sağlık kanıtına çevirir — MUHAFAZAKÂR ve DETERMINISTIK.
 *
 * Kurallar (§6):
 *   · `RESULT` → `WARNING`. `CRITICAL`e YALNIZ araç kendi kodunu
 *     `severity: 'critical'` işaretlediyse çıkılır. Telefon P-kodundan
 *     severity TAHMİN ETMEZ, kendi tablosunu kurmaz.
 *   · `NO_DTC` → `VERIFIED`, ama YALNIZ tarama kapsamında. Kapsam kısmiyse
 *     bu kısıt `limitations`a yazılır.
 *   · Diğer her durum (`UNSUPPORTED`/`OFFLINE`/`TIMEOUT`/`FAILED`/`STALE`/
 *     bekleme/`null`) → `NO_EVIDENCE`. Hiçbiri "sağlıklı" DEĞİLDİR ve
 *     hiçbiri "arızalı" da değildir.
 *
 * NEDEN DTC TAZELİK CEZASI ALMAZ: DTC bir OLAYDIR (ECU'da saklanan arıza
 * kaydı), motor sıcaklığı gibi ANLIK bir ölçüm değildir. 6 saat önce okunmuş
 * bir arıza kodu hâlâ gerçektir. Yaş gizlenmez — `measuredAt`/`freshness` ile
 * taşınır ve kartta gösterilir; ama hükümden DÜŞÜRÜLMEZ. Güven penceresinin
 * üst sınırı okuma katmanındadır (`DTC_HEALTH_MAX_AGE_MS` → `STALE`).
 */
export function judgeDtcEvidence(outcome: DtcOutcome | null, now: number): {
  reading: EvidenceReading;
  dtcs: DtcCode[];
  detail: string;
  measuredAt: number | null;
  note: string | null;
} {
  const none = (detail: string, note: string | null = null) => ({
    reading: NO_EVIDENCE,
    dtcs: [] as DtcCode[],
    detail,
    measuredAt: null,
    note,
  });

  if (!outcome) return none('Hiç taranmadı', 'Araç hiç teşhis taramasından geçmedi');

  switch (outcome.kind) {
    case 'WAITING_FOR_VEHICLE':
    case 'READING':
      return none('Okuma sürüyor', 'Teşhis okuması henüz tamamlanmadı');
    case 'UNSUPPORTED':
      /* Desteklenmiyor ARIZA DEĞİLDİR; kapsam gerçeğidir (§4). */
      return none('Desteklenmiyor', 'Araç bu teşhis servislerini desteklemiyor');
    case 'OFFLINE':
      /* Bağlantı sorunu SAĞLIK hükmü üretmez (§11). */
      return none('Araç çevrimdışıydı', 'Son teşhis denemesinde araca ulaşılamadı');
    case 'TIMEOUT':
      return none('Zaman aşımı', 'Son teşhis okuması tamamlanamadı');
    case 'STALE':
      return none('Güncel değil', 'Son teşhis okuması güncelliğini yitirdi');
    case 'FAILED':
      return none('Okunamadı', 'Son teşhis okuması başarısız oldu');

    case 'NO_DTC': {
      const measuredAt = outcome.readAt ? Date.parse(outcome.readAt) : NaN;
      const at = Number.isFinite(measuredAt) ? measuredAt : null;
      return {
        reading: {
          verdict: 'VERIFIED',
          value: 0,
          source: 'MEASURED',
          samples: null,
          ageMs: at === null ? null : now - at,
          freshness: commandFreshness(at, now),
        },
        dtcs: [],
        detail: outcome.partial
          ? 'Okunan sistemlerde arıza yok'
          : 'Arıza kodu bulunamadı',
        measuredAt: at,
        note: outcome.partial
          ? 'Teşhis taraması kısmi: bazı sistemler okunamadı'
          : null,
      };
    }

    case 'RESULT': {
      const measuredAt = outcome.readAt ? Date.parse(outcome.readAt) : NaN;
      const at = Number.isFinite(measuredAt) ? measuredAt : null;
      /* Severity ARACIN otoritesidir; telefon yükseltme/indirme yapmaz. */
      const critical = outcome.dtcs.some((d) => d.severity === 'critical');
      return {
        reading: {
          verdict: critical ? 'CRITICAL' : 'WARNING',
          value: outcome.dtcs.length,
          source: 'MEASURED',
          samples: null,
          ageMs: at === null ? null : now - at,
          freshness: commandFreshness(at, now),
        },
        dtcs: outcome.dtcs,
        detail: outcome.dtcs.length === 1
          ? '1 arıza kodu tespit edildi'
          : `${outcome.dtcs.length} arıza kodu tespit edildi`,
        measuredAt: at,
        note: outcome.partial
          ? 'Teşhis taraması kısmi: bazı sistemler okunamadı'
          : null,
      };
    }
  }
}

/**
 * Voltaj sonucunu sağlık kanıtına çevirir.
 *
 * Eşik `BATTERY_RULE`dır (mevcut kanonik kural); yeni eşik TANIMLANMAZ.
 * Ölçüm yoksa `NO_EVIDENCE` — "akü normal" VARSAYILMAZ (§4).
 */
export function judgeVoltageEvidence(outcome: VoltageOutcome | null, now: number): {
  reading: EvidenceReading;
  /** Tazelik cezası HARİÇ eşik hükmü — üst hüküm bunu kullanır. */
  threshold: Verdict;
  detail: string;
  measuredAt: number | null;
  note: string | null;
} {
  const none = (detail: string, note: string | null = null) => ({
    reading: NO_EVIDENCE, threshold: 'NO_EVIDENCE' as Verdict, detail, measuredAt: null, note,
  });

  if (!outcome) return none('Hiç ölçülmedi');

  switch (outcome.kind) {
    case 'WAITING_FOR_VEHICLE':
    case 'READING':  return none('Ölçüm sürüyor');
    case 'OFFLINE':  return none('Araç çevrimdışıydı');
    case 'TIMEOUT':  return none('Zaman aşımı');
    case 'STALE':    return none('Güncel değil', 'Akü ölçümü güncelliğini yitirdi');
    case 'FAILED':   return none('Ölçülemedi');
    case 'RESULT': {
      const parsedAt = outcome.readAt ? Date.parse(outcome.readAt) : NaN;
      const at = Number.isFinite(parsedAt) ? parsedAt : null;
      const state = commandFreshness(at, now);
      /* Eşik `BATTERY_RULE`; tazelik cezası `judge()`in kendi kuralıyla
         uygulanır (bayat ölçüm "kanıtlı sağlıklı" olamaz). */
      const reading = judge(
        {
          value: outcome.volts,
          state,
          observedAt: at,
          ageMs: at === null ? null : now - at,
          source: 'HEAD_UNIT_OBD',
        },
        BATTERY_RULE,
      );
      return {
        reading,
        threshold: thresholdVerdict(
          { value: outcome.volts, state, observedAt: at, ageMs: null, source: 'HEAD_UNIT_OBD' },
          BATTERY_RULE,
        ),
        detail: `${outcome.volts.toFixed(1)} V`,
        measuredAt: at,
        note: null,
      };
    }
  }
}

/* ── Özet ──────────────────────────────────────────────────────────────── */

export interface HealthInput {
  readonly now: number;
  /** Telemetri gerçeği; okunamadıysa `undefined`. */
  readonly freshness: VehicleFreshness | undefined;
  /** Aracın EN SON teşhis okuması; hiç yoksa `null`. */
  readonly dtc: DtcOutcome | null;
  /** Aracın EN SON voltaj ölçümü; hiç yoksa `null`. */
  readonly voltage: VoltageOutcome | null;
}

const HEADLINE: Record<Verdict, string> = {
  CRITICAL:    'Geciktirmeden kontrol ettirin',
  WARNING:     'Kontrol edilmesi gereken bir durum var',
  VERIFIED:    'Aracınız iyi görünüyor',
  NO_EVIDENCE: 'Güncel sağlık verisi bekleniyor',
};

/**
 * Tüketiciye dönük sağlık özetini kurar — SAF.
 *
 * Hüküm birleştirme kuralı (pazarlıksız):
 *   1. Kanıt üst hükme YALNIZ canlı ölçümse ya da eşiği gerçekten aşıyorsa
 *      katılır. Bayat-ama-normal ölçüm uyarı DEĞİL, "güncel veri yok"tur.
 *   2. En acil kanıt kazanır (`VERDICT_RANK`) — konsolla AYNI sıralama.
 *   3. Hükme katılan hiçbir kanıt yoksa sonuç `NO_EVIDENCE`'tır: "sorun yok"
 *      DEĞİL, "bilmiyoruz".
 *
 * `VERIFIED` bile "her sistem sağlam" İDDİASI DEĞİLDİR; `explanation` ve
 * `limitations` kapsamı açıkça söyler.
 */
export function buildVehicleHealthSummary(input: HealthInput): VehicleHealthSummary {
  const { now, freshness, dtc, voltage } = input;
  const limitations: string[] = [];

  /* ── DTC ─────────────────────────────────────────────────────────────── */
  const dtcEv = judgeDtcEvidence(dtc, now);
  if (dtcEv.note) limitations.push(dtcEv.note);

  /* ── Motor sıcaklığı ─────────────────────────────────────────────────── */
  const tempM = freshness?.engineTempC;
  const tempReading = judge(tempM, ENGINE_RULE);
  const tempThreshold = thresholdVerdict(tempM, ENGINE_RULE);
  const tempLive = isLive(tempM);
  const tempCounted =
    tempReading.verdict !== 'NO_EVIDENCE' &&
    (tempLive || tempThreshold === 'WARNING' || tempThreshold === 'CRITICAL');
  if (tempReading.verdict !== 'NO_EVIDENCE' && !tempCounted) {
    limitations.push('Motor sıcaklığı verisi güncel değil');
  }
  if (tempReading.verdict === 'NO_EVIDENCE') {
    limitations.push('Motor verisi alınamadı');
  }

  /* ── Akü ─────────────────────────────────────────────────────────────── */
  const battEv = judgeVoltageEvidence(voltage, now);
  const battLive = battEv.reading.freshness === 'LIVE';
  const battCounted =
    battEv.reading.verdict !== 'NO_EVIDENCE' &&
    (battLive || battEv.threshold === 'WARNING' || battEv.threshold === 'CRITICAL');
  if (battEv.note) limitations.push(battEv.note);
  if (battEv.reading.verdict === 'NO_EVIDENCE') {
    limitations.push('Akü voltajı ölçülmedi');
  } else if (!battCounted) {
    limitations.push('Akü ölçümü güncel değil');
  }

  /* ── Kanıt satırları ─────────────────────────────────────────────────── */
  const evidence: HealthEvidenceItem[] = [
    {
      id: 'dtc',
      label: 'Teşhis',
      verdict: dtcEv.reading.verdict,
      detail: dtcEv.detail,
      provenance: 'Araç teşhis okuması',
      measuredAt: dtcEv.measuredAt,
      freshness: dtcEv.reading.freshness,
      countedInVerdict: dtcEv.reading.verdict !== 'NO_EVIDENCE',
    },
    {
      id: 'engineTemp',
      label: 'Motor sıcaklığı',
      /* Satırda GERÇEK hüküm gösterilir (bayatlık cezası dâhil) — ama üst
         hükme katılıp katılmadığı `countedInVerdict` ile ayrı taşınır. */
      verdict: tempReading.verdict,
      detail: tempM ? measurementLabel(tempM, '°C') : 'Veri yok',
      provenance: 'Araç ünitesi OBD',
      measuredAt: tempM?.observedAt ?? null,
      freshness: tempReading.freshness,
      countedInVerdict: tempCounted,
    },
    {
      id: 'battery',
      label: 'Akü',
      verdict: battEv.reading.verdict,
      detail: battEv.detail,
      provenance: 'Araç ünitesi OBD',
      measuredAt: battEv.measuredAt,
      freshness: battEv.reading.freshness,
      countedInVerdict: battCounted,
    },
  ];

  /* ── Üst hüküm ───────────────────────────────────────────────────────── */
  const counted = evidence.filter((e) => e.countedInVerdict);
  let verdict: Verdict = 'NO_EVIDENCE';
  for (const e of counted) {
    if (VERDICT_RANK[e.verdict] > VERDICT_RANK[verdict]) verdict = e.verdict;
  }

  /* Hükme katılan en YENİ ölçüm anı — kullanıcıya "son kontrol" olarak döner. */
  const stamps = counted.map((e) => e.measuredAt).filter((v): v is number => v !== null);
  const measuredAt = stamps.length > 0 ? Math.max(...stamps) : null;

  /* Güven: kaç bağımsız kanıt hükme katıldı. Kanıt yoksa güven de yok. */
  const confidence: HealthConfidence =
    counted.length === 0 ? 'NONE'
      : counted.length === 1 ? 'LOW'
        : counted.length === 2 ? 'MEDIUM'
          : 'HIGH';

  /* Özetin tazeliği: telemetri motor tazeliğini taşır; hiç kanıt yoksa
     `UNKNOWN`. Uydurma "LIVE" YOK. */
  const summaryFreshness: FreshnessState =
    counted.length === 0 ? 'UNKNOWN'
      : commandFreshness(measuredAt, now);

  const explanation = buildExplanation(verdict, counted.length, dtcEv.dtcs.length);

  return {
    verdict,
    headline: HEADLINE[verdict],
    explanation,
    evidence,
    limitations,
    measuredAt,
    freshness: summaryFreshness,
    confidence,
    connection: {
      state: freshness?.device ?? 'UNKNOWN',
      label: freshnessLabel(freshness?.device ?? 'UNKNOWN'),
      lastSeenLabel: agoLabel(freshness?.deviceAgeMs ?? null),
    },
    dtcs: dtcEv.dtcs,
  };
}

/**
 * İkinci satır — KAPSAMI söyler.
 *
 * "Aracınız iyi görünüyor" cümlesi tek başına "bütün sistemler kesinlikle
 * sağlam" anlamına gelirdi. Bu yüzden `VERIFIED` DAİMA "mevcut verilere göre"
 * kaydıyla anlatılır (§5).
 */
function buildExplanation(verdict: Verdict, countedCount: number, dtcCount: number): string {
  switch (verdict) {
    case 'CRITICAL':
      return dtcCount > 0
        ? 'Araç kritik olarak işaretlenmiş bir arıza kodu bildirdi.'
        : 'Ölçümlerden biri kritik eşiği aştı.';
    case 'WARNING':
      return dtcCount > 0
        ? 'Araç teşhis kodu bildirdi. Acil olduğu kanıtlanmadı, ancak kontrol edilmesi gerekiyor.'
        : 'Ölçümlerden biri normal aralığın dışında.';
    case 'VERIFIED':
      return countedCount === 1
        ? 'Mevcut tek güncel kanıta göre önemli bir sorun görünmüyor.'
        : 'Mevcut güncel verilere göre önemli bir sorun görünmüyor.';
    case 'NO_EVIDENCE':
      return 'Araçtan yeterli güncel ölçüm alınamadı. Sağlık durumu değerlendirilemiyor.';
  }
}

/** Kullanıcıya gösterilecek "son kontrol" metni. Bilinmiyorsa uydurulmaz. */
export function healthMeasuredAtLabel(s: VehicleHealthSummary, now: number): string {
  if (s.measuredAt === null) return 'Son kontrol bilinmiyor';
  return `Son kontrol: ${agoLabel(now - s.measuredAt)}`;
}
