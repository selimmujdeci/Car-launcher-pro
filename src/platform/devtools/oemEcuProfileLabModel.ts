/**
 * oemEcuProfileLabModel — CAROS LAB · OEM ECU Profilleri ekranının SAF modeli.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK (zaman PARAMETRE) · global durum YOK ·
 * React importu YOK. Girdi yalnız `readOemProfileSources()` anlık görüntüsüdür.
 *
 * Gözlemlenebilirlik sınıflandırması MEVCUT `sessionInspectorModel` sözleşmesini
 * KULLANIR (OBSERVED · DERIVED · UNAVAILABLE · STALE) — paralel sistem kurulmaz.
 */

import {
  observed, derived, unavailable, applyStaleness,
  type InspectorField,
} from './sessionInspectorModel';
import type { OemProfileSourceSnapshot } from './oemEcuProfileSources';
import {
  isVerifiedOemEcu, type OemEcuEntry, type OemEcuProfile,
} from '../obd/oem/oemEcuProfile';
import { OEM_MATCH_OUTCOME_LABEL } from '../obd/oem/oemProfileMatch';
import { ECU_ROLE_LABEL } from '../obd/ecuRoleModel';

const SRC_REGISTRY = 'obd/oem/oemProfileRegistry.ts';
const SRC_MATCH = 'obd/oem/oemProfileMatch.ts';
const SRC_INVENTORY = 'obd/ecuIdentityService.buildEcuInventory';

/** Envanterin bayat sayılacağı yaş — LAB'ın kendi eşiği (tek yer). */
export const INVENTORY_STALE_MS = 5 * 60_000;

/* ── Satır türleri ────────────────────────────────────────────────────────── */

/** Ekranda gösterilen tek ECU kaydı. */
export interface OemEcuRow {
  readonly profileId: string;
  readonly ecuId: string;
  readonly name: string;
  readonly roleLabel: string;
  /** 'can11 · 7E0→7E8' gibi tek satırlık adres özeti. */
  readonly address: string;
  readonly addressing: OemEcuEntry['addressing'];
  /** KWP hedef baytı; CAN'de 'UYGULANMAZ', KWP'de bilinmiyorsa 'UNKNOWN'. */
  readonly kwpTarget: string;
  readonly session: string;
  readonly readServices: string;
  readonly didCount: number;
  /** Kaç DID gerçek araçta okundu (damgalı)? */
  readonly didVerifiedCount: number;
  readonly verified: boolean;
  readonly verifiedOn: string | null;
  readonly evidence: string | null;
  readonly provenance: string;
  readonly license: string;
  /**
   * Bu ECU envanterde ŞU AN nasıl görünüyor:
   *   'discovered'    → fonksiyonel 0100 keşfi onu buldu (yanıt kanıtı)
   *   'probed'        → profil adayıydı ve kimlik okuması YANIT ALDI
   *   'probed_silent' → profil adayıydı, soruldu, YANIT YOK
   *   'not_attempted' → profil adayı ama hiç sorulmadı
   *   'not_in_inventory' → envanterde hiç yok (profil ürün yolunda değil ya da envanter yok)
   */
  readonly inventoryState: 'discovered' | 'probed' | 'probed_silent' | 'not_attempted' | 'not_in_inventory';
}

export const INVENTORY_STATE_LABEL: Readonly<Record<OemEcuRow['inventoryState'], string>> = {
  discovered:       'KEŞFEDİLDİ (0100 yanıtı)',
  probed:           'PROFİLDEN SORULDU · YANIT VAR',
  probed_silent:    'PROFİLDEN SORULDU · YANIT YOK',
  not_attempted:    'SORULMADI',
  not_in_inventory: 'ENVANTERDE YOK',
};

export const SESSION_LABEL: Readonly<Record<string, string>> = {
  default: 'Varsayılan oturum',
  uds_extended_1003: 'UDS genişletilmiş (10 03)',
  kwp_standard_1081: 'KWP standart (10 81)',
  kwp_extended_10C0: 'KWP genişletilmiş (10 C0)',
  UNKNOWN: 'UNKNOWN — ölçülmedi',
};

export interface OemProfileRow {
  readonly id: string;
  readonly manufacturer: string;
  readonly modelFamily: string;
  readonly wmi: string;
  readonly modelPattern: string;
  readonly protocols: string;
  readonly note: string;
  readonly provenance: string;
  readonly license: string;
  /** Ürün yoluna girebilen ECU adedi (doğrulanmış). */
  readonly verifiedEcuCount: number;
  readonly totalEcuCount: number;
  /** Bu profil şu anki araca eşleşti mi (yalnız eşleşen profilde `true`). */
  readonly matchedNow: boolean;
  readonly ecus: readonly OemEcuRow[];
}

