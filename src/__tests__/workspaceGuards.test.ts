/**
 * workspaceGuards.test.ts — CLAUDE WORKSPACE yapısal kilitleri (W1–W3 + belge borçları).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Workspace, Claude oturumlarının kalıcı çalışma hafızasıdır. Değeri **küçük ve
 * tek-kaynak** kalmasındadır. Bu testler o disiplini "umarız uyulur" bir kural
 * olmaktan çıkarıp CI'da kırılan bir KİLİT hâline getirir:
 *   · satır tavanları (belge şişmesi),
 *   · zorunlu referanslar (giriş kapısı bağlantısını kaybetmesin),
 *   · yasaklı desenler (terminal dökümü / stack trace Workspace'e YAZILMAZ),
 *   · tek aktif görev (aktif görev tek yerde kuralı),
 *   · kütük KOPYALANMAZ, yalnız referans verilir,
 *   · faz sınırı (o fazda oluşturulmaması gereken dosyalar oluşturulmamış olmalı),
 *   · W2: karar kimliği/durumu/tarihi sözleşmesi, sözlükte mükerrer terim yasağı,
 *     okuma sırasında sözlüğün kararlardan ÖNCE gelmesi,
 *   · W3: borç önceliği/durumu/kapanış ölçütü, harita durum sözlüğü, VISION satırının
 *     aktiflik iddiası taşımaması,
 *   · belge borçları: README lisans beyanı (DOC-P0-01), güç yönetimi mevcut↔vizyon
 *     ayrımı (DEBT-005), SAB'ın bilinçli tercih olması (DEC-017).
 *
 * ── TASARIM: KIRILGAN OLMAMALI ──────────────────────────────────────────────
 * Tam paragraf/cümle eşleşmesine BAĞLANMAZ — yalnız başlık, zorunlu dosya
 * referansı, satır tavanı ve yasaklı desen kilitlenir. Metin serbestçe
 * düzenlenebilir; sözleşme bozulmadıkça test yeşil kalır.
 * CRLF/LF farkına ve dosya sonundaki boş satıra karşı dayanıklıdır.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const WS = ['docs', 'workspace'];
const p = (...seg: string[]): string => join(process.cwd(), ...seg);

const START_PATH = p(...WS, '00_START_HERE.md');
const STATE_PATH = p(...WS, '01_STATE.md');
const DEC_PATH = p(...WS, '02_DECISIONS.md');
const DEBT_PATH = p(...WS, '03_DEBT.md');
const MAP_PATH = p(...WS, '04_MAP.md');
const GLOSSARY_PATH = p(...WS, '05_GLOSSARY.md');

/**
 * Workspace çekirdeği W3 ile TAMAMLANDI: yalnız bu altı belge meşrudur.
 * Yeni belge eklemek Workspace'i yeniden "serbest notlar klasörü"ne çevirir (DEC-005).
 */
const ALLOWED_DOCS = [
  '00_START_HERE.md', '01_STATE.md', '02_DECISIONS.md',
  '03_DEBT.md', '04_MAP.md', '05_GLOSSARY.md',
] as const;

/** Belge → satır tavanı (boş satırlar DÂHİL). */
const LINE_CAPS: ReadonlyArray<readonly [string, string, number]> = [
  ['00_START_HERE.md', START_PATH, 80],
  ['01_STATE.md', STATE_PATH, 120],
  ['02_DECISIONS.md', DEC_PATH, 300],
  ['03_DEBT.md', DEBT_PATH, 150],
  ['04_MAP.md', MAP_PATH, 200],
  ['05_GLOSSARY.md', GLOSSARY_PATH, 100],
];

/** Satır sonu normalize + dosya sonundaki boş satırları at → kararlı sayım. */
function readLines(path: string): string[] {
  const raw = readFileSync(path, 'utf-8').replace(/\r\n?/g, '\n');
  const lines = raw.split('\n');
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines;
}

