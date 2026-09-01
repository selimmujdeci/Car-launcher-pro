/**
 * dtcScanEvidence — DTC OKUMASININ SERVİS-BAZINDA KANIT DEFTERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (P0-OBD-09) ─────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Sahada başka bir uygulama `P0089` bekleyen kodunu gösterirken CarOS
 * göstermiyordu. Kök neden native çözümleyicideydi — ve **o hata hiçbir
 * ekranda görünmüyordu**: ürün "Mode 07 sonucu ne geldi, ne çözümlendi"
 * sorusunu cevaplayamıyordu. Bir çözümleyici hatası, çıktısı gözlenmiyorsa
 * sessizce yaşar.
 *
 * Bu defter her (servis × ECU) okumasının SONUCUNU tutar: ham yanıt (kırpılmış),
 * çözümlenen kodlar, sonuç sınıfı ve OTURUM MÜHRÜ. CAROS LAB bunu salt-okunur
 * gösterir; komut GÖNDERMEZ.
 *
 * ── GİZLİLİK ──────────────────────────────────────────────────────────────
 * Taşınan tek şey OBD protokol verisidir: DTC kodu, servis numarası, ECU
 * adresi/etiketi ve ham hex yanıt. **VIN, konum, kullanıcı verisi veya API
 * anahtarı BU DEFTERE GİRMEZ** (CLAUDE.md gözlemlenebilirlik kuralı 6).
 * Ham yanıt `RAW_MAX` ile kırpılır — bellek şişmesin.
 *
 * SAF DEĞİL (durum tutar) ama I/O yapmaz; `Date.now` yalnız damga içindir.
 */

import type { DtcService } from './dtcClassModel';

/**
 * Bir okumanın ÖLÇÜLEN sonucu — yorum değil.
 *
 * P0-OBD-11: `no_response` AYRI BİR SINIFTIR ve `ok` DEĞİLDİR. Eskiden ELM327'nin
 * "NO DATA" yanıtı `ok` + boş liste oluyordu; yani **ECU sustuğu anda ürün aracın
 * temiz olduğunu ilan ediyordu**. Gerçekten temiz bir ECU `43 00` / `47 00` /
 * `4A 00` (pozitif yanıt + sayaç 0) döner — ölçüm VARDIR. "NO DATA"da ölçüm YOKTUR.
 */
export type DtcReadOutcome =
  /**
   * POZİTİF yanıt geldi (SID 43/47/4A). **Boş liste de başarıdır** — ECU cevap
   * verdi ve "kod yok" dedi. Bu, `no_response` ile ASLA aynı şey değildir.
   */
  | 'ok'
  /** Araç/adaptör bu servisi HİÇ bilmiyor (açık negatif yanıt 7F / "?"). */
  | 'unsupported'
  /**
   * **ECU SUSTU** — "NO DATA" / boş yanıt / zaman aşımı. Kod OLMADIĞI anlamına
   * GELMEZ; hiç ölçüm alınamadı demektir. Asla "temiz" sayılamaz.
   */
  | 'no_response'
  /** Ağ/adaptör/protokol hatası veya kısmi/çözümlenemeyen yanıt → tarama KISMİDİR. */
  | 'failed'
  /**
   * P0-VDK-F1A — **SORGU HİÇ GÖNDERİLMEDİ.** Tanı işlemi (bütçe · iptal ·
   * bayat oturum) hakkı vermedi; ECU'ya tek bayt gitmedi.
   *
   * DÖRT MEVCUT SINIFIN HİÇBİRİ BUNU ANLATMIYORDU ve en yakın görünen ikisi
   * de YANLIŞ olurdu: `failed` "okuma düştü" der (oysa hiç denenmedi),
   * `unsupported` "ECU bilmiyor" der (oysa ECU'ya sorulmadı). İkisi de
   * kapsam kaybını YANLIŞ yere yazar ve teşhisi bozar.
   *
   * Kapsam açısından `no_response` ile aynı ağırlıktadır: ölçüm YOKTUR ve
   * ASLA "temiz" sayılamaz.
   */
  | 'deferred';

export const DTC_OUTCOME_LABEL: Readonly<Record<DtcReadOutcome, string>> = {
  ok:          'okundu',
  unsupported: 'araç bu servisi desteklemiyor',
  no_response: 'ECU YANIT VERMEDİ — sonuç bilinmiyor',
  failed:      'okuma düştü — tarama KISMİ',
  deferred:    'SORGU GÖNDERİLMEDİ (işlem bütçesi/iptal) — ölçüm yok',
} as const;