/** Hâlâ bilinmeyen alanların dürüst dökümü — "hangi alanlar UNKNOWN" sorusunun yanıtı. */
export interface OemUnknownRow {
  readonly what: string;
  readonly where: string;
  readonly why: string;
}

export interface OemProfileLabModel {
  readonly match: readonly InspectorField[];
  readonly coverage: readonly InspectorField[];
  readonly profiles: readonly OemProfileRow[];
  readonly unknowns: readonly OemUnknownRow[];
  readonly registryErrors: readonly string[];
}

/* ── Yardımcılar ──────────────────────────────────────────────────────────── */

function _address(e: OemEcuEntry): string {
  if (e.addressing === 'kwp') {
    return e.tx === '' ? 'kwp · varsayılan oturum (header\'a dokunulmaz)' : `kwp · ${e.tx}`;
  }
  return `${e.addressing} · ${e.tx} → ${e.rx}`;
}

function _ecuRow(
  profile: OemEcuProfile, e: OemEcuEntry, snap: OemProfileSourceSnapshot,
): OemEcuRow {
  const verified = isVerifiedOemEcu(e);
  const bits = e.addressing === 'can11' ? 11 : e.addressing === 'can29' ? 29 : null;

  /* Envanter durumu ÖLÇÜMDEN gelir; profilin iddiasından DEĞİL. */
  let state: OemEcuRow['inventoryState'] = 'not_in_inventory';
  const inv = snap.inventory;
  if (inv !== null && !snap.inventoryStale && bits !== null) {
    const hit = inv.ecus.find(
      (x) => x.addressBits === bits && x.rxHeader.toUpperCase() === e.rx.toUpperCase());
    if (hit !== undefined) {
      state = hit.discoverySource === 'functional_0100'
        ? 'discovered'
        : hit.probeOutcome === 'responded'
          ? 'probed'
          : hit.probeOutcome === 'no_response' ? 'probed_silent' : 'not_attempted';
    }
  }

  return {
    profileId: profile.id,
    ecuId: e.ecuId,
    name: e.name,
    roleLabel: ECU_ROLE_LABEL[e.role],
    address: _address(e),
    addressing: e.addressing,
    kwpTarget: e.addressing === 'kwp' ? (e.kwpTarget ?? 'UNKNOWN') : 'UYGULANMAZ',
    session: SESSION_LABEL[e.session] ?? e.session,
    readServices: e.readServices.join(' · '),
    didCount: e.dids.length,
    didVerifiedCount: e.dids.filter((d) => d.verifiedOn !== null).length,
    verified,
    verifiedOn: e.verifiedOn,
    evidence: e.evidence,
    provenance: `${e.provenance.kind} — ${e.provenance.source}`,
    license: e.provenance.license,
    inventoryState: state,
  };
}

function _unknowns(snap: OemProfileSourceSnapshot): OemUnknownRow[] {
  const out: OemUnknownRow[] = [];
  for (const p of snap.all) {
    if (p.vehicle.modelFamily === 'UNKNOWN') {
      out.push({ what: 'Model/aile', where: p.id, why: 'Model ayrımı için gözlem yok — profil marka düzeyinde kalır.' });
    }
    if (p.vehicle.vdsPattern === null && p.vehicle.modelFamily !== 'UNKNOWN') {
      out.push({
        what: 'VIN model deseni (VDS)', where: p.id,
        why: 'Model adı biliniyor ama VIN deseni sahada ölçülmedi — eşleşme kapısı marka düzeyinde.',
      });
    }
    for (const e of p.ecus) {
      if (e.addressing === 'kwp' && e.kwpTarget === 'UNKNOWN') {
        out.push({ what: 'KWP hedef baytı', where: `${p.id}/${e.ecuId}`, why: 'K-line hedefi ölçülmedi — uydurulmadı.' });
      }
      if (e.session === 'UNKNOWN') {
        out.push({ what: 'Gerekli tanı oturumu', where: `${p.id}/${e.ecuId}`, why: 'Hangi oturumun gerektiği pozitif yanıtla ölçülmedi.' });
      }
      if (!isVerifiedOemEcu(e)) {
        out.push({ what: 'Adres doğrulaması (verifiedOn/evidence)', where: `${p.id}/${e.ecuId}`, why: 'Gerçek araçta hiç okunmadı — ürün yoluna alınmaz.' });
      }
    }
  }
  return out;
}

