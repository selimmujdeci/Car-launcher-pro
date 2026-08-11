/**
 * carosLabCopyModel.ts — CAROS LAB "TÜMÜNÜ KOPYALA" metin üreticisi (SAF · fail-closed).
 *
 * ═══ SÖZLEŞME ═══════════════════════════════════════════════════════════════
 *  1. SAF: servis importu YOK, I/O YOK, modül durumu YOK, `Date.now()` YOK.
 *     Girdi YAPISAL bir snapshot'tır → mock'suz test edilir (A3'te kanıtlanan desen).
 *  2. SALT-OKUNUR: bu modül hiçbir şey başlatmaz/gönderme yapmaz. Kopyalama bir
 *     GÖZLEM eylemidir; araç iletişimini DEĞİŞTİRMEZ.
 *  3. MASKELEME ZORUNLU — ekrandaki metne GÜVENİLMEZ, ham kaynaktan YENİDEN maskelenir:
 *       (a) `maskObdTrafficEntry` — OBD'ye özgü (VIN yükü · sağlayıcı anahtarı · MAC…)
 *       (b) `maskSensitiveText`   — doğrulama raporu maskesi (VIN→WMI · koordinat · k=v)
 *       (c) `sanitizeValue`       — deny-key düşürme + derinlik/uzunluk tavanı, ASLA throw
 *  4. FAIL-CLOSED: maskelenemeyen kayıt kopyalanmaz, DÜŞÜRÜLÜR ve sayısı metinde
 *     dürüstçe beyan edilir. Kaynağı okunamayan bölüm "okunamadı" yazar — boş/0
 *     VARSAYILMAZ (uydurma yasak).
 *  5. BOUNDED: bölüm başına satır tavanı + toplam karakter tavanı (Mali-400 bütçesi ve
 *     pano/WebView sınırları). Kırpma OLURSA metinde açıkça yazar — sessiz kesme YOK.
 */

import { maskObdTrafficEntry, maskCommonSecrets } from './obdTrafficMask';
import { maskSensitiveText, sanitizeValue } from '../validation/validationExport';
import { classifyCommand, classifyResponse } from './rawTrafficModel';

/* ── Sınırlar ─────────────────────────────────────────────────────────────── */

export const CAROS_LAB_COPY_SCHEMA = 'caros.lab.copy.v1';
/** Bölüm başına azami satır (en YENİ kayıtlar korunur). */
export const MAX_COPY_ROWS_PER_SECTION = 200;
/**
 * SATIR tipi bölümlerde (kütük/kanıt) tek satır azami karakter.
 *
 * SAHA (2026-07-25, gerçek cihaz çıktısı): eski değer 240'tı ve kanıt satırları
 * cümle ORTASINDA kesiliyordu ("…araç/protokol" gibi). 240, `validationExport`in
 * ALAN tavanıdır — SATIR tavanı olarak kullanmak yanlıştı.
 */
export const MAX_COPY_LINE_CHARS = 1_000;
/**
 * NESNE tipi bölümlerde (anlık araç verisi · oturum · zamanlama snapshot'ları)
 * azami karakter. SAHA: 240 tavanı bu bölümleri işe yaramaz hale getiriyordu —
 * snapshot JSON'u `"fuelLevel":-1,"t` diye kesiliyordu. Snapshot'ın TAMAMI lazım.
 * NOT: tek tek ALAN değerleri yine `sanitizeValue` içinde 240'ta kırpılır.
 */
export const MAX_COPY_OBJECT_CHARS = 20_000;
/** Tüm metin azami karakter — pano ve düşük-uç WebView güvenliği. */
export const MAX_COPY_CHARS = 180_000;

/* ── Girdi (YAPISAL — servis tipi importu YOK) ────────────────────────────── */

