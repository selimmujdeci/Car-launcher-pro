/**
 * dtcCoverageModel — DTC SINIF KAPSAMININ SAF MODELİ (P0-OBD-09).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React importu YOK.
 * Tüm girdi çağırandan gelir; aynı girdi her zaman aynı çıktıyı verir.
 *
 * ── MODELİN TEK İŞİ ───────────────────────────────────────────────────────
 * "Hangi servis soruldu, ne geldi, ne çözümlendi, hangi oturumda" sorusunu
 * ekrana çevirmek. HÜKÜM ÜRETMEZ — "araç temiz" kararı bu ekranın işi DEĞİL
 * (o karar `dtcVerdict` içinde, kapsam bilgisiyle birlikte verilir).
 *
 * ── NEDEN BU EKRAN VAR ────────────────────────────────────────────────────
 * P0-OBD-09'un kök nedeni bir ÇÖZÜMLEYİCİ hatasıydı: Mode 07 yanıtındaki
 * `P0089` dolgulu çerçevede kayboluyor ve yerine OLMAYAN kodlar (P0100/B0900)
 * üretiliyordu. Hata hiçbir ekranda görünmediği için sessizce yaşadı.
 * Bu ekran ham yanıt ile çözümlenmiş kodu YAN YANA gösterir — aynı sınıftan
 * bir hata bir daha görünmez kalamaz.
 *
 * ── DÜRÜSTLÜK ─────────────────────────────────────────────────────────────
 *  · `okundu` ile `0 kod` AYNI ŞEY DEĞİLDİR; "kod yok" ≠ "arıza yok".
 *  · `düştü` bir kapsam KAYBIDIR ve asla `ok` tonunda gösterilmez.
 *  · Ham yanıt yoksa `UNAVAILABLE` yazılır — boş string "ham geldi ama boştu"
 *    demek olurdu (sahte kanıt).
 */

import {
  DTC_CLASS_OF_SERVICE, DTC_CLASS_LABEL,
  type DtcService, type DtcClass,
} from '../obd/dtcClassModel';
import {
  DTC_OUTCOME_LABEL,
  type DtcServiceEvidence, type DtcEvidenceSummary, type DtcReadOutcome,
} from '../obd/dtcScanEvidence';

export type DtcTone = 'ok' | 'warn' | 'bad' | 'muted';

/**
 * Sonuç → ton. `unsupported` bir HATA DEĞİLDİR (araçta o servis yok).
 *
 * P0-OBD-11: `no_response` (ECU sustu) ASLA yeşil gösterilmez — bu turun kök
 * nedeni tam olarak sessizliğin başarı sanılmasıydı.
 */
export function outcomeTone(outcome: DtcReadOutcome): DtcTone {
  switch (outcome) {
    case 'ok':          return 'ok';
    case 'unsupported': return 'muted';
    case 'no_response': return 'bad';
    case 'failed':      return 'bad';
    /* P0-VDK-F1A: sorgu HİÇ gönderilmedi — hata DEĞİL ama kapsam kaybı.
       Yeşil OLAMAZ (ölçüm yok), kırmızı da değil (bir şey düşmedi). */
    case 'deferred':    return 'warn';
    default:            return 'warn';
  }
}

/** Servisin insan-okur adı — UI bunu ELLE yazmaz. */
export function serviceTitle(service: DtcService): string {
  const cls: DtcClass = DTC_CLASS_OF_SERVICE[service];
  return `Mode ${service} — ${DTC_CLASS_LABEL[cls]}`;
}

/* ── Satırlar ───────────────────────────────────────────────────────────── */

export interface DtcEvidenceRow {
  readonly id: string;
  /** "Mode 07 — BEKLEYEN" */
  readonly title: string;
  /** ECU etiketi ya da "FONKSİYONEL (7DF)". */
  readonly target: string;
  /** "okundu" · "düştü" · "desteklenmiyor". */
  readonly outcome: string;
  readonly tone: DtcTone;
  /** Çözümlenen kodlar; boşsa "0 kod". */
  readonly codes: string;
  /** Ham yanıt ya da `UNAVAILABLE`. */
  readonly raw: string;
  /** Oturum mührü. */
  readonly epoch: string;
  /** Hata metni; yoksa `null`. */
  readonly error: string | null;
  /** P0-OBD-11 — hatta gönderilen komut ("03"/"07"/"0A"). */
  readonly tx: string;
  /** Okuma anındaki aktif protokol; ölçülmediyse `UNAVAILABLE`. */
  readonly protocol: string;
  /** Okuma süresi; ölçülmediyse `UNAVAILABLE`. */
  readonly elapsed: string;
  /**
   * Bu okumadan ÖNCE tarama içinde kurtarma (ATPC/reinit) oldu mu.
   * `null` = ölçülmedi (eski native yol).
   */
  readonly recoveredBefore: boolean | null;
}

