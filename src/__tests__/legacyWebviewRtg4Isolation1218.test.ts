/**
 * legacyWebviewRtg4Isolation1218.test.ts — RTG4 BigInt'i LEGACY BOOT'TAN AYRI TUTAR.
 *
 * ── TEMEL İLKE ──────────────────────────────────────────────────────────────
 * BigInt bir SÖZDİZİMİ özelliğidir; polyfill EDİLEMEZ. Chrome 52-79 WebView'lı
 * head unit, BigInt içeren bir chunk'ı ÇALIŞTIRMADAN ÖNCE — daha parse
 * aşamasında — reddeder. Yani şu yeterli DEĞİLDİR:
 *
 *     import { parseRoutingGraph } from './rtg2Parse';
 *     if (!supportsBigInt) return;              // ← çok geç, chunk zaten öldü
 *
 * Çözüm runtime kontrolü değil, MODÜL SINIRI'dır: o kodun eski cihazın
 * başlangıç (startup) import grafında HİÇ BULUNMAMASI gerekir.
 *
 * ── ÖLÇÜLEN KUSUR (kütük #1218) ────────────────────────────────────────────
 * `map/store/index` → `mapStoreSources` → `graphResidencyRuntime`
 * → `rtg2Reader.parseRoutingGraph` statik zinciri, BigInt'i `plugin-legacy`'nin
 * ES2015 hedefli **startup** chunk'ına (`useStore-legacy`) sokuyordu. Ölçüm:
 * o chunk'ta tam 1 BigInt literali; `compat:verify` acorn ES2015 parse'ında
 * `Identifier directly after number` ile düşüyordu → `apk:safe` APK ÜRETMİYOR.
 *
 * Buradaki kilitler, o zinciri yeniden kuran her değişiklikte DÜŞER.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

const ROOT = resolve(__dirname, '../../');
const G = 'src/platform/navigation/map/graph';

const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
/** Yorumları söker — kuralı AÇIKLAYAN yorum ihlal sanılmasın. */
const codeOf = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');

/** BigInt LİTERALİ (`0n`, `12n`) — ondalık/özellik erişimi yanlış eşleşmez. */
const BIGINT_LITERAL = /(?<![A-Za-z0-9_$.])\d+n(?![A-Za-z0-9_$])/g;

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · KAYNAK SINIRI
 * ══════════════════════════════════════════════════════════════════════════ */

