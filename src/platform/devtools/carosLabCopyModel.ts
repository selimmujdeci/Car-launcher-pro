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
  /** Vehicle HAL kaynak sağlığı — `canAlive/obdAlive/gpsAlive`, null = BİLİNMİYOR. */
  readonly sourceHealth: unknown | null;
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
 * HATA KÜTÜĞÜ — kanal ölüyken "hata olmadı" izlenimi vermez.
 *
 * `debugStore.errorLog`u besleyen `dbgPushError` fonksiyonunun uygulama içinde
 * ÇAĞIRANI YOKTUR (ölü kanal — `debugStore.fallback` ile aynı sınıf). Boş liste
 * bu yüzden "hata yok" DEĞİL, "bu kanal hiç yazılmıyor" demektir. Gerçek hatalar
 * KANITLAR bölümündeki `trail:error` satırlarındadır.
 */
function errorLogSection(rows: readonly unknown[] | null): Section {
  const title = 'HATA KÜTÜĞÜ';
  const base  = fromRows(title, rows, (r) => r);
  if (Array.isArray(rows) && rows.length === 0) {
    return {
      ...base,
      lines: [
        '(kanal ÖLÜ — `dbgPushError` çağrılmıyor; boşluk "hata yok" ANLAMINA GELMEZ)',
        '→ gerçek hatalar için KANITLAR bölümündeki `trail:error` satırlarına bakın',
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
    fromObject('OTURUM DENETÇİSİ (ham snapshot)', input?.session ?? null),
    fromObject('ÇALIŞMA ZAMANI ZAMANLAMA (ham snapshot)', input?.scheduling ?? null),
    fromRows('KANITLAR', input?.evidence ?? null, (r) => r),
    obdSection(input?.obdTraffic ?? null),
    fromRows('CAN KÜTÜĞÜ', input?.canRaw ?? null, (r) => r),
    fromRows('KEŞİF GÖZLEMLERİ', input?.discovery ?? null, (r) => r),
    fromRows('BLACKBOX ÖRNEKLERİ (1 Hz)', input?.blackBox ?? null, (r) => r),
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

  return { text, sectionCount: sections.length, droppedCount: dropped, truncated, chars: text.length };
}
