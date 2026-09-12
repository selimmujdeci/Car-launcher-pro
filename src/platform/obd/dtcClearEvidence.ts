/**
 * dtcClearEvidence — MODE 04 (DTC SİLME) KANIT DEFTERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (saha kusuru · P0-OBD-10) ───────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Gerçek araçta "HAFIZAYI TEMİZLE" çalışmıyordu ve ürün **tek bir kanıt
 * üretemiyordu**: hangi komut gitti, ECU ne cevapladı, silme sonrası 03/07/0A
 * ne döndü — hiçbiri hiçbir yerde durmuyordu. `clearDTC()` sözleşmesi
 * `Promise<void>` idi; ham TX/RX plugin sınırında ATILIYORDU.
 *
 * Bu defter her silme DENEMESİNİN tam izini tutar. `dtcScanEvidence` ile AYNI
 * desendir (bounded ring + OTURUM MÜHRÜ) — ikinci bir kanıt sistemi kurulmadı.
 *
 * ── GİZLİLİK ──────────────────────────────────────────────────────────────
 * Taşınan tek şey OBD protokol verisidir: komut, ham hex yanıt, DTC kodu,
 * protokol numarası ve süre. **VIN, konum, kullanıcı verisi veya API anahtarı
 * BU DEFTERE GİRMEZ** (CLAUDE.md gözlemlenebilirlik kuralı 6). Ham yanıt
 * `RAW_MAX` ile kırpılır.
 *
 * SAF DEĞİL (durum tutar) ama I/O yapmaz; `Date.now` yalnız damga içindir.
 */

import type { DtcScanCompleteness, DtcScanModeOutcome } from '../dtcService';
import type { DtcClearCommandOutcome, DtcClearVerdict } from './dtcClearModel';
import type { WriteGateDenyReason } from './writeGate';

/** Defterin tavanı — sınırsız kayıt cihazda bellek sorunudur. */
export const DTC_CLEAR_EVIDENCE_RING = 12;

/** Ham yanıt üst sınırı (karakter) — `dtcScanEvidence` ile AYNI. */
const RAW_MAX = 240;

/**
 * Silme sonrası yeniden okumanın sınıf sonucu.
 *
 * P0-OBD-11/2 `DtcScanModeOutcome`'a `no_response` (ECU SUSTU) ekledi ama bu tip
 * onu taşımıyordu → `dtcService` yeniden okuma sonucunu buraya yazamıyordu.
 * Sözlük artık GERÇEKTEN aynı: türetilerek bağlandı, kopyalanmadı — ikisi bir daha
 * ayrışamaz. `not_run` yalnız BURADA vardır (silme hiç denenmediyse yeniden okuma da
 * yapılmaz; tarama sözlüğünde böyle bir durum yoktur).
 */
export type DtcClearRereadOutcome = DtcScanModeOutcome | 'not_run';

/** Silme sonrası yeniden okumanın SINIF BAZINDA sonucu. */
export interface DtcClearRereadClass {
  /** SAE J1979 servisi. */
  readonly service: '03' | '07' | '0A';
  /** O servisten dönen kodlar. Okuma düştüyse boş — `outcome` ayırt eder. */
  readonly codes: readonly string[];
  /** `DtcScanModeOutcome` ile AYNI sözlük (+ `not_run`). */
  readonly outcome: DtcClearRereadOutcome;
}

export interface DtcClearAttempt {
  /* ── KOMUT ─────────────────────────────────────────────────────────────── */
  /** Hatta gönderilen komut ("04"); kapı reddettiyse `null` — GÖNDERİLMEDİ. */
  readonly tx: string | null;
  /** ELM327 ham yanıtı (kırpılmış). `null` = ölçülmedi/gönderilmedi. */
  readonly raw: string | null;
  readonly commandOutcome: DtcClearCommandOutcome | null;
  /** Negatif yanıt kodu (2 hane hex); yoksa `null` — sahte "00" YAZILMAZ. */
  readonly nrc: string | null;
  /** Komut anındaki ATDPN protokolü; native taşımıyorsa `null`. */
  readonly protocol: string | null;
  /**
   * Silmenin HEDEF KAPSAMI. Ürün Mode 04'ü FONKSİYONEL adresle (7DF) gönderir —
   * yani belirli bir ECU seçilmez, hattaki tüm emisyon ECU'larına yayınlanır.
   * Bu alan o gerçeği kayda geçirir; "yanlış ECU'ya gitti mi" sorusu ancak
   * hedefi yazılıysa yanıtlanabilir.
   */
  readonly scope: 'functional_7DF';
  /** Komutun uçtan uca süresi (ms); ölçülmediyse `null`. */
  readonly elapsedMs: number | null;

  /* ── KAPI ──────────────────────────────────────────────────────────────── */
  /** Yazma kapısı izin verdi mi. `false` ise komut HİÇ gönderilmedi. */
  readonly gateAllowed: boolean;
  readonly gateDenyReason: WriteGateDenyReason | null;

