/**
 * pdfWriter — bağımlılıksız, SAF PDF 1.4 üreticisi (V-16/1).
 *
 * SAFLIK SÖZLEŞMESİ: I/O YOK · timer YOK · `Date.now()` YOK · ağ YOK ·
 * React importu YOK. Girdi yapısaldır, çıktı `Uint8Array`dır.
 *
 * ── NEDEN KENDİ YAZICIMIZ (ölçüme dayalı karar) ─────────────────────────────
 * Enterprise sayfası **"günlük/haftalık PDF rapor"** vaat ediyordu; gerçekte
 * yalnız `window.print()` vardı (tarayıcı diyaloğunda "PDF olarak kaydet").
 *
 * Kütüphane seçenekleri ölçüldü ve hepsi AYNI duvara çarpıyor: PDF'in
 * **base-14** fontları (Helvetica vb.) **WinAnsi** ile sınırlıdır ve WinAnsi'de
 * Türkçe **`ğ Ğ ı İ ş Ş` YOKTUR**. `pdf-lib` bu karakterlerde HATA FIRLATIR.
 * Tek gerçek çözümler:
 *   (a) ~300 KB'lık bir TTF gömmek — paket boyu + font lisansı yükü, ya da
 *   (b) `/Encoding` `/Differences` ile eksik glifleri adlarıyla eşlemek.
 * (b) seçildi: **sıfır bağımlılık · sıfır lisans riski · birkaç KB'lık dosya.**
 *
 * ── (b)'NİN DÜRÜST SINIRI ───────────────────────────────────────────────────
 * Font GÖMÜLMEZ; görüntüleyici Helvetica'yı kendi sistem fontuyla değiştirir
 * (Arial/Liberation Sans sınıfı). Bu fontlarda Latin Extended-A glifleri
 * (`gbreve` · `dotlessi` · `scedilla` …) BULUNUR, bu yüzden pratikte doğru
 * çizilir. Ama bu bir GARANTİ DEĞİL, yaygın bir gerçektir — glif adları
 * `TURKISH_DIFFERENCES`ta açıkça listelenir ki neye güvendiğimiz görünsün.
 * Kurumsal bir müşteri "font gömülü PDF/A" isterse karar yeniden açılır.
 *
 * ── EŞLEŞMEYEN KARAKTER SESSİZCE DÜŞÜRÜLMEZ ────────────────────────────────
 * Kodlanamayan bir karakter `?` ile DEĞİŞTİRİLİR ve `unmappable` sayacında
 * RAPORLANIR. Sessizce yutmak, raporu fark edilmeden bozardı.
 */

/* ── Türkçe glif eşlemesi ─────────────────────────────────────────────────
 * WinAnsi'de olmayan 6 Türkçe karakter, kullanılmayan kod noktalarına
 * `/Differences` ile bağlanır. Kod noktaları 0x80–0x8F aralığından seçildi
 * (WinAnsi'de bu bölge büyük ölçüde boştur/nadir kullanılır).
 * ───────────────────────────────────────────────────────────────────────── */
export const TURKISH_DIFFERENCES: ReadonlyArray<readonly [number, string, string]> = [
  [0x80, 'gbreve',     'ğ'],
  [0x81, 'Gbreve',     'Ğ'],
  [0x82, 'dotlessi',   'ı'],
  [0x83, 'Idotaccent', 'İ'],
  [0x84, 'scedilla',   'ş'],
  [0x85, 'Scedilla',   'Ş'],
];

/** WinAnsi'de ZATEN bulunan Türkçe karakterler — Differences GEREKTİRMEZ. */
const WINANSI_EXTRA: Readonly<Record<string, number>> = {
  'ç': 0xE7, 'Ç': 0xC7, 'ö': 0xF6, 'Ö': 0xD6, 'ü': 0xFC, 'Ü': 0xDC,
  'â': 0xE2, 'Â': 0xC2, 'î': 0xEE, 'Î': 0xCE, 'û': 0xFB, 'Û': 0xDB,
  '–': 0x96, '—': 0x97, '·': 0xB7, '’': 0x92, '“': 0x93, '”': 0x94, '€': 0x80,
};

