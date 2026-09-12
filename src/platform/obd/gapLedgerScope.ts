/**
 * gapLedgerScope — P0-VDK-F5F/F5G · ARAÇ TANI BÖLÜMÜ KAPSAMI (SAF POLİTİKA).
 *
 * ⚠️ P0-VDK-F5G'den itibaren bu modül YALNIZ boşluk sicilinin değil, **tüm
 * araç kapsamlı tanı depolarının** (boşluk sicili + yetenek öğrenmesi) tek
 * kapsam politikasıdır. Dosya adı F5-F'den kalmadır (kozmetik borç); ikinci
 * bir kapsam modülü açmak, iki deponun farklı araca bakabilmesi demekti.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLEN KUSUR (bu dosyanın var olma nedeni) ───────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F5-E sicili kalıcı yaptı ama **TEK GLOBAL DEPOYA** yazdı. Aynı head unit'e
 * iki farklı araç takıldığında ikisinin boşlukları AYNI deftere karışırdı ve
 * Self-Healing, Araç A'da ölçülmüş bir eksiği Araç B'de ölçmeye kalkardı —
 * yanlış ECU'ya, yanlış serviste, yanlış NRC beklentisiyle.
 *
 * Bu katman o karışmayı **yapısal olarak** imkânsız kılar: her aracın kendi
 * kalıcı bölümü (partition) vardır ve bölüm anahtarı MEVCUT araç kimliğinden
 * türer.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ ARAÇ KİMLİK OTORİTESİ DEĞİLDİR.** Kimlik ve gücü MEVCUT F4-C
 *     `buildCapabilityFingerprint` / `isFingerprintReusable`ten gelir; burada
 *     yeni bir parmak izi algoritması, yeni bir karma ya da yeni bir güven
 *     formülü TANIMLANMAZ.
 * (2) **DEFTER DEĞİLDİR.** Tek satır saklamaz; aktif kapsamı `gapRegistry`
 *     tutar. Burada yalnız KARAR verilir.
 * (3) **BOOT YÖNETİCİSİ DEĞİLDİR.** Ne zaman çağrılacağına üretim yaşam
 *     döngüsü karar verir (`SystemBoot` → `productionDiscovery`).
 * (4) **MIGRATION MOTORU DEĞİLDİR.** Kanıtsız hiçbir kayıt bir araca
 *     taşınmaz (§LEGACY).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 */

import type { CapabilityProvenance } from './capability/capabilityGraph';
import type { TraceProvenance } from './canonicalTrace';

/* ══════════════════════════════════════════════════════════════════════════
   1) ANAHTAR BİÇİMİ — gizlilik YAPISAL olarak garanti edilir
   ══════════════════════════════════════════════════════════════════════════ */

/** Araç kapsamlı BOŞLUK SİCİLİ depo anahtarı öneki. */
export const GAP_LEDGER_KEY_PREFIX = 'caros-gap-ledger-v1';

/**
 * Araç kapsamlı YETENEK ÖĞRENMESİ depo anahtarı öneki (P0-VDK-F5G).
 *
 * ⚠️ İKİNCİ BİR KAPSAM POLİTİKASI DEĞİLDİR: iki depo da AYNI karardan
 * (`resolveGapLedgerScope`) ve AYNI araç kimliğinden beslenir. Ayrı bir
 * politika yazmak, "boşluk sicili Araç A'da, öğrenme Araç B'de" gibi
 * yapısal olarak imkânsız olması gereken bir duruma kapı açardı.
 */
export const CAPABILITY_KEY_PREFIX = 'caros-capability-graph-v1';

/**
 * Araç kapsamlı ECU ROL ÖĞRENMESİ depo anahtarı öneki (P0-VDK-F6A).
 *
 * ⚠️ ÜÇÜNCÜ BİR KAPSAM POLİTİKASI DEĞİLDİR: üç depo da AYNI karardan
 * (`resolveGapLedgerScope`) ve AYNI araç kimliğinden beslenir. Ayrı bir
 * politika yazmak, "Araç A'da öğrenilen ABS rolünü Araç B'nin aynı CAN
 * kimliğine uygulamak" gibi YAPISAL OLARAK imkânsız olması gereken bir
 * duruma kapı açardı (görev §16).
 */
export const ECU_ROLE_KEY_PREFIX = 'caros-ecu-roles-v1';