/** Defterin tavanı — sınırsız kayıt cihazda bellek sorunudur. */
export const DTC_EVIDENCE_RING = 36;

/** Ham yanıt üst sınırı (karakter). */
const RAW_MAX = 240;

export interface DtcServiceEvidence {
  /** SAE J1979 servisi ('03' onaylı · '07' bekleyen · '0A' kalıcı). */
  readonly service: DtcService;
  /**
   * Okumanın hedefi. `null` = FONKSİYONEL adres (7DF) — tek ECU'ya ait değil.
   * Dolu = fiziksel ECU adresi/etiketi (çoklu-ECU taraması).
   */
  readonly ecuLabel: string | null;
  readonly ecuTxHeader: string | null;
  readonly outcome: DtcReadOutcome;
  /** Çözümlenen kodlar (tekil, sıra korunur). `outcome !== 'ok'` ise boş. */
  readonly codes: readonly string[];
  /**
   * HAM yanıt (kırpılmış). `null` = native bu yolda ham taşımıyor —
   * sahte boş string YAZILMAZ, "ölçülmedi" dürüstçe `null` kalır.
   */
  readonly raw: string | null;
  /** Okumanın ait olduğu OBD oturumu. Farklı epoch = BAŞKA oturum. */
  readonly sessionEpoch: number;
  /** Ölçüm damgası (epoch ms). */
  readonly atMs: number;
  /** Hata metni — yalnız `outcome === 'failed'` iken dolu. */
  readonly error: string | null;
  /**
   * P0-OBD-11 — okuma anındaki aktif ATDPN protokolü. `null` = ölçülmedi
   * (eski native yol taşımıyor). "ECU neden sustu" sorusu protokol bilinmeden
   * yanıtlanamaz.
   */
  readonly protocol: string | null;
  /** Bu okumanın uçtan uca süresi (ms); ölçülmediyse `null`. */
  readonly elapsedMs: number | null;
  /**
   * Okuma anındaki KWP kurtarma sayacı. İki okuma arasında ARTMIŞSA tarama
   * ortasında recovery (ATPC/reinit) olmuştur — sonuçlar aynı oturuma ait
   * görünse bile hat yeniden kurulmuştur.
   */
  readonly recoveryCount: number | null;
}

/* ── Defter (bounded ring) ──────────────────────────────────────────────── */

let _ring: DtcServiceEvidence[] = [];

export interface RecordDtcEvidenceInput {
  readonly service: DtcService;
  readonly ecuLabel?: string | null;
  readonly ecuTxHeader?: string | null;
  readonly outcome: DtcReadOutcome;
  readonly codes?: readonly string[];
  readonly raw?: string | null;
  readonly sessionEpoch: number;
  readonly error?: string | null;
  readonly protocol?: string | null;
  readonly elapsedMs?: number | null;
  readonly recoveryCount?: number | null;
}

/** Kanıt yazar. ASLA throw etmez — defter ürünü düşüremez. */
export function recordDtcEvidence(input: RecordDtcEvidenceInput): void {
  try {
    const raw = typeof input.raw === 'string'
      ? (input.raw.length > RAW_MAX ? input.raw.slice(0, RAW_MAX) : input.raw)
      : null;
    const entry: DtcServiceEvidence = {
      service:      input.service,
      ecuLabel:     input.ecuLabel ?? null,
      ecuTxHeader:  input.ecuTxHeader ?? null,
      outcome:      input.outcome,
      /* Başarısız okumanın kod listesi ANLAMSIZDIR — sahte kanıt üretmeyelim. */
      codes:        input.outcome === 'ok' ? [...(input.codes ?? [])] : [],
      raw,
      sessionEpoch: input.sessionEpoch,
      atMs:         Date.now(),
      error:        input.outcome === 'failed' ? (input.error ?? null) : null,
      protocol:      input.protocol ?? null,
      elapsedMs:     typeof input.elapsedMs === 'number' ? input.elapsedMs : null,
      recoveryCount: typeof input.recoveryCount === 'number' ? input.recoveryCount : null,
    };
    /* OTURUM MÜHRÜ — KENDİ KENDİNİ TEMİZLER.
       Yeni bir oturum (yeniden bağlanma / araç değişimi) kanıt yazmaya
       başladığında ESKİ oturumun kayıtları düşer. Böylece "eski DTC yeni
       oturuma taşınmaz" kuralı dışarıdan bir sıfırlama çağrısına BAĞLI
       DEĞİLDİR — o çağrının unutulması bu projenin tekrar eden kusurudur. */
    const last = _ring[_ring.length - 1];
    if (last !== undefined && last.sessionEpoch !== entry.sessionEpoch) _ring = [];

    _ring = _ring.length >= DTC_EVIDENCE_RING
      ? [..._ring.slice(1), entry]
      : [..._ring, entry];
  } catch { /* kanıt kaydı ürünü DÜŞÜRMEZ */ }
}

