/**
 * gapResolverRuntime — P0-VDK-F5A · SELF-HEALING GAP RESOLVER · KOŞU.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── EN ÖNEMLİ SÖZLEŞME: KENDİ ÖLÇÜM MOTORU YOKTUR ─────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Bu modül **tek bir PDU üretmez, tek bir komut göndermez**. Ölçüm gerektiğinde
 * MEVCUT normal VDK yolunu çağırır:
 *
 *   F1-A `DiagnosticTransaction`  (bütçe · iptal · mühür)
 *     → F1-B `DiagnosticSessionLease`  (oturum izni)
 *       → F1-C `isoTpTuning`  (akış kontrolü, geri yükleme native garantili)
 *         → F3/F4-A `vdkPduTransport` / genel köprü  (güvenlik kapısı)
 *           → F4-B `runServiceDiscovery`  (sınıflandırma)
 *             → F4-C `capabilityGraph`  (öğrenme politikası)
 *
 * Sınıflandırma F4-B'nin, öğrenme F4-C'nin işidir. Burada İKİNCİ bir yetki
 * katmanı KURULMAZ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU KÖR YENİDEN DENEME DEĞİLDİR ────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Her tur şu zinciri yürütür ve her adımı kanıtlar:
 *   BOŞLUK → KÖK NEDEN → GÜVENLİ ADAYLAR → DETERMİNİSTİK SEÇİM
 *   → NORMAL VDK YOLUNDAN ÖLÇÜM → KANIT → YAŞAM DÖNGÜSÜ
 *
 * `RESOLVED` YALNIZCA yeni kanıt boşluğu gerçekten kapattığında verilir.
 * Ölçüm yapılmış olması tek başına HİÇBİR ŞEY kanıtlamaz.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── GÜVENLİK ──────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Destructive aksiyon ÜRETİLEMEZ (aday sözlüğünde yoktur; `resolutionPolicy`
 * ikinci kapıdır; F4-A native `DiagnosticServiceGate` üçüncü ve son kapıdır).
 * Kör ECU/adres taraması YOKTUR: hedef ECU çağırandan gelir, uydurulmaz.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── PROVENANCE ────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * YALNIZ `live` kanıt bir boşluğu `RESOLVED` edebilir ve ürün öğrenmesi
 * üretebilir. `replay`/`synthetic`/`imported` çözücünün DAVRANIŞINI test
 * eder; sentetik başarı saha başarısı SAYILMAZ.
 *
 * Süreç ömürlü · timer YOK · `Date.now` yalnız tek yerde (enjekte edilebilir).
 */

import { logError } from '../../crashLogger';
import type { ServiceDef } from '../cddl/schema';
import type { EcuVariant } from '../cddl/schema';
import type { ProtocolClassName } from '../cddl/schema';
import type { DiagnosticTransaction } from '../diagnosticTransaction';
import { isTransactionLive } from '../diagnosticTransaction';
import type { DiagnosticSessionLease } from '../diagnosticSessionLease';
import type { CapabilityProvenance, TransportConstraint } from '../capability/capabilityGraph';
import { isProductTrusted } from '../capability/capabilityGraph';
import { runServiceDiscovery, getProbeRecords }
  from '../discovery/serviceDiscoveryRuntime';
import type { ProbeRecord } from '../discovery/serviceProbeModel';
import {
  deriveSessionRequirement, evaluateSessionHealing, isSessionFamilyNrc,
  recordSessionHealingDenial, runSessionConditionedReprobe, SESSION_CHAIN_COST,
  sessionEvidenceFromGapEvidence,
} from './sessionHealing';
import { isPresenceMeasured, isServiceProbablyPresent } from '../ecuCapabilityModel';
import { getGapLedgerScope, getGapRegistry, markGapResolved } from '../gapRegistry';
import type { GapEntry } from '../gapRegistry';
/* P0-VDK-F5D — boşluğun KENDİ kanıt zarfı (yeni depo/otorite DEĞİL). */
import {
  buildGapEvidence, gapEvidenceDiscriminator, type GapEvidence,
} from '../gapEvidence';
/* P0-VDK-F5E — bayatlık MEVCUT eşikten türer; yeni tazelik otoritesi YOK. */
import { isGapEntryStale } from '../gapRetentionPolicy';
/* P0-VDK-F6D-1 — sahiplik kanıtı MEVCUT F6-A defterinden; kopya YOK. */
import { getEcuObservations } from '../ecuAddressability';
/* P0-VDK-F6D — CORE/DEEP sırası için SAF köprü yardımcısı (yeni otorite DEĞİL). */
import { isDeepCoverageContext } from './dtcCoverageGapBridge';
import { getVehicleCapabilities } from '../capability/capabilityStore';
import { CAPABILITY_FRESH_MS, edgeKey } from '../capability/capabilityGraph';
import type { CapabilityEdge } from '../capability/capabilityGraph';
import {
  type GapLifecycle, type GapState, type ResolvableGap, type GapTarget,
  type GapResolutionSummary,
  gapKey, initialGapState, isLifecycleTransitionAllowed, summarizeGapStates,
} from './gapModel';
import {
  type MeasurementCandidateKind, type CandidateContext,
  CANDIDATE_LABEL, MAX_ATTEMPTS_PER_TRIPLE, MAX_ATTEMPTS_PER_GAP,
  attemptKey, candidatesFor, classifyRootCause, selectCandidate,
} from './resolutionPolicy';

/* ══════════════════════════════════════════════════════════════════════════
   1) DEFTER — süreç ömürlü, TAVANLI
   ══════════════════════════════════════════════════════════════════════════ */

