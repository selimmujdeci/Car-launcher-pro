/**
 * dtcClearModel — MODE 04 (DTC HAFIZASINI SİL) SONUÇ MODELİ (SAF KATMAN).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · global durum YOK · ağ YOK.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (saha kusuru · P0-OBD-10) ───────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Gerçek araçta P0089 **BEKLEYEN (Mode 07)** olarak doğru okunuyordu; kullanıcı
 * "HAFIZAYI TEMİZLE" dediğinde kod silinmiyordu. Zincir uçtan uca ölçüldü ve
 * ürünün "silindi" iddiası üç ayrı yerde KANITSIZ çıktı:
 *
 *  1. Komut hiç GİTMİYORDU. Silme önkoşulu YALNIZ Mode 03 (onaylanmış) listesine
 *     bakıyordu; bekleyen-yalnız araçta liste boş → düğme pasif + servis erken
 *     dönüş → ECU'ya tek bayt gitmiyordu.
 *  2. "Başarı" = "istisna fırlatmadı" idi. ECU'nun ne cevapladığı okunmuyordu.
 *  3. Silme sonrası YENİDEN OKUMA yoktu; UI listesi körlemesine boşaltılıyordu
 *     (`codes: []`) — yani ekran "temizlendi" gösterirken araçta kod duruyordu.
 *
 * Bu modül o üç boşluğun KARAR yüzünü kapatır: komut sonucu + silme öncesi/sonrası
 * ÖLÇÜM birleştirilerek TEK bir hüküm üretilir. Hüküm **ölçüme** dayanır, umuda değil.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *  · "Komut gönderildi" ASLA "kod silindi" DEĞİLDİR.
 *  · Sınıflar KARIŞMAZ: PENDING · CONFIRMED · PERMANENT ayrı değerlendirilir.
 *  · Mode 0A (KALICI) kodu Mode 04 ile silinemez — kalması BAŞARISIZLIK DEĞİLDİR
 *    ve asla "silinemedi" diye raporlanmaz (SAE J1979: ECU kendi temizler).
 *  · Kod silinip ANINDA geri gelmek ("aktif arıza") ile HİÇ silinememek AYRI
 *    hükümlerdir — ikisi tek kovaya atılırsa teşhis kaybolur.
 *  · Silme sonrası okuma DÜŞERSE hüküm "silindi" DEĞİL, **DOĞRULANAMADI**tır.
 */

import type { DtcScanCompleteness } from '../dtcService';

/* ══════════════════════════════════════════════════════════════════════════
   1) KOMUT SONUCU (ECU'nun Mode 04'e verdiği cevabın SINIFI)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Native `ElmProtocol.classifyClearResponse` ile **BİREBİR** aynı sözlük.
 * Yeni bir değer eklenirse İKİ tarafta da eklenir (kilit testi bunu zorlar).
 */
export type DtcClearCommandOutcome =
  /** En az bir ECU "44" pozitif yanıtı verdi. TEK BAŞINA "silindi" DEMEK DEĞİLDİR. */
  | 'POSITIVE'
  /** ECU açık negatif yanıt verdi (7F 04 <NRC>) — isteği REDDETTİ. */
  | 'NEGATIVE'
  /** ELM327 "NO DATA" döndü — ECU sustu. */
  | 'NO_DATA'
  /** Prompt gelmeden zaman aşımı / boş yanıt. */
  | 'NO_RESPONSE'
  /** Hat/protokol hatası (STOPPED · CAN ERROR · UNABLE TO CONNECT …). */
  | 'BUS_ERROR'
  /** ELM327 komutu anlamadı ("?"). */
  | 'UNSUPPORTED'
  /** Yanıt geldi ama hiçbir sınıfa girmedi — HÜKÜM VERİLMEZ. */
  | 'UNKNOWN'
  /** Native çağrı taşıma hatasıyla düştü (adaptör bağlı değil / bağlantı koptu). */
  | 'TRANSPORT_ERROR';