/* `€` (0x80) ile `ğ` çakışır — Differences 0x80'i `gbreve`e bağladığı için
   `€` KULLANILAMAZ. Para birimi metinde "TL" olarak yazılır; sessiz bir
   çakışma bırakmamak için burada açıkça iptal edilir. */
const DISABLED = new Set(['€']);

const DIFF_BY_CHAR = new Map<string, number>(
  TURKISH_DIFFERENCES.map(([code, , ch]) => [ch, code]),
);

export interface EncodedText {
  /** PDF literal string gövdesi (kaçışlanmış). */
  readonly body: string;
  /** Eşlenemeyen karakter sayısı — `?` ile değiştirildi, YUTULMADI. */
  readonly unmappable: number;
}

/**
 * Metni PDF literal string'e çevirir.
 *
 * `(`, `)` ve `\` kaçışlanır; 0x80 üstü baytlar sekizlik yazılır (görüntüleyici
 * uyumu için en güvenli biçim).
 */
export function encodePdfText(text: string): EncodedText {
  let body = '';
  let unmappable = 0;

  for (const ch of text) {
    let code: number | undefined;

    if (DISABLED.has(ch)) {
      code = undefined;
    } else if (ch.charCodeAt(0) < 0x80) {
      code = ch.charCodeAt(0);
    } else if (DIFF_BY_CHAR.has(ch)) {
      code = DIFF_BY_CHAR.get(ch);
    } else if (WINANSI_EXTRA[ch] !== undefined) {
      code = WINANSI_EXTRA[ch];
    }

    if (code === undefined) {
      unmappable += 1;
      body += '?';
      continue;
    }

    if (ch === '(' || ch === ')' || ch === '\\') body += `\\${ch}`;
    else if (code < 0x20 || code > 0x7E) body += `\\${code.toString(8).padStart(3, '0')}`;
    else body += String.fromCharCode(code);
  }

  return { body, unmappable };
}

/* ── Belge modeli ─────────────────────────────────────────────────────────── */

export type PdfAlign = 'left' | 'right';

export interface PdfCell {
  readonly text: string;
  readonly align?: PdfAlign;
}

export type PdfBlock =
  | { readonly kind: 'title'; readonly text: string }
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'note'; readonly text: string }
  | { readonly kind: 'spacer'; readonly height: number }
  | {
      readonly kind: 'table';
      readonly headers: readonly string[];
      readonly rows: ReadonlyArray<readonly PdfCell[]>;
      /** Sütun genişlikleri (pt). Uzunluk `headers` ile aynı olmalı. */
      readonly widths: readonly number[];
    };

export interface PdfDocSpec {
  readonly title: string;
  /** Her sayfanın altına yazılır; ÇAĞIRAN üretir (bu modül saat OKUMAZ). */
  readonly footer: string;
  readonly blocks: readonly PdfBlock[];
}

export interface PdfBuildResult {
  /* `ArrayBuffer` ile DARALTILDI: `Uint8Array<ArrayBufferLike>` `SharedArrayBuffer`
     de olabileceği için `BlobPart` kabul etmez ve indirme yolu derlenmez. */
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly pageCount: number;
  /** Belgenin TAMAMINDA eşlenemeyen karakter sayısı. */
  readonly unmappable: number;
}

/* A4, 72 dpi noktalar. */
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;
const LINE = 13;

const FONT_REG = 'F1';
const FONT_BOLD = 'F2';

interface Op { readonly y: number; readonly s: string }

/** Sütunlar arası boşluk (pt) — sağa yaslı metin komşu sütuna DEĞMESİN. */
const GUTTER = 8;