/** Ölçülemeyen alan için TEK gösterim — ekranlar bunu elle yazmaz. */
export const NA = 'UNAVAILABLE';

/**
 * Kanıt kayıtlarını ekran satırlarına çevirir (EN YENİ ÖNCE).
 *
 * @param entries kanıt defteri (ham)
 * @param currentEpoch ŞU ANKİ OBD oturumu; verilirse BAŞKA oturumun kaydı
 *   ELENİR (yeniden bağlanma sonrası eski kanıt ekranda kalmaz). `null` →
 *   eleme yapılmaz ve bu durum `mixedEpochs` ile ayrıca görünür.
 */
export function buildEvidenceRows(
  entries: readonly DtcServiceEvidence[],
  currentEpoch: number | null,
): DtcEvidenceRow[] {
  const rows: DtcEvidenceRow[] = [];
  /* P0-OBD-11 — TARAMA ORTASINDA KURTARMA. Kayıtlar zaman sırasındadır; bir
     okumanın `recoveryCount`u bir öncekinden BÜYÜKSE aralarında ATPC/reinit
     olmuştur. Aynı oturum numarası bunu GİZLER (epoch değişmez) — bu yüzden
     ayrıca ölçülür. */
  const recoveredAt = new Set<number>();
  let prevRec: number | null = null;
  for (let i = 0; i < entries.length; i++) {
    const rc = entries[i].recoveryCount;
    if (typeof rc === 'number') {
      if (prevRec !== null && rc > prevRec) recoveredAt.add(i);
      prevRec = rc;
    }
  }

  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (currentEpoch !== null && e.sessionEpoch !== currentEpoch) continue;
    rows.push({
      id:      `${e.service}-${e.ecuTxHeader ?? 'func'}-${e.atMs}-${i}`,
      title:   serviceTitle(e.service),
      target:  e.ecuLabel !== null && e.ecuLabel.length > 0
        ? `${e.ecuLabel}${e.ecuTxHeader ? ` (${e.ecuTxHeader})` : ''}`
        : 'FONKSİYONEL (7DF)',
      outcome: DTC_OUTCOME_LABEL[e.outcome],
      tone:    outcomeTone(e.outcome),
      /* P0-OBD-11: "0 kod" YALNIZ gerçekten okunmuş bir yanıt için yazılır.
         ECU sustuysa/okuma düştüyse kod alanı UNAVAILABLE'dır — "0 kod" yazmak
         "kod yok" demektir ve bu turun kapattığı yalanın ta kendisidir. */
      codes:   e.outcome !== 'ok' ? NA
             : e.codes.length > 0 ? e.codes.join(' · ')
             : '0 kod',
      raw:     e.raw !== null && e.raw.length > 0 ? e.raw : NA,
      epoch:   String(e.sessionEpoch),
      error:   e.error,
      tx:      e.service,
      /* Alanlar SAVUNMACI okunur: defterde eski (yeni alanları taşımayan) bir
         kayıt bulunabilir. Eksik alan `UNAVAILABLE`dır — ekranı düşürmez ve
         sahte değer ÜRETMEZ. */
      protocol: typeof e.protocol === 'string' && e.protocol.length > 0 ? `ATDPN ${e.protocol}` : NA,
      elapsed:  typeof e.elapsedMs === 'number' ? `${e.elapsedMs} ms` : NA,
      recoveredBefore: typeof e.recoveryCount === 'number' ? recoveredAt.has(i) : null,
    });
  }
  return rows;
}

/* ── Servis özeti (üst şerit) ───────────────────────────────────────────── */

export interface DtcServiceTile {
  readonly service: DtcService;
  readonly title: string;
  /** "3 okuma · 2 ok · 1 düştü" */
  readonly detail: string;
  /** "2 kod" ya da "0 kod"; hiç okunmadıysa `UNAVAILABLE`. */
  readonly codes: string;
  readonly tone: DtcTone;
  /** Hiç denenmediyse `true` — "temiz" demenin YASAK olduğu durum. */
  readonly notAsked: boolean;
}

const SERVICES: readonly DtcService[] = ['03', '07', '0A'];