/** Kaynağı okunamayan bölüm için: `null` = OKUNAMADI (boş DEĞİL). */
export interface CarosLabCopyInput {
  readonly meta: {
    /** Duvar saati (ms) — çağıran verir, modül saat okumaz. */
    readonly generatedAtWallMs: number;
    readonly platform:  string;
    readonly appVersion: string | null;
    /** Kopyalama anında açık olan kategori / araç (bağlam). */
    readonly category:  string;
    readonly activeTool: string | null;
    /**
     * Yakalama kanallarının ref sayısı (0 = KAPALI).
     *
     * SAHA GEREKÇESİ: kopyada "HAM OBD TRAFİĞİ (kayıt yok)" iki AYRI anlama gelebilir —
     * (i) yakalama açıktı ama hiç trafik olmadı, (ii) yakalama hiç açılmadı. İkisi
     * ayırt edilemezse okuyucu yanlış sonuca varır. Bu yüzden durum BEYAN edilir.
     */
    readonly captureRefs: { obd: number; can: number } | null;
    /**
     * S2 (#505) — EXTENDED POLL KANIT ÖNBELLEĞİNİN TAZELİĞİ.
     *
     * `getExtendedPollEvidence()` SENKRONDUR ve yalnız önbelleği okur; onu dolduran tek
     * şey ASYNC `refreshExtendedPollEvidence()`tir — ve bu kopya yolu sözleşmesi gereği
     * senkron olduğu için onu ÇAĞIRMAZ. Telefonda ölçüldü (2026-08-01): temiz boot →
     * `counters:null` → "eski APK / poll başlamadı" etiketi, oysa aynı cihazda native
     * çağrı 43 ms'de tam yanıt veriyordu. Yani rapor SAĞLAM bir boruyu ÖLÜ gösterebilir.
     *
     * Hüküm katmanı bunu zaten dürüst veriyor (`classifyExtendedPoll` → "ölçmedik"),
     * ama raporu OKUYAN kişi bunu bölümün derinliğinde kaçırıyordu. Bu alan uyarıyı
     * raporun BAŞINA taşır. `null` = tazelik durumu okunamadı (varsayım YAPILMAZ).
     */
    readonly pollEvidenceCacheState?: string | null;
  };
  /**
   * Katalog durum tablosu — `null` ise okunamadı.
   *
   * ⚠️ Alan adı `ad`, `name` DEĞİL: `sanitizeValue`ın gizlilik deny-list'inde `name`
   * VARDIR (kişi adı sızıntısına karşı) ve her derinlikte DÜŞÜRÜLÜR. Saha çıktısında
   * araç adları bu yüzden hiç görünmüyordu. Deny-list ZAYIFLATILMADI — alan yeniden
   * adlandırıldı (araç adı PII değildir, ama ortak kapı gevşetilmez).
   */
  readonly catalog: readonly { id: string; ad: string; category: string; status: string }[] | null;
  /** Oturum denetçisi ham snapshot'ı (serileştirilebilir nesne) — `null` = okunamadı. */
  readonly session: unknown | null;
  /** Çalışma zamanı zamanlama ham snapshot'ı — `null` = okunamadı. */
  readonly scheduling: unknown | null;
  /** Kanıt satırları (zaten maskeli model çıktısı; yine de yeniden maskelenir). */
  readonly evidence: readonly unknown[] | null;
  /** HAM OBD trafiği — maskeleme BURADA yapılır (ekrandaki satırlar kullanılmaz). */
  readonly obdTraffic: readonly { cmd?: unknown; resp?: unknown; ms?: unknown; ts?: unknown }[] | null;
  /** HAM CAN kütüğü. */
  readonly canRaw: readonly { ts?: unknown; frameId?: unknown; payload?: unknown }[] | null;
  /** Keşif gözlemleri (katalog-dışı PID/DID). */
  readonly discovery: readonly unknown[] | null;
  /** Anlık araç verisi (hız/RPM/coolant/yakıt…) — `getOBDDataSnapshot`. */
  readonly obdData: unknown | null;
  /** BlackBox 1 Hz örnekleri (Kayıt Oynatma ekranının verisi). */
  readonly blackBox: readonly unknown[] | null;
  /** Debug hata kütüğü (halka tampon). */
  readonly errorLog: readonly unknown[] | null;
  /**
   * #523 — H-A DENEYİ (ATST) SONUCU.
   *
   * SAHA GEREKÇESİ (2026-08-10): deney gerçek araçta koştu, ekranda hüküm göründü,
   * ama "TÜMÜNÜ KOPYALA" çıktısında deney bölümü YOKTU — kategori `developer` ve
   * açık araç `pid-timing-experiment` olmasına rağmen. Ölçüm yapıldı, dışarı
   * çıkarılamadı; saha oturumu okunamadan gitti.
   *
   * `null` = bu oturumda deney ekranı hiç okunmadı. Bu "deney yok" DEMEK DEĞİLDİR
   * ve öyle sunulmaz — kopya yolu senkrondur, veriyi ancak ekran bir kez okuduysa
   * önbellekten alabilir.
   */
  readonly pidTimingExperiment: unknown | null;
  /**
   * #526 — native sayaç snapshot'larının YAŞI. Kopyadaki `lastPollAt` 5 dk bayat
   * görünüp "poll durdu" sanıldı; önbellek eskiydi. Yaş olmadan bu ayrım yapılamaz.
   */
  readonly nativeSnapshotAge: unknown | null;
  /**
   * #535 — NAVİGASYON ÖLÇÜMÜ. `fixAgeMs` (#508 kabul ölçütünün dayandığı sayı)
   * ve ETA sıçrama defteri (#530) kopyada YOKTU → saha koşumu ölçüm üretemedi.
   */
  readonly navigationCore: unknown | null;
  readonly etaJumps: unknown | null;
  /**
   * #537 — FIX YAŞI DAĞILIMI (GÖREV B). Sahada tek anlık örnek (`fixAgeMs: 5237`)
   * geldi; #508 ölçütü `p50<3s ∧ p95<10s` DAĞILIMI ister → kapanış üretilemedi.
   * `null` = defter okunamadı ("ölçüm yok" DEĞİL).
   */
  readonly fixAgeDistribution: unknown | null;
  /**
   * #536 — KOPMA KANIT DEFTERİ (GÖREV A). Sahada 8 timeout ölçüldü ama dört kök
   * neden adayının (adaptör · soket · ELM init · ECU uykusu) hepsi AYNI sayıyı
   * üretiyordu. Bu bölüm kopma anındaki imzayı, kurtarma imzasını ve **eksik
   * kanıt listesini** taşır. `null` = defter okunamadı ("kopma yok" DEĞİL).
   */
  readonly linkLosses: unknown | null;
  /** Vehicle HAL kaynak sağlığı — `canAlive/obdAlive/gpsAlive`, null = BİLİNMİYOR. */
  readonly sourceHealth: unknown | null;
  /**
   * Kaza algılama sağlığı (kütük #456): kaç kayıt yazıldı, kaç darbe hareket
   * kanıtı olmadığı için reddedildi, depoda kaç kayıt duruyor.
   * GİZLİLİK: yalnız SAYI ve eşik taşır — kaza kaydının içeriği (konum, hız
   * izi, G tamponu) LAB'a TAŞINMAZ.
   */
  readonly crashDetection: unknown | null;
}