export const DTC_CLEAR_OUTCOME_LABEL: Readonly<Record<DtcClearCommandOutcome, string>> = {
  POSITIVE:        'ECU onay verdi (44)',
  NEGATIVE:        'ECU reddetti (7F 04)',
  NO_DATA:         'ECU yanıt vermedi (NO DATA)',
  NO_RESPONSE:     'zaman aşımı — yanıt yok',
  BUS_ERROR:       'hat/protokol hatası',
  UNSUPPORTED:     'adaptör komutu anlamadı (?)',
  UNKNOWN:         'yanıt tanınmadı — hüküm yok',
  TRANSPORT_ERROR: 'bağlantı hatası — komut gönderilemedi',
} as const;

/**
 * SAE J1979 / ISO 14229 negatif yanıt kodları — Mode 04 reddinde SIK görülenler.
 * Tablo dışı NRC UYDURULMAZ: `describeClearNrc` bilinmeyeni ham hex olarak döner.
 */
const CLEAR_NRC_LABEL: Readonly<Record<string, string>> = {
  '12': 'alt-fonksiyon desteklenmiyor',
  '13': 'istek uzunluğu hatalı',
  '21': 'ECU meşgul — sonra tekrar deneyin',
  '22': 'koşullar uygun değil (motor çalışıyor / kontak durumu)',
  '31': 'istek aralık dışı',
  '33': 'güvenlik erişimi reddedildi',
  '78': 'ECU işlemi sürdürüyor (yanıt bekleniyor)',
} as const;

/** Bilinmeyen NRC için ham hex döner — sahte açıklama ÜRETİLMEZ. */
export function describeClearNrc(nrc: string | null): string | null {
  if (nrc === null) return null;
  const key = nrc.trim().toUpperCase();
  if (key.length === 0) return null;
  return CLEAR_NRC_LABEL[key] ?? `bilinmeyen negatif yanıt kodu (0x${key})`;
}

/**
 * Mode 04 ham yanıtını sınıflandırır — **native ile aynı kurallar**.
 *
 * NEDEN TS'te DE VAR: eski native plugin `clearDtcCodes` metodunu taşımıyorsa
 * (geri-uyumluluk yolu) TS elindeki ham yanıtı yine de sınıflandırabilmelidir;
 * ayrıca sınıflandırma kuralları burada test edilebilir hâle gelir. Bu bir
 * İKİNCİ OTORİTE DEĞİLDİR: native yanıt taşıyorsa **native sınıfı kullanılır**,
 * bu fonksiyon yalnız ham metin elde varken çağrılır.
 *
 * SIRA ÖNEMLİDİR: metin hataları hex yorumundan ÖNCE elenir — "NO DATA"
 * içindeki D ve A harfleri aksi hâlde hex sanılırdı.
 */
export function classifyClearResponse(raw: string | null | undefined): {
  outcome: DtcClearCommandOutcome;
  nrc: string | null;
} {
  if (raw === null || raw === undefined) return { outcome: 'NO_RESPONSE', nrc: null };
  const compact = raw.replace(/\s+/g, '').toUpperCase();
  if (compact.length === 0) return { outcome: 'NO_RESPONSE', nrc: null };

  if (compact === '?') return { outcome: 'UNSUPPORTED', nrc: null };
  if (compact.includes('NODATA')) return { outcome: 'NO_DATA', nrc: null };
  if (
    compact.includes('UNABLETOCONNECT') || compact.includes('CANERROR') ||
    compact.includes('BUSERROR')        || compact.includes('BUSINIT:ERROR') ||
    compact.includes('STOPPED')         || compact.includes('BUFFERFULL') ||
    compact.includes('DATAERROR')       || compact.includes('RXERROR') ||
    compact.includes('ERROR')
  ) return { outcome: 'BUS_ERROR', nrc: null };

  const bodies = splitClearBodies(raw);

  // (4) Açık negatif yanıt — 7F 04 <NRC>, ÇİFT hizada aranır.
  for (const body of bodies) {
    for (let i = 0; i + 6 <= body.length; i += 2) {
      if (body.startsWith('7F04', i)) return { outcome: 'NEGATIVE', nrc: body.slice(i + 4, i + 6) };
    }
  }

  // (5) Pozitif yanıt — SID 0x44, ÇİFT hizada. `includes` KULLANILMAZ: hizasız
  //     eşleşme sahte başarı üretir (bu turun kök nedeni; ör. "7F 04 44" → NRC 0x44).
  for (const body of bodies) {
    for (let i = 0; i + 2 <= body.length; i += 2) {
      if (body.startsWith('44', i)) return { outcome: 'POSITIVE', nrc: null };
    }
  }

  return { outcome: 'UNKNOWN', nrc: null };
}