/**
 * F5-E'nin KAPSAMSIZ (global) deposu.
 *
 * ⚠️ Bu anahtar artık YAZILMAZ ve HİÇBİR ARACA yüklenmez. Hangi araca ait
 * olduğunu kanıtlayamayan bir sicil, bir araca atanamaz — atanırsa yanlış
 * araçta ölçüm planlanır. Bkz. `LEGACY_UNSCOPED_POLICY`.
 */
export const LEGACY_UNSCOPED_GAP_LEDGER_KEY = 'caros-gap-ledger-v1';

/**
 * F4-C'den kalan KAPSAMSIZ (global) yetenek deposu.
 *
 * ⚠️ Aynı politika: hangi araçta öğrenildiğini KANITLAYAMAZ (dosyada araç
 * kimliği ekseni yoktur; kenarların `vehicleId` alanı kaydın kendi iddiasıdır,
 * sahiplik kanıtı değil). Bu yüzden hiçbir araca yüklenmez ve taşınmaz.
 */
export const LEGACY_UNSCOPED_CAPABILITY_KEY = 'caros-capability-graph-v1';

/**
 * Kabul edilen araç kimliği biçimi — MEVCUT `fingerprintHash` çıktısı.
 *
 * `fingerprintHash` iki FNV-1a değerini 8'er hex olarak birleştirir → **16
 * küçük harf hex**. Bu kalıp bir üslup tercihi DEĞİL bir GİZLİLİK KAPISIDIR:
 * ham VIN (17 alfanümerik, büyük harf) · MAC (iki nokta üst üste) · e-posta ·
 * telefon · token bu kalıba UYAMAZ, dolayısıyla depo anahtarına YAPISAL
 * OLARAK giremez. Kalıba uymayan kimlik kalıcı bölüm AÇAMAZ (fail-closed).
 */
const FINGERPRINT_ID_RE = /^[0-9a-f]{16}$/;

export function isPersistableVehicleRef(ref: string | null): boolean {
  return ref !== null && FINGERPRINT_ID_RE.test(ref);
}

/** Araç kapsamlı depo anahtarı; kimlik kalıcı bölüme uygun değilse `null`. */
export function gapLedgerKeyFor(vehicleRef: string | null): string | null {
  return isPersistableVehicleRef(vehicleRef)
    ? `${GAP_LEDGER_KEY_PREFIX}:${vehicleRef}` : null;
}

/** Araç kapsamlı YETENEK depo anahtarı — AYNI kimlik kapısından geçer. */
export function capabilityKeyFor(vehicleRef: string | null): string | null {
  return isPersistableVehicleRef(vehicleRef)
    ? `${CAPABILITY_KEY_PREFIX}:${vehicleRef}` : null;
}

/** Araç kapsamlı ECU ROL depo anahtarı — AYNI kimlik kapısından geçer. */
export function ecuRoleKeyFor(vehicleRef: string | null): string | null {
  return isPersistableVehicleRef(vehicleRef)
    ? `${ECU_ROLE_KEY_PREFIX}:${vehicleRef}` : null;
}

/**
 * Bir aracın TÜM kalıcı bölüm anahtarları — GC ve parite için TEK liste.
 *
 * Yeni bir bölüm türü eklendiğinde BURAYA eklenir; böylece çöp toplama
 * "yarısını sildim" durumuna yapısal olarak düşmez.
 */
export function vehiclePartitionKeys(vehicleRef: string): readonly string[] {
  const out: string[] = [];
  const cap = capabilityKeyFor(vehicleRef);
  const gap = gapLedgerKeyFor(vehicleRef);
  /* P0-VDK-F6A — üçüncü bölüm türü: ECU rol öğrenmesi. Buraya eklenmesi
     ZORUNLUDUR; aksi hâlde çöp toplama aracın yarısını siler ve geride
     sahipsiz bir rol dosyası kalırdı. */
  const roles = ecuRoleKeyFor(vehicleRef);
  if (cap !== null) out.push(cap);
  if (gap !== null) out.push(gap);
  if (roles !== null) out.push(roles);
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) KAPSAM DURUMU
   ══════════════════════════════════════════════════════════════════════════ */

export type GapLedgerScopeState =
  /** Araç kimliği HENÜZ bilinmiyor (açılış). Hiçbir bölüm yüklenmez. */
  | 'UNIDENTIFIED'
  /** Güçlü, kanıtlı kimlik — aracın KENDİ kalıcı bölümü. */
  | 'VEHICLE_SCOPED'
  /** Kimlik var ama YETERSİZ — bellek içi, kalıcılık ENGELLİ. */
  | 'EPHEMERAL_WEAK_IDENTITY'
  /** Replay/sentetik/imported koşu — ürün bölümüne DOKUNAMAZ. */
  | 'EPHEMERAL_REPLAY';