/**
 * Helvetica genişlik yaklaşımı (em birimi).
 *
 * NEDEN TABLO: tek bir "0.5 em ortalama" kullanmak sağa yaslamada metni FAZLA
 * sağa iter ve komşu sütuna bindirir — bu kusur PDF GÖRÜNTÜYE ÇEVRİLİP GÖZLE
 * bakılınca yakalandı ("11,4" ile "2 dk önce" birleşip `11,42 dk önce`
 * görünüyordu). Yapısal testler bunu GÖREMEZ.
 *
 * Tam AFM metriklerini gömmek gerekmedi; sınıf bazlı yaklaşım tablo düzeni
 * için yeterli ve fazla kaydırma YAPMIYOR.
 */
function charEm(ch: string): number {
  if (ch === ' ') return 0.278;
  if (ch >= '0' && ch <= '9') return 0.556;
  if (ch === '.' || ch === ',' || ch === ':' || ch === ';' || ch === "'") return 0.278;
  if (ch === 'i' || ch === 'l' || ch === 'ı' || ch === 'j' || ch === 't' || ch === 'f') return 0.28;
  if (ch === 'm' || ch === 'w') return 0.833;
  if (ch >= 'A' && ch <= 'Z') return 0.68;
  if (ch === '—' || ch === '–') return 0.9;
  return 0.53;
}

export function textWidth(text: string, sizePt: number): number {
  let em = 0;
  for (const ch of text) em += charEm(ch);
  return em * sizePt;
}

/** Metni verilen genişliğe kırpar (gerçek genişlik tahminiyle). */
function fitWidth(text: string, widthPt: number, sizePt: number): string {
  const limit = widthPt - GUTTER;
  if (textWidth(text, sizePt) <= limit) return text;
  let out = '';
  for (const ch of text) {
    if (textWidth(`${out}${ch}…`, sizePt) > limit) break;
    out += ch;
  }
  return `${out}…`;
}

/**
 * Belgeyi PDF baytlarına çevirir.
 *
 * Sayfa taşması OTOMATİK: içerik alt kenara yaklaşınca yeni sayfa açılır.
 * Tablo başlıkları her yeni sayfada TEKRARLANIR — yoksa ikinci sayfadaki
 * sütunlar anlamsız kalırdı.
 */
export function buildPdf(spec: PdfDocSpec): PdfBuildResult {
  const pages: Op[][] = [];
  let ops: Op[] = [];
  let y = PAGE_H - MARGIN;
  let unmappable = 0;

  const esc = (t: string): string => {
    const e = encodePdfText(t);
    unmappable += e.unmappable;
    return e.body;
  };

  const newPage = (): void => { pages.push(ops); ops = []; y = PAGE_H - MARGIN; };
  const need = (h: number): void => { if (y - h < MARGIN + 24) newPage(); };

  const write = (text: string, size: number, font: string, x: number, align: PdfAlign = 'left', width = 0): void => {
    const body = esc(text);
    /* Sağa yaslamada sütunun SAĞ kenarından GUTTER kadar içeride bitir —
       aksi hâlde metin komşu sütunun ilk harfine değer. */
    const xx = align === 'right'
      ? x + Math.max(0, width - GUTTER - textWidth(text, size))
      : x;
    ops.push({ y, s: `BT /${font} ${size} Tf ${xx.toFixed(1)} ${y.toFixed(1)} Td (${body}) Tj ET` });
  };

  for (const b of spec.blocks) {
    if (b.kind === 'spacer') { need(b.height); y -= b.height; continue; }

    if (b.kind === 'title')  { need(26); write(b.text, 16, FONT_BOLD, MARGIN); y -= 24; continue; }
    if (b.kind === 'heading'){ need(20); write(b.text, 11, FONT_BOLD, MARGIN); y -= 18; continue; }
    if (b.kind === 'text')   { need(LINE); write(b.text, 9, FONT_REG, MARGIN); y -= LINE; continue; }
    if (b.kind === 'note')   { need(LINE); write(b.text, 7.5, FONT_REG, MARGIN); y -= LINE - 2; continue; }

    /* ── tablo ── */
    /* BAŞLIK, SÜTUNUN HİZASINI İZLER. Başlığı sola, değeri sağa yaslamak
       sayıyı görsel olarak BİR SONRAKİ sütunun altına düşürüyordu — bu da
       ancak PDF görüntüye çevrilip gözle bakılınca fark edildi. */
    const colAlign = (i: number): PdfAlign => b.rows[0]?.[i]?.align ?? 'left';

    const drawHeader = (): void => {
      let x = MARGIN;
      b.headers.forEach((h, i) => {
        write(fitWidth(h, b.widths[i], 8.5), 8.5, FONT_BOLD, x, colAlign(i), b.widths[i]);
        x += b.widths[i];
      });
      y -= LINE;
      ops.push({ y, s: `${MARGIN} ${(y + 4).toFixed(1)} m ${(PAGE_W - MARGIN)} ${(y + 4).toFixed(1)} l S` });
      y -= 4;
    };

    need(LINE * 3);
    drawHeader();

    for (const row of b.rows) {
      if (y - LINE < MARGIN + 24) { newPage(); drawHeader(); }
      let x = MARGIN;
      row.forEach((c, i) => {
        const w = b.widths[i] ?? 60;
        write(fitWidth(c.text, w, 8.5), 8.5, FONT_REG, x, c.align ?? 'left', w);
        x += w;
      });
      y -= LINE;
    }
    y -= 6;
  }
  pages.push(ops);

  return { bytes: serialize(pages, spec, esc), pageCount: pages.length, unmappable };
}