/**
 * Ham ELM327 yanıtını hizalanmış hex gövdelere ayırır — native
 * `splitResponseBodies` + `alignBody` ile AYNI kurallar (ISO-TP segment
 * önekleri birleştirilir; ATH1'in 3 haneli CAN kimliği hizayı bozmasın diye
 * tek uzunluklu gövdenin ilk 3 hanesi atılır).
 */
function splitClearBodies(raw: string): string[] {
  const bodies: string[] = [];
  let segmented = '';
  for (const line of raw.toUpperCase().split('\n')) {
    const t = line.trim();
    if (t.length === 0) continue;
    if (/^[0-9A-F]{1,2}:/.test(t)) {
      segmented += t.slice(t.indexOf(':') + 1).replace(/[^0-9A-F]/g, '');
    } else {
      const hex = t.replace(/[^0-9A-F]/g, '');
      if (hex.length > 0) bodies.push(hex);
    }
  }
  if (segmented.length > 0) bodies.push(segmented);
  return bodies.map((h) => (h.length % 2 === 1 && h.length >= 3 ? h.slice(3) : h));
}

/* ══════════════════════════════════════════════════════════════════════════
   2) HÜKÜM (komut sonucu + silme öncesi/sonrası ÖLÇÜM)
   ══════════════════════════════════════════════════════════════════════════ */

export type DtcClearVerdict =
  /** ECU onayladı VE hedeflenen kodların tamamı yeniden okumada YOK. */
  | 'CLEARED'
  /** ECU onayladı, kodlar silindi ama en az biri ANINDA geri geldi (aktif arıza). */
  | 'CLEARED_BUT_RETURNED'
  /** ECU onayladı, silinebilir kodlar gitti; yalnız KALICI (Mode 0A) kod duruyor. */
  | 'CLEARED_PERMANENT_REMAINS'
  /**
   * ECU onayladı ama HİÇBİR kod gitmedi — ve bu iki farklı gerçeğin ORTAK
   * gözlemidir: (a) silme fiilen olmadı, (b) silme oldu ama arıza aktif olduğu
   * için ECU kodu ANINDA yeniden yazdı. Tek bir yeniden okumayla bu ikisi
   * AYIRT EDİLEMEZ; bu yüzden ürün taraf TUTMAZ ve ikisini tek kovaya ATMAZ.
   */
  | 'INDETERMINATE_CODES_REMAIN'
  /** ECU reddetti / sustu / hat düştü — komut BAŞARISIZ. */
  | 'COMMAND_FAILED'
  /** Komut olumlu ama silme sonrası okuma DÜŞTÜ → "silindi" DENEMEZ. */
  | 'UNVERIFIED'
  /** Yazma kapısı reddetti — ECU'ya tek bayt GİTMEDİ. */
  | 'DENIED';

export const DTC_CLEAR_VERDICT_LABEL: Readonly<Record<DtcClearVerdict, string>> = {
  CLEARED:                    'SİLİNDİ',
  CLEARED_BUT_RETURNED:       'SİLİNDİ — KOD GERİ GELDİ',
  CLEARED_PERMANENT_REMAINS:  'SİLİNDİ — KALICI KOD DURUYOR',
  INDETERMINATE_CODES_REMAIN: 'KOD DURUYOR — AYIRT EDİLEMEDİ',
  COMMAND_FAILED:             'KOMUT BAŞARISIZ',
  UNVERIFIED:                 'DOĞRULANAMADI',
  DENIED:                     'GÜVENLİK KAPISI REDDETTİ',
} as const;

