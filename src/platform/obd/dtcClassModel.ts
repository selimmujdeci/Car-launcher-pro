/**
 * dtcClassModel — DTC SINIFI + KAYNAK (provenance) BİRLEŞTİRME (SAF KATMAN).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · global durum YOK · ağ YOK.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (saha kusuru · P0-OBD-09) ───────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Aynı araç + aynı adaptörle başka bir OBD uygulaması
 *   `P0089 — Fuel Pressure Regulator 1 Performance · BEKLİYOR (pending)`
 * gösterirken CarOS aynı DTC'yi göstermiyordu.
 *
 * Kök neden native çözümleyicideydi (bkz. `ElmProtocol.dtcPayloadAfterSid`), ama
 * teşhis ikinci bir yapısal eksiği de ortaya çıkardı: ürün **DTC SINIFINI ve
 * KAYNAĞINI TEK LİSTEDE TAŞIYAN bir modele sahip değildi.**
 *  · Fonksiyonel yol (`readAllDTCs`, 7DF) sınıfı taşıyordu ama **ECU'yu taşımıyordu**.
 *  · Çoklu-ECU yolu (`multiEcuScan`) ECU'yu taşıyordu ama sonuçları ana listeyle
 *    **birleştirilmiyordu**.
 *  · Aynı kod hem Mode 03'te hem Mode 07'de görünürse (ki normaldir) hangi
 *    listede gösterileceği **tesadüfe** kalıyordu.
 *
 * Bu modül o birleştirmeyi yapar ve **hiçbir bilgiyi kaybetmez**: aynı kod
 * birden fazla SINIFTA ve birden fazla ECU'da görülebilir; hepsi ayrı gözlem
 * olarak korunur.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *  · Sınıflar KARIŞTIRILMAZ: `PENDING` bir `CONFIRMED` değildir ve tersi de.
 *  · Kaynak KORUNUR: ECU anahtarı/rolü/adresi gözlemle birlikte taşınır.
 *  · **OTURUM MÜHRÜ:** başka bir OBD oturumuna (epoch) ait gözlem ELENİR —
 *    yeniden bağlanma veya araç değişimi eski kodları yeni oturuma TAŞIYAMAZ.
 *  · Bilinmeyen alan `null` KALIR — adresten rol, koddan sınıf UYDURULMAZ.
 */

/* ══════════════════════════════════════════════════════════════════════════
   1) SINIFLAR
   ══════════════════════════════════════════════════════════════════════════ */

/** Standart OBD-II DTC sınıfı. Üçü AYRI kavramdır, biri diğerine dönüşmez. */
export type DtcClass = 'PENDING' | 'CONFIRMED' | 'PERMANENT';

/** Sınıfı üreten SAE J1979 servisi. */
export type DtcService = '03' | '07' | '0A';

/** Kullanıcıya gösterilen Türkçe etiket — UI bunu ELLE yazmaz. */
export const DTC_CLASS_LABEL: Readonly<Record<DtcClass, string>> = {
  PENDING:   'BEKLEYEN',
  CONFIRMED: 'ONAYLANMIŞ',
  PERMANENT: 'KALICI',
} as const;

/** Sınıfın kısa açıklaması — "bekleyen" ile "onaylanmış" farkı gizlenmemeli. */
export const DTC_CLASS_HINT: Readonly<Record<DtcClass, string>> = {
  PENDING:   'Arıza bir kez görüldü, ECU henüz ONAYLAMADI (Mode 07).',
  CONFIRMED: 'ECU arızayı onayladı ve hafızaya yazdı (Mode 03).',
  PERMANENT: 'Kalıcı emisyon kodu — silinemez, ECU kendi temizler (Mode 0A).',
} as const;

/** Servis → sınıf. TEK eşleme yeri; kopya tablo YASAK. */
export const DTC_CLASS_OF_SERVICE: Readonly<Record<DtcService, DtcClass>> = {
  '03': 'CONFIRMED',
  '07': 'PENDING',
  '0A': 'PERMANENT',
} as const;