/* ── Model üretimi ────────────────────────────────────────────────────────── */

/**
 * Anlık görüntüden ekran modelini üretir.
 * @param nowMs duvar saati — bayatlık YALNIZ gerçek damga varsa hesaplanır.
 */
export function buildOemProfileLabModel(
  snap: OemProfileSourceSnapshot, nowMs: number,
): OemProfileLabModel {
  const inv = snap.inventory;
  const oem = inv?.oem ?? null;
  const invTs = inv?.atMs ?? null;

  const match: InspectorField[] = [
    oem === null
      ? unavailable(
        { id: 'outcome', label: 'Eşleşme sonucu', source: SRC_MATCH, note: '' },
        'ECU envanteri hiç üretilmedi — eşleştirme çalıştırılmadı ("bulunamadı" DEĞİL).')
      : applyStaleness(observed({
        id: 'outcome', label: 'Eşleşme sonucu', source: SRC_MATCH, updatedAt: invTs,
        note: oem.reason,
      }, OEM_MATCH_OUTCOME_LABEL[oem.outcome]), nowMs, INVENTORY_STALE_MS),

    oem === null || oem.profileId === null
      ? unavailable({ id: 'profile', label: 'Eşleşen profil', source: SRC_MATCH, note: '' },
        'Hiçbir profil ürün yoluna girmedi.')
      : observed({ id: 'profile', label: 'Eşleşen profil', source: SRC_MATCH, updatedAt: invTs,
        note: 'Profil kimliği — defterdeki kayıt.' }, oem.profileId),

    oem === null || oem.manufacturer === null
      ? unavailable({ id: 'manufacturer', label: 'Üretici', source: SRC_MATCH, note: '' },
        'Eşleşen profil yok.')
      : observed({ id: 'manufacturer', label: 'Üretici', source: SRC_MATCH, updatedAt: invTs,
        note: 'Profilin beyan ettiği üretici; VIN WMI kanıtıyla eşleşti.' }, oem.manufacturer),

    snap.wmi === null
      ? unavailable({ id: 'wmi', label: 'VIN WMI öneki', source: 'obdService.getHandshakeDiagnostics', note: '' },
        'VIN okunmadı — marka kanıtı yok, hiçbir profil denenmez.')
      : observed({ id: 'wmi', label: 'VIN WMI öneki', source: 'obdService.getHandshakeDiagnostics',
        note: 'Yalnız ilk 3 hane taşınır; ham VIN bu ekrana GELMEZ.' }, snap.wmi),

    snap.protocolActive === null
      ? unavailable({ id: 'protocol', label: 'Aktif protokol (ATDPN)', source: 'obdService.getHandshakeDiagnostics', note: '' },
        'Protokol okunamadı — bilinmeyen hatta profil UYGULANMAZ (fail-closed).')
      : observed({ id: 'protocol', label: 'Aktif protokol (ATDPN)', source: 'obdService.getHandshakeDiagnostics',
        note: 'ELM ATDPN ile gerçekten okunan protokol hanesi.' }, snap.protocolActive),

    oem === null || oem.protocolClass === null
      ? unavailable({ id: 'protocolClass', label: 'Protokol sınıfı', source: SRC_MATCH, note: '' },
        'Protokol sınıflandırılamadı.')
      : derived({ id: 'protocolClass', label: 'Protokol sınıfı', source: SRC_MATCH, updatedAt: invTs,
        note: 'Kural: protocolProfile.classifyProtocol(ATDPN hanesi).' }, oem.protocolClass),

    snap.sessionEpoch === null
      ? unavailable({ id: 'epoch', label: 'OBD oturum numarası', source: 'obdService.getObdSessionEpoch', note: '' },
        'Oturum numarası okunamadı.')
      : observed({ id: 'epoch', label: 'OBD oturum numarası', source: 'obdService.getObdSessionEpoch',
        note: 'Yeniden bağlanmada artar; envanter eski oturumdansa BAYAT sayılır.' }, snap.sessionEpoch),

    inv === null
      ? unavailable({ id: 'invEpoch', label: 'Envanterin oturumu', source: SRC_INVENTORY, note: '' },
        'Envanter yok.')
      : observed({ id: 'invEpoch', label: 'Envanterin oturumu', source: SRC_INVENTORY, updatedAt: invTs,
        note: snap.inventoryStale
          ? 'BAYAT: envanter başka bir OBD oturumuna ait — adaptör başka araca takılmış olabilir.'
          : 'Envanter aktif oturuma ait.' }, inv.epoch),
  ];

  const totalEcus = snap.all.reduce((n, p) => n + p.ecus.length, 0);
  const verifiedEcus = snap.all.reduce((n, p) => n + p.ecus.filter(isVerifiedOemEcu).length, 0);

  const coverage: InspectorField[] = [
    observed({ id: 'profileCount', label: 'Defterdeki profil', source: SRC_REGISTRY,
      note: 'Doğrulanmış + doğrulanmamış TÜM kayıtlar.' }, snap.all.length),
    observed({ id: 'productProfileCount', label: 'Ürün yolundaki profil', source: SRC_REGISTRY,
      note: 'Yalnız gerçek araçta doğrulanmış ECU kaydı olanlar (fail-closed kapı).' }, snap.product.length),
    observed({ id: 'ecuCount', label: 'Defterdeki ECU kaydı', source: SRC_REGISTRY, note: '' }, totalEcus),
    observed({ id: 'verifiedEcuCount', label: 'Doğrulanmış ECU kaydı', source: SRC_REGISTRY,
      note: 'verifiedOn + evidence damgası olanlar; yalnız bunlar araca adres olur.' }, verifiedEcus),

    oem === null
      ? unavailable({ id: 'added', label: 'Profilden eklenen ECU', source: SRC_INVENTORY, note: '' },
        'Envanter üretilmedi.')
      : observed({ id: 'added', label: 'Profilden eklenen ECU', source: SRC_INVENTORY, updatedAt: invTs,
        note: 'Fonksiyonel keşifte OLMAYAN, profil sayesinde adreslenebilen aday adedi.' }, oem.addedCount),
    oem === null
      ? unavailable({ id: 'dup', label: 'Keşifle çakışan (eklenmedi)', source: SRC_INVENTORY, note: '' }, 'Envanter üretilmedi.')
      : observed({ id: 'dup', label: 'Keşifle çakışan (eklenmedi)', source: SRC_INVENTORY, updatedAt: invTs,
        note: 'Aynı ECU hem 0100 hem profille bulundu → TEK kayıt; yanıt kanıtı üstündür.' }, oem.duplicateCount),
    oem === null
      ? unavailable({ id: 'kwpDef', label: 'KWP olduğu için alınmayan', source: SRC_INVENTORY, note: '' }, 'Envanter üretilmedi.')
      : observed({ id: 'kwpDef', label: 'KWP olduğu için alınmayan', source: SRC_INVENTORY, updatedAt: invTs,
        note: 'Envanter sözleşmesi 11/29-bit CAN adres kipi ister; KWP\'de böyle bir kip YOKTUR ve uydurulmaz.' }, oem.kwpDeferredCount),
    oem === null
      ? unavailable({ id: 'capped', label: 'Tavan yüzünden kesilen', source: SRC_INVENTORY, note: '' }, 'Envanter üretilmedi.')
      : observed({ id: 'capped', label: 'Tavan yüzünden kesilen', source: SRC_INVENTORY, updatedAt: invTs,
        note: 'MAX_PROFILE_ECUS bütçesi — sessiz kırpma YASAK, adet raporlanır.' }, oem.cappedCount),
  ];

  const matchedId = oem?.outcome === 'matched' ? oem.profileId : null;

  const profiles: OemProfileRow[] = snap.all.map((p) => ({
    id: p.id,
    manufacturer: p.vehicle.manufacturer,
    modelFamily: p.vehicle.modelFamily,
    wmi: p.vehicle.wmi.join(' · '),
    modelPattern: p.vehicle.vdsPattern ?? 'UNKNOWN — model ayrımı yapılmaz',
    protocols: p.vehicle.protocols.join(' · '),
    note: p.note,
    provenance: `${p.provenance.kind} — ${p.provenance.source}`,
    license: p.provenance.license,
    verifiedEcuCount: p.ecus.filter(isVerifiedOemEcu).length,
    totalEcuCount: p.ecus.length,
    matchedNow: matchedId !== null && matchedId === p.id,
    ecus: p.ecus.map((e) => _ecuRow(p, e, snap)),
  }));

  return { match, coverage, profiles, unknowns: _unknowns(snap), registryErrors: snap.registryErrors };
}