/** Boşluk durumları — anahtar `gapKey`. */
const _states = new Map<string, GapState>();
/** Anti-döngü defteri — anahtar `attemptKey` (boşluk+aday+gözlenen sonuç). */
const _attempts = new Map<string, number>();
/** Boşluk başına TOPLAM deneme (farklı adaylar dâhil). */
const _gapAttempts = new Map<string, number>();
let _runCount = 0;
let _dropped = 0;

/** Defter tavanı — sınırsız bellek bir çözücü değil, bir sızıntıdır. */
export const MAX_RESOLVER_STATES = 160;

export function getGapStates(): readonly GapState[] {
  try {
    return [..._states.values()].sort((a, b) => {
      const d = b.gap.observations - a.gap.observations;
      if (d !== 0) return d;
      return a.gap.key.localeCompare(b.gap.key);
    });
  } catch { return []; }
}

export function getResolverRunCount(): number { return _runCount; }
export function getResolverDropped(): number { return _dropped; }

export function getResolutionSummary(): GapResolutionSummary {
  return summarizeGapStates(getGapStates(), _runCount > 0);
}

/**
 * P0-VDK-F5F — ARAÇ TAKASINDA ÇÖZÜM DURUMLARINI AYIR.
 *
 * `_states` ve anti-döngü defterleri `gapKey` ile anahtarlanır ve araç
 * kimliği TAŞIMAZ. Araç değiştiğinde eski aracın "TÜKENDİ" / "ENGELLİ"
 * durumları yeni araca taşınırsa, yeni araçta hiç ölçülmemiş bir boşluk
 * ölçülmeden tükenmiş sayılabilirdi. Fail-closed: durumlar BOŞALIR.
 *
 * ⚠️ Test kancası DEĞİLDİR: üretim yolu `productionDiscovery` çağırır.
 * `_runCount` KORUNUR — kaç tur koşulduğu aracı aşan bir ölçümdür.
 */
export function detachGapResolverForVehicleSwitch(): void {
  _states.clear();
  _attempts.clear();
  _gapAttempts.clear();
}

/** @internal — testler arası izolasyon. */
export function _resetGapResolverForTest(): void {
  _states.clear();
  _attempts.clear();
  _gapAttempts.clear();
  _runCount = 0;
  _dropped = 0;
}

function _setState(next: GapState): void {
  const prev = _states.get(next.gap.key) ?? null;
  if (prev === null && _states.size >= MAX_RESOLVER_STATES) { _dropped++; return; }
  /* Geçiş matrisi ihlali SESSİZCE uygulanmaz — durum korunur ve sayılır. */
  if (prev !== null && !isLifecycleTransitionAllowed(prev.lifecycle, next.lifecycle)) {
    _states.set(next.gap.key, Object.freeze({
      ...next,
      lifecycle: prev.lifecycle,
      outcomeDetail: `geçiş reddedildi: ${prev.lifecycle} → ${next.lifecycle}; `
        + next.outcomeDetail,
    }));
    return;
  }
  _states.set(next.gap.key, Object.freeze(next));
}

/* ══════════════════════════════════════════════════════════════════════════
   2) BOŞLUK TOPLAMA — mevcut üreticilerden, yeni üretici KURULMAZ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Sicil bağlamından ölçüm hedefi çıkarır.
 *
 * `serviceDiscoveryRuntime` bağlamı `discovery:<service><sub>` biçiminde
 * yazar. Başka biçimlerde hedef ÇIKARILMAZ (uydurma hedef YASAK) ve boşluk
 * hedefsiz kalır → ölçülemez, `BLOCKED` olur.
 */
export function targetFromContext(context: string): GapTarget {
  const m = /^discovery:([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})?$/.exec(context.trim());
  if (m === null) return { ecuKey: null, service: null, subFunction: null };
  return {
    ecuKey: null,
    service: m[1].toUpperCase(),
    subFunction: m[2] === undefined ? null : m[2].toUpperCase(),
  };
}

/**
 * P0-VDK-F5C/F5D — ESKİ YOL: F4-B yoklama defterinden künye araması.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ⚠️ ARTIK KANONİK DEĞİLDİR — YALNIZ PARİTE TANIĞI / GERİYE UYUMLULUK.
 *
 * F5-C'de sicil kaydı NRC/sınıflandırma/ECU taşımadığı için bağlam buradan
 * okunuyordu. Bu KIRILGANDI: defter **tavanlıdır** (`MAX_PROBE_RECORDS`) ve
 * süreç ömürlüdür — kırpılınca boşluk duruyor, onu doğuran kanıt kayboluyordu.
 * Üstelik eşleşme yalnız servis/alt fonksiyonladır: iki ECU'nun aynı servisi
 * birbirine karışabilir.
 *
 * F5-D'den sonra bağlam boşluğun KENDİ zarfından gelir (`GapEntry.evidence`).
 * Bu fonksiyon yalnız zarfsız (eski/kanıtsız) kayıtlar için çalışır ve
 * ECU künyesi biliniyorsa ONU DA eşleştirir — sessiz karışma YASAK.
 */
function _probeFor(target: GapTarget): ProbeRecord | null {
  if (target.service === null) return null;
  const svc = target.service.toUpperCase();
  const sub = target.subFunction === null ? null : target.subFunction.toUpperCase();
  try {
    let best: ProbeRecord | null = null;
    for (const r of getProbeRecords()) {
      if (r.service.toUpperCase() !== svc) continue;
      const rs = (r.subFunction ?? '').toUpperCase();
      if (sub !== null && rs !== sub) continue;
      /* ECU künyesi biliniyorsa BAŞKA ECU'nun kaydı kanıt SAYILMAZ. */
      if (target.ecuKey !== null && r.ecuKey !== null && r.ecuKey !== target.ecuKey) continue;
      /* En taze kayıt kazanır; damgasız kayıt taze SAYILMAZ. */
      if (best === null) { best = r; continue; }
      if ((r.atMs ?? -1) > (best.atMs ?? -1)) best = r;
    }
    return best;
  } catch (e) { logError('OBD:GapProbeLookup', e); return null; }
}

