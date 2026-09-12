/**
 * dtcCoverageGapBridge — P0-VDK-F6D · TANI KAPSAMI BOŞLUĞU → KANONİK BOŞLUK SİCİLİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── KAPATILAN KÖK NEDEN ───────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F6-C `measurableGapUnits` üretiyordu ama **o sayı hiçbir yere gitmiyordu.**
 * Üretimde `recordGap`in TEK çağıranı `discovery/serviceDiscoveryRuntime`ti;
 * yani tanı kapsamı boşlukları `gapRegistry`ye **HİÇ DÜŞMÜYORDU** ve F5
 * resolver onları **GÖREMİYORDU**. Self-Healing, ürünün ölçtüğü en değerli
 * eksikliği (okunamayan DTC kanalı) bilmeden çalışıyordu.
 *
 * Bu dosya o köprüdür. **BAŞKA HİÇBİR ŞEY DEĞİLDİR.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NE DEĞİLDİR (pazarlıksız) ─────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Sicil DEĞİL · zamanlayıcı DEĞİL · çözücü DEĞİL · durum sahibi DEĞİL ·
 * ikinci skor/bütçe/oturum/taşıma otoritesi DEĞİL.
 * SAF: I/O yok · timer yok · `Date.now` yok · global durum yok · React yok.
 *
 * Yaptığı tek şey ÇEVİRİDİR:
 *   kapsam satırı → MEVCUT `ReplayGapSignal` → MEVCUT `GapEvidence`
 *                 → MEVCUT `RecordGapInput`
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── DOĞRULANMIŞ ROUND-TRIP (bu köprünün kanıtı) ───────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Ürettiğim sinyal + kapsam, resolver'ın `resolutionPolicy.classifyRootCause`
 * fonksiyonunda **BİREBİR aynı kök nedene** geri çözülür. Yani kök nedeni iki
 * yerde hesaplamıyorum: burada seçtiğim sinyal, oradaki otoritenin AYNI
 * sonucu üretmesini sağlayan girdidir. Test bu döngüyü kilitler.
 */

import type { GapScope, RecordGapInput } from '../gapRegistry';
import { buildGapEvidence, type GapEvidence } from '../gapEvidence';
import type { ReplayGapSignal } from '../virtualTransport';
import type { RootCauseClass } from './gapModel';
import type { CapabilityProvenance } from '../capability/capabilityGraph';
import type { PduOutcome } from '../pdu';
import type { ServicePresence } from '../ecuCapabilityModel';
import type { DtcCoverageAxis, DtcCoverageOutcome } from '../dtcCoveragePlan';

/* ══════════════════════════════════════════════════════════════════════════
   1) GİRDİ — kapsam defterinin SAF görünümü (servis importu YOK)
   ══════════════════════════════════════════════════════════════════════════ */

/** Bir kapsam satırının köprü için gereken alanları. */
export interface CoverageGapRowInput {
  readonly axis: DtcCoverageAxis;
  readonly service: string;
  readonly subFunction: string | null;
  readonly outcome: DtcCoverageOutcome;
  readonly gapRoot: RootCauseClass | null;
  readonly skipReason: string | null;
  /** `advancedDtcEvidence` sözlüğündeki ölçüm sonucu; sorgu gitmediyse `null`. */
  readonly measuredOutcome: string | null;
  /** Bu sınıf için hatta ÇIKAN istek sayısı. 0 = tek bayt çıkmadı. */
  readonly requestCount: number;
  /** Kapsam sınıfının kimliği — bağlam künyesine girer. */
  readonly cls: string;
}

/** Bir uç noktanın köprü için gereken alanları. */
export interface CoverageGapEndpointInput {
  readonly ecuKey: string;
  readonly txHeader: string | null;
  readonly rxHeader: string;
  readonly protocol: string | null;
  readonly provenance: CapabilityProvenance;
  readonly atMs: number;
  readonly sessionEpoch: number;
  readonly transactionId: string | null;
  readonly evidenceCorrelationId: string | null;
  readonly vehicleRef: string | null;
  readonly rows: readonly CoverageGapRowInput[];
}