/**
 * Yeni bir OBD oturumu başladığında ÇAĞRILIR — eski oturumun kanıtı yeni
 * oturuma taşınmaz. (Yeniden bağlanma / araç değişimi.)
 */
export function resetDtcEvidenceForSession(): void { _ring = []; }

/** Test izolasyonu. */
export function _resetDtcEvidenceForTest(): void { _ring = []; }

/** Salt-okunur okuma — kopya döner (çağıran defteri bozamaz). */
export function getDtcEvidence(): readonly DtcServiceEvidence[] {
  return _ring.slice();
}

/* ── Özet (LAB modeli bunu tüketir) ─────────────────────────────────────── */

export interface DtcServiceSummary {
  readonly service: DtcService;
  /** Bu servis için YAPILAN okuma sayısı (ECU başına ayrı sayılır). */
  readonly attempts: number;
  readonly okCount: number;
  readonly failedCount: number;
  readonly unsupportedCount: number;
  /** P0-OBD-11 — ECU'nun SUSTUĞU okuma sayısı. `ok` ile ASLA toplanmaz. */
  readonly noResponseCount: number;
  /** Bu servisten gelen TEKİL kod sayısı. */
  readonly uniqueCodes: number;
  /** En son okuma damgası; hiç okunmadıysa `null` (sahte 0 YASAK). */
  readonly lastAtMs: number | null;
}

export interface DtcEvidenceSummary {
  readonly byService: Readonly<Record<DtcService, DtcServiceSummary>>;
  /** Defterdeki kayıtların ait olduğu oturumlar (tekil). */
  readonly epochs: readonly number[];
  /**
   * Defter BİRDEN FAZLA oturum taşıyor mu? `true` ise ekran karışık kanıt
   * gösteriyordur — sıfırlama kaçırılmış demektir (teşhis sinyali).
   */
  readonly mixedEpochs: boolean;
  readonly total: number;
}

function _emptyService(service: DtcService): DtcServiceSummary {
  return {
    service, attempts: 0, okCount: 0, failedCount: 0, unsupportedCount: 0,
    noResponseCount: 0, uniqueCodes: 0, lastAtMs: null,
  };
}

/** Defteri servis bazında özetler. Saf (girdi defterdir). */
export function summarizeDtcEvidence(
  entries: readonly DtcServiceEvidence[] = getDtcEvidence(),
): DtcEvidenceSummary {
  const codeSets: Record<DtcService, Set<string>> = {
    '03': new Set(), '07': new Set(), '0A': new Set(),
  };
  const acc: Record<DtcService, DtcServiceSummary> = {
    '03': _emptyService('03'), '07': _emptyService('07'), '0A': _emptyService('0A'),
  };
  const epochs: number[] = [];

  for (const e of entries) {
    const cur = acc[e.service];
    if (cur === undefined) continue;
    for (const c of e.codes) codeSets[e.service].add(c);
    acc[e.service] = {
      service:          e.service,
      attempts:         cur.attempts + 1,
      okCount:          cur.okCount + (e.outcome === 'ok' ? 1 : 0),
      failedCount:      cur.failedCount + (e.outcome === 'failed' ? 1 : 0),
      unsupportedCount: cur.unsupportedCount + (e.outcome === 'unsupported' ? 1 : 0),
      noResponseCount:  cur.noResponseCount  + (e.outcome === 'no_response' ? 1 : 0),
      uniqueCodes:      codeSets[e.service].size,
      lastAtMs:         cur.lastAtMs === null ? e.atMs : Math.max(cur.lastAtMs, e.atMs),
    };
    if (!epochs.includes(e.sessionEpoch)) epochs.push(e.sessionEpoch);
  }

  return {
    byService:   acc,
    epochs,
    mixedEpochs: epochs.length > 1,
    total:       entries.length,
  };
}
