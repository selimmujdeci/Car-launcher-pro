/**
 * productionDiscovery — P0-VDK-F5B.1 · ÜRETİM TARAMASI ↔ F4-B/F4-C KANIT ZİNCİRİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── KAPATILAN AÇIK (F5-B raporunda A-2 olarak bulundu) ────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `serviceDiscoveryRuntime` (F4-B) · `capabilityGraph` (F4-C) · `gapRegistry`
 * (F2-C) yazılmıştı ama **hiçbirinin üretim çağıranı yoktu**. Sonuç: gerçek
 * araçta boşluk sicili BOŞ kalıyordu ve F5-B tetiği daima
 * `DEFERRED (çözülebilir boşluk YOK)` veriyordu — yani Self-Healing sahada
 * ölçecek hiçbir şey bulamıyordu.
 *
 * Bu katman o zinciri birleştirir. **YENİ HİÇBİR ŞEY KURMAZ.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ TARAYICI DEĞİLDİR.** Kendi probe motoru YOK; ölçümü MEVCUT
 *     `runServiceDiscovery` (F4-B) yapar.
 * (2) **İKİNCİ YETENEK/ÖĞRENME OTORİTESİ DEĞİLDİR.** Sınıflandırma F4-B'nin,
 *     öğrenme F4-C'nin; conflict/quorum/stale/reuse kuralları DEĞİŞMEDİ.
 * (3) **İKİNCİ BOŞLUK SÖZLÜĞÜ DEĞİLDİR.** Boşluk sinyalleri F4-B'nin mevcut
 *     `gapSignalForPresence` yolundan doğar; yeni sinyal adı YOK.
 * (4) **İKİNCİ BÜTÇE/ZAMANLAYICI DEĞİLDİR.** Sahibi işlemin KALAN bütçesinden
 *     pay alır; `setInterval`/`setTimeout` YOK.
 * (5) **ECU KİMLİĞİ UYDURMAZ.** Adresten rol/marka türetmez, magic-address ya
 *     da marka tablosu EKLEMEZ. Hedef, taramanın ÖLÇTÜĞÜ ECU'dur.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BÜTÇE KATMANLARI (pazarlıksız sıra) ───────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 *   NORMAL TARAMA  →  DISCOVERY PAYI  →  SELF-HEALING PAYI
 *
 * Discovery, Self-Healing'in rezervini YİYEMEZ: kendi rezervi
 * `HEALING rezervi + HEALING payı` kadardır. İkisi birlikte normal taramanın
 * rezervini yiyemez çünkü ikisi de yalnız KALAN bütçeden pay alır ve toplam
 * kullanım her hâlükârda `DiagnosticTransaction` bütçesiyle sınırlıdır
 * (`consumeRequest` tek kapı).
 */

import { logError } from '../../crashLogger';
import type { DiagnosticTransaction } from '../diagnosticTransaction';
import { hasRequestBudget, isTransactionLive } from '../diagnosticTransaction';
import type { DiagnosticAdmission } from '../diagnosticAdmission';
import type { ServiceDef, ProtocolClassName } from '../cddl/schema';
import type { TransportConstraint } from '../capability/capabilityGraph';
import { runServiceDiscovery } from '../discovery/serviceDiscoveryRuntime';
import { getGapRegistry } from '../gapRegistry';
/* P0-VDK-F5G — araç bağlamının TEK bağlama noktası: boşluk sicili + yetenek
   bölümü + süreç ömürlü defterler + katalog/GC tek atomik sırada. */
import { activateVehicleDiagnosticContext } from '../vehicleDiagnosticContext';
import {
  buildCapabilityFingerprint, isFingerprintReusable,
} from '../capability/capabilityFingerprint';
import type { EcuIdentityObservation } from '../capability/capabilityFingerprint';
/* P0-VDK-F5H — erken kimlik ile TAM TARAMA kimliğinin uzlaştırılması.
   Yeni kimlik otoritesi DEĞİL: karar `identity/earlyIdentityModel`in SAF
   `reconcileVehicleIdentity`ındadır ve birleştirme yalnız ORTAK ÖLÇÜLMÜŞ
   kanıtla (aynı ECU · aynı DID · aynı karma) yapılır. */