export interface CarosLabCopyResult {
  readonly text: string;
  /** Gerçekten yazılan bölüm sayısı (okunamayanlar da bölüm sayılır — beyan edilir). */
  readonly sectionCount: number;
  /** Maskelenemediği için DÜŞÜRÜLEN kayıt sayısı (fail-closed kanıtı). */
  readonly droppedCount: number;
  /** Satır/karakter tavanı nedeniyle kırpıldı mı. */
  readonly truncated: boolean;
  readonly chars: number;
  /**
   * S2 (#505): extended poll kanıtı bu oturumda hiç tazelenmemiş → rapor P1-1 hakkında
   * HÜKÜM VEREMEZ. Çağıran bunu kullanıcıya EKRANDA da göstermelidir (rapor gövdesindeki
   * uyarıyı okumadan kopyayı paylaşan geliştirici yanlış teşhise sürükleniyordu).
   */
  readonly pollEvidenceStale: boolean;
}

/* ── Yardımcılar ──────────────────────────────────────────────────────────── */

function clampTo(s: string, limit: number): string {
  const t = typeof s === 'string' ? s : String(s ?? '');
  return t.length > limit ? `${t.slice(0, limit - 1)}…` : t;
}

/**
 * Maskeleme zinciri — ASLA throw etmez; başarısızsa null → kayıt DÜŞER.
 *
 * SAHA DERSİ (2026-07-25, bu turda testle yakalandı): `maskSensitiveText` VIN/MAC/
 * koordinat/`anahtar=değer` yakalar ama `authorization: bearer_…` ve çıplak e-posta
 * yakalamaz — bunlar YALNIZ `maskCommonSecrets` içinde vardır. Önceden o kapı sadece
 * OBD trafiğine uygulanıyordu, dolayısıyla KANITLAR bölümündeki bir bearer token'ı
 * kopyaya HAM girebilirdi. Artık üç kapı da HER bölümde çalışır.
 */