export const GAP_LEDGER_SCOPE_LABEL: Readonly<Record<GapLedgerScopeState, string>> = {
  UNIDENTIFIED:            'ARAÇ KİMLİĞİ YOK — hiçbir sicil yüklenmedi',
  VEHICLE_SCOPED:          'ARACA BAĞLI — kendi kalıcı bölümü',
  EPHEMERAL_WEAK_IDENTITY: 'KİMLİK ZAYIF — yalnız bellek, kalıcılık ENGELLİ',
  EPHEMERAL_REPLAY:        'REPLAY/SENTETİK — ürün bölümüne yazılmaz',
} as const;

export interface GapLedgerScope {
  readonly state: GapLedgerScopeState;
  /**
   * Aktif araç kimliği REFERANSI (parmak izi karması) — ham VIN DEĞİL.
   *
   * Kalıcılık engelli olsa bile taşınır: bellek içi sicilin hangi araca ait
   * olduğunu bilmek, iki aracın çalışma durumunun karışmaması için ŞARTTIR.
   */
  readonly vehicleRef: string | null;
  /** Kalıcı depo anahtarı; kalıcılık engelliyse `null`. */
  readonly storageKey: string | null;
  readonly persistenceAllowed: boolean;
  /**
   * P0-VDK-F6E-1 — KANONİK F4-C `isFingerprintReusable(fp)` SONUCU.
   *
   * ÖLÇÜLEN KUSUR: bu değer `resolveGapLedgerScope`a GİRİYOR ama çıktıda
   * TAŞINMIYORDU; öğrenme tüketicileri onu `persistenceAllowed`tan ÇIKARMAK
   * zorunda kalıyordu. İKİSİ AYNI SORU DEĞİLDİR:
   *   · `fingerprintReusable` → “kimlik bu öğrenmeyi bu ARACA atfedecek kadar
   *     güçlü mü?” — F4-C otoritesi
   *   · `persistenceAllowed`   → “DİSKE yazabilir miyiz?” — ayrıca köken,
   *     iz modu ve referans BİÇİMİ kapılarından geçer
   * İkincisi birincinin ALT KÜMESİDİR; birini diğerinin yerine kullanmak
   * kanonik mantığı KOPYALAMAKTIR. Artık kanonik değer AYNEN taşınır.
   */
  readonly fingerprintReusable: boolean;
  /** Kalıcılık neden engellendi — sessiz engelleme YASAK. */
  readonly blockedReason: string | null;
}

export const UNIDENTIFIED_SCOPE: GapLedgerScope = Object.freeze({
  state: 'UNIDENTIFIED' as const,
  vehicleRef: null,
  storageKey: null,
  persistenceAllowed: false,
  /* Kimlik YOK → kanonik güç de yok (fail-closed). */
  fingerprintReusable: false,
  blockedReason: 'araç kimliği henüz ölçülmedi — hiçbir sicil yüklenmez',
});

/* ══════════════════════════════════════════════════════════════════════════
   3) KARAR — FAIL-CLOSED
   ══════════════════════════════════════════════════════════════════════════ */

export interface GapLedgerScopeInput {
  /** F4-C `CapabilityFingerprint.id`; ölçülmediyse `null`. */
  readonly vehicleRef: string | null;
  /** F4-C `isFingerprintReusable(fp)` — MEVCUT güç otoritesi. */
  readonly fingerprintReusable: boolean;
  /** Ölçümün kökeni — YALNIZ `live` ürün bölümü açar. */
  readonly provenance: CapabilityProvenance | null;
  /** MEVCUT kanonik iz replay modu (ikinci savunma katmanı). */
  readonly traceMode: TraceProvenance;
}

/**
 * Aktif kapsamı ÖLÇER (iddia etmez). Sıra bilinçli ve fail-closed:
 *
 *  1. **Replay/sentetik önce elenir.** Bir replay koşusu gerçek bir aracın
 *     kalıcı sicilini ne yükleyebilir ne de kirletebilir — kimliği ne kadar
 *     güçlü görünürse görünsün.
 *  2. **Kimlik yoksa hiçbir bölüm açılmaz.** "Muhtemelen aynı araçtır" diye
 *     eski sicili yüklemek, bu turun yasakladığı TEK ŞEYDİR.
 *  3. **Kimlik zayıfsa bellek içi çalışılır.** Zayıf parmak izi (yalnız
 *     adres+protokol) iki farklı aracı aynı sanabilir; kalıcı hâle gelirse
 *     hata da kalıcı olur.
 *  4. Kalanı: aracın kendi bölümü.
 */