/** Kullanıcıya söylenecek dürüst cümle — UI ve sesli asistan AYNI metni kullanır. */
export const DTC_CLEAR_VERDICT_MESSAGE: Readonly<Record<DtcClearVerdict, string>> = {
  CLEARED:                    'Arıza hafızası silindi ve yeniden okumada kod görünmüyor.',
  CLEARED_BUT_RETURNED:       'Arıza hafızası silindi ama kod hemen geri geldi — arıza hâlâ aktif.',
  CLEARED_PERMANENT_REMAINS:  'Silinebilir kodlar silindi. Kalıcı emisyon kodu (Mode 0A) duruyor — bu kod komutla silinmez, ECU koşullar sağlanınca kendi temizler.',
  INDETERMINATE_CODES_REMAIN: 'ECU silme komutunu kabul etti ama kodlar yeniden okumada hâlâ duruyor. Bu iki anlama gelebilir: silme fiilen olmadı VEYA arıza hâlâ aktif olduğu için ECU kodu anında yeniden yazdı. Tek okumayla ayırt edilemez — arızayı gidermeden tekrar deneyin.',
  COMMAND_FAILED:             'Silme komutu araç tarafından kabul edilmedi.',
  UNVERIFIED:                 'Silme komutuna onay geldi ama doğrulama okuması yapılamadı — silindiği DOĞRULANAMADI.',
  DENIED:                     'Güvenlik kapısı silme işlemine izin vermedi — ECU’ya komut gönderilmedi.',
} as const;

/** Hüküm kullanıcıya "temizlendi" denmesine izin veriyor mu? */
export function isClearSuccessVerdict(v: DtcClearVerdict): boolean {
  return v === 'CLEARED' || v === 'CLEARED_PERMANENT_REMAINS';
}

/** Hüküm hesabının girdisi — hepsi ÖLÇÜM, hiçbiri iddia değil. */
export interface ClearVerdictInput {
  /** Mode 04 komutunun ECU cevabı. */
  readonly outcome: DtcClearCommandOutcome;
  /** Silme ÖNCESİ okunmuş kodlar (sınıflarıyla). */
  readonly before: readonly ClearObservedCode[];
  /** Silme SONRASI yeniden okunmuş kodlar; `null` = yeniden okuma YAPILAMADI. */
  readonly after: readonly ClearObservedCode[] | null;
  /** Yeniden okumanın mod-bazlı kapsamı; `null` = ölçülmedi. */
  readonly afterCompleteness: DtcScanCompleteness | null;
}

export interface ClearObservedCode {
  readonly code: string;
  readonly status: 'stored' | 'pending' | 'permanent';
}

export interface ClearVerdictResult {
  readonly verdict: DtcClearVerdict;
  /** Silme öncesi görülüp sonrasında GÖRÜLMEYEN kodlar (gerçekten gidenler). */
  readonly removed: readonly string[];
  /** Silme öncesi VE sonrasında görülen SİLİNEBİLİR kodlar (gitmeyenler). */
  readonly remaining: readonly string[];
  /** Silme sonrası ORTAYA ÇIKAN kodlar (silinip anında geri gelen aktif arıza). */
  readonly returned: readonly string[];
  /** Yeniden okumada duran KALICI (Mode 0A) kodlar — başarısızlık DEĞİL. */
  readonly permanentRemaining: readonly string[];
}

/** Mode 04 ile silinebilen sınıflar. KALICI (0A) bilinçli olarak DIŞARIDADIR. */
function isClearable(c: ClearObservedCode): boolean {
  return c.status === 'stored' || c.status === 'pending';
}

/** Yeniden okuma güvenilir mi — düşen bir mod varsa hüküm DOĞRULANAMADI olur. */
function afterScanIsTrustworthy(c: DtcScanCompleteness | null): boolean {
  if (c === null) return false;
  // 'unsupported' KABUL EDİLİR (araç o servisi hiç bilmiyor — kanıt eksikliği değil,
  // ölçülmüş bir gerçek). 'failed' kapsamı bozar. P0-OBD-CORE-05: 'deferred' de
  // AYNI ŞEKİLDE güvensizdir — admisyon kapısı sorguyu HİÇ göndermedi, yani bu
  // "okundu ama düştü" değil "hiç sorulmadı"dır; ikisi de "silindi" hükmüne
  // temel OLAMAZ (yeniden okuma fiilen YAPILMADI).
  const untrustworthy = (v: DtcScanCompleteness['stored']): boolean => v === 'failed' || v === 'deferred';
  return !untrustworthy(c.stored) && !untrustworthy(c.pending) && !untrustworthy(c.permanent);
}