import { reconcileEarlyIdentityWithScan } from '../identity/earlyVehicleIdentity';
import type { IdentityRelation } from '../identity/earlyIdentityModel';
import {
  HEALING_MAX_REQUESTS, HEALING_MIN_RESERVE_REQUESTS,
  type ProvenEcuInput,
} from './selfHealingTrigger';
/* P0-VDK-F6A — hedef kurulumu artık ROL-BAĞIMSIZ: rolü çözülmemiş bir uç
   nokta da servis keşfine ve yetenek öğrenmesine girebilir. Self-Healing'in
   rol şartı (`healingTargetFromProvenEcu`) DEĞİŞMEDİ; o rol-özel bir iştir. */
import { buildEndpointInventory } from '../ecu/ecuEndpointModel';
import { endpointTargetFromEcu } from '../ecu/ecuIdentityResolver';

/* ══════════════════════════════════════════════════════════════════════════
   1) BÜTÇE PAYI
   ══════════════════════════════════════════════════════════════════════════ */

/** Discovery, sahibi işlemin KALAN bütçesinin en çok bu oranını alır. */
export const DISCOVERY_BUDGET_SHARE = 0.25;

/** Tek turda harcanabilecek MUTLAK istek tavanı. */
export const DISCOVERY_MAX_REQUESTS = 12;

/**
 * Discovery'nin DOKUNAMAYACAĞI rezerv.
 *
 * `HEALING rezervi + HEALING payı` olarak TÜRETİLİR (sabit kopyalanmaz): bu
 * sayede discovery koştuktan sonra Self-Healing hâlâ kendi payını alabilir.
 * İki katmanın rezervini elle iki ayrı sabitte tutmak, birinin güncellenip
 * diğerinin unutulması demekti.
 */
export const DISCOVERY_MIN_RESERVE_REQUESTS =
  HEALING_MIN_RESERVE_REQUESTS + HEALING_MAX_REQUESTS;

/** Bir turda en çok kaç ECU yoklanır — sınırsız keşif bir DoS'tur. */
export const DISCOVERY_MAX_ECUS = 3;

/** Bir ECU'nun servis keşfinin gönderebileceği azami yoklama (pay muhasebesi). */
export const DISCOVERY_MAX_PROBES_PER_ECU = 6;

/* ══════════════════════════════════════════════════════════════════════════
   2) KARAR — SAF
   ══════════════════════════════════════════════════════════════════════════ */

export type DiscoveryAdmission = 'RUN' | 'DEFERRED' | 'BLOCKED';

export const DISCOVERY_ADMISSION_LABEL: Readonly<Record<DiscoveryAdmission, string>> = {
  RUN:      'ÇALIŞTI — servis keşfi ölçtü',
  DEFERRED: 'ERTELENDİ — bütçe/öncelik',
  BLOCKED:  'ENGELLENDİ — yapısal ön koşul yok',
} as const;

export interface DiscoveryAdmissionInput {
  readonly admission: DiagnosticAdmission;
  readonly transactionLive: boolean;
  readonly cancelled: boolean;
  readonly staleEpoch: boolean;
  readonly remainingRequests: number;
  /** Protokol ÖLÇÜLDÜ mü — bilinmiyorsa hangi CDDL tanımının geçerli olduğu bilinemez. */
  readonly protocolKnown: boolean;
  /** Ölçülmüş (adresi ve rolü kanıtlı) hedef sayısı. */
  readonly provenTargets: number;
  /** Hedeflere uyan güvenli CDDL tanımı var mı. */
  readonly safeDefsAvailable: boolean;
}

export interface DiscoveryAdmissionDecision {
  readonly admission: DiscoveryAdmission;
  readonly reason: string;
  readonly allocatedRequests: number;
}

const NO_ALLOC = { allocatedRequests: 0 } as const;

/**
 * Üretim servis keşfi şimdi çalışabilir mi — SAF karar. FAIL-CLOSED.
 *
 * Hiçbir dal `ABSENT` üretmez: reddedilen bir tur, araç hakkında HİÇBİR ŞEY
 * söylemez ve hiçbir yeteneği "yok" diye işaretlemez.
 */
