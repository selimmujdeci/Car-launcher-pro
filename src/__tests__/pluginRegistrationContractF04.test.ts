/**
 * pluginRegistrationContractF04.test.ts — MRI F-04 · CAPACITOR PLUGIN KAYIT SÖZLEŞMESİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ÖLÇÜLEN KUSUR (bu turda HEAD üzerinde doğrulandı)
 *
 * `VehicleHALPlugin` uygulanmıştı, `@CapacitorPlugin(name="VehicleHAL")`
 * taşıyordu, üç `@PluginMethod`'u vardı ve TS tarafında ÜRETİM ÇAĞIRANI da
 * vardı:
 *
 *   SystemBoot → startVehicleDataLayer → VehicleSignalResolver
 *     → new NativeHALAdapter() → VehicleHAL.startHAL()
 *
 * …ama `MainActivity.onCreate()` içindeki `registerPlugin(...)` listesinde
 * YOKTU. Uygulamaya ait (npm paketi olmayan) plugin'ler `capacitor.plugins.json`
 * ile OTOMATİK kaydedilmez — o dosya yalnız npm plugin paketlerini taşır.
 * Sonuç: köprü 'VehicleHAL' adını hiç çözemiyor, AAOS VHAL veri kaynağı
 * sessizce yok sayılıyordu.
 *
 * ── NEDEN DERLEME VE TİP SİSTEMİ BUNU YAKALAYAMADI ────────────────────────
 * Java sınıfı derlenir, TS arayüzü tip olarak geçerlidir, `registerPlugin()`
 * bir Proxy döndürür. Üç yüzey de tek başına "sağlıklı" görünür; kırık olan
 * YALNIZ aralarındaki bağdır. Bu dosya o bağı ölçer.
 *
 * ── KANIT SEVİYESİ (dürüstlük) ────────────────────────────────────────────
 * Bu dosya ÜÇ YÜZEY ARASI YAPISAL SÖZLEŞME'dir: TS kaynağı ↔ Java kaynağı ↔
 * MainActivity kayıt listesi. Kayıt listesi üyeliği doğası gereği kaynak
 * düzeyindedir (çağrılar `onCreate` gövdesindedir; yansımayla görülemez,
 * görebilmek için gerçek Activity + Capacitor Bridge ayağa kaldırmak gerekir).
 *
 * DERLENMİŞ gerçeklik ayrı dosyada kanıtlanır:
 *   android/app/src/test/java/com/cockpitos/pro/CapacitorPluginRegistrationContractTest.java
 *   (annotation çalışma zamanında var mı, `name` değeri ne, metod imzası
 *    Capacitor'ın çözebileceği biçimde mi)
 *
 * Hiçbiri CİHAZ kanıtı değildir: gerçek head-unit'te köprünün plugin'i
 * çözdüğü ayrıca doğrulanmalıdır.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';

const ROOT          = process.cwd();
const MAIN_ACTIVITY = resolve(ROOT, 'android/app/src/main/java/com/cockpitos/pro/MainActivity.java');
const ANDROID_SRC   = resolve(ROOT, 'android/app/src/main');
const TS_SRC        = resolve(ROOT, 'src');

/** Capacitor `Plugin` tabanından miras alınan yüzey — plugin kendi yazmaz. */
const CAPACITOR_BASE = new Set([
  'addListener', 'removeAllListeners', 'checkPermissions', 'requestPermissions',
]);

/**
 * CarLauncher metod yüzeyi F-10'da AYRICA ve DAHA DERİN ölçülüyor
 * (`nativeBridgeContractF10.test.ts`: zorunlu/isteğe bağlı ayrımı + karantina).
 * Burada tekrarlamak aynı değişmezin ikinci kopyası olurdu.
 */
const METHOD_CONTRACT_OWNED_ELSEWHERE = new Set(['CarLauncher']);

// ── Saf çıkarıcılar (mutasyon testleri de bunları kullanır) ──────────────────

