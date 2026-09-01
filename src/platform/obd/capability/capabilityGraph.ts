/**
 * capabilityGraph — P0-VDK-F4C · YETENEK ÇİZGESİ VE ÖĞRENME POLİTİKASI.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NE ÖĞRENİR ────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Düğümler: araç parmak izi → ECU parmak izi → servis/alt fonksiyon.
 * Kenar: F4-B'nin ÖLÇTÜĞÜ `ServicePresence` + kanıt künyesi.
 *
 * Amaç tek: **aynı parmak izindeki ikinci araçta kör yoklamayı tekrarlamamak.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖĞRENMENİN ÜÇ PAZARLIKSIZ KURALI ──────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **UNKNOWN, ölçülmüş sonucu EZEMEZ.** ECU bir kez susmuş olması, daha önce
 *     kanıtlanmış `PRESENT`i silmez — gürültüyle kanıt silinmez.
 * (2) **`PRESENT → ABSENT` tek ölçümle dönmez.** Yokluk iddiası pahalıdır:
 *     `ABSENT_QUORUM` kadar ARDIŞIK ölçüm ister. O eşiğe kadar kayıt
 *     `PRESENT` kalır ve **`CAPABILITY_CONFLICT` üretilir** (sessiz çözüm YOK).
 * (3) **Yalnız `live` kanıt ürün öğrenmesi üretir.** `replay`/`synthetic`/
 *     `imported` çizgeyi besleyebilir ama `productTrusted` YAPMAZ — masa başında
 *     oynatılan bir iz, sahada öğrenilmiş gerçek sayılamaz.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NE DEĞİLDİR ───────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ YETENEK OTORİTESİ DEĞİLDİR.** Sınıflandırma F4-B
 *     `ecuCapabilityModel.deriveServicePresence`ten gelir; burada YENİDEN
 *     hesaplanmaz, yalnız ZAMAN İÇİNDE BİRİKTİRİLİR.
 * (2) **DESTRUCTIVE AÇMAZ.** Çizge yalnız salt-okunur servisleri taşır ve
 *     hiçbir öğrenme F4-A native kapısını gevşetemez.
 * (3) **BULUTA YAZMAZ.** FleetMemory bu turun DIŞINDADIR.
 *
 * SAF: I/O yok · timer yok · `Date.now` yok · global durum yok · React yok.
 */

import {
  isPresenceMeasured, isServiceProbablyPresent, type ServicePresence,
} from '../ecuCapabilityModel';

/* ══════════════════════════════════════════════════════════════════════════
   1) KAYNAK KÜNYESİ
   ══════════════════════════════════════════════════════════════════════════ */

/** Kanıtın nereden geldiği — ürün öğrenmesini YALNIZ `live` yükseltir. */
export type CapabilityProvenance = 'live' | 'replay' | 'synthetic' | 'imported';

export const CAPABILITY_PROVENANCE_LABEL: Readonly<Record<CapabilityProvenance, string>> = {
  live:      'canlı araç',
  replay:    'doğrulanmış iz (replay)',
  synthetic: 'sentetik',
  imported:  'içe aktarılmış',
} as const;

/** Ürün öğrenmesi ancak canlı ölçümden doğar — masa başı kanıt "öğrendik" DEMEZ. */
export function isProductTrusted(p: CapabilityProvenance): boolean {
  return p === 'live';
}

/* ══════════════════════════════════════════════════════════════════════════
   2) KENAR
   ══════════════════════════════════════════════════════════════════════════ */

/** Taşıma kısıtı — ARAÇ yeteneğiyle KARIŞTIRILMAZ (F4-C §5). */
export interface TransportConstraint {
  /** Ölçüm sırasında genel PDU köprüsü var mıydı. */
  readonly genericBridge: boolean | null;
  /** Ölçümdeki yönlendirme politikası. */
  readonly routePolicy: string | null;
  /** Adaptör kimliği KARMASI — ham MAC ASLA taşınmaz. */
  readonly adapterHash: string | null;
}

export interface CapabilityEdge {
  readonly vehicleId: string;
  readonly ecuId: string;
  readonly service: string;
  readonly subFunction: string | null;
  readonly presence: ServicePresence;
  readonly provenance: CapabilityProvenance;
  /** Yalnız `live` kanıtla `true` olur; replay/synthetic ASLA. */
  readonly productTrusted: boolean;
  readonly protocol: string | null;
  readonly transport: TransportConstraint;
  readonly firstSeenMs: number | null;
  readonly lastSeenMs: number | null;
  readonly observationCount: number;
  /** Kanıt referansları (iz korelasyon kimlikleri) — sınırlı tutulur. */
  readonly evidenceRefs: readonly string[];
  /** En son ölçülen NRC (kanıt). */
  readonly lastNrc: number | null;
  /** Aynı yönde ARDIŞIK ölçüm sayısı — kotanın temeli. */
  readonly consecutiveSame: number;
  /** Çözülmemiş çelişki var mı. */
  readonly conflict: CapabilityConflict | null;
}