export function evaluateDiscoveryAdmission(
  i: DiscoveryAdmissionInput,
): DiscoveryAdmissionDecision {
  if (i.admission !== 'READY') {
    return { admission: 'BLOCKED', ...NO_ALLOC,
      reason: `tanı admisyonu READY değil: ${i.admission}` };
  }
  if (i.cancelled) {
    return { admission: 'BLOCKED', ...NO_ALLOC, reason: 'işlem iptal edildi' };
  }
  if (i.staleEpoch) {
    return { admission: 'BLOCKED', ...NO_ALLOC,
      reason: 'OBD oturum mührü ölçülemedi — ölçüm başka araca yazılamaz' };
  }
  if (!i.transactionLive) {
    return { admission: 'BLOCKED', ...NO_ALLOC, reason: 'işlem canlı değil' };
  }
  if (!i.protocolKnown) {
    return { admission: 'BLOCKED', ...NO_ALLOC,
      reason: 'aktif protokol ÖLÇÜLMEDİ — hangi tanımın geçerli olduğu bilinemez' };
  }
  if (i.provenTargets === 0) {
    return { admission: 'BLOCKED', ...NO_ALLOC,
      reason: 'ölçülmüş ECU hedefi YOK — adres/rol uydurulmaz' };
  }
  if (!i.safeDefsAvailable) {
    return { admission: 'BLOCKED', ...NO_ALLOC,
      reason: 'güvenli CDDL tanımı yok — kör tarama yapılmaz' };
  }

  if (i.remainingRequests < DISCOVERY_MIN_RESERVE_REQUESTS) {
    return { admission: 'DEFERRED', ...NO_ALLOC,
      reason: `kalan istek (${i.remainingRequests}) rezervin `
        + `(${DISCOVERY_MIN_RESERVE_REQUESTS} = Self-Healing rezervi + payı) altında` };
  }

  const share = Math.min(
    DISCOVERY_MAX_REQUESTS,
    Math.floor(i.remainingRequests * DISCOVERY_BUDGET_SHARE),
  );
  /* Bir ECU'nun keşfi atomiktir: payı tek ECU'yu karşılamıyorsa hiç başlanmaz. */
  if (share < DISCOVERY_MAX_PROBES_PER_ECU) {
    return { admission: 'DEFERRED', ...NO_ALLOC,
      reason: `pay (${share}) tek bir ECU keşfini `
        + `(${DISCOVERY_MAX_PROBES_PER_ECU} yoklama) karşılamıyor` };
  }

  return {
    admission: 'RUN', allocatedRequests: share,
    reason: `kalan ${i.remainingRequests} istekten ${share} pay ayrıldı · `
      + `${i.provenTargets} ölçülmüş hedef`,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   3) KİMLİK — ÖLÇÜLMÜŞ KANITTAN, UYDURMADAN
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Taramanın ölçtüğü servis sonuçlarından ECU **yanıt imzası** üretir.
 *
 * ⚠️ HAM GÖVDE TAŞIMAZ: yalnız "hangi servis hangi sonucu verdi" özeti. Bu,
 * `capabilityFingerprint`in `RESPONSE_SIGNATURE` eksenidir ve parmak izini
 * yalnız adres+protokolden daha güçlü kılar — `isFingerprintReusable`ın
 * istediği ayırt edici eksen budur. VIN OKUNMAZ ve TAŞINMAZ.
 */
export function responseSignatureFrom(
  statuses: Readonly<Record<string, string | null>>,
): string | null {
  const parts: string[] = [];
  for (const key of Object.keys(statuses).sort()) {
    const v = statuses[key];
    if (v === null || v === undefined) continue;   // sorulmadı → imzaya girmez
    parts.push(`${key}:${v}`);
  }
  return parts.length === 0 ? null : parts.join('|');
}

/* ══════════════════════════════════════════════════════════════════════════
   4) KANIT DEFTERİ — LAB salt-okuma yüzeyi
   ══════════════════════════════════════════════════════════════════════════ */

export interface ProductionDiscoveryEvidence {
  readonly decision: DiscoveryAdmission;
  readonly reason: string;
  readonly allocatedRequests: number;
  /** Gerçekten harcanan istek; ölçüm yapılmadıysa `null`. */
  readonly usedRequests: number | null;
  /** Yoklanan ECU sayısı; ölçüm yapılmadıysa `null`. */
  readonly ecusProbed: number | null;
  /** Öğrenme sayesinde ATLANAN yoklama (ölçüm). */
  readonly reusedProbes: number | null;
  /** Bu turda sicile düşen yeni boşluk sinyali adedi. */
  readonly gapsProduced: number | null;
  /** Parmak izi yeniden kullanıma yetiyor mu (ölçüm). */
  readonly fingerprintReusable: boolean | null;
  /**
   * P0-VDK-F5H — erken kimlikle ilişkinin ÖLÇÜLMÜŞ sonucu.
   * `null` = erken kimlik bağlantı noktası yoktu (ilişki SORULMADI);
   * "ilişki yok" ile "sorulmadı" KARIŞMAZ.
   */
  readonly identityRelation: IdentityRelation | null;
  /** Uzlaştırma sonucunda BAĞLI KALINAN kimlik; çelişkide `null`. */
  readonly adoptedVehicleRef: string | null;
  readonly atMs: number | null;
  readonly sessionEpoch: number;
}

export const MAX_DISCOVERY_EVIDENCE = 20;

let _evidence: ProductionDiscoveryEvidence[] = [];

export function getProductionDiscoveryEvidence(): readonly ProductionDiscoveryEvidence[] {
  try { return [..._evidence]; } catch { return []; }
}
export function getLastProductionDiscovery(): ProductionDiscoveryEvidence | null {
  return _evidence.length === 0 ? null : _evidence[_evidence.length - 1];
}
/** Üretim keşfi HİÇ değerlendirildi mi — `0` ile KARIŞTIRILMAZ. */
export function productionDiscoveryEverEvaluated(): boolean {
  return _evidence.length > 0;
}
/** @internal — testler arası izolasyon. */
export function _resetProductionDiscoveryForTest(): void { _evidence = []; }

function _record(e: ProductionDiscoveryEvidence): void {
  try {
    _evidence.push(e);
    if (_evidence.length > MAX_DISCOVERY_EVIDENCE) _evidence.shift();
  } catch { /* kanıt kaydı ASLA taramayı düşürmez */ }
}

/* ══════════════════════════════════════════════════════════════════════════
   5) KABUK — üretim taramasından çağrılır
   ══════════════════════════════════════════════════════════════════════════ */

/** Taramanın ölçtüğü bir ECU'nun keşif girdisi. */
export interface DiscoveryEcuInput extends ProvenEcuInput {
  /** Bu ECU'nun ölçülen servis sonuçları (imza üretimi için). */
  readonly serviceStatuses: Readonly<Record<string, string | null>>;
  /**
   * P0-VDK-F6A — `txHeader`ın HANGİ standart kuraldan türediği.
   * Taşınmazsa uç nokta `addressable: false` sayılır ve istek GÖNDERİLMEZ
   * (uydurma adrese kör istek YASAK).
   */
  readonly txProvenance?: string;
}

export interface ProductionDiscoveryContext {
  readonly admission: DiagnosticAdmission;
  readonly ecus: readonly DiscoveryEcuInput[];
  readonly defs: readonly ServiceDef[];
  readonly protocolClass: ProtocolClassName | 'unknown' | null;
  readonly protocol: string | null;
  readonly supportedPidBitmap: string | null;
  readonly transport: TransportConstraint;
  readonly nowMs: number | null;
}

export interface ProductionDiscoveryOutcome {
  readonly decision: DiscoveryAdmissionDecision;
  readonly evidence: ProductionDiscoveryEvidence;
  /** Öğrenme bağlamı — F5-B tetiği aynı kimliği KULLANIR (ikinci kimlik yok). */
  readonly vehicleId: string | null;
  readonly fingerprintReusable: boolean;
  /** P0-VDK-F5H — erken kimlikle ilişki; sorulmadıysa `null`. */
  readonly identityRelation: IdentityRelation | null;
}

/**
 * Üretim taramasının ölçtüğü ECU'lar için F4-B servis keşfini koşar.
 *
 * ASLA throw etmez: keşfin düşmesi taramayı DÜŞÜRMEZ. Karar ne olursa olsun
 * kanıt defterine yazılır — sessiz "hiç denenmedi" durumu YOKTUR.
 */
export async function runProductionDiscovery(
  txn: DiagnosticTransaction | null,
  ctx: ProductionDiscoveryContext,
  gapCountBefore: number,
): Promise<ProductionDiscoveryOutcome> {
  const epoch = txn?.sessionEpoch ?? -1;
  const live = txn !== null && isTransactionLive(txn);
  const remaining = txn === null
    ? 0 : Math.max(0, txn.requestBudget - txn.requestsUsed);

  /* ── Kimlik: ölçülmüş kanıttan kurulur (VIN OKUNMAZ). ─────────────────── */
  const observations: EcuIdentityObservation[] = ctx.ecus.map((e) => ({
    txHeader: e.txHeader.length === 0 ? null : e.txHeader,
    rxHeader: e.rxHeader.length === 0 ? null : e.rxHeader,
    protocol: ctx.protocol,
    responseSignature: responseSignatureFrom(e.serviceStatuses),
    calibrationDid: null,
    calibrationValueHash: null,
  }));

  let vehicleId: string | null = null;
  let reusable = false;
  try {
    const fp = buildCapabilityFingerprint(
      { protocol: ctx.protocol, supportedPidBitmap: ctx.supportedPidBitmap, vin: null },
      observations,
    );
    vehicleId = fp.id;
    reusable = isFingerprintReusable(fp);
  } catch (e) { logError('OBD:DiscoveryFingerprint', e); }

  /* ── P0-VDK-F5H · ERKEN KİMLİKLE UZLAŞTIRMA (bağlamadan ÖNCE) ──────────
     ══════════════════════════════════════════════════════════════════════
     Erken kimlik (bağlantıda ölçülen kalibrasyon) ile buradaki tam tarama
     kimliği YAPISAL OLARAK farklı ID üretir: erken turda ECU yanıt imzası
     ölçülmemiştir ve imza F4-C'nin ECU kimlik metnine girer. Bu FARK
     GİZLENMEZ — ilişki ÖLÇÜLÜR:

       · ortak kanıt (aynı ECU · aynı DID) AYNI      → bölüm KORUNUR
       · ortak kanıt FARKLI                          → ÇELİŞKİ, kalıcılık DONAR
       · ortak kanıt ÖLÇÜLEMEDİ                      → KANITSIZ, bölüm DEĞİŞTİRİLMEZ

     ⚠️ Protokol · adres kümesi · PID bitmap'inin aynı olması bir birleştirme
     kanıtı DEĞİLDİR (aynı model iki araç bunlarda birebir aynıdır) ve bu yolun
     hiçbir dalı öyle bir çıkarım YAPMAZ.

     ⚠️ ERKEN KİMLİK YOKSA hiçbir şey değişmez: `relation === null` dalında
     `vehicleId`/`reusable` F5-G'deki DEĞERLERİYLE kalır. */
  let identityRelation: IdentityRelation | null = null;
  let adoptedVehicleRef: string | null = null;
  try {
    const rec = await reconcileEarlyIdentityWithScan(txn, {
      ecus: ctx.ecus.map((e) => ({ txHeader: e.txHeader, rxHeader: e.rxHeader })),
      protocol: ctx.protocol,
      protocolClass: ctx.protocolClass ?? null,
      nowMs: ctx.nowMs,
    }, vehicleId);
    identityRelation = rec.relation;
    adoptedVehicleRef = rec.adoptedRef;
    if (rec.persistenceFrozen) {
      /* ÇELİŞKİ: iki aracı birleştirmektense iki bölüm bırakılır ve BU TUR
         hiçbir yere kalıcı yazmaz. Kimlik referansı KORUNUR (bellek içi
         çalışma yine doğru araca aittir), yalnız kalıcılık DONDURULUR. */
      reusable = false;
    } else if (rec.adoptedRef !== null) {
      /* Ortak kanıt doğrulandı ya da ilişki kanıtsız kaldı: her iki durumda da
         AKTİF bölüm DEĞİŞTİRİLMEZ. Kanıtsız bir DEĞİŞTİRME, kanıtsız bir
         birleştirme kadar yanlıştır — ve erken kimlik zaten bu oturumun
         ÖLÇÜLMÜŞ en güçlü kimliğidir. */
      vehicleId = rec.adoptedRef;
      reusable = true;
    }
  } catch (e) { logError('OBD:EarlyIdentityReconcile', e); }

  /* ── P0-VDK-F5F · ARAÇ SİCİLİNİ BAĞLA (İLK YOKLAMADAN ÖNCE) ────────────
     Boşluk sicili artık araca göre bölümlenmiştir. Bağlama TAM BURADA olmak
     zorundadır: kimlik AZ ÖNCE ölçüldü ve ilk `recordGap` bir sonraki adımda
     yazılacak. Sonraya bırakılırsa yeni aracın ilk boşlukları ESKİ aracın
     bölümüne düşerdi.

     ⚠️ İKİNCİ KİMLİK SİSTEMİ YOK: `vehicleId` ve gücü YUKARIDAKİ F4-C parmak
     izinden gelir — yetenek çizgesiyle BİREBİR aynı otorite. Kimlik zayıfsa
     sicil bellek içi kalır; replay ise ürün bölümü hiç açılmaz.

     ARAÇ TAKASI: kapsam değişirse boşluk sicili, yetenek öğrenmesi ve iki
     süreç ömürlü defter (çözüm durumları · yoklama kayıtları) TEK sırada
     ayrılır — eski aracın hiçbir kanıtı yeni araca taşınamaz. Sıra
     `vehicleDiagnosticContext`tedir; çağıran adım UNUTAMAZ. */
  try {
    activateVehicleDiagnosticContext({
      vehicleRef: vehicleId,
      fingerprintReusable: reusable,
      provenance: 'live',
      nowMs: ctx.nowMs,
    });
  } catch (e) { logError('OBD:VehicleContextActivate', e); }

  /* ── Hedefler: ölçülmüş UÇ NOKTALAR — **rol ŞARTI YOK** (P0-VDK-F6A) ────
     ══════════════════════════════════════════════════════════════════════
     ÖLÇÜLEN KUSUR: hedefler `healingTargetFromProvenEcu` ile kuruluyordu ve o
     yalnız `MEASURABLE_ROLES` kabul eder. Sonuç: `7E1`de cevap veren, DTC'si
     bile okunan bir modül F4-B servis keşfine ve F4-C öğrenmesine HİÇ
     giremiyordu — ürünün "yalnız motoru tanıyor" olmasının yapısal sebebi.

     Rol artık hedef kurulumunun ÖN KOŞULU DEĞİLDİR; adres kanıtı yeterlidir
     ve gönderilen her şey salt-okunurdur. Rol-ÖZEL iş (Self-Healing) hâlâ
     ölçülmüş rol ister ve o kapı GEVŞETİLMEDİ. */
  const defIds = ctx.defs.map((d) => d.id);
  const targets = buildEndpointInventory(ctx.ecus, ctx.protocol)
    .map((ep) => ({
      raw: ctx.ecus.find((e) => e.rxHeader === ep.rxHeader) ?? ctx.ecus[0]!,
      endpoint: ep,
      variant: endpointTargetFromEcu(ep, defIds),
    }))
    .filter((t) => t.variant !== null)
    .slice(0, DISCOVERY_MAX_ECUS);

  const decision = evaluateDiscoveryAdmission({
    admission: ctx.admission,
    transactionLive: live,
    cancelled: txn?.cancelled === true,
    staleEpoch: txn !== null && txn.sessionEpoch === -1,
    remainingRequests: remaining,
    protocolKnown: (ctx.protocolClass ?? null) !== null
      && ctx.protocolClass !== 'unknown',
    provenTargets: targets.length,
    safeDefsAvailable: ctx.defs.length > 0,
  });

  if (decision.admission !== 'RUN' || txn === null) {
    const ev: ProductionDiscoveryEvidence = {
      decision: decision.admission, reason: decision.reason,
      allocatedRequests: decision.allocatedRequests,
      usedRequests: null, ecusProbed: null, reusedProbes: null,
      gapsProduced: null, fingerprintReusable: reusable,
      identityRelation, adoptedVehicleRef,
      atMs: ctx.nowMs, sessionEpoch: epoch,
    };
    _record(ev);
    return {
      decision, evidence: ev, vehicleId,
      fingerprintReusable: reusable, identityRelation,
    };
  }

  /* ── Ölçüm: MEVCUT F4-B yolu, hedef başına. ─────────────────────────────
     ⚠️ ÖLÇÜLEN KUSUR (bu turda yakalandı): ECU sayısını yalnız
     `DISCOVERY_MAX_ECUS` ile sınırlamak YETMİYOR — bir ECU'nun keşfi birden
     çok yoklama gönderdiği için 12 istek ayrılmışken 15 istek harcandığı
     ölçüldü. Hedef sayısı AYRICA `pay ÷ ECU başına azami yoklama` ile
     sınırlanır; böylece `harcanan ≤ ayrılan` yapısal olarak korunur. */
  const requestsAtStart = txn.requestsUsed;
  let probed = 0, reused = 0;
  const affordableEcus = Math.max(1,
    Math.floor(decision.allocatedRequests / DISCOVERY_MAX_PROBES_PER_ECU));

  for (const t of targets.slice(0, affordableEcus)) {
    if (!isTransactionLive(txn) || !hasRequestBudget(txn)) break;
    if ((txn.requestsUsed - requestsAtStart) >= decision.allocatedRequests) break;

    try {
      const res = await runServiceDiscovery({
        defs: ctx.defs,
        ecu: t.variant!,
        protocolClass: ctx.protocolClass ?? null,
        protocol: ctx.protocol,
        txn,
        ecuKey: t.endpoint.rxHeader,
        targetVerified: true,
        nowMs: ctx.nowMs,
        /* Alt fonksiyon keşfi ÜRETİMDE kapalı: bütçe payı ECU başına dardır ve
           alt fonksiyon turu tek başına payı doldurabilir. Boşluk sicili yine
           dolar; Self-Healing gerekirse alt fonksiyonu HEDEFLİ ölçer. */
        probeSubFunctions: false,
        vehicleId,
        ecuId: t.variant!.id,
        fingerprintReusable: reusable,
        /* YALNIZ CANLI: üretim taraması gerçek araçtan ölçer. */
        provenance: 'live',
        transport: ctx.transport,
        /* F4-C yeniden kullanım politikası AYNEN uygulanır — ikinci dedupe YOK. */
        reuseLearning: true,
      });
      probed++;
      reused += res.reused;
    } catch (e) {
      logError('OBD:ProductionDiscovery', e);
    }
  }

  const used = txn.requestsUsed - requestsAtStart;
  /* Bu turda sicile GERÇEKTEN düşen yeni boşluk satırı — iddia değil, ölçüm.
     Sicil zaten var olan satırın sayacını artırır; yeni SATIR sayısındaki
     artış "bu tur yeni bir eksik ölçtük" demektir. */
  let gapsProduced: number | null = null;
  try { gapsProduced = Math.max(0, getGapRegistry().length - gapCountBefore); }
  catch (e) { logError('OBD:DiscoveryGapCount', e); }

  const ev: ProductionDiscoveryEvidence = {
    decision: 'RUN', reason: decision.reason,
    allocatedRequests: decision.allocatedRequests,
    usedRequests: used, ecusProbed: probed, reusedProbes: reused,
    gapsProduced,
    fingerprintReusable: reusable,
    identityRelation, adoptedVehicleRef,
    atMs: ctx.nowMs, sessionEpoch: epoch,
  };
  _record(ev);
  return {
    decision, evidence: ev, vehicleId,
    fingerprintReusable: reusable, identityRelation,
  };
}