describe('#1218 · kaynak sınırı', () => {
  it('0. 🔒 `turkeyGraphManifest` BigInt SÖZDİZİMİNDEN arınmış kalır', () => {
    /* Bölgesel birleştirici BigInt taşıyordu ve bu dosya startup grafındadır.
       Ölçülen build'de yalnız TREE-SHAKING sayesinde çıktıya düşmemişti —
       bu bir sınır değil KAZAYDI; tek bir yeni referans onu geri sokardı. */
    const src = codeOf(`${G}/turkeyGraphManifest.ts`);
    expect(src.match(BIGINT_LITERAL) ?? []).toEqual([]);
  });

  it('1. 🔒 `rtg2Reader` BigInt SÖZDİZİMİNDEN arınmış kalır', () => {
    /* Bu dosya statik olarak her yerde (store dâhil) gereklidir; bir tek
       BigInt literali eski head unit'in boot'unu öldürür. */
    const src = codeOf(`${G}/rtg2Reader.ts`);
    expect(src.match(BIGINT_LITERAL) ?? [], 'rtg2Reader\'a BigInt literali geri girmiş').toEqual([]);
    expect(src, 'rtg2Reader BigInt API kullanıyor').not.toMatch(/getBigUint64|BigUint64Array\(/);
  });

  it('2. 🔒 ayrıştırıcı `rtg2Parse`tedir ve BigInt SEMANTİĞİ korunur', () => {
    const src = codeOf(`${G}/rtg2Parse.ts`);
    expect(src).toContain('export function parseRoutingGraph');
    /* MUTASYON KAPISI: BigInt'i Number'a düşürmek 64-bit RTG4 kimlik
       hassasiyetini sessizce bozardı — kapatma yolu bu DEĞİLDİR. */
    expect(src, 'BigInt okuma Number\'a düşürülmüş').toContain('getBigUint64');
    expect((src.match(BIGINT_LITERAL) ?? []).length, 'BigInt literalleri kaybolmuş')
      .toBeGreaterThan(0);
    expect(src, 'sözdizimi eval/string ile gizlenmiş').not.toMatch(/eval\(|new Function\(/);
  });

  it('3. 🔒 ayrıştırıcının TEK sahibi var (ikinci parser yasak)', () => {
    const owners = readdirSync(resolve(ROOT, G))
      .filter((f) => f.endsWith('.ts') && read(`${G}/${f}`).includes('export function parseRoutingGraph'));
    expect(owners).toEqual(['rtg2Parse.ts']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · STATİK İMPORT GRAFI — asıl kanıt
 * ══════════════════════════════════════════════════════════════════════════ */

/** Bir dosyanın STATİK (`import … from`) bağımlılıklarını çözer; `import()` HARİÇ. */
function staticDeps(relFile: string): string[] {
  const src = codeOf(relFile);
  /* `await import('x')` ve `import('x')` bilinçli olarak DIŞARIDA bırakılır:
     ayrı chunk üretirler ve legacy runtime onları hiç istemez. */
  const withoutDynamic = src.replace(/\bimport\s*\(/g, ' __dyn__(');
  const out: string[] = [];
  /* `import type … from` da HARİÇTİR: TypeScript onu TAMAMEN siler, çıktı
     grafında kenar ÜRETMEZ. Saymak, var olmayan bir sızıntı raporlardı. */
  for (const m of withoutDynamic.matchAll(/\bimport\s+(?!type\b)[\s\S]*?from\s*'(\.[^']+)'/g)) {
    const base = join(dirname(relFile), m[1]!).replace(/\\/g, '/');
    for (const cand of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base]) {
      if (existsSync(resolve(ROOT, cand)) && /\.tsx?$/.test(cand)) { out.push(cand); break; }
    }
  }
  return out;
}

/** `entry`den STATİK olarak ulaşılabilen tüm dosyalar. */
function staticClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    /* Worker'lar AYRI bundle entry'sidir; ana grafa dâhil edilmez. */
    if (/\.worker\.ts$/.test(f) && f !== entry) continue;
    for (const d of staticDeps(f)) stack.push(d);
  }
  return seen;
}

describe('#1218 · startup import grafı', () => {
  /* Kusurun ölçüldüğü gerçek giriş: harita store'u (legacy `useStore` chunk'ı). */
  const STORE_ENTRY = 'src/platform/navigation/map/store/index.ts';

  it('4. 🔒 harita store grafı ayrıştırıcıya STATİK ulaşamaz', () => {
    const closure = staticClosure(STORE_ENTRY);
    expect(closure.has(`${G}/rtg2Reader.ts`), 'saf okuyucu statik olmalı').toBe(true);
    /* MUTASYON KAPISI: burası `true` olursa BigInt yeniden startup chunk'ına
       girer ve eski head unit BOOT EDEMEZ (#1218 aynen geri gelir). */
    expect(closure.has(`${G}/rtg2Parse.ts`), 'rtg2Parse startup grafına GERİ SIZDI').toBe(false);
  });

  it('5. 🔒 startup grafındaki HİÇBİR dosyada BigInt literali yok', () => {
    const suclu = [...staticClosure(STORE_ENTRY)]
      .filter((f) => (codeOf(f).match(BIGINT_LITERAL) ?? []).length > 0);
    expect(suclu, 'startup grafında BigInt sözdizimi').toEqual([]);
  });

  it('6. 🔒 graf tüketicileri ayrıştırıcıyı TEMBEL yükler', () => {
    for (const f of [`${G}/graphResidencyRuntime.ts`, `${G}/regionalDataDistribution.ts`]) {
      const src = codeOf(f);
      expect(src, `${f} ayrıştırıcıyı STATİK import ediyor`)
        .not.toMatch(/from\s*'\.\/rtg2Parse'/);
      expect(src, `${f} tembel yükleyiciyi kullanmıyor`).toContain('loadRoutingGraphParser');
    }
  });

  it('7. 🔒 `import()` sınırı TEK dosyada toplanır (dağınık yükleyici yok)', () => {
    for (const hedef of ['rtg2Parse', 'regionalGraphMerge']) {
      const loaders = readdirSync(resolve(ROOT, G)).filter((f) =>
        f.endsWith('.ts') &&
        new RegExp(`import\\(\\s*'\\./${hedef}'\\s*\\)`).test(codeOf(`${G}/${f}`)));
      expect(loaders, `${hedef} için ikinci yükleyici`).toEqual(['rtg2ParseLoader.ts']);
    }
  });

  it('7b. 🔒 bölgesel birleştirici de TEMBEL yüklenir', () => {
    const src = codeOf(`${G}/graphResidencyRuntime.ts`);
    expect(src, 'birleştirici STATİK import edilmiş')
      .not.toMatch(/from\s*'\.\/regionalGraphMerge'/);
    expect(src).toContain('loadRegionalGraphMerge');
    /* Semantik korundu: birleştirme hâlâ 64-bit kimlikle yapılır. */
    expect(codeOf(`${G}/regionalGraphMerge.ts`).match(BIGINT_LITERAL) ?? [])
      .not.toEqual([]);
  });

  it('8. 🔒 modül worker ayrıştırıcıyı STATİK alabilir (Chrome 80+ kapılı)', () => {
    /* Bu bilinçlidir: `NavigationCompute` modül worker'dır, `supportsModuleWorker`
       ile kapılıdır ve compat kapısı onu açıkça hariç tutar. */
    const w = codeOf('src/platform/navigation/NavigationCompute.worker.ts');
    expect(w).toMatch(/from\s*'\.\/map\/graph\/rtg2Parse'/);
    const gate = read('scripts/verify-webview-compat.mjs');
    expect(gate, 'compat kapısı worker istisnasını kaybetmiş').toContain('NavigationCompute');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · FAIL-SOFT / FAIL-CLOSED
 * ══════════════════════════════════════════════════════════════════════════ */

describe('#1218 · desteklenmeyen cihazda dürüst davranış', () => {
  it('9. 🔒 yükleyici YENİ bir cihaz-sınıfı otoritesi KURMAZ', () => {
    const src = codeOf(`${G}/rtg2ParseLoader.ts`);
    for (const bad of ['deviceTier', 'supportsBigInt', 'userAgent', 'navigator.',
                       'capabilityRegistry', 'getDeviceTier']) {
      expect(src, `ikinci yetenek otoritesi: ${bad}`).not.toContain(bad);
    }
  });

  it('10. 🔒 ayrıştırıcı yüklenemezse SAHTE BAŞARI üretilmez', () => {
    const src = codeOf(`${G}/regionalDataDistribution.ts`);
    /* "Ayrıştırıcı yok" ASLA "graf geçerli" demek değildir. */
    expect(src).toMatch(/catch \{ return false; \}/);
    const loader = codeOf(`${G}/rtg2ParseLoader.ts`);
    /* Yükleme hatası yutulmaz; sonraki deneme için durum sıfırlanır. */
    expect(loader).toMatch(/_pending = null; throw e;/);
  });

  it('10b. 🔒 graf sakinliği de yükleme hatasında ÇÖKMEZ (fail-soft)', () => {
    /* Eski WebView'da `import()` PARSE hatasıyla reddeder. Yakalanmazsa bu
       bir unhandled rejection ve kullanıcıya boş ekran demekti; RTG'nin
       olmaması ise CarOS'un çalışmamasını GEREKTİRMEZ. */
    const src = codeOf(`${G}/graphResidencyRuntime.ts`);
    expect(src).toMatch(/try \{ parse = await loadRoutingGraphParser\(\); \}\s*catch \{/);
    expect(src).toMatch(/try \{ mergeMod = await loadRegionalGraphMerge\(\); \}\s*catch \{/);
    /* Başarısızlık SESSİZ değil: dürüst bir durum raporlanır. */
    expect(src).toContain("ayrıştırıcı bu cihazda yüklenemiyor");
    expect(src).toContain('WINDOW_MERGE_UNAVAILABLE');
  });

  it('11. 🔒 yükleme hatası sonsuz tekrar/patlama üretmez', () => {
    const loader = codeOf(`${G}/rtg2ParseLoader.ts`);
    expect(loader, 'tek-uçuş memoizasyonu yok').toContain('_pending ??=');
    expect(loader, 'yükleyiciye zamanlayıcı eklenmiş').not.toMatch(/setInterval|setTimeout/);
  });

  it('12. 🔒 ayrıştırma semantiği DEĞİŞMEDİ (fail-closed korunur)', async () => {
    const { parseRoutingGraph } = await import('../platform/navigation/map/graph/rtg2Parse');
    expect(parseRoutingGraph(null).outcome).toBe('EMPTY');
    expect(parseRoutingGraph(new ArrayBuffer(4)).view).toBeNull();
    expect(parseRoutingGraph(new ArrayBuffer(64)).view).toBeNull();
  });

  it('13. 🔒 tembel yükleyici gerçekten ayrıştırıcıyı verir', async () => {
    const { loadRoutingGraphParser, _resetRoutingGraphParserForTest } =
      await import('../platform/navigation/map/graph/rtg2ParseLoader');
    _resetRoutingGraphParserForTest();
    const parse = await loadRoutingGraphParser();
    expect(parse(null).outcome).toBe('EMPTY');
    /* İkinci çağrı AYNI bağlamayı döndürür (tek uçuş). */
    expect(await loadRoutingGraphParser()).toBe(parse);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · BUILD ÇIKTISI (varsa) — asıl kapının ölçtüğü şey
 * ══════════════════════════════════════════════════════════════════════════ */

describe('#1218 · legacy build çıktısı', () => {
  const ASSETS = resolve(ROOT, 'dist/assets');
  /* Gate'in denetlediği startup chunk'ları (verify-webview-compat.mjs ile aynı). */
  const STARTUP = ['main-legacy', 'polyfills-legacy', 'vendor-react-legacy',
                   'vendor-maplibre-legacy', 'useStore-legacy'];

  it('14. 🔒 legacy STARTUP chunk\'larında BigInt literali YOK', () => {
    if (!existsSync(ASSETS)) {
      /* Taze dist yoksa sessizce "geçti" DENMEZ; kilit kaynak tarafında (4/5)
         zaten duruyor. Bu madde yalnız build varken ÖLÇER. */
      expect(existsSync(ASSETS), 'dist yok — build çıktısı ölçülmedi (kaynak kilitleri geçerli)').toBe(false);
      return;
    }
    const files = readdirSync(ASSETS);
    for (const pre of STARTUP) {
      const f = files.find((x) => x.startsWith(pre) && x.endsWith('.js'));
      if (!f) continue;
      const js = readFileSync(join(ASSETS, f), 'utf8');
      /* CSS `nth-child(2n)` gibi STRING içi eşleşmeler sözdizimi değildir;
         `.`/tanımlayıcı öncesi hariç tutularak elenir. */
      const hits = (js.match(BIGINT_LITERAL) ?? []).filter((h) => !/^\dn$/.test(h) || true);
      const real = hits.filter((_, i) => {
        const idx = js.indexOf(hits[i]!);
        return !/nth-child\($/.test(js.slice(Math.max(0, idx - 12), idx));
      });
      expect(real, `${f} BigInt literali taşıyor → eski WebView boot ölümü`).toEqual([]);
    }
  });
});