/** `MainActivity.onCreate` içindeki kanonik kayıt listesi (sınıf adları). */
export function registeredPluginClasses(mainActivitySrc: string): string[] {
  return [...mainActivitySrc.matchAll(/registerPlugin\(\s*([A-Za-z0-9_.]+)\.class\s*\)/g)]
    .map((m) => m[1].split('.').pop() as string);
}

/** Java kaynağından `@CapacitorPlugin(name=…)` + sınıf adı + `@PluginMethod` yüzeyi. */
export function javaPlugin(javaSrc: string): { name: string; cls: string; methods: string[] } | null {
  const head = javaSrc.match(/@CapacitorPlugin\s*\(([\s\S]*?)\)\s*public\s+class\s+([A-Za-z0-9_]+)/);
  if (!head) return null;
  const nm = head[1].match(/name\s*=\s*"([^"]+)"/);
  if (!nm) return null;
  const methods = [...javaSrc.matchAll(
    /@PluginMethod[^\n]*\n(?:\s*@[^\n]*\n)*\s*public\s+void\s+([A-Za-z0-9_]+)\s*\(/g,
  )].map((m) => m[1]);
  return { name: nm[1], cls: head[2], methods };
}

/** TS `registerPlugin<IFACE>('NAME')` beyanları. */
export function tsRegistrations(tsSrc: string, file: string): { name: string; iface: string; file: string }[] {
  return [...tsSrc.matchAll(/registerPlugin<\s*([A-Za-z0-9_]+)\s*>\(\s*'([^']+)'/g)]
    .map((m) => ({ iface: m[1], name: m[2], file }));
}

/** Bir TS arayüzünün üyeleri: `{ ad, isteğe bağlı mı }`. */
export function tsInterfaceMembers(tsSrc: string, iface: string): { name: string; optional: boolean }[] {
  const i = tsSrc.indexOf(`interface ${iface} {`);
  if (i < 0) return [];
  const end = tsSrc.indexOf('\n}', i);
  const body = tsSrc.slice(i, end < 0 ? undefined : end);
  return [...body.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*)(\?)?\s*(?:\(|<)/gm)]
    .map((m) => ({ name: m[1], optional: m[2] === '?' }));
}

// ── Gerçek dosya yüzeyi ─────────────────────────────────────────────────────

function walk(dir: string, match: (f: string) => boolean, skipTests = false): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (skipTests && (entry === '__tests__' || entry === 'node_modules')) continue;
      out.push(...walk(p, match, skipTests));
    } else if (match(entry)) out.push(p);
  }
  return out;
}

const MAIN_SRC   = readFileSync(MAIN_ACTIVITY, 'utf8');
const REGISTERED = registeredPluginClasses(MAIN_SRC);

/** name → { cls, methods } */
const JAVA_PLUGINS = new Map<string, { cls: string; methods: string[] }>();
for (const f of walk(ANDROID_SRC, (n) => n.endsWith('.java'))) {
  const p = javaPlugin(readFileSync(f, 'utf8'));
  if (p) JAVA_PLUGINS.set(p.name, { cls: p.cls, methods: p.methods });
}

/** TS beyanları (aynı ad birden çok dosyada olabilir — ilk beyan temsil eder). */
const TS_PLUGINS = new Map<string, { iface: string; file: string }>();
for (const f of walk(TS_SRC, (n) => /\.tsx?$/.test(n), true)) {
  for (const r of tsRegistrations(readFileSync(f, 'utf8'), f)) {
    if (!TS_PLUGINS.has(r.name)) TS_PLUGINS.set(r.name, { iface: r.iface, file: r.file });
  }
}

// ── Ölçüm gerçekten çalışıyor mu? ───────────────────────────────────────────

