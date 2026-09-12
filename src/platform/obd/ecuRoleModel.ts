/**
 * ecuRoleModel — P0-OBD-08 · ECU KİMLİĞİ VE ROLÜNÜN SAF MODELİ.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React importu YOK.
 *
 * ── SÖZLEŞME: ROL KANITTAN ÇIKAR, ADRESTEN DEĞİL ──────────────────────────
 * Bugüne kadar rol yalnız iki değer alabiliyordu (`engine` | `unknown`) ve tek
 * kanıt 7E8 adresiydi. Adres, standartta YALNIZ 7E0/7E8 için rol garantisi
 * verir; 7E1+ "çoğu araçta şanzıman" olsa bile **garanti değildir** ve oradan
 * rol üretmek yanlış teşhise yol açar.
 *
 * Bu model rolü ÜÇ KANIT SINIFINDAN çıkarır ve hangisinden çıktığını KAYBETMEZ:
 *   1. `declared`  — ECU'nun KENDİ beyanı (ISO 14229 DID 0xF197
 *                    "SystemNameOrEngineType" metni). En güçlü kanıt.
 *   2. `standard`  — SAE J1979 / ISO 15765-4 ile GARANTİ adres (7E0/7E8 = ECM).
 *   3. `profile`   — üretici-özel eşleme (AYRI veri katmanı; çekirdeğe gömülmez).
 * Hiçbiri yoksa rol `unknown` KALIR. Boş bilgi, yanlış bilgiden iyidir.
 *
 * ── TÜRKÇE YEREL AYAR TUZAĞI (kütük: fail-open eşleşme) ───────────────────
 * `toUpperCase()` tr-TR yerelinde `i → İ` üretir; "abs" araması `ABS` ile
 * EŞLEŞMEZ ve kapı sessizce açık kalır. Bu modül yerelden BAĞIMSIZ bir ASCII
 * katlama kullanır (`_fold`) — `toUpperCase()` metin eşleşmesinde ASLA
 * kullanılmaz.
 */

/**
 * ECU ADRESLEME KİPİ — kanıt anahtarının parçasıdır.
 *
 *  · `11` — ISO 15765-4 standart CAN kimliği (`7E8`).
 *  · `29` — genişletilmiş CAN adresleme (`18DAF110`).
 *  · `8`  — KWP2000 / ISO 9141-2 K-line FİZİKSEL adresi (tek bayt, ör. `10`).
 *           P0-OBD-FINAL-01: bu kip eksikti; yavaş seri protokolde (ATSP 3/4/5)
 *           yanıt veren ECU'lar HİÇBİR envantere giremiyordu — "araç tek ECU'lu"
 *           yanılsaması ve boş keşif gözlemi tam olarak buradan geliyordu.
 *
 * Kipler ASLA birbirinin yerine geçmez: aynı fiziksel birim olsa bile `7E8`
 * (11-bit) ile `486B10` (8-bit) AYNI KANIT DEĞİLDİR.
 */
export type EcuAddressBits = 8 | 11 | 29;

/**
 * ECU'nun araç sistemi rolü.
 *
 * Liste bilinçli olarak KISA: yalnız kanıtla ayırt edebildiğimiz sistemler.
 * Ayırt edemediğimiz her şey `unknown`dır.
 */
export type EcuRole =
  | 'engine'        // motor kontrol (ECM/PCM)
  | 'transmission'  // şanzıman (TCM)
  | 'abs_esp'       // ABS / ESP / fren kontrol
  | 'airbag_srs'    // hava yastığı / SRS
  | 'body_bcm'      // gövde kontrol modülü
  | 'eps'           // elektrikli direksiyon
  | 'hvac'          // klima / iklimlendirme
  | 'tpms'          // lastik basıncı izleme
  | 'gateway'       // ağ geçidi
  | 'instrument'    // gösterge paneli
  | 'unknown';

export const ECU_ROLE_LABEL: Readonly<Record<EcuRole, string>> = {
  engine:       'Motor (ECM/PCM)',
  transmission: 'Şanzıman (TCM)',
  abs_esp:      'ABS / ESP',
  airbag_srs:   'Hava yastığı (SRS)',
  body_bcm:     'Gövde kontrol (BCM)',
  eps:          'Elektrikli direksiyon (EPS)',
  hvac:         'Klima (HVAC)',
  tpms:         'Lastik basıncı (TPMS)',
  gateway:      'Ağ geçidi',
  instrument:   'Gösterge paneli',
  unknown:      'Bilinmiyor',
};