function maskUnknown(value: unknown, limit: number = MAX_COPY_LINE_CHARS): string | null {
  try {
    const safe = sanitizeValue(value);                       // (c) deny-key + ALAN tavanı (240)
    const json = typeof safe === 'string' ? safe : JSON.stringify(safe);
    if (typeof json !== 'string') return null;
    const common = maskCommonSecrets(json);                  // (a) bearer · e-posta · MAC · UUID · IBAN
    /* (b) maskeleme uygulanır ama KIRPMA BURADA YAPILMAZ (`Infinity`) — kırpma tek
       yerde, çağıranın verdiği `limit` ile. Aksi halde `maskSensitiveText`in 240'lık
       ALAN tavanı tüm JSON'u keserdi (saha kusuru buydu). Gizlilik kapısı atlanmaz. */
    return clampTo(maskSensitiveText(common, Infinity), limit);
  } catch {
    return null;
  }
}

/** En YENİ N kaydı korur (baştan değil sondan kırpar — bağlam kaybı en aza iner). */
function tail<T>(rows: readonly T[], n: number): readonly T[] {
  return rows.length > n ? rows.slice(rows.length - n) : rows;
}

interface Section {
  readonly title: string;
  readonly lines: string[];
  readonly dropped: number;
  readonly truncated: boolean;
}

function unreadable(title: string, why: string): Section {
  // "veri yok" DEĞİL — "okunamadı". Boş küme varsaymak yasak.
  return { title, lines: [`(okunamadı — ${why})`], dropped: 0, truncated: false };
}

function fromRows(
  title: string,
  rows: readonly unknown[] | null,
  render: (row: unknown, i: number) => unknown,
): Section {
  if (rows === null || rows === undefined) return unreadable(title, 'kaynak getter hata verdi veya yok');
  if (!Array.isArray(rows)) return unreadable(title, 'kaynak beklenen dizi biçiminde değil');
  if (rows.length === 0) return { title, lines: ['(kayıt yok)'], dropped: 0, truncated: false };

  const kept = tail(rows, MAX_COPY_ROWS_PER_SECTION);
  const lines: string[] = [];
  let dropped = 0;
  for (let i = 0; i < kept.length; i++) {
    let projected: unknown;
    try { projected = render(kept[i], i); } catch { dropped++; continue; }
    const masked = maskUnknown(projected);
    if (masked === null) { dropped++; continue; }
    lines.push(masked);
  }
  return { title, lines, dropped, truncated: kept.length < rows.length };
}

