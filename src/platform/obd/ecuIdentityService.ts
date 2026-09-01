/**
 * ecuIdentityService — P0-OBD-08 · ECU KİMLİK ZENGİNLEŞTİRME (talep-güdümlü).
 *
 * ── İKİNCİ TARAMA SİSTEMİ KURULMADI ───────────────────────────────────────
 * ECU listesi MEVCUT keşiften gelir (`multiEcuScan.discoverEcus` → `ecuDiscovery`).
 * Bu katman yalnız o listeyi ZENGİNLEŞTİRİR: her ECU'ya ISO 14229 kimlik DID'lerini
 * sorar ve rolü `ecuRoleModel` ile çıkarır. Yeni adres taraması, yeni protokol,
 * yeni native köprü YOKTUR — okuma mevcut `readObdDid` ile yapılır (aynı atomik
 * `withEcuHeader` sözleşmesi, aynı kuyruk önceliği).
 *
 * ── OKUNAN DID'LER (hepsi ISO 14229 standardı) ────────────────────────────
 *   F197 · SystemNameOrEngineType → ROL KANITI (ECU'nun kendi beyanı)
 *   F18C · ECUSerialNumber        → KARARLI KİMLİK
 *   F191 · ECUHardwareNumber      → KARARLI KİMLİK (yedek)
 * Desteklenmeyen DID `unsupported` döner; UYDURULMAZ ve rol `unknown` kalır.
 *
 * ── SALT-OKUNUR ───────────────────────────────────────────────────────────
 * Yazma · aktüatör · rutin · oturum değiştirme YOK. Talep-güdümlü: timer
 * kurmaz, kendiliğinden hatta çıkmaz. Canlı Mode 01 poll'u ETKİLENMEZ
 * (okumalar `Priority.USER` kuyruğunda, DTC/DID okumalarıyla aynı sözleşme).
 *
 * ── OTURUM DİSİPLİNİ ──────────────────────────────────────────────────────
 * Sonuçlar OBD oturum numarasıyla damgalanır. Yeniden bağlanıldığında (adaptör
 * başka araca takılmış olabilir) envanter BAYAT işaretlenir ve kimlik anahtarı
 * araç bağlamını içerdiği için eski roller yeni araca TAŞINMAZ.
 */

import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../nativePlugin';
import { logError } from '../crashLogger';
import { getObdSessionEpoch, getHandshakeDiagnostics } from '../obdService';
import { discoverEcus } from './multiEcuScan';
import { lookupProfileRole } from './ecuRoleProfiles';
import type { DiscoveredEcu } from './ecuDiscovery';
import { getProductOemProfiles } from './oem/oemProfileRegistry';
import {
  matchOemProfile, mergeOemProfileEcus, lookupOemProfileEcu,
  type OemProfileMatchResult, type OemMergeResult,
} from './oem/oemProfileMatch';
import {
  deriveEcuRole, ecuAddressKey, ecuIdentityKey,
  type EcuAddressBits, type EcuRole, type EcuRoleEvidence,
} from './ecuRoleModel';
import { buildEcuCompleteness, ecuCoverageKey, type EcuCompletenessEvidence } from './ecuCompleteness';

/** ISO 14229 kimlik DID'leri — sıra: rol kanıtı önce, kimlik sonra. */
const DID_SYSTEM_NAME = 'F197';
const DID_SERIAL      = 'F18C';
const DID_HW_NUMBER   = 'F191';

/** Zenginleştirilecek azami ECU — tarama süresi bütçesi (ECU × 3 DID). */
export const MAX_IDENTIFIED_ECUS = 8;

/* ── Sonuç türleri ────────────────────────────────────────────────────────── */

