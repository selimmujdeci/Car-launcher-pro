/**
 * ecuRoleEvidenceModel — P0-VDK-F6A · ROL ÇÖZÜMÜNÜN SAF KANIT MODELİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **YENİ BİR KİMLİK OTORİTESİ DEĞİLDİR.** Rol sözlüğü MEVCUT
 *     `ecuRoleModel.EcuRole`dür; ad→rol eşlemesi MEVCUT
 *     `roleFromDeclaredName`, standart adres garantisi MEVCUT
 *     `roleFromStandardAddress`tir. Burada yeni bir eşleme tablosu YOKTUR.
 * (2) **OLASILIKSAL/AI MODEL DEĞİLDİR.** Güven, kanıt KÜMESİNDEN deterministik
 *     olarak türer; ağırlık, skor, eşik uydurulmaz (görev §10).
 * (3) **ADRESTEN ROL ÜRETMEZ.** Adres bu dosyaya bir kanıt olarak YALNIZ
 *     `STANDARD_ADDRESS_ROLE` biçiminde girebilir ve onu üreten yer standardın
 *     kendisidir (7E8 · KWP 0x10) — başka hiçbir adres rol kanıtı DEĞİLDİR.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── KANIT KATMANLARI (pazarlıksız) ────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 *   KENDİ BEYANI (identity)   : ECU'nun KENDİ döndürdüğü kimlik verisi.
 *   DESTEKLEYİCİ (corroborating): dışarıdan gelen eşleme (desen · profil · öğrenme).
 *   ZAYIF (weak)              : davranış benzerliği — **ASLA tek başına rol kanıtı değil**.
 *
 * "ABS gibi davranıyor" demek "ABS'tir" DEMEK DEĞİLDİR (görev §13). Bu kural
 * `CAPABILITY_SIGNATURE`ın `CANDIDATE` tavanıyla YAPISAL olarak zorlanır.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 */

import type { EcuRole } from '../ecuRoleModel';
import { ECU_ROLE_LABEL } from '../ecuRoleModel';
import type { CapabilityProvenance } from '../capability/capabilityGraph';
import { isProductTrusted } from '../capability/capabilityGraph';

/* ══════════════════════════════════════════════════════════════════════════
   1) KANIT TÜRLERİ
   ══════════════════════════════════════════════════════════════════════════ */

export type EcuRoleEvidenceKind =
  /** SAE J1979 / ISO 15031-5 ile GARANTİ adres (yalnız 7E0/7E8 · KWP 0x10). */
  | 'STANDARD_ADDRESS_ROLE'
  /** ECU'nun KENDİ beyanı — ISO 14229 kimlik DID'i (F197 sistem adı). */
  | 'IDENTITY_DID'
  /** CDDL `VariantPattern` ÖLÇÜLMÜŞ kanıtlarla eşleşti. */
  | 'VARIANT_PATTERN'
  /** Kalibrasyon/yazılım kimliği bilinen bir varyantla eşleşti. */
  | 'CALIBRATION_MATCH'
  /** Ölçülen salt-okunur servis/DID imzası — **ZAYIF**, tek başına rol DEĞİL. */
  | 'CAPABILITY_SIGNATURE'
  /** Doğrulanmış OEM profil eşleşmesi (VIN WMI/VDS kanıtlı). */
  | 'OEM_PROFILE_MATCH'
  /** Aynı güçlü araç+ECU parmak iziyle DAHA ÖNCE CANLI kanıtla doğrulanmış rol. */
  | 'LEARNED_CONFIRMED'
  /**
   * Kullanıcı/BYOD profili. **BU TURDA ÜRETİLMEZ** (BYOD kapsam dışı) ama
   * sözlükte durur ki ileride eklendiğinde ikinci bir sözlük açılmasın.
   * Üretilmediği testle KİLİTLİDİR.
   */
  | 'USER_BYOD_PROFILE';

export const ECU_ROLE_EVIDENCE_LABEL:
Readonly<Record<EcuRoleEvidenceKind, string>> = {
  STANDARD_ADDRESS_ROLE: 'standart adres garantisi (SAE J1979 / ISO 15031-5)',
  IDENTITY_DID:          'ECU kendi bildirdi (kimlik DID)',
  VARIANT_PATTERN:       'CDDL varyant deseni eşleşti',
  CALIBRATION_MATCH:     'kalibrasyon kimliği eşleşti',
  CAPABILITY_SIGNATURE:  'servis yetenek imzası (ZAYIF — rol kanıtı değil)',
  OEM_PROFILE_MATCH:     'doğrulanmış OEM profil eşleşmesi',
  LEARNED_CONFIRMED:     'aynı araç+ECU parmak iziyle öğrenilmiş (canlı)',
  USER_BYOD_PROFILE:     'kullanıcı/BYOD profili (bu turda ÜRETİLMEZ)',
} as const;

