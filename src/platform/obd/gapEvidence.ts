/**
 * gapEvidence — P0-VDK-F5D · KANONİK BOŞLUK KANIT ZARFI (saf sözleşme).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLEN KUSUR (bu dosyanın var olma nedeni) ───────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `gapRegistry` bir boşluğu yalnız `(sinyal, bağlam)` olarak tutuyordu. Boşluğu
 * DOĞURAN ölçüm — hangi ECU, hangi servis/alt fonksiyon, hangi NRC, hangi
 * sınıflandırma, hangi işlem/korelasyon — kaydın kendisinde YOKTU. Self-Healing
 * bu bağlamı bulmak için F4-B'nin **tavanlı, süreç ömürlü** yoklama defterine
 * geri dönüyordu (`serviceDiscoveryRuntime.getProbeRecords`).
 *
 * Bu kırılgandı: defter tavanı dolunca (`MAX_PROBE_RECORDS`) ya da oturum
 * değişince **boşluk duruyor ama onu doğuran kanıt kayboluyordu** — çözücü
 * hedefini ve oturum gerekçesini kaybediyordu. Üstelik defter araması yalnız
 * `service`/`subFunction` ile eşleşiyordu: iki ECU'nun aynı servisi tek satıra
 * karışabiliyordu.
 *
 * Bu zarf o bağlamı **boşluğun kendisine** bağlar.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ KANIT DEPOSU DEĞİLDİR.** Burada defter YOKTUR: tek satır bile
 *     saklamaz. Yalnız zarfın BİÇİMİNİ ve kimliğini tanımlar.
 * (2) **İKİNCİ YETENEK OTORİTESİ DEĞİLDİR.** `observedClassification` alanı
 *     MEVCUT `deriveServicePresence` çıktısının KOPYASIDIR; burada yeniden
 *     hesaplanmaz, yorumlanmaz, yükseltilmez.
 * (3) **İKİNCİ OTURUM/NRC SEMANTİĞİ DEĞİLDİR.** Oturum ihtiyacı F5-C
 *     `deriveSessionRequirement`ın işidir; bu zarf ona yalnız ÖLÇÜLMÜŞ girdi
 *     taşır.
 * (4) **HAM GÖVDE TAŞIMAZ.** Ham yanıt · VIN · MAC · konum · token buraya
 *     GİREMEZ. Taşınan tek "ham" alan İSTEK künyesidir (yanıt DEĞİL) ve o da
 *     tavanlıdır.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 */

import type { ServicePresence } from './ecuCapabilityModel';
import type { PduOutcome } from './pdu';
import type { CapabilityProvenance } from './capability/capabilityGraph';

/* ══════════════════════════════════════════════════════════════════════════
   1) KANIT DURUMU — "kanıt yok" ile "kanıt eksik" AYNI ŞEY DEĞİLDİR
   ══════════════════════════════════════════════════════════════════════════ */

export type GapEvidenceState =
  /** Boşluğu doğuran ölçüm künyesi TAM: hedef + sonuç birlikte var. */
  | 'MEASURED'
  /** Zarf var ama çözücünün ihtiyacı olan eksen(ler) ölçülmemiş. */
  | 'LEGACY_INCOMPLETE'
  /** Zarf HİÇ üretilmemiş (F5-D öncesi kayıt ya da kanıtsız üretici). */
  | 'UNAVAILABLE';

export const GAP_EVIDENCE_STATE_LABEL: Readonly<Record<GapEvidenceState, string>> = {
  MEASURED:          'KANIT BAĞI SAĞLAM',
  LEGACY_INCOMPLETE: 'KANIT BAĞI EKSİK — ölçüm künyesi yarım',
  UNAVAILABLE:       'KANIT BAĞI YOK — zarf üretilmemiş',
} as const;

/** Kanıt bağı çözücü için yeterli mi — FAIL-CLOSED. */
export function isGapEvidenceSufficient(ev: GapEvidence | null): boolean {
  return ev !== null && ev.state === 'MEASURED';
}

/* ══════════════════════════════════════════════════════════════════════════
   2) ZARF
   ══════════════════════════════════════════════════════════════════════════ */

/** İstek künyesi tavanı — künye bir kimliktir, bir gövde değildir. */
export const MAX_REQUEST_IDENTITY_CHARS = 24;
/** Referans (korelasyon/parmak izi/kenar) uzunluk tavanı. */
export const MAX_REF_CHARS = 96;

