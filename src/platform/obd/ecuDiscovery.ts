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

/** ECU'nun teşhis rolü. Yalnız STANDARTLA garanti olan çıkarım yapılır. */
export type EcuRole = 'engine' | 'unknown';

export interface DiscoveredEcu {
  /** ECU'nun YANIT (rx) header'ı — ham kanıt: '7E8' (11-bit) veya '18DAF110' (29-bit). */
  rxHeader: string;
  /** Bu ECU'ya İSTEK gönderilecek (tx) adres: '7E0' / '18DA10F1'. */
  txHeader: string;
  /** 11 = standart CAN ID, 29 = genişletilmiş adresleme. */
  addressBits: 11 | 29;
  /** Rol — yalnız standartla garanti olanlar; gerisi 'unknown' (uydurma YOK). */
  role: EcuRole;
  /** Kullanıcıya gösterilecek TR etiket. */
  label: string;
}

/**
 * Ham prob yanıtını ECU envanterine çevirir (SAF).
 *
 * ELM327 yanıt biçimi ADAPTÖRE GÖRE DEĞİŞİR — ATS0 (boşluk kapalı) açıkken satırlar
 * BOŞLUKSUZ gelir ('7E8064100BE3FA813'), ATS1'de boşluklu ('7E8 06 41 00 …'). Bu modül
 * İKİSİNİ DE kabul eder. (Bu, sahada bir kez ısırdı: `_hexTokens` boşlukla bölüyordu,
 * boşluksuz yanıtta 0 token üretip supportedPids'i boşaltmıştı → veri akmamıştı.)
 */
export function parseEcuProbe(raw: string): DiscoveredEcu[] {
  if (!raw) return [];

  const seen = new Set<string>();
  const out: DiscoveredEcu[] = [];

  for (const line of raw.split(/[\r\n]+/)) {
    const compact = line.replace(/\s+/g, '').toUpperCase();
    if (!compact) continue;
    // Gürültü satırları: ELM durum mesajları, echo, prompt.
    if (/^(OK|SEARCHING|NODATA|STOPPED|UNABLETOCONNECT|BUSINIT|BUSERROR|CANERROR|\?|>)/.test(compact)) continue;
    if (!/^[0-9A-F]+$/.test(compact)) continue;

    const hit = matchEcuHeader(compact);
    if (!hit) continue;
    if (seen.has(hit.rxHeader)) continue;   // aynı ECU birden çok satırda (çok-frame) → tek kayıt
    seen.add(hit.rxHeader);
    out.push(hit);
  }

  return out;
}

/** Bir yanıt satırının başındaki ECU header'ını tanır; tanınmazsa null (zero-trust). */
function matchEcuHeader(compact: string): DiscoveredEcu | null {
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
      label: `ECU ${ecu} (29-bit)`,
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
    const isEngine = rxHeader === '7E8';
    return {
      rxHeader,
      txHeader,
      addressBits: 11,
      role: isEngine ? 'engine' : 'unknown',
      label: isEngine ? 'Motor (ECM)' : `ECU ${txHeader}`,
    };
  }

  return null;
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
export function buildTopology(raw: string, nowMs: number): VehicleTopology {
  const ecus = parseEcuProbe(raw);
  return { ecus, probedAt: nowMs, probeEmpty: ecus.length === 0 };
}
