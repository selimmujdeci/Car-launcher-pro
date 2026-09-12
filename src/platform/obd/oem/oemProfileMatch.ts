/**
 * oemProfileMatch — P1-OBD-01 · PROFİL EŞLEŞTİRME + KEŞİF ZENGİNLEŞTİRME (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 * Tüm girdiler (VIN · protokol · oturum numarası · profil listesi) PARAMETREDİR.
 *
 * ── İKİ AYRI İŞ, İKİ AYRI FONKSİYON ───────────────────────────────────────
 *   `matchOemProfile`      → "bu araç hangi profile uyuyor?" (kanıt kapıları)
 *   `mergeOemProfileEcus`  → "mevcut keşif listesine ne EKLENİR?" (duplicate yok)
 *
 * ── KAPI SIRASI (gevşetilemez) ────────────────────────────────────────────
 *  1. VIN yok            → `no_vin`            (marka kanıtı yok; profil DENENMEZ)
 *  2. Protokol bilinmiyor→ `protocol_unknown`  (yanlış transporta istek YASAK)
 *  3. WMI tutmuyor       → `wmi_mismatch`
 *  4. VDS deseni tutmuyor→ `model_mismatch`    (yanlış model kapısı)
 *  5. Protokol sınıfı yok→ `protocol_mismatch`
 *  6. Doğrulanmış ECU yok→ `unverified_rejected` (FAIL-CLOSED)
 *  7. Aksi hâlde         → `matched`
 *
 * Sıra rastgele değildir: önce ARACIN kim olduğu kanıtlanır, sonra HATTIN ne
 * olduğu, en son profilin kendi kanıtı sorulur. Tersine çevrilirse doğrulanmamış
 * bir profil yanlış araçta "reddedildi" diye raporlanır ve teşhis kaybolur.
 *
 * ── ADRESTEN ROL UYDURMA YOK ──────────────────────────────────────────────
 * Eşleşen ECU'nun rolü profilde YAZILI olan roldür ve o rol ancak `verifiedOn`
 * damgası varsa ürün yoluna çıkar. Rolün kanıt sınıfı `profile`'dır ve
 * `ecuRoleModel.deriveEcuRole` içinde beyandan (declared) ve standart adres
 * garantisinden (standard) SONRA gelir — bu modül o sırayı DEĞİŞTİRMEZ.
 */

import { foldAscii, ecuAddressKey } from '../ecuRoleModel';
import type { DiscoveredEcu } from '../ecuDiscovery';
import { classifyProtocol } from '../protocolProfile';
import {
  addressBitsOf, selectProductEcus,
  type OemEcuEntry, type OemEcuProfile, type OemProtocolClass,
} from './oemEcuProfile';

/** Profil yoluyla envantere eklenebilecek azami ECU — hat bütçesi tavanı.
 *  Sessiz kırpma YASAK: kesilen adet `mergeOemProfileEcus` sonucunda raporlanır. */
export const MAX_PROFILE_ECUS = 4;

export type OemMatchOutcome =
  | 'matched'
  | 'no_profile'
  | 'no_vin'
  | 'protocol_unknown'
  | 'wmi_mismatch'
  | 'model_mismatch'
  | 'protocol_mismatch'
  | 'unverified_rejected';

export const OEM_MATCH_OUTCOME_LABEL: Readonly<Record<OemMatchOutcome, string>> = {
  matched:             'EŞLEŞTİ',
  no_profile:          'PROFİL YOK',
  no_vin:              'VIN YOK — marka kanıtı olmadan profil denenmez',
  protocol_unknown:    'PROTOKOL BİLİNMİYOR — fail-closed',
  wmi_mismatch:        'WMI TUTMADI (başka üretici)',
  model_mismatch:      'MODEL TUTMADI (VDS deseni uymuyor)',
  protocol_mismatch:   'PROTOKOL TUTMADI (profil bu hatta uygulanmaz)',
  unverified_rejected: 'DOĞRULANMAMIŞ — ürün yoluna alınmadı (fail-closed)',
};