/** Özeti üç sabit karoya çevirir — servis eksikse KARO YİNE görünür. */
export function buildServiceTiles(summary: DtcEvidenceSummary): DtcServiceTile[] {
  return SERVICES.map((service) => {
    const s = summary.byService[service];
    const notAsked = s === undefined || s.attempts === 0;
    if (notAsked) {
      return {
        service,
        title:  serviceTitle(service),
        detail: 'HİÇ SORULMADI',
        codes:  NA,
        tone:   'warn' as const,   // sorulmamış servis "temiz" DEĞİLDİR
        notAsked: true,
      };
    }
    const parts = [`${s.attempts} okuma`];
    if (s.okCount > 0)          parts.push(`${s.okCount} ok`);
    if (s.noResponseCount > 0)  parts.push(`${s.noResponseCount} ECU SUSTU`);
    if (s.failedCount > 0)      parts.push(`${s.failedCount} düştü`);
    if (s.unsupportedCount > 0) parts.push(`${s.unsupportedCount} desteklenmiyor`);
    /* Ton: bir okuma bile DÜŞTÜYSE ya da ECU SUSTUYSA kapsam kısmidir →
       asla `ok` gösterme (P0-OBD-11). */
    const tone: DtcTone = (s.failedCount > 0 || s.noResponseCount > 0) ? 'bad'
      : s.okCount > 0 ? 'ok'
      : 'muted';
    return {
      service,
      title:  serviceTitle(service),
      detail: parts.join(' · '),
      /* Kod sayısı YALNIZ başarılı okuma varsa anlamlıdır. */
      codes:  s.okCount > 0 ? `${s.uniqueCodes} kod` : NA,
      tone,
      notAsked: false,
    };
  });
}

/* ── Üst düzey görünüm ──────────────────────────────────────────────────── */

/* ── P0-OBD-FINAL-01 · ECU KEŞİF & ADRESLENEBİLİRLİK SATIRLARI ──────────── */

/**
 * Bir ECU adayının keşif künyesi — "keşif gözlemleri boş" ekranının yerine
 * geçen ölçülmüş cevap.
 *
 * Her alan bir SORUYU kapatır:
 *  · `source`         — bu kayıt hangi GÖZLEMDEN doğdu (fonksiyonel/fiziksel)?
 *  · `route`          — istek nereye gidiyor, cevap nereden geliyor (tx/rx)?
 *  · `txRule`         — tx hangi standarttan TÜRETİLDİ (uydurulmadı mı)?
 *  · `addressability` — o adrese istek GERÇEKTEN ulaşıyor mu?
 *  · `services`       — hangi servis · alt fonksiyon · ne döndü (ham dahil)?
 *  · `published`      — sonuç kanonik otoriteye YAZILDI mı?
 */
export interface EcuDiscoveryRow {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  readonly route: string;
  readonly txRule: string;
  readonly protocol: string;
  readonly epoch: string;
  readonly probeOutcome: string;
  readonly addressability: string;
  readonly addressabilityReason: string;
  readonly admission: string;
  readonly kwpTarget: string;
  readonly published: string;
  readonly tone: DtcTone;
  readonly services: readonly string[];
  /** Ham yanıtlar (servis → hex); ölçülmediyse satır HİÇ üretilmez. */
  readonly raws: readonly string[];
}

const TX_RULE_LABEL: Readonly<Record<string, string>> = {
  can_11bit_standard: 'ISO 15765-4 11-bit (rx−8)',
  can_29bit_standard: 'ISO 15765-4 29-bit (18DA<src>F1)',
  kwp_iso14230:       'ISO 14230-4 fiziksel (81<src>F1)',
  kwp_iso9141:        'ISO 9141-2 fiziksel (68<src>F1)',
  unknown:            'TÜRETİLEMEDİ — istek gönderilmez',
};

const ADDRESSABILITY_TONE: Readonly<Record<string, DtcTone>> = {
  PROVEN:          'ok',
  NOT_ADDRESSABLE: 'bad',
  NOT_ATTEMPTED:   'warn',
  UNKNOWN:         'warn',
};

/** Girdi tipi YAPISALDIR — model `obd/` katmanını IMPORT ETMEZ (saflık). */
export interface EcuDiscoveryObservationInput {
  readonly atMs: number;
  readonly sessionEpoch: number;
  readonly protocol: string | null;
  readonly rxHeader: string;
  readonly txHeader: string | null;
  readonly addressBits: number;
  readonly label: string;
  readonly discoverySource: string;
  readonly probeOutcome: string;
  readonly txProvenance: string;
  readonly addressability: string;
  readonly addressabilityReason: string;
  readonly admission: string;
  readonly kwpTargetVerified: boolean;
  readonly publishedToAuthority: boolean | null;
  readonly attempts: ReadonlyArray<{
    readonly service: string;
    readonly subFunction: string | null;
    readonly outcome: string | null;
    readonly raw: string | null;
    readonly codeCount: number;
  }>;
}