/* ══════════════════════════════════════════════════════════════════════════
   2) ÇIKTI
   ══════════════════════════════════════════════════════════════════════════ */

export interface CoverageGapCandidate {
  /** MEVCUT sicil çağrısının girdisi — `recordGap(...)` bunu aynen alır. */
  readonly record: RecordGapInput;
  /** Hangi eksenden geldi — CORE her zaman DEEP'ten önce ele alınır. */
  readonly axis: DtcCoverageAxis;
  /** Bu köprünün SEÇTİĞİ kök neden; resolver AYNISINI türetir (round-trip). */
  readonly root: RootCauseClass;
  /**
   * Ölçümle KAPANABİLİR mi. `false` ise boşluk yine görünür olur ama hiçbir
   * PDU üretmez — kararın son sahibi yine `resolutionPolicy`dir.
   */
  readonly measurementResolvable: boolean;
  /** Sıralama anahtarı — deterministik, tam sayı. */
  readonly priority: number;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) SİNYAL EŞLEMESİ — yeni sözlük YAZILMADI
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Kök neden → MEVCUT `ReplayGapSignal`.
 *
 * ⚠️ Bu tablo `resolutionPolicy.classifyRootCause`in TERSİDİR ve testle
 * round-trip kilitlenir. Yeni bir sinyal adı ÜRETİLMEZ.
 */
export function coverageGapSignal(
  root: RootCauseClass, subFunction: string | null,
): ReplayGapSignal | null {
  switch (root) {
    case 'CAPABILITY_UNMEASURED':
      /* Alt fonksiyon biliniyorsa boşluk ONA aittir: `19-02` susmasıyla
         `19-0A` susması AYRI teşhislerdir ve tek satıra ezilemez. */
      return subFunction === null ? 'UNKNOWN_SERVICE' : 'UNKNOWN_SUBFUNCTION';
    case 'SESSION_CONDITIONED':
      /* Kapsam `SESSION` olduğu için `_gapFromRegistry` bunu
         `sessionConditioned` sayar ve F5-C yolunu açar. */
      return 'CAPABILITY_GAP';
    case 'TRANSPORT_BOUND':
      return 'TRANSPORT_LIMITATION';
    case 'PARSER_BOUND':
      return 'PARSER_GAP';
    case 'ATTRIBUTION_UNRESOLVED':
      return 'UNKNOWN_ECU_ATTRIBUTION';
    /* Bu ikisi YETENEK ÇİZGESİNİN kendi kökenleridir (`_gapFromEdge`);
       kapsam satırından ÜRETİLMEZ — aynı gerçeği iki kapıdan yazmak
       sicilde çift kayıt demek olurdu. */
    case 'CAPABILITY_STALE':
    case 'CAPABILITY_CONTESTED':
    case 'UNKNOWN':
    default:
      return null;
  }
}

/** Kök neden → sicil kapsamı. `SESSION`/`TRANSPORT` resolver kararına GİRER. */
export function coverageGapScope(root: RootCauseClass): GapScope {
  switch (root) {
    case 'SESSION_CONDITIONED': return 'SESSION';
    case 'TRANSPORT_BOUND':     return 'TRANSPORT';
    case 'PARSER_BOUND':        return 'PARSER';
    default:                    return 'AUTHORITY';
  }
}

/**
 * Deterministik bağlam künyesi.
 *
 * `serviceDiscoveryRuntime` `discovery:<svc><sub>` yazar; bu köprü AYRI bir
 * önek kullanır ki iki üretici aynı satıra ezilmesin. Hedef bilgisi bağlamdan
 * DEĞİL, zarftan (`GapEvidence.service`) okunur — `targetFromContext` bu
 * önek için hedef üretmez ve üretmemelidir (uydurma hedef YASAK).
 */