export interface EcuIdentity {
  /** Adres anahtarı — aynı ECU yeniden bulunduğunda AYNI. */
  readonly addressKey: string;
  /** Kimlik anahtarı — araç bağlamı dâhil; farklı araçta FARKLI. */
  readonly identityKey: string;
  readonly rxHeader: string;
  readonly txHeader: string;
  readonly addressBits: EcuAddressBits;
  /** Aktif protokol damgası; bilinmiyorsa `null`. */
  readonly protocol: string | null;
  readonly role: EcuRole;
  readonly evidence: EcuRoleEvidence;
  readonly reason: string;
  /** ECU'nun beyan ettiği sistem adı (ham metin); okunamadıysa `null`. */
  readonly declaredName: string | null;
  /** ECU seri numarası (ham metin); okunamadıysa `null`. */
  readonly serial: string | null;
  /** Donanım numarası (ham metin); okunamadıysa `null`. */
  readonly hardware: string | null;
  /** Keşiften gelen özgün etiket (geriye uyum — kaybolmaz). */
  readonly discoveryLabel: string;
  /**
   * P1-OBD-01 — bu kayıt hangi yoldan geldi.
   *   `functional_0100` → ECU fonksiyonel keşif isteğini YANITLADI (yanıt kanıtı)
   *   `profile`         → adres yalnız doğrulanmış OEM profilinden geldi (İDDİA)
   * İkisi karıştırılamaz: profil bir adres iddiasıdır, yanıt kanıtı değildir.
   */
  readonly discoverySource: 'functional_0100' | 'profile';
  /**
   * Profil kaynaklı adayın gerçekten cevap verip vermediği.
   *   `responded`     → kimlik DID'lerinden en az biri okundu (adres KANITLANDI)
   *   `no_response`   → soruldu, hiçbiri okunamadı
   *   `not_attempted` → hiç sorulmadı (native köprü yok / tavan dışı)
   * Fonksiyonel keşiften gelenler zaten `responded`'dır.
   */
  readonly probeOutcome: 'responded' | 'no_response' | 'not_attempted';
  /** Adayı üreten OEM profilinin kimliği; profil kaynaklı değilse `null`. */
  readonly oemProfileId: string | null;
}

/** P1-OBD-01 — envanterdeki OEM profil eşleşmesinin salt-okunur özeti. */
export interface EcuInventoryOemSummary {
  readonly outcome: OemProfileMatchResult['outcome'];
  readonly profileId: string | null;
  readonly manufacturer: string | null;
  readonly modelFamily: string | null;
  readonly protocolClass: OemProfileMatchResult['protocolClass'];
  readonly reason: string;
  readonly addedCount: number;
  readonly duplicateCount: number;
  readonly kwpDeferredCount: number;
  readonly cappedCount: number;
}

export interface EcuInventory {
  readonly epoch: number;
  readonly atMs: number;
  readonly ecus: readonly EcuIdentity[];
  /** Native köprü yok (eski APK) → kimlik zenginleştirme HİÇ yapılamadı. */
  readonly bridgeMissing: boolean;
  /** Araç bağlamı (VIN); bilinmiyorsa `null` — profil eşlemesi o zaman DENENMEZ. */
  readonly vin: string | null;
  readonly completeness: EcuCompletenessEvidence;
  /** P1-OBD-01 — OEM profil eşleşmesi (hiç denenmediyse `no_profile`/`no_vin`). */
  readonly oem: EcuInventoryOemSummary;
}

/** Profil hiç uygulanamadığında kullanılan dürüst özet (uydurma alan YOK). */
function _emptyOem(reason: string): EcuInventoryOemSummary {
  return {
    outcome: 'no_profile', profileId: null, manufacturer: null, modelFamily: null,
    protocolClass: null, reason,
    addedCount: 0, duplicateCount: 0, kwpDeferredCount: 0, cappedCount: 0,
  };
}

function _emptyCompleteness(epoch: number): EcuCompletenessEvidence {
  return buildEcuCompleteness({ candidates: [], protocol: null, sessionEpoch: epoch,
    currentSessionEpoch: epoch, expectedEcuCount: null });
}