/** Rolün HANGİ kanıttan çıktığı — hüküm kadar önemlidir, asla kaybolmaz. */
export type EcuRoleEvidence =
  /** ECU kendi sistem adını bildirdi (ISO 14229 DID 0xF197). */
  | 'declared'
  /** SAE J1979 / ISO 15765-4 ile garanti adres (yalnız 7E0/7E8). */
  | 'standard'
  /** Üretici profili eşlemesi (ayrı veri katmanı). */
  | 'profile'
  /** Kanıt yok — rol `unknown`. */
  | 'none';

export const ECU_EVIDENCE_LABEL: Readonly<Record<EcuRoleEvidence, string>> = {
  declared: 'ECU kendi bildirdi (DID F197)',
  standard: 'Standart adres garantisi (SAE J1979)',
  profile:  'Üretici profili eşlemesi',
  none:     'Kanıt yok',
};

/* ── Yerelden bağımsız metin katlama ──────────────────────────────────────── */

/**
 * ASCII katlama — yerel ayardan BAĞIMSIZ büyük harfe çevirir ve Türkçe
 * karakterleri ASCII karşılığına indirger.
 *
 * `toUpperCase()` KULLANILMAZ: tr-TR yerelinde `i → İ` üretir ve `ABS` gibi bir
 * anahtarla eşleşme sessizce BAŞARISIZ olur (kütükte kayıtlı fail-open deseni).
 */
export function foldAscii(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c >= 0x61 && c <= 0x7A) { out += String.fromCharCode(c - 32); continue; } // a-z → A-Z
    switch (ch) {
      case 'ı': case 'İ': case 'i': out += 'I'; break;
      case 'ş': case 'Ş': out += 'S'; break;
      case 'ğ': case 'Ğ': out += 'G'; break;
      case 'ü': case 'Ü': out += 'U'; break;
      case 'ö': case 'Ö': out += 'O'; break;
      case 'ç': case 'Ç': out += 'C'; break;
      default: out += ch;
    }
  }
  return out;
}

/* ── Beyan edilen sistem adı → rol ────────────────────────────────────────── */

/**
 * Anahtar kelime tablosu. Yalnız ENDÜSTRİDE YERLEŞİK, tek anlama gelen
 * kısaltmalar; belirsiz olanlar (ör. "CTRL", "MODULE", "UNIT") KASITLA YOK —
 * onlar her ECU'da geçer ve yanlış eşleşme üretirdi.
 *
 * Sıra ÖNEMLİ: daha SPESİFİK olan önce denenir. "TCM" ile "ECM" ayrı; "ABS"
 * "SRS"ten önce gelmemeli diye bir kısıt yoktur çünkü kesişmezler — ama
 * "ENGINE" ve "TRANSMISSION" gibi uzun sözcükler kısaltmalardan ÖNCE gelir ki
 * "ENGINE MANAGEMENT" içindeki "EMS" gibi rastlantısal alt dizeler kazanmasın.
 */
const NAME_RULES: ReadonlyArray<{ readonly role: EcuRole; readonly keys: readonly string[] }> = [
  { role: 'transmission', keys: ['TRANSMISSION', 'GEARBOX', 'SANZIMAN', 'TCM', 'TCU', 'AT-ECU'] },
  { role: 'airbag_srs',   keys: ['AIRBAG', 'RESTRAINT', 'SRS', 'ACU'] },
  { role: 'abs_esp',      keys: ['ABS', 'ESP', 'ESC', 'BRAKE', 'FREN', 'EBCM', 'DSC'] },
  { role: 'eps',          keys: ['STEERING', 'DIREKSIYON', 'EPS', 'EPAS', 'PSCM'] },
  { role: 'hvac',         keys: ['HVAC', 'CLIMATE', 'KLIMA', 'AIRCON', 'A/C CONTROL'] },
  { role: 'tpms',         keys: ['TPMS', 'TIRE PRESSURE', 'TYRE PRESSURE', 'LASTIK BASINC'] },
  { role: 'gateway',      keys: ['GATEWAY', 'CGW'] },
  { role: 'instrument',   keys: ['INSTRUMENT', 'CLUSTER', 'GOSTERGE', 'IPC', 'KOMBI'] },
  { role: 'body_bcm',     keys: ['BODY CONTROL', 'BODY-CONTROL', 'BCM', 'BODYCONTROL'] },
  { role: 'engine',       keys: ['ENGINE', 'MOTOR CONTROL', 'POWERTRAIN', 'ECM', 'PCM', 'EMS', 'DDE', 'MED', 'EDC'] },
];