/** Eşleşen tek ECU — profil kaydı + türetilmiş adresleme bilgisi. */
export interface MatchedOemEcu {
  readonly profileId: string;
  readonly entry: OemEcuEntry;
  /** CAN adres bit sayısı; KWP'de `null` (CAN adres kipi yoktur). */
  readonly addressBits: 11 | 29 | null;
  /**
   * Bu ECU mevcut fonksiyonel keşifte de bulundu mu? `true` ise profil YENİ bir
   * kayıt ÜRETMEZ (duplicate yasağı) — gerçek yanıt kanıtı, profilin
   * varsayımından üstündür.
   */
  readonly alsoDiscovered: boolean;
}

export interface OemProfileMatchResult {
  readonly outcome: OemMatchOutcome;
  /** Eşleşen (ya da kapıda düşen) profilin kimliği; hiç aday yoksa `null`. */
  readonly profileId: string | null;
  readonly manufacturer: string | null;
  readonly modelFamily: string | null;
  /** Yalnız `matched` iken dolu — doğrulanmış ECU kayıtları. */
  readonly ecus: readonly MatchedOemEcu[];
  /** Aktif protokolün sınıfı (`classifyProtocol`); okunamadıysa `null`. */
  readonly protocolClass: OemProtocolClass | null;
  /** Eşleşmenin ait olduğu OBD oturum numarası — reconnect sonrası BAYAT olur. */
  readonly sessionEpoch: number;
  /** İnsan-okur karar gerekçesi (LAB bunu gösterir; uydurma yok). */
  readonly reason: string;
}

export interface OemProfileMatchInput {
  /** Araç VIN'i; yok/kısa ise hiçbir profil DENENMEZ. */
  readonly vin: string | null | undefined;
  /** ELM `ATDPN` protokol hanesi; okunamadıysa `null`. */
  readonly protocol: string | null | undefined;
  readonly sessionEpoch: number;
  readonly profiles: readonly OemEcuProfile[];
  /**
   * Mevcut fonksiyonel keşif sonucu — duplicate tespiti için. Boş dizi geçilebilir
   * (keşif hiç çalışmamışsa profil yine de aday üretebilir; "bulunmadı" ile
   * "bakılmadı" ayrımı çağıranın sorumluluğundadır).
   */
  readonly discovered?: readonly DiscoveredEcu[];
}

function _empty(
  outcome: OemMatchOutcome, reason: string, sessionEpoch: number,
  protocolClass: OemProtocolClass | null, profile: OemEcuProfile | null,
): OemProfileMatchResult {
  return {
    outcome,
    profileId: profile?.id ?? null,
    manufacturer: profile?.vehicle.manufacturer ?? null,
    modelFamily: profile?.vehicle.modelFamily ?? null,
    ecus: [],
    protocolClass,
    sessionEpoch,
    reason,
  };
}

/**
 * Araca uyan profili seçer. HİÇBİR yan etkisi yoktur; sonucu çağıran kullanır.
 *
 * Birden çok profil aynı WMI'yi taşıyorsa, model deseni OLAN (daha spesifik)
 * profil önce denenir — genel marka profili modeli olan bir aracı yutarsa
 * modele özgü adresler asla kullanılamazdı.
 */
