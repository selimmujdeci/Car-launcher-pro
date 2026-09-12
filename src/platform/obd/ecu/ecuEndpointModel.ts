/**
 * ecuEndpointModel — P0-VDK-F6A · TANI UÇ NOKTASI (ENDPOINT) SAF MODELİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYANIN TEK MİMARİ İDDİASI ────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 *          **ADRES BULMAK ≠ ECU ROLÜNÜ BİLMEK.**
 *
 * Bu modül YALNIZ birinci soruyu cevaplar: *"burada cevap veren bir tanı uç
 * noktası var mı?"*. İkinci soru (*"bu uç nokta hangi modül?"*) AYRI bir
 * dosyanın (`ecuRoleEvidenceModel`) işidir ve **birinciden TÜRETİLMEZ**.
 *
 * Bu ayrım kozmetik değildir: bugüne kadar rol ile adres aynı kayıtta yaşıyordu
 * (`DiscoveredEcu.role`) ve `7E1 = şanzıman` gibi bir genellemenin kod içine
 * sızması için tek bir satır yetiyordu. Burada `role` alanı **YOKTUR**.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ADAY UZAYI: KÖR TARAMA YAPISAL OLARAK İMKÂNSIZ ────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `endpointCandidateSpace()` her adresleme ailesi için **kapalı** bir cevap
 * verir ve tek genişleme noktası budur:
 *
 *   · `can11` → ISO 15765-4'ün KENDİ tanımladığı `7E0..7E7` çifti
 *               (mevcut `physicalEcuProbe.STANDARD_PHYSICAL_TX` — kopyalanmaz).
 *   · `can29` → **BOŞ.** 29-bit hedef baytı üretici serbestindedir; standart
 *               bir aday uzayı YOKTUR. Aday üretmek `0x00..0xFF` kör taraması
 *               demekti (görev §6 yasağı). Uç nokta YALNIZ ölçülmüş
 *               responder'dan doğar.
 *   · `kwp`  → **BOŞ.** K-line'da kör hedef sweep'i başka bir modülü uyandırır
 *               ve oturumunu bozar (sahada ölçülmüş risk). Uç nokta YALNIZ
 *               ölçülmüş kaynak adresinden doğar (görev §7).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 */

import type { TxHeaderProvenance } from '../ecuDiscovery';
import type { EcuAddressBits } from '../ecuRoleModel';
import { foldAscii } from '../ecuRoleModel';
import { STANDARD_PHYSICAL_TX, rxForPhysicalTx } from '../physicalEcuProbe';
import type { CddlAddressing } from '../cddl/schema';

/* ══════════════════════════════════════════════════════════════════════════
   1) ULAŞILABİLİRLİK — "bulunamadı" ASLA "araçta yok" DEĞİLDİR
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Uç noktanın bize NASIL ulaşılabilir olduğu (görev §19).
 *
 * ⚠️ Bu turda YALNIZ İKİ değer ÜRETİLEBİLİR ve bu bilinçlidir:
 *  · `DIRECT_ENDPOINT`       — ölçüldü: doğrudan tanı hattında cevap verdi.
 *  · `UNKNOWN_REACHABILITY`  — ölçülemedi.
 *
 * `GATEWAY_EXPOSED` / `GATEWAY_REQUIRED` **tanımlıdır ama ÜRETİLMEZ**: bu depo
 * bugün ağ geçidi topolojisini ölçemez ve ölçemediği bir şeyi iddia etmek tam
 * olarak bu ürünün kaçındığı kusurdur. Gateway bypass bu turun DIŞINDADIR.
 * `deriveReachability` bu ikisini asla döndürmez ve bu testle KİLİTLİDİR.
 */
export type EcuReachability =
  | 'DIRECT_ENDPOINT'
  | 'GATEWAY_EXPOSED'
  | 'GATEWAY_REQUIRED'
  | 'UNKNOWN_REACHABILITY';

export const ECU_REACHABILITY_LABEL: Readonly<Record<EcuReachability, string>> = {
  DIRECT_ENDPOINT:      'DOĞRUDAN — tanı hattında cevap verdi',
  GATEWAY_EXPOSED:      'AĞ GEÇİDİ ÜZERİNDEN (bu turda ÖLÇÜLEMEZ)',
  GATEWAY_REQUIRED:     'AĞ GEÇİDİ GEREKİR (bu turda ÖLÇÜLEMEZ)',
  UNKNOWN_REACHABILITY: 'BİLİNMİYOR — ölçülemedi ("araçta yok" DEĞİL)',
} as const;