/** ECU'nun KENDİ döndürdüğü kimlik verisi — en güçlü sınıf. */
export const STRONG_IDENTITY_KINDS: ReadonlySet<EcuRoleEvidenceKind> =
  Object.freeze(new Set<EcuRoleEvidenceKind>(['IDENTITY_DID', 'CALIBRATION_MATCH']));

/** Dışarıdan gelen eşleme — güçlü ama ECU'nun kendi beyanı DEĞİL. */
export const CORROBORATING_KINDS: ReadonlySet<EcuRoleEvidenceKind> =
  Object.freeze(new Set<EcuRoleEvidenceKind>([
    'VARIANT_PATTERN', 'OEM_PROFILE_MATCH', 'LEARNED_CONFIRMED', 'USER_BYOD_PROFILE',
  ]));

/**
 * ZAYIF kanıt — **hiçbir koşulda `CANDIDATE` seviyesini geçemez**.
 *
 * Bu küme bir üslup tercihi değil bir güvenlik sınırıdır: yetenek imzası
 * "bu ECU ABS'e benziyor" der; ABS OLDUĞUNU söylemez. Tek başına PROVEN
 * üretmesi, ürünün yanlış modüle yanlış teşhis yazması demekti.
 */
export const WEAK_KINDS: ReadonlySet<EcuRoleEvidenceKind> =
  Object.freeze(new Set<EcuRoleEvidenceKind>(['CAPABILITY_SIGNATURE']));

/* ══════════════════════════════════════════════════════════════════════════
   2) KANIT KAYDI
   ══════════════════════════════════════════════════════════════════════════ */

export interface EcuRoleEvidenceItem {
  readonly kind: EcuRoleEvidenceKind;
  /** Kanıtın İŞARET ETTİĞİ rol. `unknown` işaret eden kanıt KAYDEDİLMEZ. */
  readonly role: Exclude<EcuRole, 'unknown'>;
  /** İnsan okunur gerekçe — "bu rol nereden çıktı" ekranda cevaplanır. */
  readonly detail: string;
  /** Kanıtın kaynak künyesi (DID kimliği · desen kimliği · profil kimliği). */
  readonly source: string;
  /** Ölçüm damgası; enjekte edilir. Ölçülmediyse `null`. */
  readonly observedAt: number | null;
  /** YALNIZ `live` ürün kararı üretir (F4-C ile AYNI kural). */
  readonly provenance: CapabilityProvenance;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) GÜVEN SINIFLARI — DETERMİNİSTİK
   ══════════════════════════════════════════════════════════════════════════ */

export type EcuRoleConfidence =
  | 'PROVEN' | 'STRONG' | 'CANDIDATE' | 'UNKNOWN' | 'CONFLICT';

export const ECU_ROLE_CONFIDENCE_LABEL:
Readonly<Record<EcuRoleConfidence, string>> = {
  PROVEN:    'KANITLI — standart garanti ya da ECU\'nun iki bağımsız beyanı',
  STRONG:    'GÜÇLÜ — ECU beyanı ya da iki bağımsız destekleyici kanıt',
  CANDIDATE: 'ADAY — yalnız davranış benzerliği/tek destekleyici kanıt',
  UNKNOWN:   'BİLİNMİYOR — uç nokta VAR, rol kanıtı YOK',
  CONFLICT:  'ÇELİŞKİ — iki güçlü kanıt FARKLI rol söylüyor (fail-closed)',
} as const;

/** Güven bu seviyedeyse rol ürün kararlarında kullanılabilir. */
export function isRoleActionable(c: EcuRoleConfidence): boolean {
  return c === 'PROVEN' || c === 'STRONG';
}

export interface EcuRoleResolution {
  readonly role: EcuRole;
  readonly confidence: EcuRoleConfidence;
  /** Karara GERÇEKTEN katkı veren kanıtlar (deterministik sırada). */
  readonly evidence: readonly EcuRoleEvidenceItem[];
  /** Çelişkide taraf olan roller; çelişki yoksa boş. */
  readonly conflictingRoles: readonly EcuRole[];
  readonly reason: string;
}

