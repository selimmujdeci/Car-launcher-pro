/**
 * ecuDiscovery — Çoklu-ECU keşfi (OBD-OS-F2-1). Car Scanner farkının temeli.
 *
 * BUGÜNE KADAR: tüm teşhis TEK ECU'ya (motor, fonksiyonel 7DF) yapılıyordu. ABS, airbag,
 * şanzıman, BCM… hiç sorgulanmıyordu → o sistemlerdeki arızalar GÖRÜNMÜYORDU. Bu modül
 * araçta gerçekten YAŞAYAN ECU'ları çıkarır; sonraki adımlar (F2-2 router, F2-3 ECU-başına
 * DTC) bu envanterin üstüne kurulur.
 *
 * YÖNTEM (native `probeEcusRaw`): `ATH1` ile yanıt başlıkları açılır, `0100` FONKSİYONEL
 * adrese (7DF) gönderilir. ISO 15765-4: bu isteği araçtaki HER OBD-uyumlu ECU yanıtlar ve
 * her yanıt KENDİ header'ını taşır. Tek komutla envanter çıkar — kör adres taraması gerekmez.
 *
 * ZERO-TRUST: yalnız GERÇEKTEN YANIT VEREN adres envantere girer. Rol tahmini yapılmaz —
 * 7E0 dışındaki adresler araç-özeldir (7E1 çoğu araçta şanzıman AMA garanti DEĞİL) →
 * 'unknown' kalır. Uydurma rol, yanlış teşhise yol açar; boş bilgi yanlış bilgiden iyidir.
 *
 * SAF: modül-durumu yok, I/O yok — tam test edilebilir.
 */

/**
 * ECU'nun teşhis rolü.
 *
 * P0-OBD-08: tür artık `ecuRoleModel`'de TEK yerde tanımlıdır (rol sözlüğü ile
 * rol ÇIKARIMI aynı dosyada yaşamalı, yoksa ikisi ayrışır). Buradan yeniden
 * dışa verilir — mevcut tüketiciler DEĞİŞMEDEN çalışır.
 *
 * KEŞİF KATMANI hâlâ yalnız STANDART garantiyi uygular: `7E8` → `engine`,
 * gerisi `unknown`. Daha zengin roller yalnız KANITLA (ECU'nun kendi beyanı)
 * `ecuIdentityService`te türetilir — adresten rol tahmini burada da YASAK.
 */
export type { EcuRole, EcuAddressBits } from './ecuRoleModel';
import { roleFromStandardAddress, type EcuAddressBits, type EcuRole } from './ecuRoleModel';

export interface DiscoveredEcu {
  /** ECU'nun YANIT (rx) header'ı — ham kanıt: '7E8' (11-bit) veya '18DAF110' (29-bit). */
  rxHeader: string;
  /** Bu ECU'ya İSTEK gönderilecek (tx) adres: '7E0' / '18DA10F1'. */
  txHeader: string;
  /** 11 = standart CAN ID · 29 = genişletilmiş CAN · 8 = KWP/ISO K-line fiziksel adres. */
  addressBits: EcuAddressBits;
  /** Rol — yalnız standartla garanti olanlar; gerisi 'unknown' (uydurma YOK). */
  role: EcuRole;
  /**
   * P0-OBD-08 — rolün HANGİ kanıttan çıktığı. Keşif katmanında yalnız iki
   * değer olabilir: `standard` (7E8) ya da `none`. Zenginleştirilmiş roller
   * (`declared`/`profile`) `ecuIdentityService`te üretilir.
   */
  roleEvidence: 'standard' | 'none';
  /** Kullanıcıya gösterilecek TR etiket. */
  label: string;
  /** Bu kayıt hangi gerçek gözlemden geldi; adres/rol tahmini değildir. */
  discoverySource?: 'functional_0100' | 'physical_probe' | 'gateway_inventory' | 'profile';
  probeOutcome?: 'responded' | 'no_response' | 'failed' | 'not_attempted';
  /** KWP fiziksel target/session kaynağı gerçekten doğrulandı; yoksa 0x18 GÖNDERİLMEZ. */
  kwpTargetVerified?: boolean;
  /**
   * P0-OBD-FINAL-01 — `txHeader` HANGİ kuraldan çıktı.
   *
   * `unknown` iken `txHeader` BOŞ STRİNGTİR ve o ECU'ya fiziksel istek
   * GÖNDERİLEMEZ (boş tx `withEcuHeader`de "varsayılan adresleme" demektir —
   * fonksiyonel hatta sızardı). Tarama bu ECU'yu `not_addressable` sayar.
   */
  txProvenance?: TxHeaderProvenance;
}