/**
 * ECU'nun BEYAN ETTİĞİ sistem adından rol çıkarır.
 *
 * `null` = ad tanınmadı. Tanınmayan ad UYDURULMAZ: metin yine de saklanır ve
 * ekranda ham gösterilir; rol `unknown` kalır.
 */
export function roleFromDeclaredName(name: string | null | undefined): EcuRole | null {
  if (typeof name !== 'string') return null;
  const f = foldAscii(name).replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (f.length < 2) return null;
  for (const rule of NAME_RULES) {
    for (const k of rule.keys) {
      if (f.includes(k)) return rule.role;
    }
  }
  return null;
}

/* ── Standart adres garantisi ─────────────────────────────────────────────── */

/**
 * Adresten çıkarılabilecek TEK garantili rol.
 *
 * SAE J1979 / ISO 15765-4: fonksiyonel 7DF isteğine 7E8 ile yanıt veren birim
 * BİRİNCİL motor kontrol ünitesidir. Başka HİÇBİR adres için standart bir rol
 * garantisi YOKTUR — 7E1'in şanzıman olması yaygın bir GELENEKTİR, kural değil.
 *
 * 29-bit adreslemede (18DAF1xx) standart bir rol ataması YOKTUR; hedef baytı
 * üretici tarafından serbestçe atanır.
 */
export function roleFromStandardAddress(
  rxHeader: string, addressBits: EcuAddressBits,
): EcuRole | null {
  /* P0-OBD-FINAL-01 — KWP/ISO 8-bit fiziksel adresleme.
     ISO 15031-5 (ve ISO 9141-2 / ISO 14230-4 OBD katmanı) fiziksel adres
     0x10'u emisyonla ilgili BİRİNCİL ECU'ya (ECU #1) ayırır — 11-bit'teki
     `7E8` garantisiyle AYNI sınıftan bir standart hükümdür, tahmin DEĞİLDİR.
     Başka HİÇBİR KWP adresi için standart rol garantisi YOKTUR (0x18, 0x28,
     0x38… üretici serbestindedir) → `unknown` kalır. */
  if (addressBits === 8) {
    return kwpSourceAddress(rxHeader) === '10' ? 'engine' : null;
  }
  if (addressBits !== 11) return null;
  return foldAscii(rxHeader) === '7E8' ? 'engine' : null;
}

/**
 * KWP/ISO 3 baytlık yanıt header'ından (fmt·tgt·src) KAYNAK ECU adresini alır.
 * 6 hex hane değilse `null` — uydurma yapılmaz.
 */
export function kwpSourceAddress(rxHeader: string): string | null {
  const h = foldAscii(rxHeader);
  return /^[0-9A-F]{6}$/.test(h) ? h.slice(4, 6) : null;
}

/* ── Kararlı kimlik ───────────────────────────────────────────────────────── */

export interface EcuIdentityInput {
  readonly rxHeader: string;
  readonly txHeader: string;
  readonly addressBits: EcuAddressBits;
  /** Aktif protokol damgası (ör. ELM `ATDPN` hanesi) — bilinmiyorsa `null`. */
  readonly protocol: string | null;
  /** Araç bağlamı (VIN karması) — bilinmiyorsa `null`. */
  readonly vehicleKey: string | null;
}

/**
 * ADRES anahtarı — aynı ECU yeniden bulunduğunda AYNI, farklı adresleme
 * kipinde FARKLI olur.
 *
 * `addressBits` anahtara GİRER: `7E8` (11-bit) ile `18DAF108` (29-bit) aynı
 * fiziksel birim olabilir ama bizim için AYNI KANIT DEĞİLDİR — biri diğerinin
 * yerine geçemez ve karıştırılırsa iki farklı araçtan gelen sonuçlar tek kayda
 * düşer.
 */