/** Uç noktanın hangi ÖLÇÜMDEN doğduğu — iddia değil, kanıt künyesi. */
export type EcuEndpointSource =
  /** Fonksiyonel `0100` (7DF) yayınına KENDİ header'ıyla cevap verdi. */
  | 'FUNCTIONAL_RESPONDER'
  /** ISO 15765-4 standart fiziksel adres yoklamasına cevap verdi. */
  | 'STANDARD_PHYSICAL_PROBE'
  /** KWP/ISO yanıt header'ından ÖLÇÜLMÜŞ kaynak adresi. */
  | 'KWP_MEASURED_SOURCE'
  /** Kaynak ölçülemedi (yalnız profil iddiası) — uç nokta SAYILMAZ. */
  | 'UNMEASURED';

export const ECU_ENDPOINT_SOURCE_LABEL: Readonly<Record<EcuEndpointSource, string>> = {
  FUNCTIONAL_RESPONDER:    'fonksiyonel 0100 yanıtı (araç kendi bildirdi)',
  STANDARD_PHYSICAL_PROBE: 'ISO 15765-4 standart fiziksel adres yoklaması',
  KWP_MEASURED_SOURCE:     'KWP/ISO yanıt header kaynağı (ölçüldü)',
  UNMEASURED:              'ÖLÇÜLMEDİ — uç nokta sayılmaz',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
   2) GİRDİ — YAPISAL, `DiscoveredEcu`ya BAĞLI DEĞİL
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Keşfin ÖLÇTÜĞÜ asgari kayıt.
 *
 * ⚠️ `DiscoveredEcu` yerine YAPISAL bir tip kullanılması bilinçlidir: bu
 * katman `role` / `roleEvidence` alanlarını görmemelidir (görev §3). Tipi
 * dar tutmak, rolün buraya kazara sızmasını derleyici düzeyinde engeller.
 */
export interface MeasuredEcuRecord {
  readonly rxHeader: string;
  readonly txHeader: string;
  readonly addressBits: number;
  readonly discoverySource?: string | undefined;
  readonly probeOutcome?: string | undefined;
  readonly kwpTargetVerified?: boolean | undefined;
  readonly txProvenance?: string | undefined;
}

/** Ölçülen adres genişliğini kanonik kipe indirger — bilinmeyen → 11 (CAN). */
export function normalizeAddressBits(bits: number): EcuAddressBits {
  return bits === 8 ? 8 : bits === 29 ? 29 : 11;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) UÇ NOKTA KAYDI — **`role` ALANI YOKTUR**
   ══════════════════════════════════════════════════════════════════════════ */

export interface EcuEndpoint {
  /** Kararlı uç nokta anahtarı — adresleme kipi + yanıt adresi. */
  readonly key: string;
  readonly txHeader: string;
  readonly rxHeader: string;
  readonly addressBits: EcuAddressBits;
  readonly addressing: CddlAddressing;
  /** Ölçülen aktif protokol; bilinmiyorsa `null`. */
  readonly protocol: string | null;
  readonly source: EcuEndpointSource;
  readonly reachability: EcuReachability;
  /** `txHeader` HANGİ standart kuraldan türedi (uydurulmadığının kanıtı). */
  readonly txProvenance: TxHeaderProvenance;
  /** Bu uç noktaya FİZİKSEL istek gönderilebilir mi (adres türetilebildi mi). */
  readonly addressable: boolean;
  /** KWP hedefinin ÖLÇÜLMÜŞ doğrulaması; CAN'de kavram yok → `null`. */
  readonly kwpTargetVerified: boolean | null;
}

/** Adresleme kipini CDDL diline çevirir — ikinci sözlük TANIMLANMAZ. */
export function addressingForBits(bits: EcuAddressBits): CddlAddressing {
  return bits === 8 ? 'kwp' : bits === 29 ? 'can29' : 'can11';
}

/** Kararlı uç nokta anahtarı. Adresleme kipi ANAHTARA GİRER (F4-C ile aynı disiplin). */
export function endpointKey(rxHeader: string, bits: EcuAddressBits): string {
  return `${bits}:${foldAscii(rxHeader)}`;
}