/* ── PDF serileştirme ─────────────────────────────────────────────────────── */

function serialize(
  pages: readonly Op[][],
  spec: PdfDocSpec,
  esc: (t: string) => string,
): Uint8Array<ArrayBuffer> {
  const diffs = TURKISH_DIFFERENCES.map(([code, name]) => `${code} /${name}`).join(' ');
  const objects: string[] = [];
  const add = (body: string): number => { objects.push(body); return objects.length; };

  /* 1: Catalog · 2: Pages · 3-4: Font · 5: Encoding — sonra sayfa + içerik. */
  const catalogId  = add('<< /Type /Catalog /Pages 2 0 R >>');
  const pagesId    = add('');                                   // sonra doldurulur
  const encodingId = add(`<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [ ${diffs} ] >>`);
  const fontRegId  = add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding ${3} 0 R >>`);
  const fontBoldId = add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding ${3} 0 R >>`);

  const pageIds: number[] = [];
  pages.forEach((ops, idx) => {
    const footer = `${spec.footer}  ·  sayfa ${idx + 1} / ${pages.length}`;
    const stream = [
      '0.15 0.15 0.15 RG 0.5 w',
      ...ops.map((o) => o.s),
      `BT /${FONT_REG} 7 Tf ${MARGIN} ${MARGIN - 12} Td (${esc(footer)}) Tj ET`,
    ].join('\n');

    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /${FONT_REG} ${fontRegId} 0 R /${FONT_BOLD} ${fontBoldId} 0 R >> >> ` +
      `/Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  });

  objects[pagesId - 1] =
    `<< /Type /Pages /Count ${pageIds.length} /Kids [ ${pageIds.map((i) => `${i} 0 R`).join(' ')} ] >>`;

  const infoId = add(`<< /Title (${esc(spec.title)}) /Producer (CarOS Pro) >>`);

  /* Bayt bazlı birleştirme: xref ofsetleri BAYT cinsindendir, karakter değil. */
  const chunks: Uint8Array[] = [];
  const enc = new TextEncoder();
  let offset = 0;
  const push = (s: string): void => { const u = enc.encode(s); chunks.push(u); offset += u.length; };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(offset);
    push(`${i + 1} 0 obj\n${body}\nendobj\n`);
  });

  const xrefAt = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(new ArrayBuffer(offset));
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}