describe('F-04 · plugin yüzeyleri ölçülebiliyor', () => {
  it('TS beyanları, Java plugin\'leri ve kayıt listesi OKUNABİLDİ', () => {
    /* Regex bozulup boş küme dönerse aşağıdaki sözleşmeler HİÇBİR ŞEY
       kanıtlamadan yeşil olurdu — sahte güvenin ta kendisi. */
    expect(TS_PLUGINS.size,   'TS registerPlugin beyanı bulunamadı').toBeGreaterThanOrEqual(4);
    expect(JAVA_PLUGINS.size, 'Java @CapacitorPlugin sınıfı bulunamadı').toBeGreaterThanOrEqual(4);
    expect(REGISTERED.length, 'MainActivity kayıt listesi okunamadı').toBeGreaterThanOrEqual(4);
  });
});

// ── F-04 ÇEKİRDEĞİ: BEYAN EDİLEN HER PLUGIN KAYITLI ─────────────────────────

describe('F-04 · TS\'te beyan edilen her plugin KAYIT OTORİTESİNDE yer alır', () => {
  it('her `registerPlugin(\'X\')` için MainActivity\'de kayıt vardır', () => {
    const unregistered: string[] = [];
    for (const [name, ts] of TS_PLUGINS) {
      const java = JAVA_PLUGINS.get(name);
      if (!java) continue;   // ad sözleşmesi ayrı testte raporlanır
      if (!REGISTERED.includes(java.cls)) {
        unregistered.push(`${name} (${java.cls}) ← ${ts.file.slice(ROOT.length + 1).split(sep).join('/')}`);
      }
    }
    expect(
      unregistered,
      'TS bu plugin\'i çağırıyor, Java sınıfı var — ama MainActivity kayıt listesinde YOK. '
      + 'Uygulamaya ait plugin\'ler capacitor.plugins.json ile OTOMATİK kaydedilmez: '
      + 'köprü adı çözemez, çağrı cihazda sessizce düşer',
    ).toEqual([]);
  });

  it('VehicleHAL özel olarak kayıtlıdır (F-04 kök bulgusu)', () => {
    /* Üretim zinciri: SystemBoot → startVehicleDataLayer → VehicleSignalResolver
       → NativeHALAdapter → VehicleHAL.startHAL(). Kayıt düşerse AAOS veri
       kaynağı sessizce kaybolur. */
    const java = JAVA_PLUGINS.get('VehicleHAL');
    expect(java, 'VehicleHAL Java plugin sınıfı yok').toBeDefined();
    expect(REGISTERED, 'VehicleHAL kayıt listesinden düşmüş — F-04 geri geldi')
      .toContain(java!.cls);
  });

  it('kayıt listesindeki her sınıf gerçekten bir @CapacitorPlugin\'dir', () => {
    const known = new Set([...JAVA_PLUGINS.values()].map((v) => v.cls));
    const orphan = REGISTERED.filter((c) => !known.has(c));
    expect(orphan, 'kayıt listesinde @CapacitorPlugin olmayan sınıf var — köprü onu çözemez')
      .toEqual([]);
  });
});

// ── AD SÖZLEŞMESİ: TS adı ↔ Java @CapacitorPlugin adı ───────────────────────

describe('F-04 · TS plugin adı Java annotation adıyla AYNIDIR', () => {
  it('her TS beyanının Java karşılığı vardır', () => {
    const missing = [...TS_PLUGINS.keys()].filter((n) => !JAVA_PLUGINS.has(n));
    expect(
      missing,
      'TS bu adla plugin çağırıyor ama hiçbir Java sınıfı @CapacitorPlugin(name=…) ile bu adı taşımıyor '
      + '— ad uyuşmazlığı köprüde sessiz UNIMPLEMENTED üretir',
    ).toEqual([]);
  });
});

// ── METOD SÖZLEŞMESİ (CarLauncher hariç — o F-10'da) ────────────────────────

