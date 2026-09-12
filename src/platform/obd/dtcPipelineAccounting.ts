/**
 * dtcPipelineAccounting — P0-OBD-PARITY · RAW → PARSER → AUTHORITY → UI SAYIM ZİNCİRİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (ölçülen kusur) ─────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Ürün üretici DTC'lerini ÜÇ ayrı katmanda kaybediyordu (parser stride ·
 * ürün dedup · UI filtresi) ve **hiçbiri görünmüyordu**: her katman kendi
 * içinde "başarılı" raporluyordu çünkü kimse iki katmanın SAYISINI
 * karşılaştırmıyordu. ECU 20 kayıt gönderirken ekranda 0 satır varken bile
 * her ara katman `outcome: ok` diyordu.
 *
 * Bu modül o sessizliği kapatır: aynı (ECU × servis) okuması için DÖRT ayrı
 * ölçüm tutulur ve aralarındaki fark KAYIP olarak adlandırılır.
 *
 *   RAW       — ECU'nun gönderdiği kayıt sayısı; zarf GEOMETRİSİNDEN ölçülür
 *               (`countUdsDtcRecords` / `countKwpDtcRecords`), parser'dan BAĞIMSIZ.
 *   PARSED    — çözücünün ürettiği kayıt sayısı.
 *   AUTHORITY — kanonik otoriteye (`dtcAuthority`) YAZILAN gözlem sayısı.
 *   UI        — ürün listesine (ekrana) ULAŞAN satır sayısı.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU MODÜL NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) İKİNCİ DTC OTORİTESİ DEĞİLDİR. Kod listesi TUTMAZ, hüküm ÜRETMEZ,
 *     "temiz/arızalı" DEMEZ. Yalnız SAYAR. Ürün kararı hâlâ `dtcAuthority`
 *     → `evaluateVehicleDtcVerdict` tekelindedir.
 * (2) YENİ ÖLÇÜM ÜRETMEZ. Tarama zaten hesapladığı sayıları buraya yazar;
 *     bu modül hattan tek bayt istemez.
 * (3) BAŞARI KANITI DEĞİLDİR. `NONE` kaybı "araç temiz" demek değildir —
 *     "bu okumada katmanlar arası kayıp yok" demektir. RAW 0 iken de
 *     kayıp NONE'dur; ikisi karıştırılamaz (`measured` alanı ayırır).
 *
 * SAF DEĞİL (süreç-ömürlü halka defter tutar) ama I/O YAPMAZ; `Date.now`
 * yalnız damga içindir. Sınırlı: `MAX_ENTRIES` kayıt, timer YOK, abonelik YOK.
 */

/** Sayım zincirinin hangi geçişinde kayıp olduğu. */
export type DtcPipelineLossStage =
  /** Kayıp yok — dört sayı da tutarlı. */
  | 'NONE'
  /** ECU kayıt gönderdi, çözücü daha az üretti (bozuk bayt · stride · dolgu). */
  | 'PARSER'
  /** Çözüldü ama kanonik otoriteye daha azı yazıldı (dedup anahtarı dar). */
  | 'AUTHORITY'
  /** Otoritede var ama ekrana daha azı ulaştı (filtre · liste kırpma). */
  | 'UI'
  /** Bir ya da daha çok sayı ÖLÇÜLEMEDİ — kayıp VAR MI bilinmiyor. */
  | 'UNKNOWN';

export const DTC_PIPELINE_LOSS_LABEL: Readonly<Record<DtcPipelineLossStage, string>> = {
  NONE:      'KAYIP YOK',
  PARSER:    'PARSE_DROPPED',
  AUTHORITY: 'AUTHORITY_DEDUP',
  UI:        'UI_DROPPED',
  UNKNOWN:   'BİLİNMİYOR',
} as const;

/**
 * Bir (ECU × servis) okumasının sayım künyesi.
 *
 * Her sayı `number | null`: `null` = ÖLÇÜLEMEDİ. Sahte `0` YASAK — "0 kayıt
 * geldi" ile "kaç kayıt geldiğini bilmiyoruz" bu ürünün defalarca karıştırdığı
 * ve her seferinde yanlış teşhise yol açan iki ayrı gerçektir.
 */
export interface DtcPipelineEntry {
  readonly atMs: number;
  readonly sessionEpoch: number;
  /** Okumanın hedefi — provenance. */
  readonly txHeader: string;
  readonly rxHeader: string;
  readonly ecuLabel: string;
  /** Kaynak servis ve alt fonksiyon ('19'/'02', '18'/'18', '13'/'13'…). */
  readonly service: string;
  readonly subFunction: string;
  readonly protocol: string | null;
  /** ECU'nun gönderdiği kayıt (zarf geometrisi); `null` = zarf çözülemedi. */
  readonly raw: number | null;
  /** Çözücünün ürettiği kayıt. */
  readonly parsed: number | null;
  /** Kanonik otoriteye yazılan gözlem. */
  readonly authority: number | null;
  /** Ürün listesine (ekrana) ulaşan satır. */
  readonly ui: number | null;
  /** Okuma GERÇEKTEN yapıldı mı — `false` ise sayılar anlamsızdır. */
  readonly measured: boolean;
  /** Okumanın ölçülen sonucu (`advancedDtcEvidence` sözlüğüyle aynı dil). */
  readonly outcome: string;
}