const _EMPTY_ROLES: readonly EcuRole[] = Object.freeze([]);

/** Kanıt sınıfının katman ağırlığı — sıralama için, skor için DEĞİL. */
function _tier(k: EcuRoleEvidenceKind): 0 | 1 | 2 | 3 {
  if (k === 'STANDARD_ADDRESS_ROLE') return 3;
  if (STRONG_IDENTITY_KINDS.has(k)) return 2;
  if (CORROBORATING_KINDS.has(k)) return 1;
  return 0;
}

/** Kanıt deterministik sıraya sokulur — girdi sırası KARARI ETKİLEMEZ. */
function _sorted(items: readonly EcuRoleEvidenceItem[]): EcuRoleEvidenceItem[] {
  return [...items].sort((a, b) =>
    _tier(b.kind) - _tier(a.kind)
    || a.kind.localeCompare(b.kind)
    || a.role.localeCompare(b.role)
    || a.source.localeCompare(b.source));
}

/**
 * ROLÜN TEK KARAR NOKTASI — kanıttan deterministik güven.
 *
 * ── KURALLAR (görev §10 ile birebir) ──────────────────────────────────────
 *  · **CONFLICT** — `STRONG` ya da üstü ağırlıktaki iki kanıt FARKLI rol
 *    söylüyorsa rol `unknown` KALIR ve güven `CONFLICT` olur. İlk kanıt
 *    SEÇİLMEZ; "çoğunluk" sayılmaz. Fail-closed.
 *  · **PROVEN**   — standart garanti VAR, ya da ECU'nun KENDİ beyanından
 *    (identity) İKİ AYRI tür aynı rolü söylüyor.
 *  · **STRONG**   — ECU'nun kendi beyanından EN AZ BİR tür, ya da İKİ AYRI
 *    destekleyici tür aynı rolü söylüyor.
 *  · **CANDIDATE**— yalnız zayıf kanıt ya da TEK destekleyici kanıt.
 *  · **UNKNOWN**  — rol işaret eden hiçbir kanıt yok.
 *
 * ── `productTrustedOnly` ──────────────────────────────────────────────────
 * `true` iken replay/sentetik/içe aktarılmış kanıt karara GİREMEZ (F4-C
 * `isProductTrusted` ile AYNI kural). Masa başı bir iz, ürün rolünü
 * DOĞRULAMAZ — yalnız çözücünün kendisini test eder (görev §15).
 */