/**
 * SİLME HÜKMÜ — saf. "Komut gönderildi" ile "kod silindi" arasındaki farkı
 * BURADA kurar ve tek bir yerden yönetir (UI, sesli asistan ve uzak komut
 * yolu AYNI hükmü tüketir; kopya karar mantığı YASAK).
 */
export function evaluateClearVerdict(input: ClearVerdictInput): ClearVerdictResult {
  const beforeClearable = input.before.filter(isClearable);
  const empty: ClearVerdictResult = {
    verdict: 'COMMAND_FAILED', removed: [], remaining: [], returned: [], permanentRemaining: [],
  };

  /* Komut ECU tarafından kabul edilmediyse yeniden okumaya BAKILMAZ:
     kodların durması zaten beklenendir ve "silinemedi" hükmünü zenginleştirmez. */
  if (input.outcome !== 'POSITIVE') return empty;

  /* Komut olumlu ama doğrulama okuması yok/bozuk → "silindi" DENMEZ. */
  if (input.after === null || !afterScanIsTrustworthy(input.afterCompleteness)) {
    return { ...empty, verdict: 'UNVERIFIED' };
  }

  /* KARŞILAŞTIRMA ANAHTARI = KOD + SINIF, yalnız kod DEĞİL.
     NEDEN: "P0089 ONAYLANMIŞ gitti, P0089 BEKLEYEN olarak geri geldi" ölçülebilir
     bir DEĞİŞİMDİR ve yalnız Mode 04 üretir (ECU hafızayı sildi, arıza bir kez
     yeniden görüldü). Salt kod karşılaştırması bu değişimi GÖREMEZ ve olayı
     "hiç silinmedi" sanır — sınıfları karıştırmanın tam olarak yasak olduğu yer. */
  const keyOf = (c: ClearObservedCode): string => `${c.code}|${c.status}`;
  const afterClearable = input.after.filter(isClearable);
  const afterKeys  = new Set(afterClearable.map(keyOf));
  const beforeKeys = new Set(beforeClearable.map(keyOf));

  const removed:   string[] = [];
  const remaining: string[] = [];
  for (const c of beforeClearable) {
    if (afterKeys.has(keyOf(c))) remaining.push(c.code); else removed.push(c.code);
  }
  const returned = afterClearable.filter((c) => !beforeKeys.has(keyOf(c))).map((c) => c.code);
  const beforeSet = beforeKeys;
  const permanentRemaining = input.after.filter((c) => c.status === 'permanent').map((c) => c.code);

  const base = { removed, remaining, returned, permanentRemaining } as const;

  /* Silinebilir hiçbir kod GİTMEDİYSE (ve gidecek kod VARDIYSA) ürün taraf TUTMAZ:
     "hiç silinmedi" ile "silindi ve arıza aktif olduğu için anında geri yazıldı"
     TEK bir yeniden okumayla AYIRT EDİLEMEZ. ECU'nun "44" demiş olması ölçümü
     EZMEZ (silindi denemez), ölçüm de ECU'yu yalanlamaz (silinemedi denemez). */
  if (beforeSet.size > 0 && removed.length === 0) {
    return { ...base, verdict: 'INDETERMINATE_CODES_REMAIN' };
  }

  /* Kod silindi ama aynı/başka bir kod ANINDA geri geldi → arıza AKTİF.
     Bu "silinemedi" DEĞİLDİR ve öyle raporlanmaz (teşhis tamamen farklıdır). */
  if (remaining.length > 0 || returned.length > 0) {
    return { ...base, verdict: 'CLEARED_BUT_RETURNED' };
  }

  /* Kalıcı (Mode 0A) kod duruyorsa bu BAŞARISIZLIK DEĞİLDİR — ama "her şey
     temiz" de denmez; kullanıcı kalıcı kodun neden durduğunu bilmelidir. */
  if (permanentRemaining.length > 0) {
    return { ...base, verdict: 'CLEARED_PERMANENT_REMAINS' };
  }

  return { ...base, verdict: 'CLEARED' };
}