/**
 * Kayıp aşamasını SAF olarak belirler.
 *
 * FAIL-CLOSED: ölçülemeyen bir sayı varsa sonuç `UNKNOWN`'dır — "kayıp yok"
 * DEĞİL. Eksik ölçümü temizlik kanıtı saymak, bu dosyanın var olma sebebi
 * olan kusurun ta kendisidir.
 *
 * SIRA ÖNEMLİ: ilk kırılan halka raporlanır (kök en yukarıdadır); aşağıdaki
 * katmanlar zaten eksik girdiyle çalıştığı için onları da suçlamak teşhisi
 * bulanıklaştırır.
 */
export function describeDtcPipelineLoss(
  e: Pick<DtcPipelineEntry, 'raw' | 'parsed' | 'authority' | 'ui' | 'measured'>,
): DtcPipelineLossStage {
  if (!e.measured) return 'UNKNOWN';
  if (e.raw === null || e.parsed === null || e.authority === null || e.ui === null) return 'UNKNOWN';
  if (e.parsed < e.raw) return 'PARSER';
  if (e.authority < e.parsed) return 'AUTHORITY';
  if (e.ui < e.authority) return 'UI';
  return 'NONE';
}

/**
 * Tek satırlık insan-okur özet: `RAW 20 · PARSED 20 · AUTHORITY 14 · UI 14 → AUTHORITY_DEDUP`.
 * Ölçülemeyen sayı `?` basılır (sahte 0 YASAK).
 */
export function formatDtcPipelineLine(e: DtcPipelineEntry): string {
  const n = (v: number | null) => (v === null ? '?' : String(v));
  const loss = describeDtcPipelineLoss(e);
  return `RAW ${n(e.raw)} · PARSED ${n(e.parsed)} · AUTHORITY ${n(e.authority)} · UI ${n(e.ui)}`
    + ` → ${DTC_PIPELINE_LOSS_LABEL[loss]}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   HALKA DEFTER — süreç-ömürlü, sınırlı, timer YOK
   ══════════════════════════════════════════════════════════════════════════ */

/** Tarama başına ~8 ECU × ~4 servis; iki tur geçmişi yeter. */
const MAX_ENTRIES = 64;

let _entries: DtcPipelineEntry[] = [];

/** Bir okumanın sayım künyesini yazar. ASLA throw etmez (kanıt taramayı düşürmez). */
export function recordDtcPipelineEntry(e: Omit<DtcPipelineEntry, 'atMs'>): void {
  try {
    _entries.push({ ...e, atMs: Date.now() });
    if (_entries.length > MAX_ENTRIES) _entries = _entries.slice(-MAX_ENTRIES);
  } catch { /* kanıt kaydı taramayı DÜŞÜRMEZ */ }
}

/** Defterin salt-okunur kopyası (en eskiden yeniye). */
export function getDtcPipelineEntries(): readonly DtcPipelineEntry[] {
  return [..._entries];
}

/**
 * P0-OBD-PARITY — bir turun toplam künyesi.
 *
 * `lossStages` DİZİ olarak durur (küme DEĞİL, sayım): aynı turda hem PARSER
 * hem UI kaybı olabilir ve ikisi AYRI kök nedendir; birini diğerine
 * indirgemek teşhis kaybıdır.
 */
export interface DtcPipelineSummary {
  readonly entryCount: number;
  /** Yalnız GERÇEKTEN ölçülen okumalar toplanır. */
  readonly measuredCount: number;
  readonly raw: number | null;
  readonly parsed: number | null;
  readonly authority: number | null;
  readonly ui: number | null;
  /** Kayıp gözlenen aşamalar (tekrarsız, sabit sırada). */
  readonly lossStages: readonly DtcPipelineLossStage[];
  /** Herhangi bir okumada ölçülemeyen sayı var mı. */
  readonly hasUnknown: boolean;
}

const _STAGE_ORDER: readonly DtcPipelineLossStage[] = ['PARSER', 'AUTHORITY', 'UI', 'UNKNOWN'];

/**
 * Toplamı hesaplar (SAF — girdi dışarıdan gelir, modül durumu okunmaz).
 *
 * TOPLAMA KURALI: bir okumanın herhangi bir sayısı `null` ise O SAYI ALANI
 * tüm tur için `null` olur. "Ölçemediğimizi 0 sayıp toplamak" bir sayıyı
 * olduğundan küçük gösterir ve tam olarak yanlış güvene yol açar.
 */
export function summarizeDtcPipeline(
  entries: readonly DtcPipelineEntry[],
  sessionEpoch: number | null = null,
): DtcPipelineSummary {
  const scoped = sessionEpoch === null
    ? entries
    : entries.filter((e) => e.sessionEpoch === sessionEpoch);
  const measured = scoped.filter((e) => e.measured);

  function total(pick: (e: DtcPipelineEntry) => number | null): number | null {
    let sum = 0;
    for (const e of measured) {
      const v = pick(e);
      if (v === null) return null;
      sum += v;
    }
    return sum;
  }

  const stages = new Set<DtcPipelineLossStage>();
  let hasUnknown = false;
  for (const e of scoped) {
    const st = describeDtcPipelineLoss(e);
    if (st === 'UNKNOWN') hasUnknown = true;
    if (st !== 'NONE') stages.add(st);
  }

  return {
    entryCount:    scoped.length,
    measuredCount: measured.length,
    raw:       total((e) => e.raw),
    parsed:    total((e) => e.parsed),
    authority: total((e) => e.authority),
    ui:        total((e) => e.ui),
    lossStages: _STAGE_ORDER.filter((s) => stages.has(s)),
    hasUnknown,
  };
}

/** Test kancası — süreç durumu sıfırlanır. Üretim yolunda ÇAĞRILMAZ. */
export function _resetDtcPipelineForTest(): void { _entries = []; }