/**
 * Bir boşluğu DOĞURAN ölçümün kanonik künyesi.
 *
 * ⚠️ Ölçülmeyen her alan `null`. Adres · rol · oturum · NRC **UYDURULMAZ**.
 * Alanların hiçbiri burada türetilmez; hepsi çağıranın ÖLÇTÜĞÜ değerin
 * kopyasıdır.
 */
export interface GapEvidence {
  /* ── hedef ─────────────────────────────────────────────────────────── */
  readonly ecuKey: string | null;
  readonly ecuTxHeader: string | null;
  readonly ecuRxHeader: string | null;
  readonly service: string | null;
  readonly subFunction: string | null;
  /** `encodePduRequest` künyesi (İSTEK — yanıt DEĞİL), tavanlı. */
  readonly requestIdentity: string | null;

  /* ── ölçüm sonucu ──────────────────────────────────────────────────── */
  readonly observedOutcome: PduOutcome | null;
  readonly observedNrc: number | null;
  /** MEVCUT `deriveServicePresence` çıktısının kopyası — yeniden yorum YOK. */
  readonly observedClassification: ServicePresence | null;
  /** F1-B oturum kanıtı — ölçülmediyse `null` (`false` bir ÖLÇÜMDÜR). */
  readonly sessionOpened: boolean | null;
  readonly sessionCommand: string | null;

  /* ── taşıma ────────────────────────────────────────────────────────── */
  readonly transportKind: string | null;
  readonly protocol: string | null;

  /* ── kanıt referansları (KOPYA DEĞİL, BAĞ) ─────────────────────────── */
  readonly transactionId: string | null;
  readonly evidenceCorrelationId: string | null;
  readonly traceEventRef: string | null;
  readonly sessionEpoch: number | null;
  readonly vehicleFingerprintRef: string | null;
  readonly ecuFingerprintRef: string | null;
  readonly capabilityEdgeRef: string | null;

  /* ── köken ─────────────────────────────────────────────────────────── */
  readonly provenance: CapabilityProvenance | null;
  readonly observedAt: number | null;
  readonly state: GapEvidenceState;
}

/**
 * Zarfa girdi olan ÖLÇÜM — `ProbeRecord` bu biçime YAPISAL olarak uyar.
 *
 * Tip olarak `ProbeRecord` import EDİLMEZ: bu katman keşif çalıştırıcısına
 * bağımlı olmamalı ki parser/uygunluk üreticileri de aynı kurucuyu
 * kullanabilsin.
 */
export interface GapObservation {
  readonly ecuKey: string | null;
  readonly txHeader: string | null;
  readonly rxHeader: string | null;
  readonly service: string | null;
  readonly subFunction: string | null;
  readonly requestIdentity: string | null;
  readonly outcome: PduOutcome | null;
  readonly nrc: number | null;
  readonly classification: ServicePresence | null;
  readonly sessionOpened: boolean | null;
  readonly sessionCommand: string | null;
  readonly transportKind: string | null;
  readonly protocol: string | null;
  readonly traceCorrelationId: string | null;
  readonly atMs: number | null;
}

export interface GapEvidenceInput {
  readonly observation: GapObservation | null;
  readonly transactionId?: string | null;
  readonly evidenceCorrelationId?: string | null;
  readonly sessionEpoch?: number | null;
  readonly provenance?: CapabilityProvenance | null;
  readonly vehicleFingerprintRef?: string | null;
  readonly ecuFingerprintRef?: string | null;
  readonly capabilityEdgeRef?: string | null;
}

