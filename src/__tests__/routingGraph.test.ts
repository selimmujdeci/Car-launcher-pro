/**
 * routingGraph.test.ts — V-05 çevrimdışı rota grafiği KİLİTLERİ.
 *
 * İKİ AYRI ŞEYİ KİLİTLER:
 *  (A) ÜRETİLEN VERİ — `public/maps/routing-graph.bin` gerçekten var, RTG2
 *      biçiminde, boş değil, yol sınıfı taşıyor ve boyut bütçesini aşmıyor.
 *  (B) WORKER SÖZLEŞMESİ — flags baytının yorumu, sınıf→hız tablosu ve
 *      sezgisel ağırlığı; bunlar sessizce değişirse ETA veya rota bozulur.
 *
 * (B) kaynak METNİ üzerinden kilitlenir: worker bir WebWorker modülüdür ve
 * jsdom'da import edilemez; ama sözleşme sabitleri metinden okunabilir ve
 * ÜRETİCİ ile aynı olmak ZORUNDADIR — ikisi ayrışırsa mesafe/süre sessizce yanlışlanır.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { stripComments } from './helpers';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const GRAPH_PATH = 'public/maps/routing-graph.bin';
const GRAPH_MAGIC_V2 = 0x32475452; // 'RTG2'

/** APK bütçesi: grafik tek başına bu sınırı aşarsa paket şişer. */
const MAX_GRAPH_MB = 24;

const graphExists = existsSync(resolve(process.cwd(), GRAPH_PATH));

/* ══════════════════════════════════════════════════════════════════════════
 * A) ÜRETİLEN VERİ
 * ═════════════════════════════════════════════════════════════════════════ */
