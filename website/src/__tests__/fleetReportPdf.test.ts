/**
 * fleetReportPdf.test.ts — V-16/1 PDF rapor üretiminin KİLİTLERİ.
 *
 * ── KAPATILAN BOŞLUK ───────────────────────────────────────────────────────
 * Enterprise sayfası **"Günlük/haftalık PDF rapor gönderimi"** vaat ediyordu;
 * gerçekte yalnız `window.print()` vardı — yani kullanıcı tarayıcı diyaloğunda
 * "PDF olarak kaydet" seçmek zorundaydı. Sunucudan/uygulamadan üretilen bir PDF
 * YOKTU.
 *
 * Kilitler dört şeyi korur:
 *  (A) Üretilen baytların GERÇEKTEN geçerli bir PDF olduğu
 *  (B) TÜRKÇE karakterlerin bozulmadığı (asıl teknik risk)
 *  (C) Sahte veri yasağının PDF'e de uygulandığı
 *  (D) Saflık: modülün saat okumadığı / I/O yapmadığı
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildPdf, encodePdfText, textWidth, TURKISH_DIFFERENCES,
} from '@/lib/reports/pdfWriter';
import {
  buildFleetReportPdf, buildFleetReportBlocks, fleetReportFileName,
  type FleetReportInput,
} from '@/lib/reports/fleetReportPdf';

const dec = new TextDecoder('latin1');
const asText = (b: Uint8Array): string => dec.decode(b);

const BASE: FleetReportInput = {
  generatedAtLabel: '22.08.2026 12:00',
  windowDays: 14,
  tally: { total: 3, critical: 1, warning: 1, verified: 1, noEvidence: 0 },
  days: [
    { key: '2026-08-21', critical: 1, warning: 0, info: 2 },
    { key: '2026-08-22', critical: 0, warning: 1, info: 0 },
  ],
  vehicles: [
    { title: 'Şahin Ağır', verdict: 'KRİTİK', batteryVolt: 11.4, lastSeenLabel: '2 dk önce', evidence: 'akü düşük' },
    { title: 'Iğdır Filo 1', verdict: 'KANIT BEKLİYOR', batteryVolt: null, lastSeenLabel: null, evidence: null },
  ],
  logUnreadable: false,
};

/* ══════════════════════════════════════════════════════════════════════════
 * A) GEÇERLİ PDF
 * ═════════════════════════════════════════════════════════════════════════ */
