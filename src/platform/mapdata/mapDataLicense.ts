/**
 * mapDataLicense.ts — MAP DATA PLATFORM · F0 · LİSANS GÜVENLİK DUVARI (SAF).
 *
 * SAF: I/O YOK · timer YOK · ağ YOK · global durum YOK · React YOK · saat YOK.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN MİMARİNİN PARÇASI ───────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * CarOS Pro **ticari olarak satılacak** (CLAUDE.md §Ticari Lisans). Harita
 * verisi de tıpkı bir bağımlılık gibi lisanslıdır: yeniden dağıtım hakkı
 * olmayan bir kaynağı cihaza paketlemek ürünü satılamaz hâle getirir. Bu
 * yüzden lisans bir doküman notu değil, **veri hattında zorlanan bir kapıdır**.
 *
 * ── FAIL-CLOSED (pazarlıksız) ─────────────────────────────────────────────
 * Bir hakkın var olduğu KANITLANAMIYORSA `UNKNOWN`'dır ve `UNKNOWN` **RED**
 * demektir. "Muhtemelen serbesttir" diye üretime/offline pakete veri girmez.
 *
 * ── BU DOSYA HUKUKİ DANIŞMANLIK DEĞİLDİR ──────────────────────────────────
 * Aşağıdaki kayıtlar sağlayıcıların ilan ettiği lisans etiketlerinin makine
 * okunur özetidir; ticari lansman öncesi bağımsız hukuk denetimi gerekir.
 * Emin olunmayan her hak `UNKNOWN` bırakılmıştır — bilerek.
 */

import type { MapDataSourceId } from './mapDataSource';

/* ══════════════════════════════════════════════════════════════════════════
   1) HAK ÜÇ DURUMLUDUR — "bilinmiyor" ≠ "yok" ≠ "var"
   ══════════════════════════════════════════════════════════════════════════ */

export type LicenseRight = 'ALLOWED' | 'DENIED' | 'UNKNOWN';

export const LICENSE_RIGHTS: readonly LicenseRight[] = ['ALLOWED', 'DENIED', 'UNKNOWN'] as const;

/** Verinin ürün içindeki kullanım niyeti — kapı bu niyete göre karar verir. */
export type MapDataUseIntent =
  /** Yalnız ölçüm/karşılaştırma; üretim çıktısına GİRMEZ. */
  | 'MEASUREMENT_ONLY'
  /** Çalışma zamanında çevrimiçi tüketim (yeniden dağıtım yok). */
  | 'ONLINE_RUNTIME'
  /** Cihaza paketlenip offline dağıtılacak (en yüksek eşik). */
  | 'OFFLINE_PACKAGING'
  /** Türev veri kümesi üretip dağıtmak (fusion çıktısı). */
  | 'DERIVED_REDISTRIBUTION';

export const MAP_DATA_USE_INTENTS: readonly MapDataUseIntent[] = [
  'MEASUREMENT_ONLY', 'ONLINE_RUNTIME', 'OFFLINE_PACKAGING', 'DERIVED_REDISTRIBUTION',
] as const;

/* ══════════════════════════════════════════════════════════════════════════
   2) LİSANS POLİTİKASI
   ══════════════════════════════════════════════════════════════════════════ */

export interface MapLicensePolicy {
  readonly sourceId: MapDataSourceId;
  /** SPDX benzeri etiket (`ODbL-1.0`, `CDLA-Permissive-2.0`…). Bilinmiyorsa `'UNKNOWN'`. */
  readonly license: string;
  /** Zorunlu atıf metni; `null` = atıf gereksinimi BİLİNMİYOR (→ kapı kısıtlar). */
  readonly attribution: string | null;
  readonly commercialUse: LicenseRight;
  readonly redistribution: LicenseRight;
  readonly offlinePackaging: LicenseRight;
  /**
   * Türev üretip DAĞITMA hakkı. Share-alike (ODbL) lisanslarda hak vardır ama
   * **koşulludur** — koşul `shareAlike` ile ayrıca taşınır.
   */
  readonly derivativeRedistribution: LicenseRight;
  /** Türev veri kümesi aynı lisansla yayımlanmak zorunda mı. */
  readonly shareAlike: boolean;
  /** Lisans metninin/sürümünün kanıt adresi; `null` = doğrulanmadı. */
  readonly termsUrl: string | null;
  /** Politikanın hangi tarihte/nasıl saptandığı (insan notu). */
  readonly provenanceNote: string;
}