function readText(path: string): string {
  return readFileSync(path, 'utf-8').replace(/\r\n?/g, '\n');
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1-2. Varlık
 * ════════════════════════════════════════════════════════════════════════ */

describe('Workspace — zorunlu belgeler VAR', () => {
  it('00_START_HERE.md mevcut', () => {
    expect(existsSync(START_PATH)).toBe(true);
  });

  it('01_STATE.md mevcut', () => {
    expect(existsSync(STATE_PATH)).toBe(true);
  });

  it('02_DECISIONS.md mevcut', () => {
    expect(existsSync(DEC_PATH)).toBe(true);
  });

  it('05_GLOSSARY.md mevcut', () => {
    expect(existsSync(GLOSSARY_PATH)).toBe(true);
  });

  it('03_DEBT.md mevcut', () => {
    expect(existsSync(DEBT_PATH)).toBe(true);
  });

  it('04_MAP.md mevcut', () => {
    expect(existsSync(MAP_PATH)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3-4. Satır tavanları — Workspace'in ŞİŞMESİNİ engelleyen asıl kilit
 * ════════════════════════════════════════════════════════════════════════ */

describe('Workspace — satır tavanları (boş satırlar DÂHİL)', () => {
  it('00_START_HERE.md ≤ 80 satır', () => {
    const n = readLines(START_PATH).length;
    expect(n, `00_START_HERE.md ${n} satır — tavan 80. Çözüm: içeriği KISALT veya ` +
      'ilgili bölümü doğru role taşı; tavanı YÜKSELTME.').toBeLessThanOrEqual(80);
  });

  it('01_STATE.md ≤ 120 satır', () => {
    const n = readLines(STATE_PATH).length;
    expect(n, `01_STATE.md ${n} satır — tavan 120. Bu belge GÜNLÜK DEĞİLDİR: ` +
      'her oturumda append edilmez, YENİDEN DÜZENLENİR.').toBeLessThanOrEqual(120);
  });

  it('02_DECISIONS.md ≤ 300 satır', () => {
    const n = readLines(DEC_PATH).length;
    expect(n, `02_DECISIONS.md ${n} satır — tavan 300. Append-only bir günlüktür: ` +
      'tavana dayanınca eski kararlar ADR\'ye taşınır, tavan YÜKSELTİLMEZ.',
    ).toBeLessThanOrEqual(300);
  });

  it('05_GLOSSARY.md ≤ 100 satır', () => {
    const n = readLines(GLOSSARY_PATH).length;
    expect(n, `05_GLOSSARY.md ${n} satır — tavan 100. Genel otomotiv sözlüğüne ` +
      'DÖNÜŞMEMELİDİR; yalnız yanlış anlaşılması riskli proje terimleri.',
    ).toBeLessThanOrEqual(100);
  });

  it('03_DEBT.md ≤ 150 satır', () => {
    const n = readLines(DEBT_PATH).length;
    expect(n, `03_DEBT.md ${n} satır — tavan 150. Bu liste BÜYÜMEZ: borç kapanınca ` +
      'kayıt SİLİNİR, arşivlenmez.').toBeLessThanOrEqual(150);
  });

  it('04_MAP.md ≤ 200 satır', () => {
    const n = readLines(MAP_PATH).length;
    expect(n, `04_MAP.md ${n} satır — tavan 200. Harita mimariyi ANLATMAZ; ` +
      'her dosya ayrı satır DEĞİLDİR.').toBeLessThanOrEqual(200);
  });

  it('altı Workspace belgesinin tamamı kendi tavanına uyar', () => {
    for (const [name, path, cap] of LINE_CAPS) {
      const n = readLines(path).length;
      expect(n, `${name} ${n} satır — tavan ${cap}`).toBeLessThanOrEqual(cap);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5-7. Zorunlu referanslar — giriş kapısı bağlantılarını kaybetmesin
 * ════════════════════════════════════════════════════════════════════════ */

describe('00_START_HERE — zorunlu referanslar', () => {
  const src = readText(START_PATH);

  it('01_STATE.md dosyasına referans verir', () => {
    expect(src).toContain('01_STATE.md');
  });

  it('AI.md ve CLAUDE.md dosyalarına referans verir', () => {
    expect(src).toMatch(/\bAI\.md\b/);
    expect(src).toMatch(/\bCLAUDE\.md\b/);
  });

  it('saha kütüğüne (DEVICE_VALIDATION_LEDGER) referans verir', () => {
    expect(src).toContain('docs/DEVICE_VALIDATION_LEDGER.md');
  });

  it('giriş sırasının TEK sahibi olduğunu beyan eder', () => {
    // Kelime kelime eşleşme YOK — yalnız beyanın varlığı kilitli.
    expect(src.toLowerCase()).toMatch(/tek\s+(sahibi|başlangıç|kapı)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8. Kütük KOPYALANMAZ — yalnız referans
 *
 * `docs/project/DEVICE_VALIDATION.md` tam olarak içerik kopyaladığı için kütük
 * 137 maddeye çıkarken geride kaldı. O hata tekrarlanmasın diye kilitli.
 * ════════════════════════════════════════════════════════════════════════ */

describe('01_STATE — saha kütüğü KOPYALANMAZ, işaret edilir', () => {
  const src = readText(STATE_PATH);

  it('kütüğe otorite olarak işaret eder', () => {
    expect(src).toContain('docs/DEVICE_VALIDATION_LEDGER.md');
  });

  it('kütüğün satırları blok hâlinde kopyalanmamış', () => {
    // Kütük satırları `| <no> | **...` biçimindedir. Bir-iki numara referansı
    // serbest; ÜÇ veya daha fazla kütük-biçimli satır KOPYALAMA sayılır.
    const ledgerRows = src.split('\n').filter((l) => /^\|\s*\d+[a-z]?\s*\|\s*\*\*/.test(l));
    expect(ledgerRows.length,
      'Kütük satırları 01_STATE.md içine kopyalanmış. Yalnız NUMARA referansı ver.',
    ).toBeLessThan(3);
  });

  it('kütüğün uzun açıklama metinleri taşınmamış', () => {
    for (const marker of ['NOT DEVICE VALIDATED —', '**KÖK:**', '**EKLENEN:**']) {
      expect(src, `Kütük metni '${marker}' 01_STATE.md'ye kopyalanmamalı`).not.toContain(marker);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9. Yasaklı desenler — terminal dökümü / stack trace Workspace'e YAZILMAZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('Workspace — ham terminal çıktısı ve stack trace YASAK', () => {
  const files: ReadonlyArray<[string, string]> = [
    ['00_START_HERE.md', readText(START_PATH)],
    ['01_STATE.md', readText(STATE_PATH)],
    ['02_DECISIONS.md', readText(DEC_PATH)],
    ['03_DEBT.md', readText(DEBT_PATH)],
    ['04_MAP.md', readText(MAP_PATH)],
    ['05_GLOSSARY.md', readText(GLOSSARY_PATH)],
  ];

  it('stack trace kalıbı yok', () => {
    for (const [name, src] of files) {
      // "    at Something (file:line)" — klasik JS stack satırı
      expect(src, `${name} stack trace içermemeli`).not.toMatch(/^\s+at\s+\S+\s*\(/m);
      expect(src, `${name} stack trace içermemeli`).not.toMatch(/\bError:\s+.*\n\s+at\s/);
    }
  });

  it('ham git/test döküm kalıbı yok', () => {
    for (const [name, src] of files) {
      // `?? path` / ` M path` satır başları = yapıştırılmış `git status --short`
      expect(src, `${name} ham 'git status' dökümü içermemeli`).not.toMatch(/^\?\?\s+\S+\//m);
      expect(src, `${name} ham 'git status' dökümü içermemeli`).not.toMatch(/^\s?M\s+\S+\//m);
      // Vitest özet bloğu
      expect(src, `${name} ham test çıktısı içermemeli`).not.toMatch(/Test Files\s+\d+\s+passed/);
      expect(src, `${name} ham test çıktısı içermemeli`).not.toMatch(/^\s*❯\s+src\//m);
    }
  });

  it('hiçbir Workspace belgesi saha kütüğünü KOPYALAMAZ', () => {
    for (const [name, src] of files) {
      const ledgerRows = src.split('\n').filter((l) => /^\|\s*\d+[a-z]?\s*\|\s*\*\*/.test(l));
      expect(ledgerRows.length,
        `${name} kütük satırlarını kopyalamış — yalnız NUMARA referansı ver ` +
        '(otorite: docs/DEVICE_VALIDATION_LEDGER.md).',
      ).toBeLessThan(3);
      expect(src, `${name} kütük açıklama metni taşımamalı`)
        .not.toContain('NOT DEVICE VALIDATED —');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10. Aktif görev TEK yerde ve TEK tane
 * ════════════════════════════════════════════════════════════════════════ */

describe('01_STATE — tek aktif görev', () => {
  const lines = readLines(STATE_PATH);

  it('yalnız BİR "Aktif görev" başlığı var', () => {
    const headings = lines.filter((l) => /^#{2,3}\s+.*Aktif\s+[Gg]örev/.test(l));
    expect(headings.length,
      `"Aktif görev" başlığı ${headings.length} kez geçiyor — TEK olmalı.`,
    ).toBe(1);
  });

  it('aktif görev başlığının altında görev kimliği var', () => {
    const idx = lines.findIndex((l) => /^#{2,3}\s+.*Aktif\s+[Gg]örev/.test(l));
    expect(idx).toBeGreaterThan(-1);
    const block = lines.slice(idx, idx + 8).join('\n');
    // Kimlik biçimi serbest; sadece BOŞ bırakılmadığı kilitli.
    expect(block.replace(/^#{2,3}.*$/m, '').trim().length).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 11. Faz sınırı — W1'de oluşturulmaması gereken belgeler
 * ════════════════════════════════════════════════════════════════════════ */

describe('Workspace — altı belgelik çekirdek sınırı', () => {
  it('docs/workspace YALNIZ izin verilen altı belgeyi içerir', () => {
    const found = readdirSync(p(...WS)).filter((f) => f.endsWith('.md')).sort();
    expect(found, 'Workspace serbest büyüyen bir notlar klasörü DEĞİLDİR (DEC-005). ' +
      'Yeni bir rol gerçekten gerekiyorsa önce karar kaydı açılır.',
    ).toEqual([...ALLOWED_DOCS].sort());
  });

  it('zorunlu okuma sırası var olmayan bir belgeye yönlendirmez', () => {
    const orderBlock = readingOrderBlock();
    const referenced = orderBlock.match(/docs\/workspace\/[\w.]+\.md/g) ?? [];
    for (const ref of new Set(referenced)) {
      expect(existsSync(join(process.cwd(), ...ref.split('/'))),
        `Zorunlu okuma sırası var olmayan '${ref}' dosyasını gösteriyor.`,
      ).toBe(true);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * FAZ W2 — karar günlüğü ve sözlük kilitleri
 * ════════════════════════════════════════════════════════════════════════ */

/** `## B.` ile `## C.` arasındaki numaralı zorunlu okuma sırası bloğu. */
function readingOrderBlock(): string {
  const src = readText(START_PATH);
  const from = src.indexOf('## B.');
  const to = src.indexOf('## C.');
  return src.slice(from, to > from ? to : undefined);
}

describe('00_START_HERE — W2 okuma sırası', () => {
  it('05_GLOSSARY.md, 02_DECISIONS.md dosyasından ÖNCE okutulur', () => {
    const block = readingOrderBlock();
    const g = block.indexOf('05_GLOSSARY.md');
    const d = block.indexOf('02_DECISIONS.md');
    expect(g, 'Zorunlu okuma sırası 05_GLOSSARY.md içermeli').toBeGreaterThan(-1);
    expect(d, 'Zorunlu okuma sırası 02_DECISIONS.md içermeli').toBeGreaterThan(-1);
    expect(g, 'Önce DİL (sözlük), sonra KARARLAR okunur — sıra ters çevrilmemeli.')
      .toBeLessThan(d);
  });

  it('sözlük ve kararlar AI.md/CLAUDE.md ÖNCESİNDE gelir', () => {
    const block = readingOrderBlock();
    expect(block.indexOf('02_DECISIONS.md')).toBeLessThan(block.indexOf('AI.md'));
  });

  it('altı Workspace belgesinin tamamı zorunlu sırada, doğru düzende', () => {
    const block = readingOrderBlock();
    const order = ['00_START_HERE.md', '01_STATE.md', '05_GLOSSARY.md',
      '02_DECISIONS.md', '03_DEBT.md', '04_MAP.md'];
    const at = order.map((f) => {
      const i = block.indexOf(f);
      expect(i, `Zorunlu okuma sırası '${f}' içermeli`).toBeGreaterThan(-1);
      return i;
    });
    for (let k = 1; k < at.length; k += 1) {
      expect(at[k], `Okuma sırası bozuk: ${order[k]} ${order[k - 1]} sonrasında gelmeli`)
        .toBeGreaterThan(at[k - 1] as number);
    }
    // Borç, haritadan ÖNCE okunur: önce "ne açık", sonra "ne bağlı".
    expect(block.indexOf('03_DEBT.md')).toBeLessThan(block.indexOf('04_MAP.md'));
  });
});

describe('03_DEBT — açık borç sözleşmesi', () => {
  const lines = readLines(DEBT_PATH);
  const ids = lines
    .map((l) => /^##\s+(DEBT-\d{3})\s+—\s+\S/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m[1] as string);

  it('en az bir borç kaydı DEBT-XXX kimlik biçiminde', () => {
    expect(ids.length).toBeGreaterThan(0);
  });

  it('borç kimlikleri benzersiz', () => {
    expect(new Set(ids).size, `Mükerrer DEBT kimliği: ${ids.join(', ')}`).toBe(ids.length);
  });

  it('öncelikler yalnız P0–P3', () => {
    const allowed = new Set(['P0', 'P1', 'P2', 'P3']);
    const rows = lines.filter((l) => /^-\s*Öncelik:/.test(l));
    expect(rows.length, 'Her DEBT kaydı bir "Öncelik:" satırı taşımalı').toBe(ids.length);
    for (const l of rows) {
      const v = l.replace(/^-\s*Öncelik:\s*/, '').trim();
      expect(allowed.has(v), `İzinsiz öncelik: '${v}'`).toBe(true);
    }
  });

  it('durumlar yalnız OPEN / BLOCKED / FIELD_VALIDATION_REQUIRED / HUMAN_DECISION_REQUIRED', () => {
    const allowed = new Set(['OPEN', 'BLOCKED', 'FIELD_VALIDATION_REQUIRED',
      'HUMAN_DECISION_REQUIRED']);
    const rows = lines.filter((l) => /^-\s*Durum:/.test(l));
    expect(rows.length, 'Her DEBT kaydı bir "Durum:" satırı taşımalı').toBe(ids.length);
    for (const l of rows) {
      const v = l.replace(/^-\s*Durum:\s*/, '').trim();
      expect(allowed.has(v), `İzinsiz borç durumu: '${v}'`).toBe(true);
    }
  });

  it('kapanmış borç BURADA TUTULMAZ (DONE durumu yok)', () => {
    for (const l of lines.filter((l) => /^-\s*Durum:/.test(l))) {
      expect(l, 'Kapanan borç SİLİNİR — "DONE" ile bırakılmaz.').not.toMatch(/\bDONE\b/);
    }
  });

  it('her borçta kapanış ölçütü var', () => {
    const rows = lines.filter((l) => /^-\s*Kapanış ölçütü:/.test(l));
    expect(rows.length, 'Kapanış ölçütü olmayan borç, kapanamayan borçtur.').toBe(ids.length);
    for (const l of rows) {
      expect(l.replace(/^-\s*Kapanış ölçütü:\s*/, '').trim().length,
        `Boş kapanış ölçütü: ${l}`).toBeGreaterThan(10);
    }
  });

  it('aktif görev bu belgeye TAŞINMAZ', () => {
    const headings = lines.filter((l) => /^#{2,3}\s+.*Aktif\s+[Gg]örev/.test(l));
    expect(headings.length, 'Aktif görev yalnız 01_STATE.md içindedir.').toBe(0);
  });

  it('kapanan borçlar listeden ÇIKARILDI ve kalanlar yeniden numaralandırılmadı', () => {
    expect(ids, 'DEBT-001 (README lisans) kapandı → aktif listede kalmamalı.')
      .not.toContain('DEBT-001');
    expect(ids, 'DEBT-005 (Battery Protection durumu) kapandı → aktif listede kalmamalı.')
      .not.toContain('DEBT-005');
    // Kimlik sabitliği: kapanan kayıt silinince kalanlar KAYMAZ.
    for (const id of ['DEBT-002', 'DEBT-006', 'DEBT-010']) {
      expect(ids, `${id} kimliği korunmalı — kapanan borç sonrası yeniden ` +
        'numaralandırma YASAK.').toContain(id);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * DOC-P0-01 — README lisans beyanı depo lisansıyla tutarlı kalır
 *
 * README bir dönem projeyi MIT ilan ediyordu; depo `LICENSE-PROPRIETARY.md` ile
 * tescilli/kapalı kaynak. Bu KİLİT, o hukuki çelişkinin sessizce geri gelmesini
 * engeller. Bağımlılıkların kendi MIT lisansları bu kilidin konusu DEĞİLDİR.
 * ════════════════════════════════════════════════════════════════════════ */

describe('README — lisans beyanı (DOC-P0-01)', () => {
  const readmePath = p('README.md');
  const src = readText(readmePath);

  it('projeyi MIT lisanslı ilan eden rozet/ifade YOK', () => {
    expect(src, 'MIT rozeti geri gelmiş — depo tescilli/kapalı kaynaktır.')
      .not.toMatch(/License[:\s-]+MIT/i);
    expect(src, 'MIT dağıtım cümlesi geri gelmiş.')
      .not.toMatch(/(distributed|licen[sc]ed|released)\s+under\s+the\s+MIT/i);
    expect(src, 'SPDX MIT beyanı eklenmiş.')
      .not.toMatch(/SPDX-License-Identifier:\s*MIT/i);
  });

  it('gerçek lisans belgesine referans verir', () => {
    expect(src, 'README lisans bölümü LICENSE-PROPRIETARY.md dosyasını göstermeli.')
      .toContain('LICENSE-PROPRIETARY.md');
  });

  it('tescilli / kapalı kaynak statüsünü açıkça belirtir', () => {
    expect(src, 'README projenin tescilli-kapalı kaynak olduğunu YAZMALI.')
      .toMatch(/proprietary/i);
    expect(src).toMatch(/closed[-\s]?source|kapalı kaynak/i);
  });

  it('depo köküne açık kaynak `LICENSE` dosyası eklenmemiş (DOC-P0-01)', () => {
    // LICENSE-PROPRIETARY.md meşrudur; çıplak `LICENSE` açık kaynak izlenimi yaratır.
    expect(existsSync(p('LICENSE')),
      'Kökte `LICENSE` dosyası var — lisans otoritesi LICENSE-PROPRIETARY.md olmalı.',
    ).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * DEBT-005 — Güç yönetimi: uygulanan katman ile vizyon katmanı KARIŞTIRILMAZ
 *
 * `BatteryProtectionService` gerçek, koşulsuz boot'a bağlı bir servistir; belgeler
 * bir dönem onu "YOK" gösteriyordu. Smart/Continuous Surveillance ise kodda YOKTUR.
 * Bu kilitler İKİ YÖNLÜ çalışır: mevcut katman "yok" gösterilemez, olmayan katmanlar
 * "mevcut" gösterilemez. Kontroller ilgili TABLO SATIRINA bağlanır — belgede tek
 * başına geçen 'ACTIVE' kelimesi kilidi geçemez.
 * ════════════════════════════════════════════════════════════════════════ */

describe('Güç yönetimi — mevcut ↔ vizyon ayrımı (DEBT-005)', () => {
  /** `| Terim | ... |` satırını bul; hücreleri döndür (0. eleman baştaki boşluk). */
  function rowCells(src: string, term: string): string[] {
    const line = src.split('\n').find((l) => {
      const first = l.split('|')[1];
      return first !== undefined && first.trim().startsWith(term);
    });
    expect(line, `'${term}' için tablo satırı bulunamadı`).toBeDefined();
    return (line as string).split('|').map((c) => c.trim());
  }

  const glossary = readText(GLOSSARY_PATH);
  const vision = readText(p('docs', 'CAROS_PRO_VIZYONU.md'));

  const ACTIVE_CLAIM = /\bACTIVE\b|\bWIRED\b|\bMEVCUT\b|\bIMPLEMENTED\b/i;
  const VISION_CLAIM = /\bVİZYON\b|\bVISION\b/i;

  it('sözlük: Battery Protection MEVCUT/ACTIVE olarak tanımlı', () => {
    const def = rowCells(glossary, 'Battery Protection')[2] ?? '';
    expect(def, 'Battery Protection sözlükte mevcut/aktif gösterilmeli.')
      .toMatch(ACTIVE_CLAIM);
    expect(def, 'Battery Protection "YOK" gösterilemez — servis boot\'ta kayıtlı.')
      .not.toMatch(/\bYOK\b/i);
    expect(def, 'Battery Protection yalnız VİZYON olarak gösterilemez.')
      .not.toMatch(VISION_CLAIM);
  });

  it('sözlük: Smart ve Continuous Surveillance aktif GİBİ sunulmaz', () => {
    for (const term of ['Smart Surveillance', 'Continuous Surveillance']) {
      const def = rowCells(glossary, term)[2] ?? '';
      expect(def, `${term} kodda YOK — aktiflik iddiası taşıyamaz.`)
        .not.toMatch(ACTIVE_CLAIM);
      expect(def, `${term} açıkça VİZYON olarak işaretlenmeli.`).toMatch(VISION_CLAIM);
    }
  });

  it('sözlük: üç terim AYNI satırda gruplanmaz (yanlış çıkarım engeli)', () => {
    const grouped = glossary.split('\n').filter((l) => {
      const first = l.split('|')[1] ?? '';
      return /Battery Protection/i.test(first) && /Surveillance/i.test(first);
    });
    expect(grouped.length,
      'Battery Protection ile Surveillance modları aynı satırda gruplanmış — ' +
      'bu, uygulanan katmanla vizyon katmanını tek statüye çeker.',
    ).toBe(0);
  });

  it('vizyon: Battery Protection artık YOK durumunda değil', () => {
    const status = rowCells(vision, 'Battery Protection')[2] ?? '';
    expect(status, `Vizyon durum tablosu Battery Protection'ı '${status}' gösteriyor; ` +
      'servis boot\'a bağlı — kod esastır.').not.toMatch(/^YOK$/i);
  });

  it('vizyon: Surveillance modları Battery Protection\'tan AYRI ve YOK', () => {
    for (const term of ['Smart Surveillance', 'Continuous Surveillance']) {
      const status = rowCells(vision, term)[2] ?? '';
      expect(status, `${term} kodda bulunamadı — durumu YOK kalmalı.`).toMatch(/^YOK$/i);
    }
  });

  it('hiçbir Workspace belgesi üç modlu güç sisteminin TAMAMLANDIĞINI iddia etmez', () => {
    for (const path of [GLOSSARY_PATH, MAP_PATH]) {
      const src = readText(path);
      const line = src.split('\n').find((l) => /Surveillance/i.test(l) && ACTIVE_CLAIM.test(l.split('|')[2] ?? ''));
      expect(line, `Surveillance satırı aktiflik iddiası taşıyor: ${line}`).toBeUndefined();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * DEBT-002-REVIEW — SharedArrayBuffer politikası kalıcıdır
 *
 * SAB'ın üretimde kapalı olması ÜRÜN SAHİBİ ONAYLI bir tercihtir (DEC-017).
 * Bu kilitler iki yanlışı birden engeller:
 *   (a) SAB'ın ölü/bozuk kod ya da tek başına teknik borç gösterilmesi,
 *   (b) "SAB kapalı" gerekçesinin runtime bütçe borcunun YERİNE geçmesi.
 * ════════════════════════════════════════════════════════════════════════ */

describe('SAB politikası — bilinçli tercih, borç değil (DEC-017)', () => {
  /** Belgedeki tüm `## DEC-0xx` bloklarını ayır. */
  function decisionBlocks(src: string): string[] {
    const lines = src.split('\n');
    const starts: number[] = [];
    lines.forEach((l, i) => { if (/^##\s+DEC-\d{3}/.test(l)) starts.push(i); });
    return starts.map((s, k) => lines.slice(s, starts[k + 1] ?? lines.length).join('\n'));
  }

  /**
   * Türkçe büyük harf katlaması. JS'te `/i` bayrağı `İ` (U+0130) → `i` eşlemesi
   * YAPMAZ; bu yüzden "ZORUNLU DEĞİLDİR" gibi büyük harfli metinler kaçar.
   */
  function foldTr(s: string): string {
    return s
      .replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ğ/g, 'ğ')
      .replace(/Ş/g, 'ş').replace(/Ç/g, 'ç').replace(/Ö/g, 'ö').replace(/Ü/g, 'ü')
      .toLowerCase();
  }

  // SAB'a değinen TÜM kararlar — kimliğe veya başlık metnine bağlanmaz.
  const sabBlocks = decisionBlocks(readText(DEC_PATH))
    .filter((b) => /SharedArrayBuffer|\bSAB\b/i.test(b));

  /** SAB kararlarından EN AZ BİRİ bu kuralı yazmalı (Türkçe-katlamalı arama). */
  function someSabDecision(re: RegExp): string | undefined {
    return sabBlocks.find((b) => re.test(foldTr(b)));
  }

  it('SAB hakkında en az bir kalıcı karar kayıtlı', () => {
    expect(sabBlocks.length, 'SAB politikası karar günlüğünde yok.').toBeGreaterThan(0);
  });

  it('karar: SAB üretim için ZORUNLU DEĞİL ve karar ACTIVE', () => {
    const b = someSabDecision(/zorunlu\s+değil/);
    expect(b, 'Bir SAB kararı "zorunlu değil" demeli.').toBeDefined();
    expect(b as string, 'Bu karar ACTIVE olmalı.')
      .toMatch(/^-\s*Durum:\s*ACTIVE\s*$/m);
  });

  it('karar: SAB kodu KALDIRILMAZ', () => {
    expect(someSabDecision(/kaldırılm|silinm/),
      'Bir SAB kararı kodun silinmeyeceğini belirtmeli.').toBeDefined();
  });

  it('karar: gelecekte yeniden değerlendirme kapısı açık', () => {
    expect(someSabDecision(/yeniden\s+değerlendir/),
      'Bir SAB kararı yeniden değerlendirme kapısını açık tutmalı.').toBeDefined();
  });

  it('karar: `hasSAB === false` tek başına borç sayılmaz', () => {
    expect(someSabDecision(/hassab/),
      'Bir SAB kararı, SAB yokluğunun tek başına hata/borç OLMADIĞINI yazmalı.')
      .toBeDefined();
  });

  it('sözlük: SAB bozuk/ölü kod gibi gösterilmez', () => {
    const def = readText(GLOSSARY_PATH).split('\n')
      .find((l) => (l.split('|')[1] ?? '').trim() === 'SAB');
    expect(def, 'Sözlükte SAB satırı bulunamadı').toBeDefined();
    const cell = (def as string).split('|')[2] ?? '';
    expect(cell, 'SAB DEAD/BROKEN/kaldırılacak gibi gösterilemez.')
      .not.toMatch(/\bDEAD\b|\bBROKEN\b|bozuk|kald[ıi]r[ıi]lacak/i);
    expect(cell, 'SAB\'ın bilinçli tercih olduğu sözlükte görünmeli.')
      .toMatch(/bilin[çc]li|DEC-017/i);
  });

  it('harita: SAB DISABLED ve bunun bilinçli politika olduğu yazılı', () => {
    const row = readText(MAP_PATH).split('\n')
      .find((l) => /^\|\s*SAB\b/.test(l.trim()));
    expect(row, 'Haritada SAB satırı bulunamadı').toBeDefined();
    const cells = (row as string).split('|').map((c) => c.trim());
    expect(cells[2], 'SAB durumu DISABLED olmalı (DEAD değil).').toBe('DISABLED');
    expect(cells.slice(3).join(' '), 'Bilinçli politika olduğu belirtilmeli.')
      .toMatch(/bilin[çc]li/i);
  });

  it('borç listesi: yalnız "SAB kapalı" gerekçesiyle borç tutulmaz', () => {
    const src = readText(DEBT_PATH);
    for (const line of src.split('\n')) {
      if (!/^##\s+DEBT-\d{3}/.test(line)) continue;
      expect(line, `Borç başlığı SAB'ın kapalı olmasını borç gibi sunuyor: ${line}`)
        .not.toMatch(/SAB.*(kapal[ıi]|yok|devre d[ıi][şs][ıi])/i);
    }
  });
});

describe('04_MAP — modül haritası sözleşmesi', () => {
  const lines = readLines(MAP_PATH);
  const ALLOWED_STATUS = ['ACTIVE', 'WIRED', 'SHADOW', 'PARTIAL', 'SKELETON',
    'DISABLED', 'DARK', 'DEAD', 'VISION', 'UNKNOWN'] as const;
  /** Modül satırları: en az 4 kolonlu, ayraç olmayan tablo satırları. */
  const rows = lines.filter((l) => {
    const t = l.trim();
    if (!t.startsWith('|') || /^\|[\s:|-]+\|$/.test(t)) return false;
    return t.split('|').length >= 5 && !/^\|\s*(Alan|Terim)\b/.test(t);
  });

  it('çekirdek durum ayrımları belgede tanımlı', () => {
    const src = readText(MAP_PATH);
    for (const s of ['ACTIVE', 'WIRED', 'SHADOW', 'DARK', 'VISION', 'UNKNOWN']) {
      expect(src, `'${s}' durumunun anlamı haritada tanımlı olmalı`).toContain(s);
    }
    // Not: Türkçe locale'de toLocaleLowerCase('tr') 'I' → 'ı' yapar; bu yüzden
    // düz metin araması yerine locale-bağımsız regex kullanılır.
    expect(src, 'Import edilmiş olmanın aktiflik kanıtı OLMADIĞI kuralı korunmalı')
      .toMatch(/import/i);
  });

  it('durum kolonunda yalnız izin verilen değerler var', () => {
    const bad: string[] = [];
    for (const r of rows) {
      const status = (r.split('|')[2] ?? '').trim();
      if (status.length === 0) continue;
      if (!(ALLOWED_STATUS as readonly string[]).includes(status)) bad.push(status);
    }
    expect(bad, `İzinsiz durum değeri: ${bad.join(', ')}`).toHaveLength(0);
  });

  it('her modül satırı kanıt/giriş noktası taşır', () => {
    const empty: string[] = [];
    for (const r of rows) {
      const cells = r.split('|').map((c) => c.trim());
      // cells[1]=ad, cells[2]=durum; kalan kolonlarda en az bir dolu kanıt alanı olmalı.
      const evidence = cells.slice(3, -1).filter((c) => c.length > 0 && c !== '—');
      if (evidence.length === 0) empty.push(cells[1] ?? r);
    }
    expect(empty, `Kanıtsız modül satırı: ${empty.join(', ')}`).toHaveLength(0);
  });

  it('VISION satırları aktiflik iddiası taşımaz', () => {
    for (const r of rows) {
      const cells = r.split('|').map((c) => c.trim());
      if ((cells[2] ?? '') !== 'VISION') continue;
      const rest = cells.slice(3).join(' ');
      expect(rest, `VISION satırı aktif/bağlı iddiası taşıyor: ${cells[1]}`)
        .not.toMatch(/\bACTIVE\b|\bWIRED\b/);
    }
  });
});

describe('02_DECISIONS — karar günlüğü sözleşmesi', () => {
  const src = readText(DEC_PATH);
  const lines = readLines(DEC_PATH);
  const ids = lines
    .map((l) => /^##\s+(DEC-\d{3})\s+—\s+\S/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m[1]);

  it('resmî mimari otoritesi olarak docs/adr/ referansı verir', () => {
    expect(src, 'ADR otoritesi kaybolursa iki paralel karar kaynağı doğar.')
      .toContain('docs/adr/');
  });

  it('en az bir karar kaydı DEC-XXX kimlik biçiminde', () => {
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/^DEC-\d{3}$/);
  });

  it('karar kimlikleri benzersiz', () => {
    expect(new Set(ids).size, `Mükerrer DEC kimliği: ${ids.join(', ')}`).toBe(ids.length);
  });

  it('her kararda MUTLAK tarih (YYYY-AA-GG) var', () => {
    const dateLines = lines.filter((l) => /^-\s*Tarih:/.test(l));
    expect(dateLines.length, 'Her DEC kaydı bir "Tarih:" satırı taşımalı')
      .toBeGreaterThanOrEqual(ids.length);
    for (const l of dateLines) {
      expect(l, `Göreli tarih YASAK ("dün", "geçen hafta"): ${l}`)
        .toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  it('durum değerleri yalnız ACTIVE / SUPERSEDED / PROVISIONAL', () => {
    const allowed = new Set(['ACTIVE', 'SUPERSEDED', 'PROVISIONAL']);
    const statusLines = lines.filter((l) => /^-\s*Durum:/.test(l));
    expect(statusLines.length).toBe(ids.length);
    for (const l of statusLines) {
      const v = l.replace(/^-\s*Durum:\s*/, '').trim();
      expect(allowed.has(v), `İzinsiz durum değeri: '${v}' (${l})`).toBe(true);
    }
  });

  it('aktif görev bu belgeye TAŞINMAZ (tek sahibi 01_STATE.md)', () => {
    const headings = lines.filter((l) => /^#{2,3}\s+.*Aktif\s+[Gg]örev/.test(l));
    expect(headings.length,
      'Aktif görev yalnız 01_STATE.md içinde tutulur — karar günlüğü değildir.',
    ).toBe(0);
  });

  it('saha kütüğünün satırları buraya kopyalanmamış', () => {
    const ledgerRows = lines.filter((l) => /^\|\s*\d+[a-z]?\s*\|\s*\*\*/.test(l));
    expect(ledgerRows.length, 'Kütük satırları kopyalanmış — yalnız NUMARA referansı ver.')
      .toBeLessThan(3);
  });
});

describe('05_GLOSSARY — sözlük sözleşmesi', () => {
  const lines = readLines(GLOSSARY_PATH);
  /** Ayraç satırı (`|---|`) hariç tablo satırları. */
  const rows = lines.filter((l) => l.trimStart().startsWith('|') && !/^\|[\s:|-]+\|$/.test(l.trim()));
  const terms = rows
    .map((l) => l.split('|')[1]?.trim() ?? '')
    .filter((t) => t.length > 0 && !/^Terim$/i.test(t));

  it('zorunlu çekirdek terimler tanımlı', () => {
    const src = readText(GLOSSARY_PATH);
    const core = ['CAROS PRO', 'Mavi', 'CAROS LAB', 'Zero-Trust', 'Fail-Closed',
      'Shadow', 'Takeover', 'DeviceTier', 'OBD-II', 'ECU', 'PID', 'DID', 'DTC',
      'Deep Scan', 'SAB', 'VCOMP', 'TMR', 'Arabam Cebimde'];
    for (const t of core) {
      expect(src, `Çekirdek terim '${t}' sözlükte tanımlı olmalı`).toContain(t);
    }
  });

  it('terimler mükerrer tanımlanmamış', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const t of terms) {
      const k = t.toLocaleLowerCase('tr');
      if (seen.has(k)) dupes.push(t);
      seen.add(k);
    }
    expect(dupes, `Mükerrer terim: ${dupes.join(', ')}`).toHaveLength(0);
  });

  it('HEDEF ile MEVCUT ayrımı açıkça korunur', () => {
    const src = readText(GLOSSARY_PATH).toLocaleUpperCase('tr');
    expect(src, 'Sözlük vizyondaki şeyi mevcut özellik gibi tanımlamamalı — ' +
      'HEDEF/VİZYON ayrımı metinde görünür olmalı.').toMatch(/HEDEF|VİZYON/);
  });

  it('uzun paragraflara dönüşmemiş (tablo kalır, makale olmaz)', () => {
    const prose = lines.filter((l) => {
      const t = l.trim();
      return t.length > 0 && !t.startsWith('|') && !t.startsWith('#') && !t.startsWith('>');
    });
    expect(prose.length,
      `Sözlükte ${prose.length} serbest metin satırı var — tanımlar TABLODA kalmalı, ` +
      'uzun mimari açıklama otoriter belgeye bırakılmalı.',
    ).toBeLessThanOrEqual(6);
    for (const l of lines) {
      expect(l.length, `Satır ${l.length} karakter — tanım fazla uzun: ${l.slice(0, 60)}…`)
        .toBeLessThanOrEqual(400);
    }
  });
});