/** `txHeader`ın türetildiği kural — adres UYDURULMADIĞININ kanıtıdır. */
export type TxHeaderProvenance =
  /** ISO 15765-4: rx(7E8) − 8 = tx(7E0). Standart aritmetik. */
  | 'can_11bit_standard'
  /** ISO 15765-4 genişletilmiş: 18DAF1<src> → 18DA<src>F1. */
  | 'can_29bit_standard'
  /** ISO 14230-4 (KWP2000): fmt 0x81 + hedef + tester F1. */
  | 'kwp_iso14230'
  /** ISO 9141-2: fmt 0x68 + hedef + tester F1. */
  | 'kwp_iso9141'
  /** Türetilemedi (protokol bilinmiyor) — istek GÖNDERİLMEZ. */
  | 'unknown';

/**
 * Ham prob yanıtını ECU envanterine çevirir (SAF).
 *
 * ELM327 yanıt biçimi ADAPTÖRE GÖRE DEĞİŞİR — ATS0 (boşluk kapalı) açıkken satırlar
 * BOŞLUKSUZ gelir ('7E8064100BE3FA813'), ATS1'de boşluklu ('7E8 06 41 00 …'). Bu modül
 * İKİSİNİ DE kabul eder. (Bu, sahada bir kez ısırdı: `_hexTokens` boşlukla bölüyordu,
 * boşluksuz yanıtta 0 token üretip supportedPids'i boşaltmıştı → veri akmamıştı.)
 */
export function parseEcuProbe(raw: string, protocol: string | null = null): DiscoveredEcu[] {
  if (!raw) return [];

  const seen = new Set<string>();
  const out: DiscoveredEcu[] = [];

  for (const line of raw.split(/[\r\n]+/)) {
    const compact = line.replace(/\s+/g, '').toUpperCase();
    if (!compact) continue;
    // Gürültü satırları: ELM durum mesajları, echo, prompt.
    if (/^(OK|SEARCHING|NODATA|STOPPED|UNABLETOCONNECT|BUSINIT|BUSERROR|CANERROR|\?|>)/.test(compact)) continue;
    if (!/^[0-9A-F]+$/.test(compact)) continue;

    const hit = matchEcuHeader(compact, protocol);
    if (!hit) continue;
    if (seen.has(hit.rxHeader)) continue;   // aynı ECU birden çok satırda (çok-frame) → tek kayıt
    seen.add(hit.rxHeader);
    out.push(hit);
  }

  return out;
}

/**
 * KWP/ISO 3 bayt header kalibi: fmt(2) + tgt(F1|6B) + src(2).
 * Modul seviyesinde SABIT: satir basina RegExp allocation yok (hot-path degil
 * ama ayni disiplin) ve kural TEK yerde yasar.
 */
const KWP_HEADER_RE = /^[0-9A-F]{2}(F1|6B)([0-9A-F]{2})/;

/**
 * P0-OBD-FINAL-01 — KWP2000 / ISO 9141-2 (K-line) YANIT HEADER'I.
 *
 * ── ÖLÇÜLEN SAHA GERÇEĞİ (2026-08-25, Protocol 5 / classic BT) ────────────
 * `probeEcusRaw` (ATH1 + 0100) ÇALIŞIYOR ve gerçek ECU cevapları geliyordu; ama
 * bu çözümleyici YALNIZ CAN header'ı tanıyordu (7E8..7EF, 18DAF1xx). Yavaş seri
 * hatta yanıt "48 6B 10 41 00 …" biçimindedir → hiçbir satır eşleşmiyor →
 * topoloji BOŞ → tek bir ECU bile taranmıyor. "Motor dışındaki ECU arızası
 * görünmüyor" ve "LAB keşif gözlemleri boş" sahada AYNI kökten geliyordu.
 *
 * ── FORMAT (ISO 14230-2 · ISO 9141-2) ─────────────────────────────────────
 * Header 3 BAYTTIR: fmt · tgt · src.
 *   · tgt = isteği yapan TESTER adresi — ELM327'de F1 (KWP2000) ya da 6B
 *     (ISO 9141-2 geleneği). Bu iki değer CAN header'larıyla ÇAKIŞMAZ
 *     (7E8… → 2. bayt E8 · 18DAF1… → 2. bayt DA), bu yüzden ayrım kesindir
 *     ve mevcut CAN yolu BİREBİR korunur.
 *   · src = yanıtı VEREN ECU'nun fiziksel adresi — envantere giren KANIT budur.
 *
 * ZERO-TRUST: src GÖZLENİR (ECU gerçekten cevap verdi), tx ise standarttan
 * TÜRETİLİR ve hangi kuraldan çıktığı `txProvenance` ile taşınır. Protokol
 * bilinmiyorsa tx TÜRETİLMEZ (boş + 'unknown') — yanlış adrese istek gitmez.
 */