/** Hiçbir hak kanıtlanmamış politika — her kapıdan RED alır. */
export function unknownLicensePolicy(sourceId: MapDataSourceId): MapLicensePolicy {
  return {
    sourceId,
    license: 'UNKNOWN',
    attribution: null,
    commercialUse: 'UNKNOWN',
    redistribution: 'UNKNOWN',
    offlinePackaging: 'UNKNOWN',
    derivativeRedistribution: 'UNKNOWN',
    shareAlike: false,
    termsUrl: null,
    provenanceNote: 'Lisans saptanmadı — fail-closed.',
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   3) BİLİNEN KAYNAK KAYITLARI (ilan edilen lisans etiketlerinin özeti)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * NOT: `TUCBS` · `MUNICIPALITY` · `LICENSED_PROVIDER` bilerek `UNKNOWN`'dır.
 * Bu kaynaklar dataset BAŞINA lisanslıdır; tek bir genel kayıt yazmak yanlış
 * olur ve fail-closed kuralını delerdi. Belirli bir dataset kullanılacaksa o
 * dataset için ayrı politika kaydı üretilir.
 */
export const MAP_LICENSE_REGISTRY: Readonly<Record<MapDataSourceId, MapLicensePolicy>> = {
  OSM: {
    sourceId: 'OSM',
    license: 'ODbL-1.0',
    attribution: '© OpenStreetMap katkıcıları',
    commercialUse: 'ALLOWED',
    redistribution: 'ALLOWED',
    offlinePackaging: 'ALLOWED',
    derivativeRedistribution: 'ALLOWED',
    shareAlike: true,
    termsUrl: 'https://www.openstreetmap.org/copyright',
    provenanceNote: 'ODbL-1.0; türev veri kümesi share-alike koşuluna tabidir.',
  },
  OPENFREEMAP: {
    sourceId: 'OPENFREEMAP',
    license: 'ODbL-1.0',
    attribution: '© OpenStreetMap katkıcıları / OpenMapTiles / OpenFreeMap',
    commercialUse: 'ALLOWED',
    redistribution: 'UNKNOWN',
    offlinePackaging: 'UNKNOWN',
    derivativeRedistribution: 'UNKNOWN',
    shareAlike: true,
    termsUrl: 'https://openfreemap.org/',
    provenanceNote:
      'Veri ODbL (OSM türevi). Sağlayıcının KENDİ karo dosyalarını toplu indirip '
      + 'yeniden dağıtma/offline paketleme hakkı bu turda doğrulanmadı → UNKNOWN.',
  },
  OVERTURE: {
    sourceId: 'OVERTURE',
    license: 'CDLA-Permissive-2.0',
    attribution: '© Overture Maps Foundation',
    commercialUse: 'ALLOWED',
    redistribution: 'ALLOWED',
    offlinePackaging: 'ALLOWED',
    derivativeRedistribution: 'ALLOWED',
    shareAlike: false,
    termsUrl: 'https://docs.overturemaps.org/attribution/',
    provenanceNote:
      'Overture dağıtımı CDLA-Permissive-2.0. ANCAK kayıt düzeyinde OSM kökenli '
      + 'nesneler ODbL atıf/share-alike koşulunu TAŞIR — kayıt bazında '
      + 'sources[].dataset okunmadan ODbL yükümlülüğü yok sayılamaz '
      + '(bkz. requiresOsmShareAlike).',
  },
  TUCBS: unknownLicensePolicy('TUCBS'),
  MUNICIPALITY: unknownLicensePolicy('MUNICIPALITY'),
  LICENSED_PROVIDER: unknownLicensePolicy('LICENSED_PROVIDER'),
  FIELD_OBSERVATION: {
    sourceId: 'FIELD_OBSERVATION',
    license: 'PROPRIETARY-CAROS',
    attribution: null,
    commercialUse: 'ALLOWED',
    redistribution: 'ALLOWED',
    offlinePackaging: 'ALLOWED',
    derivativeRedistribution: 'ALLOWED',
    shareAlike: false,
    termsUrl: null,
    provenanceNote: 'CarOS kendi cihaz gözlemi; üçüncü taraf hakkı içermez.',
  },
  DERIVED: {
    sourceId: 'DERIVED',
    license: 'INHERITED',
    attribution: null,
    commercialUse: 'UNKNOWN',
    redistribution: 'UNKNOWN',
    offlinePackaging: 'UNKNOWN',
    derivativeRedistribution: 'UNKNOWN',
    shareAlike: false,
    termsUrl: null,
    provenanceNote:
      'Türetilmiş veri kendi hakkını üretmez; hakları BESLEYEN gözlemlerden '
      + 'devralır. Tek başına kapıdan geçemez.',
  },
} as const;

export function licensePolicyFor(sourceId: MapDataSourceId): MapLicensePolicy {
  const found = MAP_LICENSE_REGISTRY[sourceId];
  return found ?? unknownLicensePolicy(sourceId);
}

/**
 * Overture kaydı OSM kökenli mi — kayıt düzeyinde `sources[].dataset` değerine
 * bakılır. `true` ise dağıtım lisansı permissive olsa bile **ODbL atıf ve
 * share-alike** yükümlülüğü sürer.
 */
export function requiresOsmShareAlike(datasetLabels: readonly string[] | null | undefined): boolean {
  if (!Array.isArray(datasetLabels)) return false;
  return datasetLabels.some((d) => typeof d === 'string' && /openstreetmap|osm/i.test(d));
}

/* ══════════════════════════════════════════════════════════════════════════
   4) KAPI — niyete göre hak değerlendirmesi (FAIL-CLOSED)
   ══════════════════════════════════════════════════════════════════════════ */

export type LicenseGateVerdict = 'ALLOW' | 'ALLOW_WITH_ATTRIBUTION' | 'DENY';

export interface LicenseGateResult {
  readonly verdict: LicenseGateVerdict;
  readonly sourceId: MapDataSourceId;
  readonly intent: MapDataUseIntent;
  /** Kararı belirleyen hak alanları (boş değil — hüküm daima gerekçelidir). */
  readonly reasons: readonly string[];
  /** Zorunlu atıf metni; `ALLOW_WITH_ATTRIBUTION` ise DAİMA dolu. */
  readonly requiredAttribution: string | null;
  /** Türev çıktının aynı lisansla yayımlanma zorunluluğu var mı. */
  readonly shareAlikeObligation: boolean;
}

/** Niyetin gerektirdiği haklar — tek yerde tanımlı. */
const REQUIRED_RIGHTS: Readonly<Record<MapDataUseIntent, readonly (keyof MapLicensePolicy)[]>> = {
  MEASUREMENT_ONLY: [],
  ONLINE_RUNTIME: ['commercialUse'],
  OFFLINE_PACKAGING: ['commercialUse', 'redistribution', 'offlinePackaging'],
  DERIVED_REDISTRIBUTION: ['commercialUse', 'redistribution', 'derivativeRedistribution'],
} as const;

/**
 * Lisans kapısı. `UNKNOWN` hak → `DENY`. `MEASUREMENT_ONLY` niyeti hak
 * gerektirmez (ölçüm üretime girmez) ama atıf yükümlülüğünü yine de bildirir.
 */
export function evaluateLicenseGate(
  policy: MapLicensePolicy | null | undefined,
  intent: MapDataUseIntent,
): LicenseGateResult {
  const sourceId = policy?.sourceId ?? 'DERIVED';
  if (!policy) {
    return {
      verdict: 'DENY', sourceId, intent,
      reasons: ['Lisans politikası YOK — fail-closed.'],
      requiredAttribution: null, shareAlikeObligation: false,
    };
  }
  if (!(MAP_DATA_USE_INTENTS as readonly string[]).includes(intent)) {
    return {
      verdict: 'DENY', sourceId, intent,
      reasons: [`Tanımsız kullanım niyeti: ${String(intent)}`],
      requiredAttribution: null, shareAlikeObligation: false,
    };
  }

  const required = REQUIRED_RIGHTS[intent];
  const reasons: string[] = [];
  for (const key of required) {
    const right = policy[key] as LicenseRight;
    if (right === 'DENIED') reasons.push(`${String(key)} = DENIED`);
    else if (right !== 'ALLOWED') reasons.push(`${String(key)} = UNKNOWN → fail-closed RED`);
  }

  if (reasons.length > 0) {
    return {
      verdict: 'DENY', sourceId, intent, reasons,
      requiredAttribution: policy.attribution,
      shareAlikeObligation: policy.shareAlike,
    };
  }

  // Atıf gereksinimi BİLİNMİYORSA üretim niyetlerinde kapı kapanır: eksik atıf
  // ODbL/CDLA ihlalidir ve sonradan düzeltilemez (paket dağıtılmış olur).
  // Tek istisna kendi saha gözlemimizdir — üçüncü taraf hakkı içermez.
  if (policy.attribution === null && intent !== 'MEASUREMENT_ONLY'
      && policy.sourceId !== 'FIELD_OBSERVATION') {
    return {
      verdict: 'DENY', sourceId, intent,
      reasons: ['Zorunlu atıf metni BİLİNMİYOR → fail-closed RED.'],
      requiredAttribution: null, shareAlikeObligation: policy.shareAlike,
    };
  }

  const verdict: LicenseGateVerdict = policy.attribution ? 'ALLOW_WITH_ATTRIBUTION' : 'ALLOW';
  return {
    verdict, sourceId, intent,
    reasons: [`${policy.license}: gerekli haklar ALLOWED.`],
    requiredAttribution: policy.attribution,
    shareAlikeObligation: policy.shareAlike,
  };
}

/**
 * Birden çok kaynağın BİRLEŞTİĞİ türev çıktı için kapı. Tek bir kaynak bile
 * RED alırsa çıktı REDDEDİLİR; atıflar ve share-alike yükümlülükleri BİRLEŞİR.
 */
export function evaluateFusionLicenseGate(
  sourceIds: readonly MapDataSourceId[],
  intent: MapDataUseIntent,
): LicenseGateResult {
  if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
    return {
      verdict: 'DENY', sourceId: 'DERIVED', intent,
      reasons: ['Besleyen kaynak YOK — türev veri kendi hakkını üretemez.'],
      requiredAttribution: null, shareAlikeObligation: false,
    };
  }
  const reasons: string[] = [];
  const attributions: string[] = [];
  let shareAlike = false;
  let denied = false;

  for (const id of sourceIds) {
    const result = evaluateLicenseGate(licensePolicyFor(id), intent);
    if (result.verdict === 'DENY') {
      denied = true;
      reasons.push(`${id}: ${result.reasons.join(' · ')}`);
    }
    if (result.shareAlikeObligation) shareAlike = true;
    if (result.requiredAttribution && !attributions.includes(result.requiredAttribution)) {
      attributions.push(result.requiredAttribution);
    }
  }

  if (denied) {
    return {
      verdict: 'DENY', sourceId: 'DERIVED', intent, reasons,
      requiredAttribution: attributions.length > 0 ? attributions.join(' · ') : null,
      shareAlikeObligation: shareAlike,
    };
  }
  return {
    verdict: attributions.length > 0 ? 'ALLOW_WITH_ATTRIBUTION' : 'ALLOW',
    sourceId: 'DERIVED', intent,
    reasons: [`${sourceIds.length} kaynağın tamamı ${intent} için geçti.`],
    requiredAttribution: attributions.length > 0 ? attributions.join(' · ') : null,
    shareAlikeObligation: shareAlike,
  };
}