/* ── Modül durumu ─────────────────────────────────────────────────────────── */

let _inventory: EcuInventory | null = null;
let _running = false;
let _runs = 0;

export function isEcuIdentityScanRunning(): boolean { return _running; }

/**
 * Son envanter. Oturum değiştiyse `stale:true` — sonuç SİLİNMEZ ama canlı
 * sanılamaz (adaptör başka araca takılmış olabilir).
 */
export function getEcuInventory(): {
  inventory: EcuInventory | null; stale: boolean; runs: number;
} {
  let epoch = -1;
  try { epoch = getObdSessionEpoch(); } catch { /* fail-soft */ }
  return {
    inventory: _inventory,
    stale: _inventory !== null && _inventory.epoch !== epoch,
    runs: _runs,
  };
}

/** @internal — testler arası izolasyon. */
export function _resetEcuIdentityForTest(): void {
  _inventory = null; _running = false; _runs = 0;
}

/* ── DID okuma ────────────────────────────────────────────────────────────── */

/** Ham hex → yazdırılabilir ASCII metin. Boş/anlamsız sonuçta `null`. */
export function decodeDidText(hex: string | null | undefined): string | null {
  if (typeof hex !== 'string') return null;
  const clean = hex.replace(/[^0-9A-Fa-f]/g, '');
  let out = '';
  for (let i = 0; i + 2 <= clean.length; i += 2) {
    const code = parseInt(clean.substring(i, i + 2), 16);
    /* Yalnız yazdırılabilir ASCII. Dolgu baytları (0x00/0xFF) ve kontrol
       karakterleri ATILIR — onları metne katmak sahte ad üretirdi. */
    if (code >= 0x20 && code < 0x7F) out += String.fromCharCode(code);
  }
  out = out.trim();
  /* Tek/iki karakterlik "ad" bir sistem adı DEĞİLDİR; dolgudan arta kalmıştır. */
  return out.length >= 3 ? out : null;
}

async function _readDidText(tx: string, rx: string, did: string): Promise<string | null> {
  const fn = CarLauncher.readObdDid;
  if (!fn) return null;
  try {
    const r = await fn.call(CarLauncher, { tx, rx, did, service: '22' });
    if (r?.supported !== true || !r.data) return null;
    return decodeDidText(r.data);
  } catch (e) {
    /* Hat hatası ECU KİMLİĞİ HAKKINDA KANIT DEĞİLDİR — "adı yok" demeyiz. */
    logError('OBD:EcuIdentityDid', e);
    return null;
  }
}

/* ── Envanter üretimi ─────────────────────────────────────────────────────── */

function _protocolOf(): string | null {
  try {
    const h = getHandshakeDiagnostics();
    const p = (h as unknown as { protocol?: unknown }).protocol;
    return typeof p === 'string' && p.length > 0 ? p : null;
  } catch { return null; }
}

function _vinOf(): string | null {
  try {
    const h = getHandshakeDiagnostics();
    const v = (h as unknown as { vin?: unknown }).vin;
    return typeof v === 'string' && v.trim().length >= 8 ? v.trim() : null;
  } catch { return null; }
}

/**
 * ECU envanterini üretir: mevcut keşif + kimlik DID'leri + rol çıkarımı.
 *
 * İdempotent koruma: tarama sürerken ikinci çağrı NO-OP (hat iki kez meşgul
 * edilmez). Fail-soft: bir ECU'nun DID'leri okunamazsa diğerleri devam eder ve
 * o ECU `unknown` rolüyle envanterde KALIR (kaybolmaz).
 */