/**
 * Keşfin ÖLÇTÜĞÜ kaydı kanonik uç noktaya çevirir.
 *
 * ⚠️ `DiscoveredEcu.role` / `roleEvidence` alanları **BİLEREK OKUNMAZ**: bu
 * katmanın rol hakkında hiçbir şey bilmemesi, rolün adresten sızmasını
 * yapısal olarak imkânsız kılar (görev §3).
 *
 * `null` döner: kaydın uç nokta olduğu ÖLÇÜLMEMİŞSE (profil iddiası ya da
 * cevap vermemiş aday). Uydurma uç nokta YASAK.
 */
export function buildEcuEndpoint(
  e: MeasuredEcuRecord, protocol: string | null,
): EcuEndpoint | null {
  const source = endpointSourceOf(e);
  if (source === 'UNMEASURED') return null;

  const bits = normalizeAddressBits(e.addressBits);
  const tx = foldAscii(e.txHeader ?? '');
  const provenance = (e.txProvenance ?? 'unknown') as TxHeaderProvenance;
  /* ── ADRESLENEBİLİRLİK — İKİ AYRI "BİLİNMİYOR" KARIŞTIRILMAZ ───────────
     ⚠️ ÖLÇÜLEN KUSUR (bu turda regresyon olarak yakalandı): `txProvenance`
     ALANI TAŞINMAMASI ile `txProvenance: 'unknown'` AYNI ŞEY DEĞİLDİR.
      · alan YOK        → çağıran bu ekseni taşımıyor (eski/dar kayıt türü);
                          boş olmayan bir `tx` yine de TÜRETİLMİŞ adrestir ve
                          mevcut davranış (`healingTargetFromProvenEcu`) onu
                          kabul eder.
      · alan 'unknown'  → keşif adresi TÜRETEMEDİĞİNİ ÖLÇTÜ → istek YASAK.
     İkisini birleştirmek, ölçüm taşımayan her çağıranın hedefini sessizce
     düşürüyordu (üretim keşfi `BLOCKED`a düşüyordu). */
  const explicitlyUnknown = e.txProvenance === 'unknown';
  const addressable = tx.length > 0 && !explicitlyUnknown;

  return {
    key: endpointKey(e.rxHeader, bits),
    txHeader: tx,
    rxHeader: foldAscii(e.rxHeader),
    addressBits: bits,
    addressing: addressingForBits(bits),
    protocol,
    source,
    /* Cevap verdiği ÖLÇÜLDÜ → doğrudan uç nokta. Ağ geçidi ayrımı ölçülemez. */
    reachability: 'DIRECT_ENDPOINT',
    txProvenance: provenance,
    addressable,
    kwpTargetVerified: bits === 8 ? (e.kwpTargetVerified ?? false) : null,
  };
}

/**
 * Kaydın hangi ölçümden doğduğu.
 *
 * `profile` kaynaklı ve cevabı ÖLÇÜLMEMİŞ adaylar `UNMEASURED`dır: bir profil
 * bir adres İDDİASIDIR, yanıt kanıtı değildir (mevcut `EcuIdentity.probeOutcome`
 * ayrımıyla aynı felsefe).
 */
export function endpointSourceOf(e: MeasuredEcuRecord): EcuEndpointSource {
  if (e.probeOutcome !== undefined && e.probeOutcome !== 'responded') return 'UNMEASURED';
  if (e.discoverySource === 'profile') return 'UNMEASURED';
  if (e.discoverySource === 'physical_probe') return 'STANDARD_PHYSICAL_PROBE';
  if (normalizeAddressBits(e.addressBits) === 8) return 'KWP_MEASURED_SOURCE';
  return 'FUNCTIONAL_RESPONDER';
}

/**
 * Ulaşılabilirlik hükmü — **ölçülemeyen hiçbir şey iddia edilmez**.
 *
 * "ECU bulunamadı" ile "araçta o ECU yok" ARASINDAKİ farkı korumak bu
 * fonksiyonun tek işidir; ikisi karıştırılırsa ürün, sormadığı bir soruya
 * "hayır" cevabı verir.
 */
export function deriveReachability(measuredResponder: boolean): EcuReachability {
  return measuredResponder ? 'DIRECT_ENDPOINT' : 'UNKNOWN_REACHABILITY';
}

/* ══════════════════════════════════════════════════════════════════════════
   4) ADAY UZAYI — TEK GENİŞLEME NOKTASI, KÖR TARAMA İMKÂNSIZ
   ══════════════════════════════════════════════════════════════════════════ */