function fromObject(title: string, value: unknown | null): Section {
  if (value === null || value === undefined) return unreadable(title, 'kaynak getter hata verdi veya yok');
  const masked = maskUnknown(value, MAX_COPY_OBJECT_CHARS);
  if (masked === null) return unreadable(title, 'maskelenemedi → fail-closed düşürüldü');
  return { title, lines: [masked], dropped: 0, truncated: masked.endsWith('…') };
}

/* ── OBD trafiği: ÜÇÜNCÜ kapı (a) burada uygulanır ────────────────────────── */

function obdSection(entries: CarosLabCopyInput['obdTraffic']): Section {
  const title = 'HAM OBD TRAFİĞİ (maskeli)';
  if (entries === null || entries === undefined) return unreadable(title, 'trafik tamponu okunamadı');
  if (!Array.isArray(entries)) return unreadable(title, 'tampon beklenen dizi biçiminde değil');
  if (entries.length === 0) return { title, lines: ['(kayıt yok)'], dropped: 0, truncated: false };

  const kept = tail(entries, MAX_COPY_ROWS_PER_SECTION);
  const lines: string[] = [];
  let dropped = 0;
  for (const e of kept) {
    // Fail-closed: ham cmd/resp string DEĞİLSE maskeleme anlamsızdır → kayıt düşer.
    if (typeof e?.cmd !== 'string' || typeof e?.resp !== 'string') { dropped++; continue; }
    let cmd: string; let resp: string;
    try {
      // (a) OBD'ye özgü maske (VIN yükü · sağlayıcı anahtarı · MAC…).
      const m = maskObdTrafficEntry(e.cmd, e.resp);
      if (!m || typeof m.cmd !== 'string' || typeof m.resp !== 'string') { dropped++; continue; }
      cmd = m.cmd; resp = m.resp;
    } catch { dropped++; continue; }

    const ms = typeof e.ms === 'number' && Number.isFinite(e.ms) ? e.ms : null;
    const ts = typeof e.ts === 'number' && Number.isFinite(e.ts) ? e.ts : null;
    const line = maskUnknown({
      ts, ms,
      txKind: classifyCommand(cmd), cmd,
      rxKind: classifyResponse(cmd, resp), resp,
    });
    if (line === null) { dropped++; continue; }
    lines.push(line);
  }
  return { title, lines, dropped, truncated: kept.length < entries.length };
}

/**
 * HATA KÜTÜĞÜ — T10: artık CANONICAL `crashLogger` kütüğünden beslenir.
 *
 * ESKİ DURUM: kaynak `debugStore.errorLog` idi ve onu besleyen `dbgPushError`in
 * hiç çağıranı yoktu → bölüm YAPISAL olarak boştu, "hata yok" diye okunuyordu.
 * Bölüm bunu dürüstçe ilan ediyordu ama sorun çözülmüyordu. Artık kaynak
 * `getErrorLog()`tur — `trail:error` satırlarıyla AYNI otorite (çift sistem yok).
 *
 * Boşluk hâlâ "hata yok" DEMEK DEĞİLDİR: kütük oturum başında boş olabilir veya
 * okuma patlamış olabilir (o durumda `fromRows` "okunamadı" yazar). Bu ayrım
 * korunur — sessiz "sağlıklı" iddiası ÜRETİLMEZ.
 */
function errorLogSection(rows: readonly unknown[] | null): Section {
  const title = 'HATA KÜTÜĞÜ';
  const base  = fromRows(title, rows, (r) => r);
  if (Array.isArray(rows) && rows.length === 0) {
    return {
      ...base,
      lines: [
        '(kayıt yok — kaynak: crashLogger canonical kütüğü, `trail:error` ile AYNI otorite)',
        '→ boş kütük "hata olmadı" ANLAMINA GELMEZ: oturum yeni olabilir veya kütük temizlenmiş olabilir',
      ],
    };
  }
  return base;
}

/* ── Ana kurucu ───────────────────────────────────────────────────────────── */