/** Sınıf → servis (ters eşleme; LAB kanıt ekranı bunu kullanır). */
export const DTC_SERVICE_OF_CLASS: Readonly<Record<DtcClass, DtcService>> = {
  CONFIRMED: '03',
  PENDING:   '07',
  PERMANENT: '0A',
} as const;

/**
 * Mevcut `dtcService.DTCStatus` ('stored'|'pending'|'permanent') → sınıf.
 * Eski sözleşme DEĞİŞMEDİ; burada yalnız kanonik sınıfa çevrilir.
 */
export const DTC_CLASS_OF_STATUS: Readonly<Record<'stored' | 'pending' | 'permanent', DtcClass>> = {
  stored:    'CONFIRMED',
  pending:   'PENDING',
  permanent: 'PERMANENT',
} as const;

/** `multiEcuScan.EcuDtc.mode` → sınıf (aynı kanonik eşleme). */
export const DTC_CLASS_OF_SCAN_MODE = DTC_CLASS_OF_STATUS;

/**
 * Gösterim önceliği — kod BİRDEN FAZLA sınıfta görülebilir (normaldir).
 * Bu sıra yalnız SIRALAMA/rozet-önceliği içindir; diğer sınıflar SİLİNMEZ.
 * Kalıcı en ağırdır (silinemez), sonra onaylanmış, en hafifi bekleyen.
 */
const _CLASS_WEIGHT: Readonly<Record<DtcClass, number>> = {
  PERMANENT: 3,
  CONFIRMED: 2,
  PENDING:   1,
};

/* ══════════════════════════════════════════════════════════════════════════
   2) GÖZLEM (tek okuma sonucu)
   ══════════════════════════════════════════════════════════════════════════ */

/** Kodun geldiği ECU'nun kimliği. Fonksiyonel adres (7DF) için hepsi `null`. */
export interface DtcEcuOrigin {
  /** Kararlı ECU anahtarı (araç bağlamı dâhil). Bilinmiyorsa `null`. */
  readonly ecuKey: string | null;
  /** Görünen etiket ("ECU 7E8"). Bilinmiyorsa `null`. */
  readonly ecuLabel: string | null;
  /** Fiziksel istek adresi ("7E0"). Bilinmiyorsa `null`. */
  readonly ecuTxHeader: string | null;
  /** Envanterden gelen ROL. Adresten UYDURULMAZ — bilinmiyorsa `null`. */
  readonly ecuRole: string | null;
}

/** Fonksiyonel adres (7DF) okuması — tek ECU'ya ait DEĞİLDİR. */
export const FUNCTIONAL_ORIGIN: DtcEcuOrigin = {
  ecuKey: null, ecuLabel: null, ecuTxHeader: null, ecuRole: null,
} as const;

export interface DtcObservation {
  /** Kod ("P0089"). */
  readonly code: string;
  /** Kodu ÜRETEN servis — sınıf bundan TÜRETİLİR, tersi değil. */
  readonly service: DtcService;
  readonly origin: DtcEcuOrigin;
  /** Gözlemin ait olduğu OBD oturumu. Farklı epoch = BAŞKA oturum. */
  readonly sessionEpoch: number;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) BİRLEŞTİRME
   ══════════════════════════════════════════════════════════════════════════ */

export interface DtcRecord {
  readonly code: string;
  /**
   * Kodun görüldüğü TÜM sınıflar (ağırdan hafife). Birden fazla olabilir:
   * aynı arıza hem onaylanmış hem bekleyen listede duruyor olabilir.
   */
  readonly classes: readonly DtcClass[];
  /** Rozet önceliği — `classes[0]` ile aynıdır, okunabilirlik için ayrı alan. */
  readonly primaryClass: DtcClass;
  /** TÜM gözlemler — hiçbiri atılmaz (sınıf × ECU çaprazı korunur). */
  readonly observations: readonly DtcObservation[];
  /** Kodun görüldüğü ECU etiketleri (tekil, sıra korunur). Boş = yalnız fonksiyonel. */
  readonly ecuLabels: readonly string[];
  /** Kod EN AZ BİR ECU'dan mı geldi (fonksiyonel değil)? */
  readonly hasEcuOrigin: boolean;
}