function _text(v: string | null | undefined, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function _hex(v: string | null | undefined): string | null {
  const t = _text(v, MAX_REF_CHARS);
  return t === null ? null : t.toUpperCase();
}

/**
 * Sınıflandırma ÖLÇÜLMÜŞ bir sonuç mu — `null` ve `NOT_PROBED` değildir.
 *
 * `UNKNOWN*` aileleri ölçülmüş SAYILIR: ECU sustu ya da köprü taşıyamadı; bu
 * da bir ölçüm sonucudur ve çözücünün kök nedeni tam olarak budur.
 */
function _hasOutcome(o: GapObservation): boolean {
  return o.classification !== null && o.classification !== 'NOT_PROBED';
}

/**
 * Zarfın kanıt durumunu ÖLÇER (iddia etmez).
 *
 * `MEASURED` için İKİ eksen birden şarttır:
 *   · hedef künyesi (en az `service`) — yoksa yeniden ölçüm imkânsızdır,
 *   · ölçüm sonucu (`classification`) — yoksa kök neden bilinemez.
 * Biri eksikse `LEGACY_INCOMPLETE`; zarf hiç yoksa `UNAVAILABLE`.
 */
export function deriveGapEvidenceState(o: GapObservation | null): GapEvidenceState {
  if (o === null) return 'UNAVAILABLE';
  const hasTarget = _text(o.service, MAX_REF_CHARS) !== null;
  return hasTarget && _hasOutcome(o) ? 'MEASURED' : 'LEGACY_INCOMPLETE';
}

/**
 * KANONİK KURUCU — boşluk kanıt zarfının TEK üretim noktası.
 *
 * Gözlem yoksa `null` döner: boş bir zarf üretmek "kanıt var" izlenimi
 * verirdi. Ölçülmeyen alan `null` kalır; hiçbir alan tahmin edilmez.
 */
export function buildGapEvidence(input: GapEvidenceInput): GapEvidence | null {
  const o = input.observation ?? null;
  if (o === null) return null;
  return Object.freeze({
    ecuKey: _text(o.ecuKey, MAX_REF_CHARS),
    ecuTxHeader: _hex(o.txHeader),
    ecuRxHeader: _hex(o.rxHeader),
    service: _hex(o.service),
    subFunction: _hex(o.subFunction),
    requestIdentity: _hex(_text(o.requestIdentity, MAX_REQUEST_IDENTITY_CHARS)),
    observedOutcome: o.outcome ?? null,
    observedNrc: typeof o.nrc === 'number' ? o.nrc : null,
    observedClassification: o.classification ?? null,
    sessionOpened: typeof o.sessionOpened === 'boolean' ? o.sessionOpened : null,
    sessionCommand: _hex(o.sessionCommand),
    transportKind: _text(o.transportKind, MAX_REF_CHARS),
    protocol: _text(o.protocol, MAX_REF_CHARS),
    transactionId: _text(input.transactionId, MAX_REF_CHARS),
    evidenceCorrelationId: _text(input.evidenceCorrelationId, MAX_REF_CHARS),
    traceEventRef: _text(o.traceCorrelationId, MAX_REF_CHARS),
    sessionEpoch: typeof input.sessionEpoch === 'number' ? input.sessionEpoch : null,
    vehicleFingerprintRef: _text(input.vehicleFingerprintRef, MAX_REF_CHARS),
    ecuFingerprintRef: _text(input.ecuFingerprintRef, MAX_REF_CHARS),
    capabilityEdgeRef: _text(input.capabilityEdgeRef, MAX_REF_CHARS),
    provenance: input.provenance ?? null,
    observedAt: typeof o.atMs === 'number' ? o.atMs : null,
    state: deriveGapEvidenceState(o),
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   3) KİMLİK — deterministik, ÖLÇÜLMÜŞ eksenlerden
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Zarfın kimlik ayırıcısı.
 *
 * ⚠️ FARKLI ÖLÇÜM FARKLI BOŞLUKTUR: aynı sinyal iki ayrı ECU'da, iki ayrı alt
 * fonksiyonda ya da iki ayrı NRC ile ölçüldüyse bunlar TEK satıra ezilemez —
 * ezilirse çözücü hedefini ve gerekçesini kaybeder (P0380 alt kodlarında bir
 * kez ödenen kusur sınıfı tam olarak budur).
 *
 * Zarf yoksa ayırıcı BOŞTUR: eski (kanıtsız) davranış birebir korunur.
 */
export function gapEvidenceDiscriminator(ev: GapEvidence | null): string {
  if (ev === null) return '';
  const e = ev.ecuKey ?? '-';
  const s = ev.service ?? '-';
  const f = ev.subFunction ?? '-';
  const c = ev.observedClassification ?? '-';
  const n = ev.observedNrc === null ? '-' : ev.observedNrc.toString(16).toUpperCase();
  return `${e}|${s}|${f}|${c}|${n}`;
}

/** Sicil satır anahtarı — zarf yoksa eski `sinyal|bağlam` biçimiyle AYNI. */
export function gapRegistryKey(
  signal: string, context: string, ev: GapEvidence | null,
): string {
  const d = gapEvidenceDiscriminator(ev);
  return d === '' ? `${signal}|${context}` : `${signal}|${context}|${d}`;
}