export function buildCarosLabCopy(input: CarosLabCopyInput): CarosLabCopyResult {
  const meta = input?.meta;
  const sections: Section[] = [
    fromRows('KATALOG DURUMU', input?.catalog ?? null, (r) => r),
    fromObject('ANLIK ARAÇ VERİSİ', input?.obdData ?? null),
    fromObject('KAYNAK SAĞLIĞI (HAL · null = BİLİNMİYOR)', input?.sourceHealth ?? null),
    /* #526 — yaş bölümü sayaçlardan ÖNCE gelir: okuyucu sayıya bakmadan önce
       hangi ANDAN geldiğini görsün. */
    fromObject('NATIVE SAYAÇ SNAPSHOT YAŞI (#526)', input?.nativeSnapshotAge ?? null),
    /* #535: navigasyon ölçümü — #508 (fixAgeMs) ve #530 (ETA sıçramaları). */
    fromObject('NAVİGASYON ÇEKİRDEĞİ (#508 · fixAgeMs)', input?.navigationCore ?? null),
    /* #537: dağılım AYRI bölümdür — tek anlık örnekle karıştırılmasın. #508
       hükmü burada okunur; nav çekirdeği bölümündeki tek örnek KANIT DEĞİLDİR. */
    fromObject('KONUM FIX YAŞI DAĞILIMI (#537 · #508 hükmü)', input?.fixAgeDistribution ?? null),
    fromObject('ETA SIÇRAMA DEFTERİ (#530)', input?.etaJumps ?? null),
    /* #536: kopma kanıtı — sayaçlardan (kalite/baskı) SONRA değil ÖNCE okunmalı
       ki okuyucu "8 timeout" görmeden önce imzaların ne söylediğini görsün. */
    fromObject('KOPMA KANIT DEFTERİ (#536 · GÖREV A)', input?.linkLosses ?? null),
    fromObject('KAZA ALGILAMA (yalnız sayaç · null = BİLİNMİYOR)', input?.crashDetection ?? null),
    fromObject('OTURUM DENETÇİSİ (ham snapshot)', input?.session ?? null),
    fromObject('ÇALIŞMA ZAMANI ZAMANLAMA (ham snapshot)', input?.scheduling ?? null),
    fromRows('KANITLAR', input?.evidence ?? null, (r) => r),
    obdSection(input?.obdTraffic ?? null),
    fromRows('CAN KÜTÜĞÜ', input?.canRaw ?? null, (r) => r),
    fromRows('KEŞİF GÖZLEMLERİ', input?.discovery ?? null, (r) => r),
    fromRows('BLACKBOX ÖRNEKLERİ (1 Hz)', input?.blackBox ?? null, (r) => r),
    /* #523 — deney sonucu kopyaya GİRER. Sahada bu bölüm yoktu ve gerçek araçta
       koşmuş bir ölçüm dışarı çıkarılamadı. `null` ise "ekran okunmadı" yazılır —
       "deney yok" DİYE OKUNMAMALIDIR. */
    input?.pidTimingExperiment
      ? fromObject('H-A DENEYİ · ATST YANIT SÜRESİ (#518)', input.pidTimingExperiment)
      : unreadable('H-A DENEYİ · ATST YANIT SÜRESİ (#518)',
          'bu oturumda deney ekranı hiç okunmadı — kopya yolu senkrondur, veri ancak '
          + 'ekran bir kez açıldıysa önbellekte olur. "deney koşmadı" ANLAMINA GELMEZ'),
    /* SAHA (2026-07-25): cihaz çıktısında bu bölüm boştu, oysa KANITLAR'da 40+
       `OBD:Reconnect — CONNECT_FAILED` vardı. Sebep: `dbgPushError`in ÇAĞIRANI YOK —
       kanal yapısal olarak boş. "(kayıt yok)" burada "hata olmadı" diye OKUNUR;
       bu YANLIŞ olur. Kanalın ölü olduğu açıkça yazılır. */
    errorLogSection(input?.errorLog ?? null),
  ];

  const dropped   = sections.reduce((a, s) => a + s.dropped, 0);
  let   truncated = sections.some((s) => s.truncated);

  const refs = meta?.captureRefs ?? null;
  const capLine = refs === null
    ? 'yakalama     : BİLİNMİYOR (ref sayacı okunamadı)'
    : `yakalama     : OBD trafiği ${refs.obd > 0 ? 'AÇIK' : 'KAPALI'} (ref ${refs.obd}) · ` +
      `CAN ${refs.can > 0 ? 'AÇIK' : 'KAPALI'} (ref ${refs.can})`;

  /* S2 (#505): kanıt önbelleği bu oturumda hiç tazelenmediyse rapor extended poll (P1-1)
     hakkında hüküm VEREMEZ. Bilinmeyen/okunamayan durum "taze" SAYILMAZ ama "bayat" da
     İDDİA EDİLMEZ — yalnız açıkça `never_refreshed` ise uyarı basılır. */
  const cacheState = meta?.pollEvidenceCacheState ?? null;
  const pollEvidenceStale = cacheState === 'never_refreshed';
  const evidenceLines = pollEvidenceStale
    ? [
      '⚠ UYARI: EXTENDED POLL KANIT ÖNBELLEĞİ BU OTURUMDA HİÇ TAZELENMEDİ.',
      '  Bu kopya senkrondur ve native kanıtı ÇEKMEZ → aşağıdaki extended poll hükmü',
      '  "ölçmedik" demektir, "poll ölü" DEMEZ. Ölçmek için: CAROS LAB → Runtime',
      '  Scheduling ekranını açın, YENİLE yapın, sonra bu kopyayı YENİDEN alın.',
    ]
    : [`kanıt tazeliği: extended poll önbelleği = ${clampTo(String(cacheState ?? 'BİLİNMİYOR'), 40)}`];

  const head = [
    `# CAROS LAB — TAM KOPYA (${CAROS_LAB_COPY_SCHEMA})`,
    `zaman        : ${meta?.generatedAtWallMs ?? 0}`,
    `platform     : ${clampTo(String(meta?.platform ?? 'bilinmiyor'), 120)}`,
    `sürüm        : ${clampTo(String(meta?.appVersion ?? 'bilinmiyor'), 120)}`,
    `kategori     : ${clampTo(String(meta?.category ?? '-'), 120)}`,
    `açık araç    : ${clampTo(String(meta?.activeTool ?? '(katalog)'), 120)}`,
    capLine,
    `maskeleme    : AÇIK (3 kapı) · düşürülen kayıt: ${dropped}`,
    `tavanlar     : ${MAX_COPY_ROWS_PER_SECTION} satır/bölüm · ${MAX_COPY_LINE_CHARS} kr/satır · ` +
      `${MAX_COPY_OBJECT_CHARS} kr/snapshot · toplam ${MAX_COPY_CHARS} kr`,
    'NOT: SALT-OKUNUR kopya. Kaynağı okunamayan bölüm "okunamadı" yazar — boş kabul edilmez.',
    'NOT: "yakalama KAPALI" iken boş trafik bölümü "trafik yoktu" ANLAMINA GELMEZ.',
    ...evidenceLines,
    '',
  ];

  const body: string[] = [];
  for (const s of sections) {
    body.push(`## ${s.title}`);
    if (s.truncated) body.push(`(kırpıldı — yalnız son ${MAX_COPY_ROWS_PER_SECTION} kayıt)`);
    body.push(...s.lines);
    if (s.dropped > 0) body.push(`(fail-closed: ${s.dropped} kayıt maskelenemediği için düşürüldü)`);
    body.push('');
  }

  let text = [...head, ...body].join('\n');
  if (text.length > MAX_COPY_CHARS) {
    truncated = true;
    text = `${text.slice(0, MAX_COPY_CHARS)}\n\n(TOPLAM KARAKTER TAVANI AŞILDI — metin burada kesildi)`;
  }

  return {
    text, sectionCount: sections.length, droppedCount: dropped, truncated,
    chars: text.length, pollEvidenceStale,
  };
}