/** Kod metnini normalize eder (büyük harf, boşluksuz). Saf. */
export function normalizeDtcCode(code: unknown): string {
  return typeof code === 'string' ? code.trim().toUpperCase().replace(/\s+/g, '') : '';
}

/**
 * Gözlemleri koda göre birleştirir. **Bilgi kaybı YOKTUR.**
 *
 * @param observations ham gözlemler (fonksiyonel + çoklu-ECU karışık olabilir)
 * @param sessionEpoch ŞU ANKİ OBD oturumu. Farklı epoch taşıyan gözlem ELENİR —
 *   yeniden bağlanma / araç değişimi eski kodları yeni oturuma taşıyamaz.
 *   `null` verilirse eleme YAPILMAZ (epoch okunamadı — sahte filtre uygulamaktansa
 *   hiç uygulamamak dürüsttür; çağıran bu durumu kapsam olarak raporlar).
 */
export function mergeDtcObservations(
  observations: readonly DtcObservation[],
  sessionEpoch: number | null,
): DtcRecord[] {
  const byCode = new Map<string, DtcObservation[]>();

  for (const o of observations) {
    const code = normalizeDtcCode(o.code);
    if (code.length === 0) continue;                       // adsız kod KAYIT DEĞİLDİR
    /* OTURUM MÜHRÜ — bayat oturumun kodu yeni oturuma SIZAMAZ. */
    if (sessionEpoch !== null && o.sessionEpoch !== sessionEpoch) continue;
    const list = byCode.get(code);
    if (list) list.push({ ...o, code });
    else byCode.set(code, [{ ...o, code }]);
  }

  const out: DtcRecord[] = [];
  for (const [code, obs] of byCode) {
    const classes: DtcClass[] = [];
    const ecuLabels: string[] = [];
    for (const o of obs) {
      const cls = DTC_CLASS_OF_SERVICE[o.service];
      if (cls !== undefined && !classes.includes(cls)) classes.push(cls);
      const label = o.origin.ecuLabel;
      if (label !== null && label.length > 0 && !ecuLabels.includes(label)) ecuLabels.push(label);
    }
    classes.sort((a, b) => _CLASS_WEIGHT[b] - _CLASS_WEIGHT[a]);
    /* Sınıfsız gözlem olamaz (servis kümesi kapalı), ama savunmacı davranırız. */
    if (classes.length === 0) continue;
    out.push({
      code,
      classes,
      primaryClass: classes[0],
      observations: obs,
      ecuLabels,
      hasEcuOrigin: obs.some((o) => o.origin.ecuKey !== null || o.origin.ecuLabel !== null),
    });
  }

  /* Ağır sınıf önce; eşitlikte kod alfabetik (kararlı, tekrar edilebilir sıra). */
  out.sort((a, b) => {
    const w = _CLASS_WEIGHT[b.primaryClass] - _CLASS_WEIGHT[a.primaryClass];
    return w !== 0 ? w : a.code.localeCompare(b.code);
  });
  return out;
}

/** Belirli bir sınıftaki kayıtlar (sınıf ayrımı bozulmadan). Saf. */
export function recordsOfClass(records: readonly DtcRecord[], cls: DtcClass): DtcRecord[] {
  return records.filter((r) => r.classes.includes(cls));
}

/**
 * Kaynağın kullanıcıya gösterilecek kısa adı.
 * Bilinmiyorsa `null` — "ECU bilinmiyor" yazmak yerine alan GİZLENİR
 * (uydurma kaynak iddiası YASAK).
 */
export function describeOrigin(o: DtcEcuOrigin): string | null {
  if (o.ecuRole !== null && o.ecuRole.length > 0 && o.ecuRole !== 'unknown') {
    return o.ecuLabel !== null ? `${o.ecuRole} · ${o.ecuLabel}` : o.ecuRole;
  }
  if (o.ecuLabel !== null && o.ecuLabel.length > 0) return o.ecuLabel;
  return null;
}