export const MAX_EVIDENCE_REFS = 5;

/* ══════════════════════════════════════════════════════════════════════════
   3) ÇELİŞKİ
   ══════════════════════════════════════════════════════════════════════════ */

export type CapabilityConflictKind =
  /** Kanıtlı `PRESENT` iken `ABSENT` ölçüldü — kota dolmadan dönüş YAPILMAZ. */
  | 'PRESENT_TO_ABSENT'
  /** Kanıtlı `ABSENT` iken `PRESENT` ölçüldü. */
  | 'ABSENT_TO_PRESENT'
  /** Aynı adres, farklı ECU kimliği — öğrenme taşınamaz. */
  | 'ECU_ADDRESS_COLLISION';

export const CAPABILITY_CONFLICT_LABEL: Readonly<Record<CapabilityConflictKind, string>> = {
  PRESENT_TO_ABSENT:     'kanıtlı VAR iken YOK ölçüldü',
  ABSENT_TO_PRESENT:     'kanıtlı YOK iken VAR ölçüldü',
  ECU_ADDRESS_COLLISION: 'aynı adres, farklı ECU kimliği',
} as const;

export interface CapabilityConflict {
  readonly kind: CapabilityConflictKind;
  readonly previous: ServicePresence;
  readonly observed: ServicePresence;
  /** Kotaya kaç ölçüm kaldı; `0` = karar verilebilir. */
  readonly quorumRemaining: number;
  readonly atMs: number | null;
}

/**
 * `PRESENT → ABSENT` dönüşü için gereken ARDIŞIK ölçüm sayısı.
 *
 * `2` bilinçlidir ve keyfî değildir: tek bir `7F xx 11` oturum/koşul kaynaklı
 * olabilir (bazı ECU'lar varsayılan oturumda servisi gizler). İki ARDIŞIK
 * ölçüm, tek seferlik oturum etkisini eler. Sayı DETERMİNİSTİK ve AÇIKTIR —
 * olasılıksal bir ağırlık modeli KURULMADI.
 */
export const ABSENT_QUORUM = 2;

/* ══════════════════════════════════════════════════════════════════════════
   4) ÖĞRENME — kenar birleştirme
   ══════════════════════════════════════════════════════════════════════════ */

export interface CapabilityObservationInput {
  readonly vehicleId: string;
  readonly ecuId: string;
  readonly service: string;
  readonly subFunction: string | null;
  readonly presence: ServicePresence;
  readonly provenance: CapabilityProvenance;
  readonly protocol: string | null;
  readonly transport: TransportConstraint;
  readonly evidenceRef: string | null;
  readonly nrc: number | null;
  /** Damga ENJEKTE edilir — bu modül `Date.now` ÇAĞIRMAZ. */
  readonly atMs: number | null;
}

export function edgeKey(
  e: Pick<CapabilityEdge, 'vehicleId' | 'ecuId' | 'service' | 'subFunction'>,
): string {
  return `${e.vehicleId}|${e.ecuId}|${e.service}|${e.subFunction ?? ''}`;
}

function _refs(prev: readonly string[], next: string | null): readonly string[] {
  if (next === null || prev.includes(next)) return prev;
  const out = [...prev, next];
  return out.length > MAX_EVIDENCE_REFS ? out.slice(out.length - MAX_EVIDENCE_REFS) : out;
}

/**
 * Yeni bir ölçümü mevcut kenara işler.
 *
 * ⚠️ SIRA BİLİNÇLİ:
 *  1. İlk gözlem → doğrudan yazılır.
 *  2. Ölçülmemiş sonuç (UNKNOWN ailesi / DEFERRED) → **kanıt KORUNUR**, yalnız sayaç
 *     ve son damga ilerler.
 *  3. `PRESENT → ABSENT` → kota dolana kadar `PRESENT` KALIR + çelişki üretilir.
 *  4. `ABSENT → PRESENT` → çelişki üretilir ama `PRESENT` KABUL EDİLİR:
 *     pozitif yanıt, yokluk iddiasından daha güçlü bir kanıttır (ECU cevap verdi).
 *  5. Aynı yönde tekrar → sayaç artar, güven pekişir.
 */