export interface EndpointCandidateSpace {
  /** Sorulabilecek fiziksel istek adresleri; kapalı ve sonlu. */
  readonly txCandidates: readonly string[];
  /** Aday üretilemiyorsa NEDEN — sessiz boşluk YASAK. */
  readonly reason: string;
  /** Standart bir aday uzayı tanımlı mı (yoksa yalnız ölçülmüş responder). */
  readonly standardSpaceDefined: boolean;
}

/**
 * Bir adresleme ailesi için STANDART aday uzayı.
 *
 * ⚠️ Bu fonksiyon bir **beyaz listedir** ve genişletmenin TEK yeridir. Yeni bir
 * adres buraya ancak bir STANDART METNİ gösterilerek girebilir; marka tablosu,
 * forum bilgisi ve "çoğu araçta böyle" gerekçesi GİREMEZ.
 */
export function endpointCandidateSpace(
  addressing: CddlAddressing,
): EndpointCandidateSpace {
  switch (addressing) {
    case 'can11':
      return {
        txCandidates: STANDARD_PHYSICAL_TX,
        standardSpaceDefined: true,
        reason: 'ISO 15765-4 fiziksel istek/yanıt çifti (7E0..7E7 ↔ 7E8..7EF)',
      };
    case 'can29':
      return {
        txCandidates: [],
        standardSpaceDefined: false,
        reason: '29-bit hedef baytı ÜRETİCİ SERBESTİNDEDİR — standart aday uzayı '
          + 'YOK. Aday üretmek kör 0x00..0xFF taraması olurdu; uç nokta yalnız '
          + 'ÖLÇÜLMÜŞ responder\'dan doğar.',
      };
    case 'kwp':
      return {
        txCandidates: [],
        standardSpaceDefined: false,
        reason: 'K-line\'da kör hedef taraması başka bir modülü uyandırır ve '
          + 'oturumunu bozar (sahada ölçülmüş risk). Uç nokta yalnız ÖLÇÜLMÜŞ '
          + 'kaynak adresinden doğar.',
      };
    default:
      return {
        txCandidates: [],
        standardSpaceDefined: false,
        reason: 'fonksiyonel yayın tek bir ECU\'ya ait DEĞİLDİR — uç nokta değil',
      };
  }
}

/**
 * Aday adresin standart uzayda olup olmadığı — **fail-closed muhafız**.
 *
 * Uç nokta yoklaması yapan her yol bu kapıdan geçer; TS tarafında yanlışlıkla
 * bir adres listesi genişletilse bile bu fonksiyon standart dışı bir adresi
 * kabul etmez.
 */
export function isStandardCandidate(
  addressing: CddlAddressing, tx: string,
): boolean {
  const space = endpointCandidateSpace(addressing);
  const t = foldAscii(tx);
  return space.txCandidates.some((c) => foldAscii(c) === t);
}

/** ISO 15765-4 `rx = tx + 8` — mevcut otorite yeniden dışa verilir, kopyalanmaz. */
export { rxForPhysicalTx };

/* ══════════════════════════════════════════════════════════════════════════
   5) ENVANTER YARDIMCILARI
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Ölçülmüş kayıtlardan kanonik uç nokta listesi — **deterministik sıra**.
 *
 * Sıra kimliğin parçası olabildiği için (F5-H dersi) yanıt adresine göre
 * sıralanır: keşfin döndürme sırası hat gürültüsüne göre değişebilir.
 */
export function buildEndpointInventory(
  ecus: readonly MeasuredEcuRecord[], protocol: string | null,
): readonly EcuEndpoint[] {
  const byKey = new Map<string, EcuEndpoint>();
  for (const e of ecus) {
    const ep = buildEcuEndpoint(e, protocol);
    if (ep === null) continue;
    /* Aynı uç nokta iki kaynaktan gelebilir (fonksiyonel + fiziksel prob).
       Fonksiyonel kanıt daha güçlüdür: araç onu KENDİLİĞİNDEN bildirdi. */
    const prev = byKey.get(ep.key);
    if (prev === undefined || (prev.source !== 'FUNCTIONAL_RESPONDER'
      && ep.source === 'FUNCTIONAL_RESPONDER')) {
      byKey.set(ep.key, ep);
    }
  }
  return Object.freeze([...byKey.values()].sort((a, b) => a.key.localeCompare(b.key)));
}