export async function buildEcuInventory(): Promise<EcuInventory> {
  if (_running) {
    return _inventory ?? {
      epoch: -1, atMs: 0, ecus: [], bridgeMissing: false, vin: null,
      completeness: _emptyCompleteness(-1), oem: _emptyOem('Envanter henüz üretilmedi.'),
    };
  }
  _running = true;

  let epoch = -1;
  try { epoch = getObdSessionEpoch(); } catch { /* fail-soft */ }

  try {
    const bridgeMissing = !Capacitor.isNativePlatform() || !CarLauncher.readObdDid;
    const protocol = _protocolOf();
    const vin = _vinOf();

    let functional: readonly DiscoveredEcu[] = [];
    try {
      const topo = await discoverEcus();
      functional = topo?.ecus ?? [];
    } catch (e) {
      logError('OBD:EcuIdentityDiscover', e);
    }

    /* ── P1-OBD-01 · OEM PROFİL ZENGİNLEŞTİRME ─────────────────────────────
       İKİNCİ KEŞİF OTORİTESİ DEĞİL: envanterin listesi hâlâ `discoverEcus`'tan
       gelir; profil yalnız o listeye ADAY ekler ve yalnız DOĞRULANMIŞ kayıtlar
       (`getProductOemProfiles`) dikkate alınır. Fonksiyonel keşifte zaten bulunan
       adres EKLENMEZ (duplicate yasağı). Tümü fail-soft: profil yolu düşerse
       envanter eskisi gibi üretilir. */
    let oemMatch: OemProfileMatchResult | null = null;
    let oemMerge: OemMergeResult | null = null;
    let discovered: readonly DiscoveredEcu[] = functional;
    try {
      oemMatch = matchOemProfile({
        vin, protocol, sessionEpoch: epoch,
        profiles: getProductOemProfiles(), discovered: functional,
      });
      oemMerge = mergeOemProfileEcus(functional, oemMatch);
      discovered = oemMerge.merged;
    } catch (e) {
      logError('OBD:OemProfileMatch', e);
      oemMatch = null; oemMerge = null; discovered = functional;
    }

    const identityList = discovered.slice(0, MAX_IDENTIFIED_ECUS);
    const ecus: EcuIdentity[] = [];
    for (const d of identityList) {
      let declaredName: string | null = null;
      let serial: string | null = null;
      let hardware: string | null = null;

      if (!bridgeMissing) {
        declaredName = await _readDidText(d.txHeader, d.rxHeader, DID_SYSTEM_NAME);
        serial       = await _readDidText(d.txHeader, d.rxHeader, DID_SERIAL);
        hardware     = await _readDidText(d.txHeader, d.rxHeader, DID_HW_NUMBER);
      }

      /* Profil AYRI katmandır ve YALNIZ üretici kanıtla biliniyorsa denenir.
         Sıra: mevcut WMI eşleme tablosu → OEM profil defteri. İkisi de boşsa
         `null` kalır ve rol adresten UYDURULMAZ. */
      /* OEM/WMI profil defterleri YALNIZ CAN adreslemesini (11/29) tanır; KWP
         8-bit adres icin profil sorgusu YAPILMAZ — yanlis eslesme uydurma rol
         demektir. Bilinmiyorsa `null` kalir (P0-OBD-FINAL-01). */
      const canBits = d.addressBits === 8 ? null : d.addressBits;
      const oemEcu = oemMatch === null || canBits === null
        ? null : lookupOemProfileEcu(oemMatch, d.rxHeader, canBits);
      const profileRole = (canBits === null ? null : lookupProfileRole(vin, d.rxHeader, canBits))
        ?? oemEcu?.entry.role ?? null;
      const derived = deriveEcuRole({
        rxHeader: d.rxHeader, addressBits: d.addressBits, declaredName, profileRole,
      });

      /* Adayın gerçekten cevap verip vermediği: profil kaynaklı bir adres için
         kimlik DID'lerinden EN AZ BİRİNİN okunması, o adresin canlı olduğunun
         kanıtıdır. Köprü yoksa hiç sorulmadı → `not_attempted` (sahte "yok" YOK). */
      const fromProfile = d.discoverySource === 'profile';
      const probeOutcome: EcuIdentity['probeOutcome'] = !fromProfile
        ? 'responded'
        : bridgeMissing
          ? 'not_attempted'
          : (declaredName !== null || serial !== null || hardware !== null) ? 'responded' : 'no_response';

      ecus.push({
        addressKey:  ecuAddressKey(d),
        identityKey: ecuIdentityKey({ ...d, protocol, vehicleKey: vin }),
        rxHeader: d.rxHeader, txHeader: d.txHeader, addressBits: d.addressBits,
        protocol,
        role: derived.role, evidence: derived.evidence, reason: derived.reason,
        declaredName, serial, hardware,
        discoveryLabel: d.label,
        discoverySource: fromProfile ? 'profile' : 'functional_0100',
        probeOutcome,
        oemProfileId: fromProfile ? (oemEcu?.profileId ?? oemMatch?.profileId ?? null) : null,
      });
    }

    const skippedKeys = new Set(discovered.slice(identityList.length).map((d) =>
      ecuCoverageKey({ rxHeader: d.rxHeader, addressBits: d.addressBits })));
    const completeness = buildEcuCompleteness({
      candidates: discovered.map((d) => {
        const hit = ecus.find((e) => e.rxHeader === d.rxHeader);
        return {
          ...d,
          role: hit?.role ?? 'unknown',
          roleEvidence: hit?.evidence === 'standard' ? 'standard' : 'none',
          /* P1-OBD-01: kaynak ve prob sonucu ARTIK SABİT DEĞİL — profil kaynaklı
             aday 'responded' sayılırsa, sorulmamış bir adres yanıt vermiş gibi
             raporlanır ve kapsam yüzdesi yalan söylerdi. */
          discoverySource: d.discoverySource ?? 'functional_0100',
          probeOutcome: hit?.probeOutcome ?? d.probeOutcome ?? 'not_attempted',
        } as const;
      }),
      skippedKeys, protocol, sessionEpoch: epoch, currentSessionEpoch: epoch, expectedEcuCount: null,
    });
    const oem: EcuInventoryOemSummary = (oemMatch === null || oemMerge === null)
      ? _emptyOem('OEM profil eşleştirme çalıştırılamadı (fail-soft).')
      : {
        outcome: oemMatch.outcome,
        profileId: oemMatch.profileId,
        manufacturer: oemMatch.manufacturer,
        modelFamily: oemMatch.modelFamily,
        protocolClass: oemMatch.protocolClass,
        reason: oemMatch.reason,
        addedCount: oemMerge.addedCount,
        duplicateCount: oemMerge.duplicateCount,
        kwpDeferredCount: oemMerge.kwpDeferredCount,
        cappedCount: oemMerge.cappedCount,
      };
    _inventory = { epoch, atMs: Date.now(), ecus, bridgeMissing, vin, completeness, oem };
    _runs += 1;
    return _inventory;
  } catch (e) {
    logError('OBD:EcuInventory', e);
    _inventory = {
      epoch, atMs: Date.now(), ecus: [], bridgeMissing: false, vin: null,
      completeness: _emptyCompleteness(epoch), oem: _emptyOem('Envanter üretimi düştü.'),
    };
    return _inventory;
  } finally {
    _running = false;
  }
}

/**
 * Bir ECU'nun (adres anahtarına göre) bilinen kimliği — DTC/Mode 06 sonuçları
 * bunu kullanarak rol etiketini KAYBETMEDEN gösterebilir.
 *
 * Envanter yoksa ya da bayatsa `null` döner: bayat bir rolü sonuca yapıştırmak,
 * başka bir aracın kimliğini bu araca yazmak olurdu.
 */
export function lookupEcuIdentity(rxHeader: string, addressBits: EcuAddressBits): EcuIdentity | null {
  const { inventory, stale } = getEcuInventory();
  if (inventory === null || stale) return null;
  const key = ecuAddressKey({ rxHeader, addressBits });
  return inventory.ecus.find((e) => e.addressKey === key) ?? null;
}