export function mergeCapabilityObservation(
  prev: CapabilityEdge | null, o: CapabilityObservationInput,
): CapabilityEdge {
  const trusted = isProductTrusted(o.provenance);
  const base: CapabilityEdge = {
    vehicleId: o.vehicleId, ecuId: o.ecuId,
    service: o.service, subFunction: o.subFunction,
    presence: o.presence, provenance: o.provenance, productTrusted: trusted,
    protocol: o.protocol, transport: o.transport,
    firstSeenMs: o.atMs, lastSeenMs: o.atMs, observationCount: 1,
    evidenceRefs: _refs([], o.evidenceRef),
    lastNrc: o.nrc, consecutiveSame: 1, conflict: null,
  };

  if (prev === null) return base;

  /* ── P0-VDK-F6E-1 · ÇAPRAZ PROTOKOL ÖLÇÜMÜ ÇELİŞKİ DEĞİLDİR ─────────────
     ÖLÇÜLEN KUSUR: aşağıdaki `protocol: o.protocol ?? prev.protocol` yeni
     protokolü eski kaydın üstüne yazıyor, ama presence/kota/çelişki geçmişi
     ÖNCEKİ protokolden kalmış oluyordu. Sonuç: CAN'de `PRESENT`, KWP'de
     `ABSENT` ölçüldüğünde sistem bunu **ÇELİŞKİ** sanıyor, `ABSENT_QUORUM`
     sayacını ilerletiyor ve `CAPABILITY_CONFLICT` üretiyordu — oysa bunlar
     iki AYRI hattın iki AYRI gerçeğidir ve birbiriyle ÇELİŞMEZLER.

     Protokol değiştiyse kayıt o protokol için BAŞTAN başlar: sahte çelişki
     üretilmez, sahte kota ilerlemez. Geçmiş sessizce SİLİNMEZ — `firstSeenMs`
     ve kanıt referansları KORUNUR (kaydın doğumu ve izi kaybolmaz). */
  if (prev.protocol !== null && o.protocol !== null && prev.protocol !== o.protocol) {
    return {
      ...base,
      firstSeenMs: prev.firstSeenMs ?? o.atMs,
      evidenceRefs: _refs(prev.evidenceRefs, o.evidenceRef),
    };
  }

  const common = {
    firstSeenMs: prev.firstSeenMs ?? o.atMs,
    lastSeenMs: o.atMs ?? prev.lastSeenMs,
    observationCount: prev.observationCount + 1,
    evidenceRefs: _refs(prev.evidenceRefs, o.evidenceRef),
    transport: o.transport,
    protocol: o.protocol ?? prev.protocol,
  };

  /* (2) Ölçüm YOKLUĞU kanıtı silemez. */
  if (!isPresenceMeasured(o.presence)) {
    if (isPresenceMeasured(prev.presence)) {
      return { ...prev, ...common, consecutiveSame: prev.consecutiveSame };
    }
    return { ...prev, ...common, presence: o.presence, lastNrc: o.nrc, consecutiveSame: 1 };
  }

  /* Aynı sonuç → pekişir. `productTrusted` bir kez canlı kanıtla açıldıysa
     düşürülmez; replay bir yeteneği "güvenilmez" yapamaz. */
  if (prev.presence === o.presence) {
    return {
      ...prev, ...common,
      provenance: trusted ? 'live' : prev.provenance,
      productTrusted: prev.productTrusted || trusted,
      lastNrc: o.nrc ?? prev.lastNrc,
      consecutiveSame: prev.consecutiveSame + 1,
      conflict: null,
    };
  }

  /* (3) VAR → YOK: kota dolmadan DÖNMEZ. */
  if (isServiceProbablyPresent(prev.presence) && o.presence === 'ABSENT') {
    const seen = prev.conflict?.kind === 'PRESENT_TO_ABSENT'
      ? (ABSENT_QUORUM - prev.conflict.quorumRemaining) + 1 : 1;
    const remaining = Math.max(0, ABSENT_QUORUM - seen);
    if (remaining > 0) {
      return {
        ...prev, ...common,
        lastNrc: o.nrc,
        consecutiveSame: prev.consecutiveSame,
        conflict: {
          kind: 'PRESENT_TO_ABSENT', previous: prev.presence, observed: 'ABSENT',
          quorumRemaining: remaining, atMs: o.atMs,
        },
      };
    }
    /* Kota doldu — yokluk artık KANITLI. Çelişki KAPANIR ama sessizce değil:
       `observationCount` ve `evidenceRefs` geçmişi taşır. */
    return {
      ...prev, ...common,
      presence: 'ABSENT', provenance: o.provenance, productTrusted: trusted,
      lastNrc: o.nrc, consecutiveSame: ABSENT_QUORUM, conflict: null,
    };
  }

  /* (4) YOK → VAR: pozitif yanıt daha güçlü kanıttır; kabul edilir ama GÖRÜNÜR. */
  if (prev.presence === 'ABSENT' && isServiceProbablyPresent(o.presence)) {
    return {
      ...prev, ...common,
      presence: o.presence, provenance: o.provenance,
      productTrusted: prev.productTrusted || trusted,
      lastNrc: o.nrc, consecutiveSame: 1,
      conflict: {
        kind: 'ABSENT_TO_PRESENT', previous: 'ABSENT', observed: o.presence,
        quorumRemaining: 0, atMs: o.atMs,
      },
    };
  }

  /* Ölçülmüş → ölçülmüş, başka geçiş (ör. PRESENT ↔ PRESENT_BUT_CONDITIONED):
     en taze ölçüm kazanır; ikisi de servisin VARLIĞINI söyler. */
  return {
    ...prev, ...common,
    presence: o.presence, provenance: o.provenance,
    productTrusted: prev.productTrusted || trusted,
    lastNrc: o.nrc, consecutiveSame: 1, conflict: null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   5) YENİDEN KULLANIM POLİTİKASI
   ══════════════════════════════════════════════════════════════════════════ */

/** Öğrenilmiş kaydın tazelik penceresi (ms) — dışındaysa yeniden ÖLÇÜLÜR. */
export const CAPABILITY_FRESH_MS = 30 * 24 * 60 * 60 * 1000;   // 30 gün

export type ReuseDecision =
  /** Yoklama ATLANABİLİR — taze, kanıtlı, ürün-güvenilir kayıt var. */
  | 'REUSE'
  /** Kayıt yok. */
  | 'NO_RECORD'
  /** Kayıt var ama ürün-güvenilir değil (replay/synthetic/imported). */
  | 'NOT_PRODUCT_TRUSTED'
  /** Kayıt bayat. */
  | 'STALE'
  /** Çözülmemiş çelişki var — yeniden ölçülmeli. */
  | 'CONFLICT'
  /** Kayıt ölçülmemiş bir sonuç taşıyor (UNKNOWN/DEFERRED). */
  | 'NOT_MEASURED'
  /** Taşıma koşulu DEĞİŞTİ — yetenek koşullu sayılır. */
  | 'TRANSPORT_CHANGED'
  /**
   * P0-VDK-F6E-1 — KAYIT BAŞKA PROTOKOLDE ÖLÇÜLMÜŞ.
   *
   * CAN'de kanıtlanmış bir yokluk, KWP taramasında **atlama gerekçesi OLAMAZ**
   * (ve tersi). Aynı ECU aynı servisi iki hatta FARKLI şekilde cevaplar;
   * `edgeKey` protokol İÇERMEDİĞİ için iki ölçüm AYNI kenara düşer ve ayrım
   * ancak burada yapılabilir.
   *
   * FAIL-CLOSED: kayıtta protokol ÖLÇÜLMEMİŞSE de bu karar verilir —
   * protokolü bilinmeyen eski bir kaydı "doğru protokol" saymak, tam olarak
   * bu turun kapattığı sızıntıdır.
   */
  | 'PROTOCOL_CHANGED'
  /** Parmak izi yeniden kullanım için yeterli değil. */
  | 'WEAK_FINGERPRINT';

export const REUSE_DECISION_LABEL: Readonly<Record<ReuseDecision, string>> = {
  REUSE:               'ÖĞRENİLMİŞ — yoklama atlandı',
  NO_RECORD:           'kayıt yok — ölç',
  NOT_PRODUCT_TRUSTED: 'kanıt canlı değil (replay/sentetik) — ölç',
  STALE:               'kayıt bayat — yeniden ölç',
  CONFLICT:            'çelişki açık — yeniden ölç',
  NOT_MEASURED:        'kayıt ölçüm taşımıyor — ölç',
  TRANSPORT_CHANGED:   'taşıma koşulu değişti — ölç',
  PROTOCOL_CHANGED:    'kayıt BAŞKA protokolde ölçüldü — ölç',
  WEAK_FINGERPRINT:    'parmak izi zayıf — ölç',
} as const;

export interface ReuseContext {
  readonly nowMs: number | null;
  readonly fingerprintReusable: boolean;
  readonly transport: TransportConstraint;
  /**
   * P0-VDK-F6E-1 — ŞU ANKİ ölçümün protokolü (ATDPN). Ölçülmediyse `null`.
   *
   * VERİLMEZSE (`undefined`) protokol kapısı UYGULANMAZ ve davranış BİREBİR
   * eskisi gibi kalır — mevcut çağıranlarda (F4-B keşif yolu) regresyon YOK.
   * `null` ile `undefined` AYRIDIR: `null` "sordum, ölçemedim" demektir ve
   * fail-closed olarak yeniden ölçüm üretir.
   */
  readonly protocol?: string | null;
}

/**
 * Bir kenarın yoklamayı ATLATIP atlatamayacağı.
 *
 * FAIL-CLOSED: emin olunmayan her durumda ÖLÇÜLÜR. Öğrenme bir hız
 * optimizasyonudur; kanıtın yerine geçmez.
 *
 * ⚠️ TAŞIMA ≠ ARAÇ: ölçüm genel köprü VARKEN yapıldıysa ve şimdi köprü YOKSA
 * (ya da tersi), yetenek koşullu sayılır ve yeniden ölçülür. Adaptör
 * yeteneğini araç yeteneği sanmak, F4-C'nin açıkça yasakladığı hatadır.
 */
export function decideReuse(
  edge: CapabilityEdge | null, ctx: ReuseContext,
): ReuseDecision {
  if (!ctx.fingerprintReusable) return 'WEAK_FINGERPRINT';
  if (edge === null) return 'NO_RECORD';
  if (edge.conflict !== null) return 'CONFLICT';
  if (!edge.productTrusted) return 'NOT_PRODUCT_TRUSTED';
  if (!isPresenceMeasured(edge.presence)) return 'NOT_MEASURED';
  if (edge.transport.genericBridge !== ctx.transport.genericBridge) return 'TRANSPORT_CHANGED';
  /* ── P0-VDK-F6E-1 · PROTOKOL İZOLASYONU ─────────────────────────────────
     `edgeKey` protokol İÇERMEZ (`vehicleId|ecuId|service|subFunction`), bu
     yüzden aynı ECU'nun aynı servisi CAN'de ve KWP'de AYNI kenara yazılır.
     Ayrım ancak burada yapılabilir: **başka protokolde ölçülmüş bir kayıt bu
     protokolde atlama gerekçesi OLAMAZ.**
     Karşılaştırma yalnız çağıran protokolü BİLDİRDİĞİNDE yapılır; bildirmeyen
     çağıranda davranış BİREBİR eskisi gibidir (regresyon yok). */
  if (ctx.protocol !== undefined) {
    /* Kayıtta protokol yoksa (eski kayıt) ya da farklıysa → ÖLÇ. */
    if (edge.protocol === null || edge.protocol !== ctx.protocol) return 'PROTOCOL_CHANGED';
  }
  if (edge.lastSeenMs === null || ctx.nowMs === null) return 'STALE';
  if (ctx.nowMs - edge.lastSeenMs > CAPABILITY_FRESH_MS) return 'STALE';
  return 'REUSE';
}

/* ══════════════════════════════════════════════════════════════════════════
   6) ÖZET
   ══════════════════════════════════════════════════════════════════════════ */

export interface CapabilityGraphSummary {
  readonly vehicles: number;
  readonly ecus: number;
  readonly edges: number;
  readonly trusted: number;
  readonly untrusted: number;
  readonly conflicts: number;
  readonly stale: number;
  /** Hiç öğrenme yok mu — ekranda `0` DEĞİL "KAYNAK YOK" demek için. */
  readonly neverLearned: boolean;
}

export function summarizeGraph(
  edges: readonly CapabilityEdge[], nowMs: number | null,
): CapabilityGraphSummary {
  const vehicles = new Set<string>();
  const ecus = new Set<string>();
  let trusted = 0, conflicts = 0, stale = 0;

  for (const e of edges) {
    vehicles.add(e.vehicleId);
    ecus.add(e.ecuId);
    if (e.productTrusted) trusted++;
    if (e.conflict !== null) conflicts++;
    if (nowMs !== null && e.lastSeenMs !== null
        && nowMs - e.lastSeenMs > CAPABILITY_FRESH_MS) stale++;
  }

  return {
    vehicles: vehicles.size, ecus: ecus.size, edges: edges.length,
    trusted, untrusted: edges.length - trusted, conflicts, stale,
    neverLearned: edges.length === 0,
  };
}