export function buildEcuDiscoveryRows(
  observations: readonly EcuDiscoveryObservationInput[],
  currentEpoch: number | null,
): EcuDiscoveryRow[] {
  const rows: EcuDiscoveryRow[] = [];
  for (let i = observations.length - 1; i >= 0; i--) {
    const o = observations[i];
    if (currentEpoch !== null && o.sessionEpoch !== currentEpoch) continue;
    rows.push({
      id:    `${o.addressBits}-${o.rxHeader}-${o.atMs}`,
      title: `${o.label} · ${o.addressBits}-bit`,
      source: o.discoverySource,
      route:  `tx ${o.txHeader ?? NA} → rx ${o.rxHeader}`,
      txRule: TX_RULE_LABEL[o.txProvenance] ?? o.txProvenance,
      protocol: o.protocol !== null && o.protocol.length > 0 ? `ATDPN ${o.protocol}` : NA,
      epoch: String(o.sessionEpoch),
      probeOutcome: o.probeOutcome,
      addressability: o.addressability,
      addressabilityReason: o.addressabilityReason,
      admission: o.admission,
      /* KWP hedefi "doğrulanmadı" ile "sorulmadı" AYRI gösterilir. */
      kwpTarget: o.addressBits === 8
        ? (o.kwpTargetVerified ? 'DOĞRULANDI — 0x18 gönderilebilir' : 'DOĞRULANMADI — 0x18 GÖNDERİLMEZ')
        : 'uygulanmaz (CAN)',
      published: o.publishedToAuthority === null ? NA
        : o.publishedToAuthority ? 'kanonik otoriteye YAZILDI' : 'YAZILAMADI',
      tone: ADDRESSABILITY_TONE[o.addressability] ?? 'muted',
      services: o.attempts.map((a) =>
        `${a.service}${a.subFunction === null ? '' : `-${a.subFunction}`}: ${a.outcome ?? NA} (${a.codeCount} kod)`),
      /* Ham yanıt YOKSA satır üretilmez — boş string "ham geldi ama boştu"
         demektir ve sahte kanıttır. */
      raws: o.attempts
        .filter((a) => typeof a.raw === 'string' && a.raw.length > 0)
        .map((a) => `${a.service}: ${a.raw}`),
    });
  }
  return rows;
}

/* ── Üst düzey görünüm ──────────────────────────────────────────────────── */

export interface DtcCoverageView {
  readonly tiles: readonly DtcServiceTile[];
  readonly rows: readonly DtcEvidenceRow[];
  /** Şu anki oturum; okunamadıysa `UNAVAILABLE`. */
  readonly epochLabel: string;
  /**
   * Defter birden fazla oturum taşıyor mu — `true` ise oturum sıfırlaması
   * KAÇIRILMIŞ demektir (teşhis sinyali, sessizce yutulmaz).
   */
  readonly mixedEpochs: boolean;
  /** Hiç kanıt yoksa `true` — ekran "temiz" DEMEZ, "tarama yapılmadı" der. */
  readonly empty: boolean;
  /** P0-OBD-FINAL-01 — ECU keşif/adreslenebilirlik satırları. */
  readonly ecuRows: readonly EcuDiscoveryRow[];
  /**
   * Keşif gözlemi YOK. Bu, "araçta ECU yok" DEĞİL, "tam araç taraması bu
   * oturumda hiç koşmadı ya da tek aday üretmedi" demektir — ekran bu cümleyi
   * AÇIKÇA yazar, boş liste bırakmaz.
   */
  readonly ecuEmpty: boolean;
}

export function buildDtcCoverageView(
  entries: readonly DtcServiceEvidence[],
  summary: DtcEvidenceSummary,
  currentEpoch: number | null,
  observations: readonly EcuDiscoveryObservationInput[] = [],
): DtcCoverageView {
  const rows = buildEvidenceRows(entries, currentEpoch);
  const ecuRows = buildEcuDiscoveryRows(observations, currentEpoch);
  return {
    tiles:       buildServiceTiles(summary),
    rows,
    epochLabel:  currentEpoch === null ? NA : String(currentEpoch),
    mixedEpochs: summary.mixedEpochs,
    empty:       rows.length === 0,
    ecuRows,
    ecuEmpty:    ecuRows.length === 0,
  };
}