describe('PDF rapor › geçerli belge', () => {
  const out = buildFleetReportPdf(BASE);
  const text = asText(out.bytes);

  it('PDF başlığı ve sonlandırıcısı var', () => {
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('katalog · sayfa ağacı · içerik akışı yerinde', () => {
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Type /Pages');
    expect(text).toContain('/Type /Page ');
    expect(text).toContain('stream');
    expect(text).toContain('endstream');
  });

  it('xref tablosu nesne sayısıyla TUTARLI', () => {
    const size = Number(/\/Size (\d+)/.exec(text)?.[1]);
    const rows = (text.match(/^\d{10} \d{5} n $/gm) ?? []).length;
    /* `/Size` serbest nesneyi (0) de sayar → satır sayısı bir eksik olmalı. */
    expect(rows).toBe(size - 1);
  });

  it('`startxref` ofseti xref tablosunu GERÇEKTEN gösterir', () => {
    const at = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(Number.isFinite(at)).toBe(true);
    /* Ofset BAYT cinsindendir; yanlış hesaplanırsa görüntüleyici belgeyi
       onarmaya çalışır ya da açmaz. */
    expect(text.slice(at, at + 4)).toBe('xref');
  });

  it('her sayfa içeriğinin `/Length` değeri gerçek akış uzunluğu', () => {
    const lengths = [...text.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)];
    expect(lengths.length).toBeGreaterThan(0);
    for (const m of lengths) expect(m[2].length).toBe(Number(m[1]));
  });

  it('çok satırlı içerik yeni sayfaya taşar', () => {
    const many = { ...BASE, days: Array.from({ length: 120 }, (_, i) => ({
      key: `2026-05-${String((i % 28) + 1).padStart(2, '0')}`, critical: i % 3, warning: i % 2, info: i % 5,
    })) };
    const res = buildFleetReportPdf(many);
    expect(res.pageCount).toBeGreaterThan(1);
    /* Taşan tabloda başlık TEKRARLANMALI — yoksa ikinci sayfadaki sütunlar
       anlamsız kalır. */
    const t = asText(res.bytes);
    expect((t.match(/\(Kritik\) Tj/g) ?? []).length).toBeGreaterThan(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * A2) YERLEŞİM — yapısal testlerin GÖREMEDİĞİ kusur sınıfı
 *
 * Bu bölüm, PDF'i GÖRÜNTÜYE ÇEVİRİP GÖZLE bakınca bulunan iki kusuru kilitler.
 * Önceki hâlde tüm yapısal testler YEŞİLDİ ama sayfa görsel olarak BOZUKTU:
 *   · başlıklar sola, değerler sağa yaslıydı → sayılar bir SONRAKİ sütunun
 *     altına düşüyordu
 *   · sağa yaslı sayı komşu sütuna DEĞİYORDU ("11,4" + "2 dk önce" =
 *     ekranda `11,42 dk önce`)
 * ═════════════════════════════════════════════════════════════════════════ */
describe('PDF rapor › yerleşim', () => {
  /** `Td` komutlarından (x, metin) çiftlerini çıkarır. */
  function placements(bytes: Uint8Array): ReadonlyArray<{ x: number; t: string }> {
    return [...asText(bytes).matchAll(/([\d.]+) [\d.]+ Td \(([^)]*)\) Tj/g)]
      .map((m) => ({ x: Number(m[1]), t: m[2] }));
  }

  const doc = buildPdf({
    title: 'T', footer: 'F',
    blocks: [{
      kind: 'table',
      headers: ['Ad', 'Deger'],
      widths: [200, 200],
      rows: [[{ text: 'Arac' }, { text: '11,4', align: 'right' }]],
    }],
  });

  it('BAŞLIK, sütununun HİZASINI izler — sola/sağa ayrışmaz', () => {
    const p = placements(doc.bytes);
    const headerX = p.find((q) => q.t === 'Deger')!.x;
    const valueX = p.find((q) => q.t === '11,4')!.x;
    /* İkisi de sağa yaslı olduğu için SAĞ kenarları çakışmalı. */
    const headerRight = headerX + textWidth('Deger', 8.5);
    const valueRight = valueX + textWidth('11,4', 8.5);
    expect(Math.abs(headerRight - valueRight)).toBeLessThan(1.5);
  });

  it('sağa yaslı metin KOMŞU sütuna DEĞMEZ (gutter korunuyor)', () => {
    const p = placements(doc.bytes);
    const valueX = p.find((q) => q.t === '11,4')!.x;
    const columnRight = 40 + 200 + 200;          // MARGIN + genişlikler
    const end = valueX + textWidth('11,4', 8.5);
    expect(columnRight - end).toBeGreaterThanOrEqual(6);
  });

  it('genişlik tahmini rakamları OLDUĞUNDAN DAR saymaz', () => {
    /* Eski hata tam buydu: 0,5 em ortalama rakamları (0,556 em) dar sayıyor,
       sağa yaslı metni fazla sağa itiyordu. */
    expect(textWidth('11,4', 10)).toBeGreaterThan(4 * 10 * 0.4);
    expect(textWidth('0000', 10)).toBeGreaterThan(textWidth('iiii', 10));
  });

  it('sığmayan metin kırpılır ve taşmaz', () => {
    const wide = buildPdf({
      title: 'T', footer: 'F',
      blocks: [{
        kind: 'table', headers: ['Dar'], widths: [40],
        rows: [[{ text: 'Cok cok cok uzun bir arac adi' }]],
      }],
    });
    const p = placements(wide.bytes);
    const cell = p.find((q) => q.t.includes('Cok'))!;
    expect(cell.t.length).toBeLessThan(20);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B) TÜRKÇE — asıl teknik risk
 * ═════════════════════════════════════════════════════════════════════════ */
describe('PDF rapor › Türkçe karakterler', () => {
  it('WinAnsi\'de olmayan 6 harf `/Differences` ile bağlanır', () => {
    const text = asText(buildFleetReportPdf(BASE).bytes);
    expect(text).toContain('/Differences');
    for (const [, glyph] of TURKISH_DIFFERENCES) expect(text).toContain(`/${glyph}`);
    expect(text).toContain('/BaseEncoding /WinAnsiEncoding');
  });

  it('`ğ Ğ ı İ ş Ş` sekizlik kaçışla kodlanır — düşürülmez', () => {
    for (const [code, , ch] of TURKISH_DIFFERENCES) {
      const e = encodePdfText(ch);
      expect(e.unmappable, `${ch} eşlenemedi`).toBe(0);
      expect(e.body).toBe(`\\${code.toString(8).padStart(3, '0')}`);
    }
  });

  it('WinAnsi\'de ZATEN olan Türkçe harfler Differences GEREKTİRMEZ', () => {
    for (const ch of ['ç', 'Ç', 'ö', 'Ö', 'ü', 'Ü']) {
      expect(encodePdfText(ch).unmappable, `${ch} eşlenemedi`).toBe(0);
    }
  });

  it('gerçek Türkçe metinde HİÇ kayıp yok', () => {
    const res = buildFleetReportPdf(BASE);
    /* Girdide "Şahin Ağır" ve "Iğdır" var — biri bile düşerse rapor bozuk. */
    expect(res.unmappable).toBe(0);
  });

  it('eşlenemeyen karakter SESSİZCE yutulmaz, SAYILIR', () => {
    const e = encodePdfText('日本語');
    expect(e.unmappable).toBe(3);
    expect(e.body).toBe('???');
  });

  it('PDF string kaçış karakterleri bozulmaz', () => {
    expect(encodePdfText('a(b)c\\d').body).toBe('a\\(b\\)c\\\\d');
  });

  it('`€` bilinçli DEVRE DIŞI — 0x80 `gbreve`e ayrıldı', () => {
    /* Sessiz bir kod çakışması bırakmak, para tutarını `ğ` olarak
       çizdirirdi. Açıkça iptal edilir ve sayılır. */
    expect(encodePdfText('€').unmappable).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C) SAHTE VERİ YASAĞI
 * ═════════════════════════════════════════════════════════════════════════ */
describe('PDF rapor › sahte veri yasağı', () => {
  it('ölçülmemiş akü `—` yazılır, `0` YAZILMAZ', () => {
    const blocks = buildFleetReportBlocks(BASE);
    const table = blocks.find((b) => b.kind === 'table' && b.headers.includes('Akü (V)'));
    expect(table).toBeDefined();
    const row = (table as Extract<typeof table, { kind: 'table' }>).rows[1];
    expect(row[2].text).toBe('—');
    expect(row[2].text).not.toBe('0');
    expect(row[3].text).toBe('—');   // son görülme
    expect(row[4].text).toBe('—');   // kanıt
  });

  it('günlük OKUNAMADIYSA "olay yok" DENMEZ', () => {
    const blocks = buildFleetReportBlocks({ ...BASE, logUnreadable: true, days: [] });
    const joined = JSON.stringify(blocks);
    expect(joined).toContain('OKUNAMADI');
    expect(joined).toContain('karıştırılmamalıdır');
    /* Okunamayan günlük için tablo ÇİZİLMEZ — boş tablo "olay yok" gibi okunur. */
    expect(blocks.some((b) => b.kind === 'table' && b.headers.includes('Gün'))).toBe(false);
  });

  it('gerçekten boş pencere, okunamayan pencereden AYRI ifade edilir', () => {
    const blocks = buildFleetReportBlocks({ ...BASE, logUnreadable: false, days: [] });
    expect(JSON.stringify(blocks)).toContain('ölçülmüş bir YOK');
  });

  it('zaman serisi ÖLÇÜM gibi sunulmaz — türetim olduğu yazar', () => {
    const joined = JSON.stringify(buildFleetReportBlocks(BASE));
    expect(joined).toContain('TÜRETİLDİ');
    expect(joined).toContain('İDDİA ETMEZ');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D) SAFLIK
 * ═════════════════════════════════════════════════════════════════════════ */
describe('PDF rapor › saflık', () => {
  const strip = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const WRITER = strip(readFileSync(join(process.cwd(), 'src/lib/reports/pdfWriter.ts'), 'utf8'));
  const REPORT = strip(readFileSync(join(process.cwd(), 'src/lib/reports/fleetReportPdf.ts'), 'utf8'));

  it('modüller saat OKUMAZ — damga çağırandan gelir', () => {
    expect(WRITER).not.toMatch(/Date\.now\(|new Date\(/);
    expect(REPORT).not.toMatch(/Date\.now\(|new Date\(/);
  });

  it('modüller I/O · ağ · timer İÇERMEZ', () => {
    for (const src of [WRITER, REPORT]) {
      expect(src).not.toMatch(/fetch\(|setInterval|setTimeout|require\(|node:fs/);
    }
  });

  it('DIŞ BAĞIMLILIK YOK — lisans yüzeyi büyümedi', () => {
    /* Ticari satış kuralı: her yeni bağımlılık lisans denetimi gerektirir.
       PDF üreticisi bilinçli olarak bağımlılıksızdır. */
    const imports = [...WRITER.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
    expect(imports).toEqual([]);
    const reportImports = [...REPORT.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
    expect(reportImports.every((i) => i.startsWith('.'))).toBe(true);
  });

  it('dosya adı çağıranın tarihini kullanır', () => {
    expect(fleetReportFileName('2026-08-22T10:00:00Z')).toBe('filo-raporu-2026-08-22.pdf');
  });
});