export function matchOemProfile(input: OemProfileMatchInput): OemProfileMatchResult {
  const { sessionEpoch, profiles } = input;
  const discovered = input.discovered ?? [];

  if (profiles.length === 0) {
    return _empty('no_profile', 'Kayıtlı OEM ECU profili yok.', sessionEpoch, null, null);
  }

  const rawVin = typeof input.vin === 'string' ? input.vin.trim() : '';
  if (rawVin.length < 3) {
    return _empty('no_vin',
      'VIN okunmadı — üretici KANITI olmadan hiçbir profil denenmez (adresten marka tahmini YASAK).',
      sessionEpoch, null, null);
  }
  const vin = foldAscii(rawVin);
  const wmi = vin.slice(0, 3);

  const protocolClassRaw = classifyProtocol(input.protocol);
  if (protocolClassRaw === 'unknown') {
    return _empty('protocol_unknown',
      'Aktif protokol okunamadı — bilinmeyen hatta fiziksel adres denemek COMM_ERROR fırtınası üretir (fail-closed).',
      sessionEpoch, null, null);
  }
  const protocolClass: OemProtocolClass = protocolClassRaw;

  /* WMI adayları — model deseni olanlar önce (spesifik genelden önce gelir). */
  const wmiCandidates = profiles
    .filter((p) => p.vehicle.wmi.some((w) => foldAscii(w) === wmi))
    .sort((a, b) => Number(b.vehicle.vdsPattern !== null) - Number(a.vehicle.vdsPattern !== null));

  if (wmiCandidates.length === 0) {
    return _empty('wmi_mismatch',
      `VIN'in WMI öneki '${wmi}' hiçbir profille eşleşmedi.`, sessionEpoch, protocolClass, null);
  }

  /* Kapıları sırayla uygula; ilk geçen kazanır. Hiçbiri geçmezse EN SON
     düşen adayın gerekçesi raporlanır (teşhis kaybolmasın). */
  let lastFail: OemProfileMatchResult | null = null;

  for (const profile of wmiCandidates) {
    const vds = profile.vehicle.vdsPattern;
    if (vds !== null) {
      let re: RegExp | null = null;
      try { re = new RegExp(vds); } catch { re = null; }
      /* Desen derlenemiyorsa profil UYGULANMAZ — bozuk desenle "eşleşti" demek,
         doğrulayıcıyı atlatmış bir kaydı ürün yoluna sokmak olurdu. */
      const vds6 = vin.slice(3, 9);
      if (re === null || !re.test(vds6)) {
        lastFail = _empty('model_mismatch',
          re === null
            ? `Profil '${profile.id}' model deseni derlenemedi — uygulanmadı.`
            : `VIN'in VDS alanı '${vds6}' profil '${profile.id}' model desenine uymuyor.`,
          sessionEpoch, protocolClass, profile);
        continue;
      }
    }

    if (!profile.vehicle.protocols.includes(protocolClass)) {
      lastFail = _empty('protocol_mismatch',
        `Profil '${profile.id}' yalnız ${profile.vehicle.protocols.join('/')} hattında uygulanır; aktif hat '${protocolClass}'.`,
        sessionEpoch, protocolClass, profile);
      continue;
    }

    const verified = selectProductEcus(profile);
    if (verified.length === 0) {
      lastFail = _empty('unverified_rejected',
        `Profil '${profile.id}' eşleşti ama gerçek araçta doğrulanmış (verifiedOn + evidence) ECU kaydı YOK — ürün yoluna alınmadı.`,
        sessionEpoch, protocolClass, profile);
      continue;
    }

    const discoveredKeys = new Set(discovered.map((d) => ecuAddressKey(d)));
    const ecus: MatchedOemEcu[] = verified.map((entry) => {
      const bits = addressBitsOf(entry);
      const alsoDiscovered = bits !== null
        && discoveredKeys.has(ecuAddressKey({ rxHeader: entry.rx, addressBits: bits }));
      return { profileId: profile.id, entry, addressBits: bits, alsoDiscovered };
    });

    return {
      outcome: 'matched',
      profileId: profile.id,
      manufacturer: profile.vehicle.manufacturer,
      modelFamily: profile.vehicle.modelFamily,
      ecus,
      protocolClass,
      sessionEpoch,
      reason: `VIN WMI '${wmi}' + protokol '${protocolClass}' ile profil '${profile.id}' eşleşti; ${ecus.length} doğrulanmış ECU kaydı.`,
    };
  }

  return lastFail ?? _empty('wmi_mismatch', 'Aday profil bulunamadı.', sessionEpoch, protocolClass, null);
}

/* ── Keşif zenginleştirme ─────────────────────────────────────────────────── */