export function resolveGapLedgerScope(input: GapLedgerScopeInput): GapLedgerScope {
  if (input.traceMode !== 'live' || input.provenance !== 'live') {
    return Object.freeze({
      state: 'EPHEMERAL_REPLAY' as const,
      vehicleRef: input.vehicleRef,
      storageKey: null,
      persistenceAllowed: false,
      /* Kanonik güç AYNEN taşınır — replay koşusunda tüketici zaten MEVCUT
         köken kapısından (F4-C `isProductTrusted`) geçemez. */
      fingerprintReusable: input.fingerprintReusable,
      blockedReason: `köken ${input.provenance ?? 'ÖLÇÜLMEDİ'} · iz modu `
        + `${input.traceMode} — ürün bölümü açılmaz`,
    });
  }
  if (input.vehicleRef === null || input.vehicleRef.length === 0) {
    return UNIDENTIFIED_SCOPE;
  }
  if (!input.fingerprintReusable || !isPersistableVehicleRef(input.vehicleRef)) {
    return Object.freeze({
      state: 'EPHEMERAL_WEAK_IDENTITY' as const,
      vehicleRef: input.vehicleRef,
      storageKey: null,
      persistenceAllowed: false,
      fingerprintReusable: input.fingerprintReusable,
      blockedReason: !input.fingerprintReusable
        ? 'parmak izi yeniden kullanıma YETMİYOR (F4-C isFingerprintReusable) '
          + '— başka aracın sicili YÜKLENMEZ'
        : 'kimlik referansı parmak izi biçiminde DEĞİL — kalıcı bölüm açılmaz',
    });
  }
  return Object.freeze({
    state: 'VEHICLE_SCOPED' as const,
    vehicleRef: input.vehicleRef,
    storageKey: gapLedgerKeyFor(input.vehicleRef),
    persistenceAllowed: true,
    /* Bu dala YALNIZ `fingerprintReusable === true` iken gelinir (yukarıdaki
       kapı aksini eler) — yine de değer TÜRETİLMEZ, girdiden AYNEN taşınır. */
    fingerprintReusable: input.fingerprintReusable,
    blockedReason: null,
  });
}

/**
 * İki kapsam AYNI sicili mi gösteriyor.
 *
 * ⚠️ OTURUM MÜHRÜ (`sessionEpoch`) BU KARARIN PARÇASI DEĞİLDİR: aynı araca
 * yeniden bağlanmak yeni bir epoch üretir ama araç DEĞİŞMEZ — sicil kalır.
 * Bölüm yalnız **araç kimliği** değişince değişir.
 */
export function isSameGapLedgerScope(a: GapLedgerScope, b: GapLedgerScope): boolean {
  return a.state === b.state && a.vehicleRef === b.vehicleRef
    && a.storageKey === b.storageKey;
}

/* ══════════════════════════════════════════════════════════════════════════
   4) ESKİ KAPSAMSIZ DEPO
   ══════════════════════════════════════════════════════════════════════════ */

export type LegacyUnscopedPolicy = 'IGNORE_NO_OWNERSHIP_PROOF';

/**
 * F5-E'den kalan kapsamsız deponun politikası — TEK seçenek.
 *
 * O depo hangi araçta yazıldığını KANITLAYAMAZ (araç kimliği eksenlerinden
 * hiçbiri kaydında yoktur). Bir araca taşımak, o araca ait olmayan bir tanı
 * geçmişini ürün gerçeği gibi sunmak olurdu. Bu yüzden:
 *
 *  · yüklenmez · taşınmaz · yorumlanmaz · üstüne yazılmaz,
 *  · yalnız VARLIĞI LAB'da kanıt olarak görünür.
 *
 * Sahiplik kanıtı (kaydın içinde ölçülmüş araç kimliği) ileride eklenirse
 * migration AYRI ve kanıtlı bir iş olarak tasarlanır — bu turda YOK.
 */
export const LEGACY_UNSCOPED_POLICY: LegacyUnscopedPolicy = 'IGNORE_NO_OWNERSHIP_PROOF';

export const LEGACY_UNSCOPED_POLICY_LABEL =
  'KAPSAMSIZ ESKİ DEPO — sahiplik kanıtı YOK, hiçbir araca taşınmaz';