describe('F-04 · TS arayüzünün zorunlu üyeleri Java\'da @PluginMethod olarak vardır', () => {
  it('kayıtlı plugin\'lerin zorunlu metod yüzeyi eksiksizdir', () => {
    const violations: string[] = [];
    for (const [name, ts] of TS_PLUGINS) {
      if (METHOD_CONTRACT_OWNED_ELSEWHERE.has(name)) continue;
      const java = JAVA_PLUGINS.get(name);
      if (!java) continue;
      const members = tsInterfaceMembers(readFileSync(ts.file, 'utf8'), ts.iface);
      for (const m of members) {
        if (m.optional || CAPACITOR_BASE.has(m.name)) continue;
        if (!java.methods.includes(m.name)) violations.push(`${name}.${m.name}`);
      }
    }
    expect(violations, 'TS ZORUNLU beyan ediyor ama Java\'da @PluginMethod YOK — cihazda UNIMPLEMENTED')
      .toEqual([]);
  });

  it('VehicleHAL\'in üretimde çağrılan üç metodu Java\'da vardır', () => {
    const java = JAVA_PLUGINS.get('VehicleHAL');
    expect(java).toBeDefined();
    for (const m of ['startHAL', 'stopHAL', 'getSignal']) {
      expect(java!.methods, `VehicleHAL.${m} Java yüzeyinde yok`).toContain(m);
    }
  });
});

// ── MUTASYON: bu testler GERÇEKTEN ısırıyor mu? ─────────────────────────────

describe('F-04 · sözleşme ihlalleri TESPİT EDİLİYOR (mutasyon)', () => {
  it('MUT-1 — kayıt satırı silinirse tespit edilir', () => {
    const mutated = MAIN_SRC.replace(
      /registerPlugin\(\s*com\.cockpitos\.pro\.hal\.VehicleHALPlugin\.class\s*\);/,
      '/* kayıt silindi */',
    );
    expect(mutated, 'mutasyon uygulanamadı — kayıt satırı bulunamadı').not.toBe(MAIN_SRC);

    const after = registeredPluginClasses(mutated);
    expect(after, 'MUT-1: kayıt silindiği hâlde liste değişmedi — çıkarıcı kör')
      .not.toContain('VehicleHALPlugin');
    /* Çekirdek iddia aynı saf fonksiyonla kurulduğu için bu, üretimdeki
       testin de kırmızı olacağının kanıtıdır. */
    expect(REGISTERED, 'gerçek kaynakta kayıt DURUYOR olmalı').toContain('VehicleHALPlugin');
  });

  it('MUT-2 — Java plugin adı TS adından saparsa tespit edilir', () => {
    const javaSrc = readFileSync(
      resolve(ROOT, 'android/app/src/main/java/com/cockpitos/pro/hal/VehicleHALPlugin.java'), 'utf8',
    );
    const mutated = javaSrc.replace('@CapacitorPlugin(name = "VehicleHAL")',
      '@CapacitorPlugin(name = "VehicleHALv2")');
    expect(mutated, 'mutasyon uygulanamadı').not.toBe(javaSrc);

    const p = javaPlugin(mutated);
    expect(p?.name, 'MUT-2: ad değişikliği görülmedi').toBe('VehicleHALv2');
    expect(TS_PLUGINS.has(p!.name),
      'MUT-2: sapmış ad TS tarafında bulunmamalı — sözleşme bunu ihlal sayar').toBe(false);
    /* Gerçek dosyada ad DOĞRU olmalı. */
    expect(javaPlugin(javaSrc)?.name).toBe('VehicleHAL');
  });

  it('MUT-3 — üretimde çağrılan @PluginMethod silinirse tespit edilir', () => {
    const javaSrc = readFileSync(
      resolve(ROOT, 'android/app/src/main/java/com/cockpitos/pro/hal/VehicleHALPlugin.java'), 'utf8',
    );
    const mutated = javaSrc.replace(/@PluginMethod\s*\n\s*public void startHAL\(PluginCall call\)/,
      'public void startHAL(PluginCall call)');
    expect(mutated, 'mutasyon uygulanamadı').not.toBe(javaSrc);

    const p = javaPlugin(mutated);
    expect(p!.methods, 'MUT-3: annotation silindiği hâlde metod yüzeyde görünüyor')
      .not.toContain('startHAL');
    expect(javaPlugin(javaSrc)!.methods, 'gerçek dosyada startHAL DURUYOR olmalı')
      .toContain('startHAL');
  });
});