export interface OemMergeResult {
  /** Mevcut keşif + profil adayları (SIRA korunur: keşfedilenler ÖNCE). */
  readonly merged: readonly DiscoveredEcu[];
  /** Profil sayesinde EKLENEN aday adedi. */
  readonly addedCount: number;
  /** Profilde olup keşifte de bulunan (bu yüzden EKLENMEYEN) adet. */
  readonly duplicateCount: number;
  /**
   * KWP adreslemeli olduğu için envantere ALINMAYAN adet. `DiscoveredEcu`
   * sözleşmesi 11/29-bit CAN adres kipi ZORUNLU kılar; KWP'de böyle bir kip
   * yoktur ve uydurmak (ör. "11 diyelim") kayıt anahtarını yalanlar.
   */
  readonly kwpDeferredCount: number;
  /** `MAX_PROFILE_ECUS` tavanı yüzünden kesilen adet — sessiz kırpma YASAK. */
  readonly cappedCount: number;
}

/**
 * Profil adaylarını MEVCUT keşif listesine ekler (ikinci otorite kurmadan).
 *
 * SÖZLEŞME:
 *  - Keşifte zaten olan adres EKLENMEZ (duplicate yasağı); gerçek `0100` yanıtı
 *    profil varsayımından üstündür ve kaydın `discoverySource`'u değişmez.
 *  - Eklenen aday `discoverySource: 'profile'` + `probeOutcome: 'not_attempted'`
 *    taşır: profil bir ADRES İDDİASIDIR, bir YANIT KANITI DEĞİLDİR. Yanıt kanıtı
 *    ancak o adrese gerçekten okuma yapıldığında (`ecuIdentityService`) oluşur.
 *  - Rol profilden gelir ve `roleEvidence` keşif katmanının sözleşmesi gereği
 *    `'none'` bırakılır: `DiscoveredEcu.roleEvidence` yalnız `standard | none`
 *    değerlerini tanır ve `profile` kanıtı bir üst katmanda (`deriveEcuRole`)
 *    üretilir. Burada `standard` demek, SAE garantisi yokken varmış gibi
 *    göstermek olurdu.
 */
export function mergeOemProfileEcus(
  discovered: readonly DiscoveredEcu[],
  match: OemProfileMatchResult,
): OemMergeResult {
  if (match.outcome !== 'matched' || match.ecus.length === 0) {
    return { merged: discovered, addedCount: 0, duplicateCount: 0, kwpDeferredCount: 0, cappedCount: 0 };
  }

  const keys = new Set(discovered.map((d) => ecuAddressKey(d)));
  const out: DiscoveredEcu[] = [...discovered];
  let added = 0, duplicate = 0, kwpDeferred = 0, capped = 0;

  for (const m of match.ecus) {
    const bits = m.addressBits;
    if (bits === null) { kwpDeferred += 1; continue; }

    const key = ecuAddressKey({ rxHeader: m.entry.rx, addressBits: bits });
    if (keys.has(key)) { duplicate += 1; continue; }

    if (added >= MAX_PROFILE_ECUS) { capped += 1; continue; }

    keys.add(key);
    added += 1;
    out.push({
      rxHeader: foldAscii(m.entry.rx),
      txHeader: foldAscii(m.entry.tx),
      addressBits: bits,
      role: m.entry.role,
      roleEvidence: 'none',
      label: `${m.entry.name} (profil ${m.profileId})`,
      discoverySource: 'profile',
      probeOutcome: 'not_attempted',
    });
  }

  return { merged: out, addedCount: added, duplicateCount: duplicate, kwpDeferredCount: kwpDeferred, cappedCount: capped };
}

/**
 * Bir adresin (rx + adres kipi) eşleşmiş profilde karşılığı var mı?
 * `ecuIdentityService` rol çıkarımına `profileRole` girdisini bundan alır —
 * eşleşme yoksa `null` döner ve rol `unknown` KALIR.
 */
export function lookupOemProfileEcu(
  match: OemProfileMatchResult, rxHeader: string, addressBits: 11 | 29,
): MatchedOemEcu | null {
  if (match.outcome !== 'matched') return null;
  const key = ecuAddressKey({ rxHeader, addressBits });
  for (const m of match.ecus) {
    if (m.addressBits === null) continue;
    if (ecuAddressKey({ rxHeader: m.entry.rx, addressBits: m.addressBits }) === key) return m;
  }
  return null;
}