  /* ── ÖLÇÜM ─────────────────────────────────────────────────────────────── */
  /** Silme ÖNCESİ görülen kodlar (sınıflarıyla, "P0089/pending" biçiminde). */
  readonly before: readonly string[];
  /** Silme SONRASI yeniden okumanın sınıf bazında sonucu. */
  readonly reread: readonly DtcClearRereadClass[];
  /** Yeniden okumanın kapsam özeti; yapılmadıysa `null`. */
  readonly rereadCompleteness: DtcScanCompleteness | null;

  /* ── HÜKÜM ─────────────────────────────────────────────────────────────── */
  readonly verdict: DtcClearVerdict;
  readonly removed: readonly string[];
  readonly remaining: readonly string[];
  readonly returned: readonly string[];
  readonly permanentRemaining: readonly string[];

  /** Denemenin ait olduğu OBD oturumu. `-1` = okunamadı (sahte 0 YASAK). */
  readonly sessionEpoch: number;
  /** Ölçüm damgası (epoch ms). */
  readonly atMs: number;
  /** Taşıma hatası metni — yalnız `TRANSPORT_ERROR` iken dolu. */
  readonly error: string | null;
}

/* ── Defter (bounded ring) ──────────────────────────────────────────────── */

let _ring: DtcClearAttempt[] = [];

export type RecordDtcClearInput =
  Omit<DtcClearAttempt, 'atMs' | 'raw'> & { readonly raw?: string | null };

/** Kanıt yazar. ASLA throw etmez — defter ürünü düşüremez. */
export function recordDtcClearAttempt(input: RecordDtcClearInput): void {
  try {
    const raw = typeof input.raw === 'string'
      ? (input.raw.length > RAW_MAX ? input.raw.slice(0, RAW_MAX) : input.raw)
      : null;
    const entry: DtcClearAttempt = { ...input, raw, atMs: Date.now() };

    /* OTURUM MÜHRÜ — `dtcScanEvidence` ile AYNI kural: yeni bir oturum kanıt
       yazmaya başladığında ESKİ oturumun kayıtları DÜŞER. Böylece eski
       oturumun silme kanıtı yeni oturumun ekranına SIZAMAZ ve kural dışarıdan
       bir sıfırlama çağrısına BAĞLI DEĞİLDİR (o çağrı unutulur). */
    const last = _ring[_ring.length - 1];
    if (last !== undefined && last.sessionEpoch !== entry.sessionEpoch) _ring = [];

    _ring = _ring.length >= DTC_CLEAR_EVIDENCE_RING
      ? [..._ring.slice(1), entry]
      : [..._ring, entry];
  } catch { /* kanıt kaydı ürünü DÜŞÜRMEZ */ }
}

/** Yeni OBD oturumu — eski oturumun silme kanıtı taşınmaz. */
export function resetDtcClearEvidenceForSession(): void { _ring = []; }

/** Test izolasyonu. */
export function _resetDtcClearEvidenceForTest(): void { _ring = []; }

/** Salt-okunur okuma — kopya döner (çağıran defteri bozamaz). */
export function getDtcClearEvidence(): readonly DtcClearAttempt[] {
  return _ring.slice();
}

/* ── Özet (LAB ekranı bunu tüketir) ─────────────────────────────────────── */

export interface DtcClearEvidenceSummary {
  readonly total: number;
  /** Kapının GEÇİRDİĞİ (ECU'ya komut giden) deneme sayısı. */
  readonly sent: number;
  /** Kapının REDDETTİĞİ (tek bayt gitmeyen) deneme sayısı. */
  readonly denied: number;
  /** ECU'nun pozitif onay verdiği deneme sayısı. */
  readonly ecuPositive: number;
  /** "Silindi" denebilen (doğrulanmış) deneme sayısı. */
  readonly verifiedCleared: number;
  /** En son deneme; hiç yoksa `null` (sahte 0 YASAK). */
  readonly last: DtcClearAttempt | null;
  /** Defterdeki oturumlar (tekil) + karışıklık bayrağı. */
  readonly epochs: readonly number[];
  readonly mixedEpochs: boolean;
}

/** Defteri özetler. Saf (girdi defterdir). */
export function summarizeDtcClearEvidence(
  entries: readonly DtcClearAttempt[] = getDtcClearEvidence(),
): DtcClearEvidenceSummary {
  const epochs: number[] = [];
  let sent = 0, denied = 0, ecuPositive = 0, verifiedCleared = 0;

  for (const e of entries) {
    if (e.gateAllowed) sent++; else denied++;
    if (e.commandOutcome === 'POSITIVE') ecuPositive++;
    if (e.verdict === 'CLEARED' || e.verdict === 'CLEARED_PERMANENT_REMAINS') verifiedCleared++;
    if (!epochs.includes(e.sessionEpoch)) epochs.push(e.sessionEpoch);
  }

  return {
    total: entries.length,
    sent, denied, ecuPositive, verifiedCleared,
    last: entries.length > 0 ? entries[entries.length - 1] : null,
    epochs,
    mixedEpochs: epochs.length > 1,
  };
}