export function coverageGapContext(axis: DtcCoverageAxis, cls: string): string {
  return `dtc_coverage:${axis}:${cls}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   4) ÖLÇÜM SONUCU → KANONİK SINIFLAR
   ══════════════════════════════════════════════════════════════════════════ */

/** `advancedDtcEvidence` sözlüğü → `PduOutcome`. Ölçülmediyse `null`. */
export function coveragePduOutcome(measured: string | null): PduOutcome | null {
  switch (measured) {
    case 'ok':                 return 'POSITIVE';
    case 'unsupported':
    case 'security_required':
    case 'condition_required': return 'NEGATIVE';
    case 'no_response':        return 'NO_RESPONSE';
    case 'timeout':            return 'TIMEOUT';
    case 'malformed':          return 'MALFORMED';
    case 'transport_error':    return 'TRANSPORT_ERROR';
    case 'not_addressable':    return 'NOT_ADDRESSABLE';
    /* Standart mod durumları (`EcuModeStatus`) — aynı defterden gelir. */
    case 'failed':             return 'TRANSPORT_ERROR';
    case 'deferred':           return null;
    default:                   return null;
  }
}

/**
 * `PduOutcome` → `ServicePresence`.
 *
 * **İKİNCİ SINIFLANDIRICI DEĞİLDİR:** F4-B `deriveServicePresence` NRC ister,
 * kapsam satırı NRC TAŞIMAZ (yalnız sonuç sınıfı). Bu yüzden burada yalnız
 * NRC'siz dallar kullanılır ve **hiçbir dal `ABSENT` ÜRETMEZ** — "servis yok"
 * demek yalnız ölçülmüş `NRC 0x11` ile mümkündür ve o karar F4-B'nindir.
 */
export function coveragePresence(o: PduOutcome | null): ServicePresence | null {
  switch (o) {
    case 'POSITIVE':                   return 'PRESENT';
    /* Negatif yanıt geldi ama NRC ölçülmedi → F4-B kuralı: servis VAR,
       erişim koşullu. `ABSENT` DEMEK için 0x11 görmek ŞARTTIR. */
    case 'NEGATIVE':                   return 'PRESENT_BUT_CONDITIONED';
    case 'NO_RESPONSE':
    case 'TIMEOUT':
    case 'TRANSPORT_ERROR':            return 'UNKNOWN';
    case 'MALFORMED':                  return 'UNKNOWN_RESPONSE_SHAPE';
    case 'NOT_ADDRESSABLE':            return 'UNKNOWN_ADDRESSING';
    case 'NOT_SUPPORTED_BY_TRANSPORT': return 'UNKNOWN_TRANSPORT_LIMIT';
    default:                           return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   5) HANGİ SATIR BOŞLUK ÜRETİR
   ══════════════════════════════════════════════════════════════════════════ */

/** Boşluk üretilmeme gerekçesi — kapalı sözlük, LAB bunu gösterir. */
export type CoverageGapRejection =
  /** Terminal başarı / ölçülmüş yokluk / plan dışı — eksiklik DEĞİL. */
  | 'NOT_A_GAP'
  /** Sorgu hiç gitmedi (bütçe · ön koşul) — AYNI turda boşluk ÜRETİLMEZ. */
  | 'NOT_MEASURED_THIS_RUN'
  /** Ürün sınırı (kapı/tanım) — araç ölçümü DEĞİL, sicile yazılmaz. */
  | 'PRODUCT_LIMIT_NOT_VEHICLE_MEASUREMENT'
  /** Kök neden kapsam satırından üretilmez (yetenek çizgesinin işi). */
  | 'OWNED_BY_CAPABILITY_GRAPH';

export const COVERAGE_GAP_REJECTION_LABEL:
Readonly<Record<CoverageGapRejection, string>> = {
  NOT_A_GAP: 'eksiklik DEĞİL — terminal ölçüm',
  NOT_MEASURED_THIS_RUN: 'bu turda ölçülmedi — aynı turda yeniden denenmez',
  PRODUCT_LIMIT_NOT_VEHICLE_MEASUREMENT: 'ürün/kapı sınırı — araç ölçümü değil',
  OWNED_BY_CAPABILITY_GRAPH: 'bu kök neden yetenek çizgesine aittir',
} as const;

/**
 * Bu satır boşluk üretir mi — SAF karar.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÜÇ BİLİNÇLİ RET ───────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * ① **Terminal satır boşluk DEĞİLDİR.** `COMPLETE` (pozitif yanıt, 0 kod
 *    dâhil) · `UNSUPPORTED_MEASURED` (ECU 7F-11 dedi) · `NOT_APPLICABLE`
 *    (protokol ailesi uymuyor) ölçülmüş GERÇEKLERDİR.
 *
 * ② **HİÇ ÖLÇÜLMEMİŞ satır bu turda boşluk ÜRETMEZ.** Bütçe bittiği ya da ön
 *    koşul (0x19-06 için ölçülmüş DTC) olmadığı için gönderilmemiş bir sorgu
 *    hemen ardından gelen iyileştirme turunda yeniden denenirse **kendi
 *    kendini yiyen bir döngü** olur: bütçe zaten bitmişti. Kapsam her taramada
 *    yeniden hesaplandığı için bu satır bir sonraki turda kendiliğinden
 *    yeniden ölçülür.
 *
 * ③ **KAPI/TANIM sınırı sicile YAZILMAZ.** `19-04` her CAN ECU'sunda kalıcı
 *    olarak engellidir; bu bir ARAÇ ölçümü değil, ÜRÜN sınırıdır. Sicile
 *    yazmak her araca kalıcı ve asla kapanmayacak satırlar eklerdi. Durum
 *    zaten F6-C kapsam kartında `ENGELLİ` olarak GÖRÜNÜR.
 *    Ölçülmüş taşıma hatası (`transport_error`) bunun DIŞINDADIR — o gerçek
 *    bir araç/hat ölçümüdür ve boşluk üretir.
 */
export function coverageGapRejection(
  row: CoverageGapRowInput,
): CoverageGapRejection | null {
  if (row.outcome === 'COMPLETE' || row.outcome === 'UNSUPPORTED_MEASURED'
      || row.outcome === 'NOT_APPLICABLE') return 'NOT_A_GAP';
  if (row.gapRoot === null) return 'NOT_A_GAP';
  if (row.gapRoot === 'CAPABILITY_STALE' || row.gapRoot === 'CAPABILITY_CONTESTED') {
    return 'OWNED_BY_CAPABILITY_GRAPH';
  }
  if (row.gapRoot === 'UNKNOWN') return 'NOT_A_GAP';
  /* ② ve ③: hatta tek bayt çıkmadıysa bu tur için ölçüm YOKTUR. */
  if (row.requestCount === 0 || row.measuredOutcome === null) {
    return row.outcome === 'BLOCKED'
      ? 'PRODUCT_LIMIT_NOT_VEHICLE_MEASUREMENT'
      : 'NOT_MEASURED_THIS_RUN';
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
   6) CORE > DEEP ÖNCELİĞİ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Deterministik tam sayı önceliği — **küçük olan ÖNCE** ele alınır.
 *
 * ⚠️ İKİNCİ SKOR MOTORU DEĞİLDİR: aday seçimi ve puanlama yine
 * `resolutionPolicy.scoreCandidate`tedir. Bu sayı yalnız **hangi boşluğun
 * sıraya önce gireceğini** belirler — bütçe azken temel arıza hafızası
 * kapsamının, kayıt başına derin kanıtın (19-03/19-06) ARKASINDA kalmasını
 * engeller.
 *
 * Sıra (görev §9):
 *   1 CORE capability · 2 CORE session · 3 CORE attribution ·
 *   4 CORE transport  · 5 CORE parser  · 6+ aynı sıra DEEP için (+10)
 */
export function coverageGapPriority(
  axis: DtcCoverageAxis, root: RootCauseClass,
): number {
  const base =
      root === 'CAPABILITY_UNMEASURED'   ? 1
    : root === 'SESSION_CONDITIONED'     ? 2
    : root === 'ATTRIBUTION_UNRESOLVED'  ? 3
    : root === 'TRANSPORT_BOUND'         ? 4
    : root === 'PARSER_BOUND'            ? 5
    : 9;
  /* DEEP eksen HER ZAMAN tüm CORE sınıflarının ARKASINDA. */
  return axis === 'core' ? base : base + 10;
}

/** Ölçümle kapanabilir mi — `gapModel.isMeasurementResolvable` ile AYNI ilke. */
function _resolvable(root: RootCauseClass): boolean {
  /* PARSER_BOUND: ECU zaten doğru cevap veriyor; aynı isteği tekrar göndermek
     AYNI çözülemeyen baytı getirir → bilgi kazancı SIFIR, israf. */
  if (root === 'PARSER_BOUND' || root === 'UNKNOWN') return false;
  /* TRANSPORT_BOUND: yalnız F1-C güvenli tuning yolu VARSA — kararı
     `resolutionPolicy.candidatesFor` verir, burada iddia edilmez. */
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════
   7) PLAN — SAF ÇEVİRİ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Kapsam defterini kanonik boşluk kayıtlarına çevirir (SAF · DETERMİNİSTİK).
 *
 * Hiçbir şey YAZMAZ — çağıran `recordGap(c.record)` ile mevcut sicile yazar.
 * Sıra: önce öncelik (CORE < DEEP), sonra uç nokta, sonra sınıf — iki tur
 * arasında karşılaştırılabilir olsun diye tamamen deterministik.
 */
export function planCoverageGaps(
  endpoints: readonly CoverageGapEndpointInput[],
): readonly CoverageGapCandidate[] {
  const out: CoverageGapCandidate[] = [];

  for (const ep of endpoints) {
    for (const row of ep.rows) {
      if (coverageGapRejection(row) !== null) continue;
      const root = row.gapRoot;
      if (root === null) continue;
      const signal = coverageGapSignal(root, row.subFunction);
      if (signal === null) continue;

      const pduOutcome = coveragePduOutcome(row.measuredOutcome);
      const evidence: GapEvidence | null = buildGapEvidence({
        observation: {
          ecuKey: ep.ecuKey,
          txHeader: ep.txHeader,
          rxHeader: ep.rxHeader,
          service: row.service,
          subFunction: row.subFunction,
          /* Ham istek gövdesi kapsam defterinde YOKTUR — uydurulmaz. */
          requestIdentity: null,
          outcome: pduOutcome,
          /* NRC kapsam satırında ÖLÇÜLMEZ → `null`. Sahte 0 YASAK. */
          nrc: null,
          classification: coveragePresence(pduOutcome),
          sessionOpened: null,
          sessionCommand: null,
          transportKind: null,
          protocol: ep.protocol,
          traceCorrelationId: ep.evidenceCorrelationId,
          atMs: ep.atMs,
        },
        transactionId: ep.transactionId,
        evidenceCorrelationId: ep.evidenceCorrelationId,
        sessionEpoch: ep.sessionEpoch,
        provenance: ep.provenance,
        vehicleFingerprintRef: ep.vehicleRef,
        ecuFingerprintRef: ep.ecuKey,
      });

      out.push({
        record: {
          signal,
          scope: coverageGapScope(root),
          context: coverageGapContext(row.axis, row.cls),
          atMs: ep.atMs,
          evidence,
        },
        axis: row.axis,
        root,
        measurementResolvable: _resolvable(root),
        priority: coverageGapPriority(row.axis, root),
      });
    }
  }

  return out.sort((a, b) =>
    a.priority - b.priority
    || a.record.context.localeCompare(b.record.context)
    || (a.record.evidence?.ecuKey ?? '').localeCompare(b.record.evidence?.ecuKey ?? ''));
}

/* ═══════════════════════════════════════════════════════════════════════
   8) GERİ DÖNÜŞ — İYİLEŞTİRME ÖLÇÜMÜ → KAPSAM SINIFI
   ═══════════════════════════════════════════════════════════════════════ */

/** Kapsam bağlamının çözülmüş hâli; bağlam bu köprüye ait değilse `null`. */
export interface ParsedCoverageContext {
  readonly axis: DtcCoverageAxis;
  readonly cls: string;
}

/**
 * `dtc_coverage:<axis>:<cls>` bağlamını çözer.
 *
 * Başka bir üreticinin bağlamı (ör. `discovery:1902`) `null` döner — bu köprü
 * yalnız KENDİ yazdığı boşlukları geri okur; başka bir üreticinin ölçümünü
 * kapsam satırına yazmak sessiz bir karışma olurdu.
 */
export function parseCoverageContext(context: string): ParsedCoverageContext | null {
  const m = /^dtc_coverage:(core|deep):([A-Z0-9_]+)$/.exec(context.trim());
  if (m === null) return null;
  return { axis: m[1] as DtcCoverageAxis, cls: m[2] };
}

/** Bu bağlam DERİN eksene mi ait — çözüm SIRASI için (CORE her zaman önce). */
export function isDeepCoverageContext(context: string): boolean {
  return parseCoverageContext(context)?.axis === 'deep';
}

/**
 * İyileştirme ölçümünün sonucu → YENİ kapsam sınıfı.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ── NEDEN BU EŞLEME (ve neden KıSAYOL DEĞİL) ──────────────────────
 * ═══════════════════════════════════════════════════════════════════════
 * Çözücünün ölçümü, taramanın gönderdiğİ İSTEĞİN AYNISIDIR (aynı F4-B/F4-A
 * yolundan `19 02 …`, `03`, `18 …`). Bu yüzden sonucu kapsam sınıfına çevirmek
 * bir KıSAYOL DEĞİL, aynı ölçümün aynı dile çevrilmesidir.
 *
 * ÜÇ PAZARLIKSIZ KURAL:
 *  ① `ABSENT` (ECU 7F-11 dedi) → `UNSUPPORTED_MEASURED`. Terminal ve KESİN.
 *  ② `PRESENT` (pozitif yanıt) → `COMPLETE`. F6-C'nin KENDİ kuralıyla
 *     TUTARLIDIR: `coverageOutcomeFromAdvanced('ok', 'UNKNOWN') === 'COMPLETE'`
 *     — beyan/ölçüm çapraz kontrolü yalnız 19-01 AYNI okumada ölçüldüyse
 *     uygulanır; ölçülmediyse okuma yine TERMİNALDİR. Yeni bir gevşeklik
 *     İCAT EDİLMEDİ.
 *  ③ `PRESENT_BUT_CONDITIONED` (oturum/koşul reddi) → `UNKNOWN`.
 *     **Oturumun açılmış olması BAŞARI DEĞİLDİR**; aynı koşullu yanıt geri
 *     geldiyse kanal hâlâ OKUNAMAMIŞTIR (görev §12).
 *
 * Ölçüm yoksa `null` — kapsam satırına DOKUNULMAZ.
 */
export function coverageOutcomeFromHealing(
  lastOutcome: string | null | undefined,
): DtcCoverageOutcome | null {
  if (typeof lastOutcome !== 'string' || lastOutcome.length === 0) return null;
  const classification = lastOutcome.split(':')[0];
  switch (classification) {
    case 'PRESENT':                 return 'COMPLETE';
    case 'ABSENT':                  return 'UNSUPPORTED_MEASURED';
    case 'PRESENT_BUT_CONDITIONED': return 'UNKNOWN';
    case 'UNKNOWN':
    case 'UNKNOWN_TRANSPORT_LIMIT':
    case 'UNKNOWN_ADDRESSING':
    case 'UNKNOWN_RESPONSE_SHAPE':  return 'UNKNOWN';
    /* `NOT_PROBED` / `NO_RECORD` / `PROBE_FORBIDDEN` → ÖLÇÜM YOK. */
    default:                        return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   9) FONKSİYONEL ATIF BOŞLUĞU (P0-VDK-F6D-1)
   ═══════════════════════════════════════════════════════════════════════

   ── NEDEN AYRI BİR ÜRETİCİ ──────────────────────────────────────
   **KAPSAM SATIRI ATIF BOŞLUĞU ÜRETEMEZ** — ve bu bir kusur DEĞİL, tasarımdır:
   F6-C kapsam satırları uç nokta BAŞINA tutulur ve anahtarı `ecuCoverageKey`tir;
   yani sahibi YAPISAL OLARAK bellidir (fiziksel adrese sorduk, o cevapladı).
   Oradan `ATTRIBUTION_UNRESOLVED` üretmek OLMAYAN bir belirsizliği UYDURMAK olurdu.

   Gerçek atıf belirsizliği **FONKSİYONEL (7DF) yayında** yaşar: birden çok ECU
   aynı yayına cevap verir ve çözümleyici sahibini ölçemeyebilir
   (`functionalDtcEvidence.ecuAttribution === 'UNKNOWN'`). O sinyal REPODA ZATEN
   ÜRETİLİYORDU (`functionalDtcGapSignals`) ama **hiçbir `recordGap` çağıranı yoktu**
   — yalnız bir LAB kaynağı okuyordu. Bu köprü o kopukluğu kapatır.

   ── SAHİP UYDURULMAZ ──────────────────────────────────────────
   Zarfın `ecuKey`i **`null`**dır — boşluğun TANIMI zaten "sahibi bilinmiyor"dur.
   Bir sahip yazmak, çözmeye çalıştığımız belirsizliği kendi elimizle
   kapatmış gibi yapmak olurdu. `judgeEvidence` bu yüzden bu boşluğu ancak
   BAĞIMSIZ ölçülmüş sahiplik kanıtıyla kapatır (F6D-1 fail-open kilidi).
*/

/** Fonksiyonel kanıtın köprü için gereken alanları (SAF görünüm). */
export interface FunctionalAttributionInput {
  /** Ölçülen servis ('03' · '07' · '0A'). */
  readonly service: string;
  /** Çözümleyicinin sahiplik ölçümü; `'UNKNOWN'` → boşluk. */
  readonly ecuAttribution: string;
  readonly protocol: string | null;
  readonly provenance: CapabilityProvenance;
  readonly atMs: number;
  readonly sessionEpoch: number;
  readonly transactionId: string | null;
  readonly evidenceCorrelationId: string | null;
  readonly vehicleRef: string | null;
}

/** Fonksiyonel atıf boşluğunun deterministik bağlamı. */
export function functionalAttributionContext(service: string): string {
  return `dtc_attribution:functional:${service.toUpperCase()}`;
}

/**
 * Fonksiyonel atıf belirsizliğini kanonik boşluk kaydına çevirir (SAF).
 *
 * `ecuAttribution !== 'UNKNOWN'` olan kanıt boşluk ÜRETMEZ — sahibi ölçülmüş
 * bir okuma eksiklik değildir.
 */
export function planFunctionalAttributionGaps(
  entries: readonly FunctionalAttributionInput[],
): readonly CoverageGapCandidate[] {
  const out: CoverageGapCandidate[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (e.ecuAttribution !== 'UNKNOWN') continue;
    const ctx = functionalAttributionContext(e.service);
    if (seen.has(ctx)) continue;          // servis başına TEK satır
    seen.add(ctx);
    out.push({
      record: {
        signal: 'UNKNOWN_ECU_ATTRIBUTION',
        scope: 'AUTHORITY',
        context: ctx,
        atMs: e.atMs,
        evidence: buildGapEvidence({
          observation: {
            /* SAHİP UYDURULMAZ: boşluğun tanımı "sahibi bilinmiyor"dur. */
            ecuKey: null, txHeader: null, rxHeader: null,
            service: e.service, subFunction: null,
            requestIdentity: null,
            outcome: 'POSITIVE',
            nrc: null,
            /* Yanıt GELDİ (servis var); ölçülemeyen şey SAHİPLİKTİR. */
            classification: 'PRESENT',
            sessionOpened: null, sessionCommand: null,
            transportKind: null, protocol: e.protocol,
            traceCorrelationId: e.evidenceCorrelationId,
            atMs: e.atMs,
          },
          transactionId: e.transactionId,
          evidenceCorrelationId: e.evidenceCorrelationId,
          sessionEpoch: e.sessionEpoch,
          provenance: e.provenance,
          vehicleFingerprintRef: e.vehicleRef,
        }),
      },
      /* Atıf boşluğu TEMEL eksene aittir: sahibi bilinmeyen bir DTC, arıza
         hafızası kapsamının bir parçasıdır. */
      axis: 'core',
      root: 'ATTRIBUTION_UNRESOLVED',
      /* MEVCUT F6-A kimlik/adres yolu hedefli ölçüm SUNABİLİR — ama kararı
         `resolutionPolicy` verir; burada iddia edilmez. */
      measurementResolvable: true,
      priority: coverageGapPriority('core', 'ATTRIBUTION_UNRESOLVED'),
    });
  }
  return out.sort((a, b) => a.record.context.localeCompare(b.record.context));
}