export function ecuAddressKey(i: Pick<EcuIdentityInput, 'rxHeader' | 'addressBits'>): string {
  return `${i.addressBits}:${foldAscii(i.rxHeader)}`;
}

/**
 * KİMLİK anahtarı — adres anahtarı + araç bağlamı (+ protokol).
 *
 * NEDEN ARAÇ BAĞLAMI: aynı `7E8` adresi HER araçta vardır. Araç bağlamı
 * olmadan iki farklı aracın motor ECU'su tek kimlik sanılır ve bir aracın
 * öğrenilmiş rolü diğerine taşınır. Bağlam bilinmiyorsa `?` yazılır — bu
 * "bilinmiyor"un AÇIK işaretidir, sessizce boş bırakılmaz.
 */
export function ecuIdentityKey(i: EcuIdentityInput): string {
  const veh = i.vehicleKey === null || i.vehicleKey === '' ? '?' : foldAscii(i.vehicleKey);
  const proto = i.protocol === null || i.protocol === '' ? '?' : foldAscii(i.protocol);
  return `${veh}|${proto}|${ecuAddressKey(i)}`;
}

/* ── Rol çıkarımı (tek karar noktası) ─────────────────────────────────────── */

export interface RoleDerivationInput {
  readonly rxHeader: string;
  readonly addressBits: EcuAddressBits;
  /** ECU'nun beyan ettiği sistem adı (DID F197 metni); yoksa `null`. */
  readonly declaredName: string | null;
  /**
   * Üretici profilinden gelen rol; yoksa `null`. Profil AYRI katmandır ve
   * çağıran onu oradan getirir — bu saf fonksiyon profil TABLOSU BİLMEZ.
   */
  readonly profileRole: EcuRole | null;
}

export interface RoleDerivation {
  readonly role: EcuRole;
  readonly evidence: EcuRoleEvidence;
  /** İnsan okunur gerekçe — "bu rol nereden çıktı" sorusu ekranda cevaplanır. */
  readonly reason: string;
}

/**
 * Rolün TEK karar noktası. Kanıt sırası bilinçlidir ve GEVŞETİLEMEZ:
 *   beyan > standart adres > üretici profili > bilinmiyor
 *
 * Beyan en üsttedir çünkü ECU'nun kendi söylediği, bizim adresten tahmin
 * ettiğimizden her zaman daha güvenilirdir — 7E8'de oturan bir birim kendini
 * "TCM" diye tanıtıyorsa o bir şanzımandır ve standart varsayımı YANILIR.
 */
export function deriveEcuRole(i: RoleDerivationInput): RoleDerivation {
  const declared = roleFromDeclaredName(i.declaredName);
  if (declared !== null) {
    return {
      role: declared, evidence: 'declared',
      reason: `ECU kendini "${(i.declaredName ?? '').trim()}" olarak tanıttı (DID F197).`,
    };
  }

  const std = roleFromStandardAddress(i.rxHeader, i.addressBits);
  if (std !== null) {
    return {
      role: std, evidence: 'standard',
      reason: `SAE J1979: ${i.rxHeader} adresi birincil motor kontrol ünitesidir.`,
    };
  }

  if (i.profileRole !== null && i.profileRole !== 'unknown') {
    return {
      role: i.profileRole, evidence: 'profile',
      reason: `Üretici profili ${i.rxHeader} adresini bu role eşliyor. `
        + `Bu bir STANDART GARANTİSİ DEĞİL, doğrulanmış bir gözlemdir.`,
    };
  }

  return {
    role: 'unknown', evidence: 'none',
    reason: i.declaredName !== null && i.declaredName.trim().length > 0
      ? `ECU "${i.declaredName.trim()}" adını bildirdi ama bu ad tanınan bir sisteme `
        + `eşlenemedi — rol UYDURULMADI.`
      : `${i.rxHeader} adresi için standart bir rol garantisi yok ve ECU sistem adını `
        + `bildirmedi. Adresten rol tahmin etmek yanlış teşhise yol açar.`,
  };
}