/**
 * P0-VDK-F5D — HEDEF, ÖNCE KANONİK ZARFTAN.
 *
 * Zarf ECU/servis/alt fonksiyonu ÖLÇÜLMÜŞ olarak taşır; bağlam metnini
 * ayrıştırmak (eski `targetFromContext`) yalnız zarfsız kayıtlar için kalır.
 * Böylece hedefte ECU künyesi de bulunur — eskiden HER ZAMAN `null`dı.
 */
function _targetFromEvidence(e: GapEntry): GapTarget {
  const ev = e.evidence;
  if (ev === null || ev.service === null) return targetFromContext(e.context);
  return {
    ecuKey: ev.ecuKey,
    service: ev.service,
    subFunction: ev.subFunction,
  };
}

function _gapFromRegistry(e: GapEntry): ResolvableGap {
  const ev = e.evidence;
  const target = _targetFromEvidence(e);
  /* KANONİK YOL: kanıt boşluğun kendisinde. ESKİ YOL yalnız zarfsız kayıtta
     ve yalnız PARİTE TANIĞI olarak — tavanlı defter artık ZORUNLU DEĞİL. */
  const rec = ev === null ? _probeFor(target) : null;
  const classification = ev?.observedClassification ?? rec?.classification ?? null;
  const nrc = ev?.observedNrc ?? rec?.nrc ?? null;
  const sessionOpened = ev?.sessionOpened ?? rec?.sessionOpened ?? null;
  /* Oturum koşulu İKİ kanıttan biriyle bilinir; ikisi de ÖLÇÜMDÜR. */
  const sessionConditioned = e.scope === 'SESSION'
    || (classification === 'PRESENT_BUT_CONDITIONED' && isSessionFamilyNrc(nrc))
    || sessionOpened === true;
  return Object.freeze({
    key: gapKey('REGISTRY', e.signal, target, e.context,
      gapEvidenceDiscriminator(ev)),
    origin: 'REGISTRY' as const,
    gapClass: e.signal,
    scope: e.scope,
    target,
    context: e.context,
    observations: e.count,
    lastSeenMs: e.lastSeenMs,
    /* NRC artık ÖLÇÜLMÜŞ kayıttan gelir — kanıtlı ABSENT (0x11) kuralı ve
       oturum ailesi ayrımı bu alan olmadan çalışamıyordu. */
    lastNrc: nrc,
    transportLimited: e.signal === 'TRANSPORT_LIMITATION' || e.scope === 'TRANSPORT',
    sessionConditioned,
    evidence: ev,
    evidenceState: e.evidenceState,
    registryKey: e.key,
  });
}

/**
 * P0-VDK-F5D — YETENEK KENARINDAN kanonik zarf.
 *
 * Kenarın KOPYASI DEĞİLDİR: yalnız kenarın zaten ölçtüğü künye ve onun
 * kanıt referansı taşınır. Ham gövde, ham yanıt, DID değeri GİRMEZ.
 */
function _evidenceFromEdge(edge: CapabilityEdge): GapEvidence | null {
  return buildGapEvidence({
    observation: {
      ecuKey: edge.ecuId,
      txHeader: null, rxHeader: null,
      service: edge.service,
      subFunction: edge.subFunction,
      requestIdentity: null,
      outcome: null,
      nrc: edge.lastNrc,
      classification: edge.presence,
      sessionOpened: null, sessionCommand: null,
      transportKind: null,
      protocol: edge.protocol,
      traceCorrelationId: edge.evidenceRefs.length === 0
        ? null : edge.evidenceRefs[edge.evidenceRefs.length - 1],
      atMs: edge.lastSeenMs,
    },
    provenance: edge.provenance,
    vehicleFingerprintRef: edge.vehicleId,
    ecuFingerprintRef: edge.ecuId,
    capabilityEdgeRef: edgeKey(edge),
  });
}

function _gapFromEdge(edge: CapabilityEdge, nowMs: number | null): ResolvableGap | null {
  const target: GapTarget = {
    ecuKey: edge.ecuId, service: edge.service, subFunction: edge.subFunction,
  };
  const ctxText = `capability:${edge.ecuId}:${edge.service}${edge.subFunction ?? ''}`;
  const ev = _evidenceFromEdge(edge);

  if (edge.conflict !== null) {
    return Object.freeze({
      key: gapKey('CAPABILITY_CONFLICT', edge.conflict.kind, target, ctxText),
      origin: 'CAPABILITY_CONFLICT' as const,
      gapClass: edge.conflict.kind,
      scope: 'AUTHORITY' as const,
      target,
      context: ctxText,
      observations: edge.observationCount,
      lastSeenMs: edge.lastSeenMs,
      lastNrc: edge.lastNrc,
      transportLimited: false,
      sessionConditioned: edge.presence === 'PRESENT_BUT_CONDITIONED',
      evidence: ev,
      evidenceState: ev?.state ?? 'UNAVAILABLE',
      registryKey: null,
    });
  }
  /* Bayat: yalnız ÖLÇÜLMÜŞ ve GÜVENİLİR bir kayıt bayatlayabilir. Ölçülmemiş
     kayıt zaten "bayat" değildir — hiç ölçülmemiştir. */
  const stale = nowMs !== null && edge.lastSeenMs !== null
    && (nowMs - edge.lastSeenMs) > CAPABILITY_FRESH_MS;
  if (stale && edge.productTrusted && isPresenceMeasured(edge.presence)) {
    return Object.freeze({
      key: gapKey('CAPABILITY_STALE', 'STALE_CAPABILITY', target, ctxText),
      origin: 'CAPABILITY_STALE' as const,
      gapClass: 'STALE_CAPABILITY' as const,
      scope: 'AUTHORITY' as const,
      target,
      context: ctxText,
      observations: edge.observationCount,
      lastSeenMs: edge.lastSeenMs,
      lastNrc: edge.lastNrc,
      transportLimited: false,
      sessionConditioned: edge.presence === 'PRESENT_BUT_CONDITIONED',
      evidence: ev,
      evidenceState: ev?.state ?? 'UNAVAILABLE',
      registryKey: null,
    });
  }
  return null;
}