function matchKwpHeader(compact: string, protocol: string | null): DiscoveredEcu | null {
  // 3 header baytı + en az 1 veri baytı olmadan bu bir header DEĞİLDİR.
  if (compact.length < 8) return null;
  const m = KWP_HEADER_RE.exec(compact);
  if (!m) return null;
  const src = m[2]!;
  // Tester adresinin kendisi bir ECU kaynağı olamaz (yankı/echo satırı).
  if (src === 'F1' || src === '6B') return null;

  const rxHeader = compact.slice(0, 6);
  const digit = (protocol ?? '').trim().toUpperCase().charAt(0);
  let txHeader = '';
  let txProvenance: TxHeaderProvenance = 'unknown';
  if (digit === '3') {
    txHeader = `68${src}F1`;        // ISO 9141-2 fiziksel istek
    txProvenance = 'kwp_iso9141';
  } else if (digit === '4' || digit === '5') {
    txHeader = `81${src}F1`;        // ISO 14230-4 (KWP2000) fiziksel istek
    txProvenance = 'kwp_iso14230';
  }

  const std = roleFromStandardAddress(rxHeader, 8);
  return {
    rxHeader,
    txHeader,
    addressBits: 8,
    role: std ?? 'unknown',
    roleEvidence: std === null ? 'none' : 'standard',
    label: std === null ? `ECU ${src} (KWP)` : 'Motor (ECM)',
    discoverySource: 'functional_0100',
    probeOutcome: 'responded',
    /* Fiziksel target HENÜZ kanıtlanmadı: fonksiyonel yanıt "bu ECU var" der,
       "bu adrese istek gidebiliyor" DEMEZ. Kanıt fiziksel okumadan gelir. */
    kwpTargetVerified: false,
    txProvenance,
  };
}

/** Bir yanıt satırının başındaki ECU header'ını tanır; tanınmazsa null (zero-trust). */
function matchEcuHeader(compact: string, protocol: string | null): DiscoveredEcu | null {
  // 29-bit genişletilmiş: 18DAF1<ecu> — F1 = teşhis cihazı (tester) adresi.
  // Yanıt ECU→tester olduğu için hedef F1'dir: 18 DA F1 <src>.
  const m29 = /^(18DAF1([0-9A-F]{2}))/.exec(compact);
  if (m29) {
    const rxHeader = m29[1]!;
    const ecu = m29[2]!;
    return {
      rxHeader,
      txHeader: `18DA${ecu}F1`,       // istek: tester(F1) → ECU
      addressBits: 29,
      role: 'unknown',                // 29-bit adreslerde standart rol garantisi YOK
      roleEvidence: 'none',
      label: `ECU ${ecu} (29-bit)`,
      discoverySource: 'functional_0100', probeOutcome: 'responded',
      txProvenance: 'can_29bit_standard',
    };
  }

  // 11-bit standart ISO 15765-4: yanıt 7E8..7EF ↔ istek 7E0..7E7 (rx = tx + 8).
  const m11 = /^(7E[8-9A-F])/.exec(compact);
  if (m11) {
    const rxHeader = m11[1]!;
    const rxNum = parseInt(rxHeader, 16);
    const txNum = rxNum - 8;                       // 7E8 → 7E0
    const txHeader = txNum.toString(16).toUpperCase();
    // SAE J1979: 7E0/7E8 = birincil motor kontrol (ECM) — STANDARTLA garanti.
    // 7E1+ araç-özeldir (çoğu araçta şanzıman ama garanti DEĞİL) → 'unknown'.
    /* Standart garanti TEK yerde karar verilir (`ecuRoleModel`) — burada
       yeniden yazılırsa iki kural ayrışır ve biri güncellenmeden kalır. */
    const std = roleFromStandardAddress(rxHeader, 11);
    const isEngine = std === 'engine';
    return {
      rxHeader,
      txHeader,
      addressBits: 11,
      role: isEngine ? 'engine' : 'unknown',
      roleEvidence: isEngine ? 'standard' : 'none',
      label: isEngine ? 'Motor (ECM)' : `ECU ${txHeader}`,
      discoverySource: 'functional_0100', probeOutcome: 'responded',
      txProvenance: 'can_11bit_standard',
    };
  }

  /* CAN taninmadi -> yavas seri (KWP/ISO 9141) header'i olabilir. SIRA ONEMLI:
     CAN kaliplari ONCE denenir, boylece mevcut CAN davranisi DEGISMEZ. */
  return matchKwpHeader(compact, protocol);
}

/**
 * Araç topolojisi — keşfin sonucu. `probedAt` null ise keşif HİÇ çalışmadı
 * ("ECU yok" ile "bakılmadı" ASLA karıştırılmaz — fail-closed).
 */
export interface VehicleTopology {
  ecus: DiscoveredEcu[];
  probedAt: number | null;
  /** Keşif çalıştı ama tek ECU bile yanıtlamadıysa true (adaptör/araç sorunu sinyali). */
  probeEmpty: boolean;
}

/** Keşif hiç çalışmamış topoloji (başlangıç durumu). */
export function emptyTopology(): VehicleTopology {
  return { ecus: [], probedAt: null, probeEmpty: false };
}

/** Ham yanıttan topoloji üretir. `nowMs` enjekte edilir (saf/test edilebilir). */
export function buildTopology(raw: string, nowMs: number, protocol: string | null = null): VehicleTopology {
  const ecus = parseEcuProbe(raw, protocol);
  return { ecus, probedAt: nowMs, probeEmpty: ecus.length === 0 };
}