export function resolveEcuRole(
  items: readonly EcuRoleEvidenceItem[],
  opts: { readonly productTrustedOnly?: boolean } = {},
): EcuRoleResolution {
  const trustedOnly = opts.productTrustedOnly !== false;
  const usable = _sorted(items).filter((i) =>
    !trustedOnly || isProductTrusted(i.provenance));

  if (usable.length === 0) {
    return {
      role: 'unknown', confidence: 'UNKNOWN',
      evidence: Object.freeze([]), conflictingRoles: _EMPTY_ROLES,
      reason: items.length === 0
        ? 'Uç nokta ölçüldü ama rol işaret eden hiçbir kanıt YOK — rol UYDURULMADI.'
        : 'Kanıtların tamamı ürün-güvenilir DEĞİL (replay/sentetik/içe aktarılmış); '
          + 'masa başı kanıt ürün rolünü doğrulamaz.',
    };
  }

  /* ── Rol başına kanıt türlerini AYIR (aynı türün tekrarı bir kanıt sayılır) ── */
  const byRole = new Map<Exclude<EcuRole, 'unknown'>, Set<EcuRoleEvidenceKind>>();
  for (const i of usable) {
    const set = byRole.get(i.role) ?? new Set<EcuRoleEvidenceKind>();
    set.add(i.kind);
    byRole.set(i.role, set);
  }

  /* ── ÇELİŞKİ: güçlü sınıfta iki farklı rol → fail-closed ─────────────── */
  const strongRoles = [...byRole.entries()]
    .filter(([, kinds]) => [...kinds].some((k) => _tier(k) >= 2))
    .map(([r]) => r);
  if (strongRoles.length > 1) {
    return {
      role: 'unknown', confidence: 'CONFLICT',
      evidence: Object.freeze(usable),
      conflictingRoles: Object.freeze([...strongRoles].sort()),
      reason: `İki güçlü kanıt FARKLI rol söylüyor (${strongRoles
        .map((r) => ECU_ROLE_LABEL[r]).join(' ↔ ')}). `
        + 'Biri seçilmedi: yanlış rol, rolsüzlükten tehlikelidir.',
    };
  }

  /* ── Tek aday rol: en yüksek katmanı taşıyan ─────────────────────────── */
  const ranked = [...byRole.entries()].sort((a, b) => {
    const ta = Math.max(...[...a[1]].map(_tier));
    const tb = Math.max(...[...b[1]].map(_tier));
    return tb - ta || a[0].localeCompare(b[0]);
  });
  const [role, kinds] = ranked[0]!;
  const kindList = [...kinds];

  const hasStandard = kinds.has('STANDARD_ADDRESS_ROLE');
  const identityCount = kindList.filter((k) => STRONG_IDENTITY_KINDS.has(k)).length;
  const corroborateCount = kindList.filter((k) => CORROBORATING_KINDS.has(k)).length;
  const onlyWeak = kindList.every((k) => WEAK_KINDS.has(k));

  const evidence = Object.freeze(usable.filter((i) => i.role === role));

  if (hasStandard || identityCount >= 2) {
    return {
      role, confidence: 'PROVEN', evidence, conflictingRoles: _EMPTY_ROLES,
      reason: hasStandard
        ? `${ECU_ROLE_LABEL[role]} — standardın KENDİ garantisi (adres tahmini DEĞİL).`
        : `${ECU_ROLE_LABEL[role]} — ECU'nun iki bağımsız kimlik beyanı aynı rolü söylüyor.`,
    };
  }
  if (identityCount >= 1 || corroborateCount >= 2) {
    return {
      role, confidence: 'STRONG', evidence, conflictingRoles: _EMPTY_ROLES,
      reason: identityCount >= 1
        ? `${ECU_ROLE_LABEL[role]} — ECU kendi kimlik verisiyle bildirdi.`
        : `${ECU_ROLE_LABEL[role]} — iki bağımsız destekleyici kanıt aynı rolü söylüyor.`,
    };
  }

  /* ── ZAYIF TAVAN: yetenek imzası ASLA bunu geçemez (görev §13) ───────── */
  return {
    role, confidence: 'CANDIDATE', evidence, conflictingRoles: _EMPTY_ROLES,
    reason: onlyWeak
      ? `${ECU_ROLE_LABEL[role]} gibi DAVRANIYOR — bu bir benzerliktir, kimlik DEĞİL. `
        + 'Güçlü kimlik kanıtı gelene kadar ADAY kalır.'
      : `${ECU_ROLE_LABEL[role]} — tek destekleyici kanıt var, ECU'nun kendi beyanı YOK.`,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   4) ÖĞRENME BİRLEŞTİRME — "PROVEN, TIMEOUT İLE DÜŞMEZ"
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Yeni turun çözümü ile ÖNCEKİ (öğrenilmiş) çözümü birleştirir.
 *
 * ── PAZARLIKSIZ KURAL (görev §15) ─────────────────────────────────────────
 * **Bir ölçüm KAYBI, kanıtlanmış bir rolü DÜŞÜREMEZ.** Bu turda ECU sustuysa
 * (`UNKNOWN`), bu araç hakkında yeni bir gerçek DEĞİL, bir ölçüm boşluğudur;
 * önceki `PROVEN`/`STRONG` rol KORUNUR ve bunun öğrenmeden geldiği
 * `LEARNED_CONFIRMED` kanıtıyla GÖRÜNÜR kalır.
 *
 * Tersi serbesttir: `UNKNOWN` bir sonraki turda `PROVEN` olabilir.
 *
 * **ÇELİŞKİ İSTİSNASI:** yeni tur `CONFLICT` ürettiyse öğrenilmiş rol
 * KORUNMAZ — çelişki, öğrenilenin artık güvenilmez olduğunun kanıtıdır.
 */
export function mergeWithLearnedRole(
  fresh: EcuRoleResolution, learned: EcuRoleResolution | null,
): EcuRoleResolution {
  if (learned === null) return fresh;
  if (fresh.confidence === 'CONFLICT') return fresh;
  if (isRoleActionable(fresh.confidence)) return fresh;
  if (!isRoleActionable(learned.confidence)) return fresh;

  return {
    role: learned.role,
    confidence: learned.confidence,
    evidence: learned.evidence,
    conflictingRoles: _EMPTY_ROLES,
    reason: `${learned.reason} (Bu turda yeniden ölçülemedi — ölçüm KAYBI `
      + 'kanıtlanmış rolü DÜŞÜRMEZ.)',
  };
}