describe('routingGraph › üretilen veri', () => {
  it('grafik dosyası VAR — yoksa çevrimdışı rota kuş uçuşuna düşer', () => {
    expect(graphExists, `${GRAPH_PATH} bulunamadı — "node scripts/build-routing-graph.mjs --in <pbf>" koşulmalı`).toBe(true);
  });

  it.runIf(graphExists)('RTG2 sihirli sayısını taşır ve boş değildir', () => {
    const buf = readFileSync(resolve(process.cwd(), GRAPH_PATH));
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(view.getUint32(0, true)).toBe(GRAPH_MAGIC_V2);

    const nodeCount = view.getUint32(4, true);
    expect(nodeCount).toBeGreaterThan(10_000);

    const edgeOff = 8 + nodeCount * 16;
    const edgeCount = view.getUint32(edgeOff, true);
    expect(edgeCount).toBeGreaterThan(10_000);

    /* Dosya boyutu, başlıkta beyan edilen sayılarla BİREBİR uyuşmalı —
       uyuşmazsa parse ortada taşar ve worker sessizce `null` döner. */
    expect(buf.length).toBe(4 + 4 + nodeCount * 16 + 4 + edgeCount * 13);
  });

  it.runIf(graphExists)('kenarlar YOL SINIFI taşır — yoksa ETA sabit hıza düşer', () => {
    const buf = readFileSync(resolve(process.cwd(), GRAPH_PATH));
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const nodeCount = view.getUint32(4, true);
    let off = 8 + nodeCount * 16;
    const edgeCount = view.getUint32(off, true); off += 4;

    const hist = new Array(8).fill(0);
    const sample = Math.min(edgeCount, 50_000);
    for (let i = 0; i < sample; i++) {
      const flags = view.getUint8(off + i * 13 + 12);
      hist[(flags >> 1) & 0x07] += 1;
    }
    /* Sınıfsız (UNKNOWN=0) kenarlar tüm örneklemi kaplamamalı. */
    expect(hist[0]).toBeLessThan(sample);
    /* En az bir hızlı sınıf bulunmalı (motorway/trunk) — yoksa şehirlerarası
       rota gerçekçi süre üretemez. */
    expect(hist[1] + hist[2]).toBeGreaterThan(0);
  });

  it.runIf(graphExists)('APK boyut bütçesini aşmaz', () => {
    const mb = statSync(resolve(process.cwd(), GRAPH_PATH)).size / 1048576;
    expect(mb).toBeLessThan(MAX_GRAPH_MB);
  });

  it.runIf(graphExists)('ODbL lisans dosyası grafiğin YANINDA durur', () => {
    const p = resolve(process.cwd(), 'public/maps/routing-graph.license.txt');
    expect(existsSync(p)).toBe(true);
    const txt = readFileSync(p, 'utf8');
    expect(txt).toMatch(/OpenStreetMap/);
    expect(txt).toMatch(/ODbL/);
  });

  it('ODbL atfı KULLANICIYA gösterilir (yalnız dosyada durması YETMEZ)', () => {
    const s = read('src/components/settings/SettingsPage.tsx');
    expect(s).toMatch(/© OpenStreetMap katkıcıları/);
    /* Rota grafiği türetilmiş bir veritabanıdır; atıf onu da KAPSAMALI. */
    expect(s).toMatch(/çevrimdışı rota grafiği/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B) WORKER ↔ ÜRETİCİ SÖZLEŞMESİ
 * ═════════════════════════════════════════════════════════════════════════ */
describe('routingGraph › worker sözleşmesi', () => {
  const worker = stripComments(read('src/platform/navigation/NavigationCompute.worker.ts'));
  const builder = stripComments(read('scripts/build-routing-graph.mjs'));
  /* NAV-V3-F4/1 (kütük #1232): RTG2 ayrıştırma tek otoriteye taşındı — magic
     sayı ve flags-bit yorumu artık BURADA yaşıyor, worker yalnız import eder.
     Kilit taşınan koda yeniden bağlanır (kaldırılmaz — CLAUDE.md "kör guard"). */
  const rtg2Reader = stripComments(read('src/platform/navigation/map/graph/rtg2Reader.ts'));

  it('sihirli sayı okuyucu ve üreticide AYNIDIR', () => {
    expect(rtg2Reader).toMatch(/0x32475452/);
    expect(builder).toMatch(/0x32475452/);
  });

  it('flags baytı: bit 0 oneway, bit 1-3 yol sınıfı (iki tarafta da)', () => {
    expect(rtg2Reader).toMatch(/edgeFlags\[ordinal\] & 0x01/);
    expect(rtg2Reader).toMatch(/\(view\.edgeFlags\[ordinal\] >> 1\) & 0x07/);
    expect(builder).toMatch(/\(w\.oneway \? 1 : 0\) \| \(\(w\.cls & 0x07\) << 1\)/);
  });

  it('sınıf→hız tablosu 8 girdilidir ve UNKNOWN eski sabiti korur', () => {
    /* Kilit DEĞERLERE bakar, yorumlara DEĞİL: `stripComments` zaten
       `// 0 UNKNOWN` etiketlerini söker; yorum metnine dayanan bir kilit
       hem yanlış yeşil hem yanlış kırmızı verirdi. */
    const m = worker.match(/ROAD_CLASS_SPEED_MS[^=]*=\s*\[([\s\S]*?)\]/);
    expect(m, 'ROAD_CLASS_SPEED_MS tablosu bulunamadı').not.toBeNull();

    const entries = m![1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const kmh = s.match(/^([\d.]+)\s*\/\s*3\.6$/);
        return kmh ? Number(kmh[1]) : NaN;
      });

    expect(entries).toHaveLength(8);
    expect(entries.every((v) => Number.isFinite(v) && v > 0)).toBe(true);
    /* İndeks 0 = UNKNOWN → eski 30 km/h sabiti KORUNMALI (geriye uyum:
       sınıfsız eski grafikler bu değişiklikle sessizce hızlanmamalı). */
    expect(entries[0]).toBe(30);
    /* Otoyol şehir içinden HIZLI olmalı, yoksa sınıf ayrımı anlamsızdır. */
    expect(entries[1]).toBeGreaterThan(entries[0]);
    expect(entries[1]).toBeGreaterThanOrEqual(90);
  });

  it('SÜRE kenar başına sınıf hızıyla toplanır — tek sabitle DEĞİL', () => {
    /* NAV-V3-F4/1: A* traversalı `edge` nesnesi yerine view-tabanlı okumaya
       geçti (`costM` yerel değişkeni + `edgeRoadClass(graph.view, ordinal)`
       erişimcisi) — anlam AYNI (kenar başına sınıf hızıyla toplama), sözdizimi
       taşındı. Kilit güncel erişim biçimine yeniden bağlanır. */
    expect(worker).toMatch(/durationS \+= _edgeSeconds\(costM, edgeRoadClass\(graph\.view, ordinal\), graph\.version\)/);
    /* Eski hata deseni geri gelmemeli: tüm mesafeyi tek ortalamaya bölmek. */
    expect(worker).not.toMatch(/durationS: distanceM \/ AVG_ROUTE_SPEED_MS,\s*\n\s*steps: \[\],\s*\n\s*\}\);\s*\n\s*\} catch/);
  });

  it('MESAFE kenardan okunur — seyreltilmiş düğümlerden TÜRETİLMEZ', () => {
    /* Üretici ara düğümleri seyreltir; iki düğüm arasını haversine ile ölçmek
       kıvrımlı yolu sistematik olarak KISA gösterir. */
    expect(worker).toMatch(/distanceM \+= costM/);
  });

  it('sezgisel ağırlığı 1.0 DEĞİL (düşük-uçta uzun rota bulunabilsin)', () => {
    const m = worker.match(/const HEURISTIC_WEIGHT = ([\d.]+);/);
    expect(m, 'HEURISTIC_WEIGHT bulunamadı').not.toBeNull();
    const w = Number(m![1]);
    expect(w).toBeGreaterThan(1.0);
    /* Çok büyütmek rotayı sessizce uzatır — ölçülen takas W=1.2'de %2,5'ti. */
    expect(w).toBeLessThanOrEqual(1.5);
    expect(worker).toMatch(/HEURISTIC_WEIGHT \* _havM\(/);
  });

  it('doğrulayıcı worker ile AYNI ağırlığı kullanır (yoksa yeşili anlamsız)', () => {
    const v = stripComments(read('scripts/verify-routing-graph.mjs'));
    const wv = v.match(/const HEURISTIC_WEIGHT = ([\d.]+);/);
    const ww = worker.match(/const HEURISTIC_WEIGHT = ([\d.]+);/);
    expect(wv).not.toBeNull();
    expect(Number(wv![1])).toBe(Number(ww![1]));
  });

  it('üretici ürün kodundan import EDİLMEZ (build-zamanı aracı)', () => {
    /* KODA bakar, belgeye DEĞİL: worker'ın başlık yorumu üreticiyi ADIYLA
       anmak ZORUNDA (izlenebilirlik) — o anma bir import değildir. */
    const hits = [
      'src/platform/navigation/NavigationCompute.worker.ts',
      'src/platform/navigation/routingService.ts',
    ].filter((p) => existsSync(resolve(process.cwd(), p)))
      .map((p) => stripComments(read(p)))
      .filter((s) => /build-routing-graph/.test(s));
    expect(hits).toHaveLength(0);
  });
});