/**
 * Çözülebilir boşlukları MEVCUT üreticilerden toplar.
 *
 * Hiçbir şey tetiklemez; yalnız okur. Sıralama deterministiktir.
 */
export function collectResolvableGaps(nowMs: number | null): readonly ResolvableGap[] {
  const out: ResolvableGap[] = [];
  try {
    for (const e of getGapRegistry()) {
      /* ── P0-VDK-F5E · KAPANMIŞ BOŞLUK HER TURDA YENİDEN ÖLÇÜLMEZ ────────
         Sicil artık KALICIDIR: kapanmış bir boşluk her açılışta yeniden
         yoklanırsa, kapanış kanıtının hiçbir anlamı kalmaz ve her restart
         aynı isteği tekrar hatta çıkarır (bütçe israfı).
         Ama kapanış SONSUZ değildir: kayıt MEVCUT tazelik eşiğine
         (`CAPABILITY_FRESH_MS`) göre bayatlarsa yeniden ölçülebilir hâle
         gelir — doğum kanıtı bu durumda da SİLİNMEZ. Yeni tazelik otoritesi
         KURULMADI. `REOPENED` kayıt zaten tekrar ölçülmüştür, dâhildir. */
      if (e.resolutionState === 'RESOLVED' && !isGapEntryStale(e, nowMs)) continue;
      out.push(_gapFromRegistry(e));
    }
  } catch (e) { logError('OBD:GapCollectRegistry', e); }
  try {
    /* ── P0-VDK-F5F · YETENEK KENARLARI DA ARACA BAĞLIDIR ──────────────────
       `capabilityStore` TÜM araçların kenarlarını tek depoda tutar (kimlik
       `edgeKey`in içindedir). Hepsini okumak, Araç B bağlıyken Araç A'nın
       çelişkili/bayat kenarlarını B'de ölçmeye kalkmak demekti.
       FAIL-CLOSED: aktif araç bağlı değilse yetenek kökenli boşluk HİÇ
       toplanmaz — kimliği bilinmeyen bir kenarı bir araca atfetmek yasak.
       Kimlik otoritesi sicille AYNIDIR (`gapLedgerScope.vehicleRef`). */
    const activeVehicle = getGapLedgerScope().vehicleRef;
    const edges = activeVehicle === null
      ? [] : getVehicleCapabilities(activeVehicle);
    for (const edge of edges) {
      const g = _gapFromEdge(edge, nowMs);
      if (g !== null) out.push(g);
    }
  } catch (e) { logError('OBD:GapCollectCapability', e); }
  /* ── P0-VDK-F6D · CORE HER ZAMAN DEEP'TEN ÖNCE ───────────────────
     İKİNCİ SKOR MOTORU DEĞİL: aday puanlaması yine `resolutionPolicy`dedir.
     Buradaki tek ekleme SIRADIR — bütçe azken kayıt başına derin kanıt
     (19-03 / 19-06) temel arıza hafızası kapsamının ÖNÜNE GEÇEMEZ.
     Kapsam köprüsüne ait OLMAYAN boşluklar `0` alır → aralarındaki mevcut
     sıralama BİREBİR korunur (davranış regresyonu yok). */
  return out.sort((a, b) => {
    const ad = isDeepCoverageContext(a.context) ? 1 : 0;
    const bd = isDeepCoverageContext(b.context) ? 1 : 0;
    return ad - bd
      || b.observations - a.observations
      || a.key.localeCompare(b.key);
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   3) KANIT DEĞERLENDİRME — "ölçtüm" ile "öğrendim" AYNI ŞEY DEĞİLDİR
   ══════════════════════════════════════════════════════════════════════════ */

/** Ölçümün gözlenen sonucu — anti-döngü üçlüsünün üçüncü ayağı. */
export function observedOutcomeOf(records: readonly ProbeRecord[]): string {
  if (records.length === 0) return 'NO_RECORD';
  const last = records[records.length - 1];
  return `${last.classification}:${last.nrc === null ? '-' : last.nrc.toString(16)}`;
}

/**
 * P0-VDK-F6D-1 — bu boşluğun hedefi için SAHİPLİK ÖLÇÜLMÜŞ Mİ.
 *
 * Kaynak MEVCUT F6-A defteridir (`ecuAddressability`): fiziksel isteğe
 * GERÇEKTEN cevap vermiş bir uç nokta `PROVEN` işaretlenir. Bu, çağıranın
 * yankıladığı künyeden BAĞIMSIZ bir ölçümdür.
 *
 * FAIL-CLOSED: hedef anahtarı yoksa, oturum mührü tutmuyorsa ya da defter
 * okunamazsa `false` — sahiplik KANITLANMAMIŞTIR.
 *
 * ⚠️ Anahtar biçimi `ecuCompleteness.ecuCoverageKey` ile AYNIDIR
 * (`<addressBits>:<rxHeader>`); iki taraf aynı kimliği kullanmazsa
 * "doğrulanmış sahiplik" başka bir uç noktaya atfedilebilirdi.
 */
export function attributionProvenFor(
  gap: ResolvableGap, sessionEpoch: number | null,
): boolean {
  const key = gap.target.ecuKey;
  if (key === null || key === '') return false;
  try {
    for (const o of getEcuObservations()) {
      if (o.addressability !== 'PROVEN') continue;
      if (sessionEpoch !== null && o.sessionEpoch !== sessionEpoch) continue;
      if (`${o.addressBits}:${o.rxHeader.replace(/\s+/g, '').toUpperCase()}` === key) {
        return true;
      }
    }
  } catch { /* fail-soft → fail-closed: kanıt okunamazsa KANITLANMAMIŞ sayılır */ }
  return false;
}

export interface EvidenceVerdict {
  readonly lifecycle: GapLifecycle;
  readonly detail: string;
}

/**
 * Yeni kanıtın boşluğu GERÇEKTEN kapatıp kapatmadığına karar verir.
 *
 * ⚠️ FAIL-CLOSED ve provenance-kapılı:
 *  · Kanıt `live` değilse ASLA `RESOLVED` verilmez (sentetik başarı saha
 *    başarısı sayılmaz) — durum `UNKNOWN`a düşer.
 *  · Ölçülmemiş sınıflandırma (`UNKNOWN*`) boşluğu KAPATMAZ.
 *  · Taşıma sınırı ölçüldüyse bu araç sınırı DEĞİLDİR ve `RESOLVED` olmaz.
 */
export function judgeEvidence(
  gap: ResolvableGap, records: readonly ProbeRecord[],
  provenance: CapabilityProvenance,
  /**
   * ── P0-VDK-F6D-1 · ATIF SAHİBİ ÖLÇÜLDÜ MÜ ──────────────────────
   *
   * KAPATILAN FAIL-OPEN: bu dal `last.ecuKey !== null` ise atıf boşluğunu
   * `RESOLVED` sayıyordu. Ama `ProbeRecord.ecuKey`
   * (`serviceDiscoveryRuntime.ts:539` → `input.ekuKey ?? null`) ÇAĞIRANDAN
   * YANKILANIR ve çağıran onu `gap.target.ecuKey`den verir. Yani hedefte
   * bir ECU anahtarı varsa kayıtta da OLUR ve boşluk **sahibi hiç ölçülmeden**
   * kapanırdı — "komut gönderdim → çözdüm" hatasının atıf kılığındaki hâli.
   *
   * Artık sahiplik AYRI ve ÖLÇÜLMÜŞ bir kanıttan gelir (F6-A
   * `ecuAddressability` → `PROVEN`). `null`/`false` → FAIL-CLOSED: boşluk
   * AÇIK kalır. Yeni bir atıf otoritesi KURULMADI; mevcut kanıt SORULUR.
   */
  attributionProven: boolean | null = null,
): EvidenceVerdict {
  if (records.length === 0) {
    return { lifecycle: 'UNKNOWN', detail: 'ölçüm kaydı üretilmedi' };
  }
  const last = records[records.length - 1];
  const cls = last.classification;

  if (cls === 'UNKNOWN_TRANSPORT_LIMIT') {
    return {
      lifecycle: 'UNKNOWN',
      detail: 'TAŞIMA taşıyamadı — araç sınırı DEĞİL, "desteklemiyor" DENMEZ',
    };
  }
  if (!isPresenceMeasured(cls)) {
    return { lifecycle: 'UNKNOWN', detail: `ölçüm sınıfı: ${cls} — kanıt üretmedi` };
  }
  if (!isProductTrusted(provenance)) {
    return {
      lifecycle: 'UNKNOWN',
      detail: `kanıt kaynağı ${provenance} — ürün güveni ÜRETMEZ, boşluk AÇIK kalır`,
    };
  }

  /* ── ATIF BOŞLUĞU YALNIZ SAHİBİ ÖLÇÜLÜNCE KAPANIR (P0-VDK-F6D-1) ───────
     İKİ ŞART BİRDEN: (a) kayıtta bir sahip künyesi olacak, (b) o sahiplik
     BAĞIMSIZ olarak ÖLÇÜLMÜŞ olacak (`attributionProven`).
     (a) tek başına YETMEZ: `ProbeRecord.ecuKey` çağırandan YANKILANIR ve
     hedefin anahtarını geri verir — kendi sorumuzu kanıt sayamayız. */
  if (gap.origin === 'REGISTRY' && gap.gapClass === 'UNKNOWN_ECU_ATTRIBUTION') {
    if (last.ecuKey === null) {
      return { lifecycle: 'UNKNOWN', detail: 'yanıt geldi ama SAHİBİ yine ölçülemedi' };
    }
    if (attributionProven !== true) {
      return {
        lifecycle: 'UNKNOWN',
        detail: 'yanıt geldi ama sahiplik BAĞIMSIZ ÖLÇÜMLE doğrulanmadı '
          + '(künye çağırandan yankılandı — kanıt SAYILMAZ)',
      };
    }
    return {
      lifecycle: 'RESOLVED',
      detail: `sahip ÖLÇÜLDÜ: ${last.ecuKey} (${cls}) · fiziksel atıf kanıtlı`,
    };
  }
  /* Alt fonksiyon boşluğu servis varlığı kanıtıyla KAPANMAZ. */
  if (gap.gapClass === 'UNKNOWN_SUBFUNCTION' && last.subFunction === null) {
    return { lifecycle: 'UNKNOWN', detail: 'servis ölçüldü ama ALT FONKSİYON değil' };
  }

  /* ── P0-VDK-F5C · KOŞULLU BOŞLUK AYNI KOŞULLA KAPANMAZ ────────────────
     ÖLÇÜLEN KUSUR: `CAPABILITY_GAP` boşluğu "bu yeteneği ÖLÇEMEDİK" demektir
     (ECU `PRESENT_BUT_CONDITIONED` döndürdü). Yeniden ölçüp AYNI koşullu
     cevabı almak YENİ BİLGİ DEĞİLDİR — oturum açılmış olsa bile yetenek hâlâ
     okunamıyor. Bunu `RESOLVED` saymak, "komut gönderdim → çözdüm" hatasının
     oturum kılığındaki hâliydi ve boşluk sonsuza dek kapanmış görünürdü.
     Kapanma YALNIZ kesin bir sonuçla olur: `PRESENT` (okundu) ya da `ABSENT`
     (kanıtlı yok). */
  if (gap.gapClass === 'CAPABILITY_GAP' && cls === 'PRESENT_BUT_CONDITIONED') {
    return {
      lifecycle: 'UNKNOWN',
      detail: 'yetenek YİNE koşullu — aynı koşul yeni bilgi DEĞİL'
        + (last.nrc === null ? '' : ` (NRC 0x${last.nrc.toString(16).toUpperCase()})`)
        + (last.sessionOpened === true ? '; oturum açıldı ama yetmedi' : ''),
    };
  }

  return {
    lifecycle: 'RESOLVED',
    detail: `canlı kanıt: ${cls}`
      + (last.nrc === null ? '' : ` (NRC 0x${last.nrc.toString(16).toUpperCase()})`)
      + (isServiceProbablyPresent(cls) ? ' — servis MEVCUT' : ' — servis YOK (kanıtlı)'),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   4) KOŞU
   ══════════════════════════════════════════════════════════════════════════ */

export interface GapResolutionInput {
  /** Hedef ECU — çağırandan gelir; resolver adres UYDURMAZ. `null` = ölçüm yok. */
  readonly ecu: EcuVariant | null;
  /** Kullanılabilir CDDL tanımları (hedefe göre DARALTILIR). */
  readonly defs: readonly ServiceDef[];
  /** F1-A işlemi — bütçe/iptal/mühür kapısı. `null` = ölçüm yapılmaz. */
  readonly txn: DiagnosticTransaction | null;
  /** F1-B kirası. */
  readonly lease?: DiagnosticSessionLease | null;
  readonly protocolClass?: ProtocolClassName | 'unknown' | null;
  readonly protocol?: string | null;
  /** Kanıt kaynağı — YALNIZ `live` boşluk kapatır. */
  readonly provenance: CapabilityProvenance;
  readonly transport: TransportConstraint;
  readonly targetVerified?: boolean;
  readonly vehicleId?: string | null;
  readonly ecuId?: string | null;
  readonly fingerprintReusable?: boolean;
  /** Damga ENJEKTE edilir. */
  readonly nowMs: number | null;
  /** Bu turda en çok kaç boşluk ele alınsın (bütçe). */
  readonly maxGaps?: number;
  /** İptal kancası — `true` dönerse tur DURUR. */
  readonly isCancelled?: () => boolean;
}

export interface GapResolutionResult {
  readonly considered: number;
  readonly measured: number;
  readonly resolved: number;
  readonly blocked: number;
  readonly exhausted: number;
  readonly requestsSpent: number;
  readonly requestsSaved: number;
  readonly states: readonly GapState[];
  readonly stopReason: 'COMPLETED' | 'CANCELLED' | 'BUDGET' | 'NO_GAPS';
}

/** Bu turda ele alınacak varsayılan boşluk tavanı. */
export const DEFAULT_MAX_GAPS = 8;

function _priorAttempts(gk: string, kind: MeasurementCandidateKind): number {
  let total = 0;
  for (const [k, v] of _attempts) {
    if (k.startsWith(`${gk}|${kind}|`)) total += v;
  }
  return total;
}

/**
 * Hedefe göre CDDL tanımlarını DARALTIR.
 *
 * Kör tarama YASAK: yalnız boşluğun künyesine uyan tanım(lar) yoklanır.
 * Eşleşme yoksa boş dizi döner ve ölçüm YAPILMAZ.
 */
export function narrowDefs(
  defs: readonly ServiceDef[], target: GapTarget,
): readonly ServiceDef[] {
  if (target.service === null) return [];
  const svc = target.service.toUpperCase();
  const sub = target.subFunction === null ? null : target.subFunction.toUpperCase();
  const byService = defs.filter((d) => d.service.toUpperCase() === svc);
  if (sub === null) return byService;
  const exact = byService.filter(
    (d) => (d.subFunction ?? '').toUpperCase() === sub);
  return exact.length > 0 ? exact : byService;
}

/**
 * P0-VDK-F5D — KAPATAN KANITI SİCİLE BAĞLAR.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Durum değiştirmek TEK BAŞINA yetmiyordu: "boşluk kapandı" bilgisi
 * çözücünün süreç ömürlü durum defterinde kalıyor, boşluğun HANGİ YENİ
 * KANITLA kapandığı hiçbir yerde durmuyordu.
 *
 * ⚠️ DOĞUM KANITI DEĞİŞTİRİLMEZ: `markGapResolved` yalnız AYRI bir kapanış
 * bağı yazar (`GapEntry.resolution`); `GapEntry.evidence` aynen kalır.
 * "Neden açıldı?" ile "neden kapandı?" iki ayrı gerçektir.
 */
function _writeResolution(
  gap: ResolvableGap, records: readonly ProbeRecord[],
  input: GapResolutionInput, detail: string,
): void {
  const key = gap.registryKey ?? null;
  if (key === null) return;               // sicil dışı boşluk (yetenek kökenli)
  const last = records.length === 0 ? null : records[records.length - 1];
  try {
    markGapResolved({
      key,
      evidenceRef: last?.traceCorrelationId ?? null,
      classification: last?.classification ?? null,
      provenance: input.provenance,
      resolvedAtMs: input.nowMs,
      detail,
    });
  } catch (e) { logError('OBD:GapResolutionWrite', e); }
}

/**
 * Bir çözüm turu koşar.
 *
 * ASLA throw etmez: bir boşluğun düşmesi turu düşürmez.
 */
export async function runGapResolution(
  input: GapResolutionInput,
): Promise<GapResolutionResult> {
  _runCount++;
  const gaps = collectResolvableGaps(input.nowMs);
  const maxGaps = input.maxGaps ?? DEFAULT_MAX_GAPS;

  let measured = 0, resolved = 0, blocked = 0, exhausted = 0;
  let spent = 0, saved = 0;
  let considered = 0;
  let stopReason: GapResolutionResult['stopReason'] = 'COMPLETED';

  if (gaps.length === 0) {
    return {
      considered: 0, measured: 0, resolved: 0, blocked: 0, exhausted: 0,
      requestsSpent: 0, requestsSaved: 0, states: getGapStates(),
      stopReason: 'NO_GAPS',
    };
  }

  for (const gap of gaps) {
    if (input.isCancelled?.() === true) { stopReason = 'CANCELLED'; break; }
    if (considered >= maxGaps) { stopReason = 'BUDGET'; break; }
    considered++;

    const root = classifyRootCause(gap);
    const prev = _states.get(gap.key) ?? initialGapState(gap, root);

    /* Tükenmiş boşluk YENİ CANLI KANIT olmadan yeniden başlamaz. */
    if (prev.lifecycle === 'EXHAUSTED') { exhausted++; continue; }

    const gapTries = _gapAttempts.get(gap.key) ?? 0;
    /* ── P0-VDK-F5C/F5D — OTURUM KANITI ────────────────────────────────────
       KANONİK KAYNAK boşluğun KENDİ zarfıdır: `SESSION_CONDITIONED` bağlamı
       artık F4-B'nin tavanlı yoklama defterine geri dönmeden bilinir. Defter
       yalnız ZARFSIZ (eski) kayıtlarda parite tanığı olarak okunur.
       Oturum SEMANTİĞİ tek yerdedir (`deriveSessionRequirement`). */
    const fromEvidence = sessionEvidenceFromGapEvidence(gap.evidence ?? null);
    const requirement = deriveSessionRequirement(
      fromEvidence ?? _probeFor(gap.target));
    const ctx: CandidateContext = {
      isCan: (input.protocolClass ?? null) === 'can',
      genericBridge: input.transport.genericBridge === true,
      targetVerified: input.targetVerified === true,
      priorAttemptsFor: (k) => _priorAttempts(gap.key, k),
      sessionEvidenceAvailable: requirement.required,
    };
    const cands = candidatesFor(gap, root, ctx);
    const sel = selectCandidate(cands, gapTries);

    /* ── Güvenli aksiyon yok ─────────────────────────────────────────── */
    if (sel.candidate === null) {
      const isCeiling = gapTries >= MAX_ATTEMPTS_PER_GAP
        || sel.reason.includes('tavan');
      const life: GapLifecycle = isCeiling ? 'EXHAUSTED' : 'BLOCKED';
      if (life === 'EXHAUSTED') exhausted++; else blocked++;
      _setState({
        ...prev, gap, rootCause: root, lifecycle: life,
        selected: 'NO_SAFE_ACTION', selectionReason: sel.reason,
        lastOutcome: prev.lastOutcome,
        outcomeDetail: sel.reason,
      });
      continue;
    }

    /* ── Aday seçildi ama hatta çıkamaz ──────────────────────────────── */
    if (!sel.candidate.executable) {
      blocked++;
      _setState({
        ...prev, gap, rootCause: root, lifecycle: 'BLOCKED',
        selected: sel.kind, selectionReason: sel.reason,
        lastOutcome: prev.lastOutcome,
        outcomeDetail: `${CANDIDATE_LABEL[sel.kind]} — ön koşul yok: `
          + sel.candidate.prerequisite,
      });
      continue;
    }

    /* ── Ölçüm: NORMAL VDK YOLU ──────────────────────────────────────── */
    if (input.ecu === null || input.txn === null) {
      blocked++;
      _setState({
        ...prev, gap, rootCause: root, lifecycle: 'BLOCKED',
        selected: sel.kind, selectionReason: sel.reason,
        lastOutcome: prev.lastOutcome,
        outcomeDetail: input.ecu === null
          ? 'hedef ECU yok — adres UYDURULMAZ'
          : 'F1-A işlemi yok — bütçesiz ölçüm YAPILMAZ',
      });
      continue;
    }

    const defs = narrowDefs(input.defs, gap.target);
    if (defs.length === 0) {
      blocked++;
      _setState({
        ...prev, gap, rootCause: root, lifecycle: 'BLOCKED',
        selected: sel.kind, selectionReason: sel.reason,
        lastOutcome: prev.lastOutcome,
        outcomeDetail: 'hedefe uyan CDDL tanımı yok — kör tarama YAPILMAZ',
      });
      continue;
    }

    _setState({
      ...prev, gap, rootCause: root, lifecycle: 'IN_PROGRESS',
      selected: sel.kind, selectionReason: sel.reason,
      lastOutcome: prev.lastOutcome,
      outcomeDetail: 'ölçüm başlatıldı',
    });

    let records: readonly ProbeRecord[] = [];
    let probesSent = 0, reused = 0;

    /* ── P0-VDK-F5C · OTURUM-KOŞULLU YENİDEN ÖLÇÜM ──────────────────────
       Kör `10 xx` GÖNDERİLMEZ: asıl salt-okunur yoklama normal F4-B yolundan
       tekrarlanır; oturum gerekiyorsa native'in ATOMİK dalında açılır ve
       kanıtı F1-B kirasına işlenir. Oturumun açılması TEK BAŞINA başarı
       DEĞİLDİR — hüküm yine `judgeEvidence`indir. */
    const isSessionCandidate = sel.kind === 'REOPEN_SESSION'
      || sel.kind === 'VERIFY_TESTER_PRESENT';
    if (isSessionCandidate) {
      const decision = evaluateSessionHealing({
        requirement,
        transactionLive: isTransactionLive(input.txn),
        cancelled: input.txn.cancelled === true,
        staleEpoch: input.txn.sessionEpoch === -1,
        admissionReady: true,
        ecuTargetProven: input.targetVerified === true,
        safeDefsAvailable: defs.length > 0,
        allocatedRequests: Math.max(0, maxGaps - considered + 1) * SESSION_CHAIN_COST,
        chainCost: SESSION_CHAIN_COST,
      });
      if (decision.admission !== 'RUN') {
        recordSessionHealingDenial(gap.key, decision, requirement, input.nowMs);
        blocked++;
        _setState({
          ...prev, gap, rootCause: root,
          lifecycle: decision.admission === 'DEFERRED' ? 'BLOCKED' : 'BLOCKED',
          selected: sel.kind, selectionReason: sel.reason,
          lastOutcome: prev.lastOutcome, outcomeDetail: decision.reason,
        });
        continue;
      }
      try {
        const res = await runSessionConditionedReprobe(input.txn, requirement, {
          gapKey: gap.key,
          ecu: input.ecu,
          defs,
          protocolClass: input.protocolClass ?? null,
          protocol: input.protocol ?? null,
          ecuKey: gap.target.ecuKey,
          targetVerified: input.targetVerified === true,
          provenance: input.provenance,
          transport: input.transport,
          vehicleId: input.vehicleId ?? null,
          ecuId: input.ecuId ?? null,
          fingerprintReusable: input.fingerprintReusable ?? false,
          nowMs: input.nowMs,
          probeSubFunctions: gap.target.subFunction !== null,
          verifyTesterPresent: sel.kind === 'VERIFY_TESTER_PRESENT',
        });
        records = res.records;
        probesSent = res.requestsSpent;
      } catch (e) { logError('OBD:SessionHealingRun', e); }
    } else {
    try {
      const res = await runServiceDiscovery({
        defs,
        ecu: input.ecu,
        protocolClass: input.protocolClass ?? null,
        protocol: input.protocol ?? null,
        txn: input.txn,
        lease: input.lease ?? null,
        ecuKey: gap.target.ecuKey,
        targetVerified: input.targetVerified === true,
        nowMs: input.nowMs,
        probeSubFunctions: sel.kind === 'REPROBE_SUBFUNCTION',
        isoTpTuning: sel.kind === 'APPLY_ISOTP_TUNING',
        vehicleId: input.vehicleId ?? null,
        ecuId: input.ecuId ?? null,
        fingerprintReusable: input.fingerprintReusable ?? false,
        provenance: input.provenance,
        transport: input.transport,
        /* Çelişki/bayatlıkta öğrenmeyi YENİDEN KULLANMA — amaç zaten ölçmek. */
        reuseLearning: gap.origin === 'REGISTRY',
      });
      records = res.records;
      probesSent = res.probesSent;
      reused = res.reused;
    } catch (e) {
      logError('OBD:GapResolutionProbe', e);
    }
    }

    measured++;
    spent += probesSent;
    saved += reused;

    const observed = observedOutcomeOf(records);
    const ak = attemptKey(gap.key, sel.kind, observed);
    const nextAttempts = (_attempts.get(ak) ?? 0) + 1;
    _attempts.set(ak, nextAttempts);
    _gapAttempts.set(gap.key, gapTries + 1);

    /* P0-VDK-F6D-1 — SAHİPLİK KANITI MEVCUT F6-A DEFTERİNDEN SORULUR.
       Yeni atıf otoritesi KURULMADI: `ecuAddressability` zaten fiziksel
       isteğe CEVAP VEREN uç noktaları `PROVEN` olarak işaretliyor. */
    const verdict = judgeEvidence(gap, records, input.provenance,
      attributionProvenFor(gap, input.txn?.sessionEpoch ?? null));
    let life = verdict.lifecycle;
    let detail = verdict.detail;

    /* ── ANTİ-DÖNGÜ: aynı boşluk + aynı aday + aynı sonuç ────────────── */
    if (life !== 'RESOLVED' && nextAttempts >= MAX_ATTEMPTS_PER_TRIPLE) {
      life = 'EXHAUSTED';
      detail = `${detail}; aynı yol aynı sonucu (${observed}) `
        + `${nextAttempts} kez verdi — tavan ${MAX_ATTEMPTS_PER_TRIPLE}, `
        + 'yeni canlı kanıt olmadan tekrar YOK';
    }

    if (life === 'RESOLVED') {
      resolved++;
      _writeResolution(gap, records, input, detail);
    } else if (life === 'EXHAUSTED') exhausted++;

    _setState({
      gap, rootCause: root, lifecycle: life,
      selected: sel.kind, selectionReason: sel.reason,
      attempts: gapTries + 1,
      lastOutcome: observed,
      outcomeDetail: detail,
      requestsSpent: prev.requestsSpent + probesSent,
      requestsSaved: prev.requestsSaved + reused,
    });
  }

  return {
    considered, measured, resolved, blocked, exhausted,
    requestsSpent: spent, requestsSaved: saved,
    states: getGapStates(), stopReason,
  };
}
