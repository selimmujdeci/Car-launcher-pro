/**
 * nativeBridgeContractF10.test.ts — MRI F-10 · TS ↔ ANDROID KÖPRÜ SÖZLEŞMESİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ÖLÇÜLEN KUSUR SINIFI
 *
 * `nativePlugin.ts` içindeki `CarLauncherPlugin` arayüzü bir İDDİADIR:
 * "bu metod cihazda vardır". TypeScript bu iddiayı DOĞRULAYAMAZ — arayüz
 * yalnız bir tip beyanıdır, karşılığında Java tarafında `@PluginMethod`
 * olmasa bile derleme geçer. Çağrı cihazda `UNIMPLEMENTED` ile reddedilir ve
 * çağıranın `catch` dalı sessizce devreye girer.
 *
 * MRI bunun gerçek örneğini buldu (VehicleHAL: implemented but not registered).
 * Bu dosya aynı arıza sınıfını YAPISAL olarak yakalar:
 *
 *   TS ARAYÜZÜNDE ZORUNLU  ∧  ÜRETİMDE ÇAĞRILIYOR  ⇒  JAVA'DA @PluginMethod OLMALI
 *
 * ── KANIT SEVİYESİ (dürüstlük) ────────────────────────────────────────────
 * Bu bir KAYNAK-YAPISAL sözleşmedir (kategori: structural contract), davranış
 * testi değildir: iki yüzeyin birbiriyle tutarlılığını kanıtlar. Derlenmiş
 * Java sınıfının GERÇEK çağrılabilirliği (public + PluginCall imzası +
 * annotation) ayrı bir JUnit yansıma testinde kanıtlanır:
 *   android/app/src/test/java/com/cockpitos/pro/CarLauncherPluginBridgeContractTest.java
 *
 * ── KARANTİNA ─────────────────────────────────────────────────────────────
 * `KNOWN_MISSING` bugün GERÇEKTEN kırık olan sözleşmelerin tam listesidir.
 * Liste bir mazeret değil, ÖLÇÜLMÜŞ BORÇTUR: yeni bir kırık eklenirse test
 * kırmızı olur, karantinadaki biri düzeltilirse test yine kırmızı olur ve
 * listenin küçültülmesini zorlar. Yani boşluk ne büyüyebilir ne de sessizce
 * unutulabilir.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT      = process.cwd();
const TS_PLUGIN = resolve(ROOT, 'src/platform/nativePlugin.ts');
const JAVA_PLUGIN = resolve(
  ROOT, 'android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java',
);

/**
 * Capacitor `Plugin` taban sınıfından MİRAS alınan yüzey — `CarLauncherPlugin.java`
 * bunları kendi `@PluginMethod`'u olarak yazmaz, köprü yine de çözer.
 */
const CAPACITOR_BASE = new Set([
  'addListener', 'removeAllListeners', 'checkPermissions', 'requestPermissions',
]);

/**
 * BUGÜN GERÇEKTEN KIRIK olan sözleşmeler (ölçülmüş borç).
 *
 * ŞU AN BOŞ. Tek kalemi olan `setPinHash` / `verifyPin` / `clearPin` borcu
 * Wave 12B'de KAPANDI: o sözleşme (hash'i JS üretip native'e yollamak) güven
 * sınırını yanlış yere koyduğu için körlemesine implemente EDİLMEDİ; yerine
 * türetme/karşılaştırma/sayacı native'de tutan `localPinStatus` ·
 * `setLocalPin` · `verifyLocalPin` · `changeLocalPin` · `clearLocalPin`
 * sözleşmesi geldi ve Java'da uygulandı.
 *
 * Liste bir mazeret değil ÖLÇÜLMÜŞ BORÇTUR: yeni bir kırık eklenirse test
 * kırmızı olur; buraya bir kalem eklemek ancak gerçekten kırık bir sözleşme
 * ölçüldüğünde meşrudur.
 */
const KNOWN_MISSING = new Set<string>([]);

// ── Yüzey çıkarımı ───────────────────────────────────────────────────────────

/** `CarLauncherPlugin` arayüz gövdesi (üye beyanlarının bulunduğu dilim). */
function pluginInterfaceBody(src: string): string {
  const start = src.indexOf('export interface CarLauncherPlugin {');
  expect(start, 'CarLauncherPlugin arayüzü bulunamadı — köprü sözleşmesi ölçülemez')
    .toBeGreaterThan(-1);
  /* Arayüz gövdesi, sütun 0'daki ilk `}` ile biter (üyeler 2 boşluk girintili). */
  const end = src.indexOf('\n}', start);
  expect(end, 'CarLauncherPlugin arayüzünün sonu bulunamadı').toBeGreaterThan(start);
  return src.slice(start, end);
}

/** Arayüz üyeleri: `{ ad → zorunlu mu }`. */
function declaredMembers(body: string): Map<string, boolean> {
  const members = new Map<string, boolean>();
  const re = /^ {2}([A-Za-z_][A-Za-z0-9_]*)(\?)?\s*(?:\(|<)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    members.set(m[1], m[2] !== '?'); // true = zorunlu
  }
  return members;
}

/** Java `@PluginMethod` ile işaretlenmiş köprü metodları. */
function javaPluginMethods(src: string): Set<string> {
  const names = new Set<string>();
  const re = /@PluginMethod[^\n]*\n(?:\s*@[^\n]*\n)*\s*public\s+void\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) names.add(m[1]);
  return names;
}

/** Üretim kaynağı (testler ve tip beyanı hariç). */
function productionSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        if (entry === '__tests__' || entry === 'node_modules') continue;
        walk(p);
      } else if (/\.tsx?$/.test(entry) && p !== TS_PLUGIN) {
        out.push(p);
      }
    }
  };
  walk(resolve(ROOT, 'src'));
  return out;
}

/**
 * `CarLauncher.<ad>(` çağrıları — `as unknown as {…}` cast'leriyle yazılmış
 * köprü çağrıları da yakalanır (kod tabanında yaygın kalıp).
 */
function productionCallSites(): Map<string, string[]> {
  const calls = new Map<string, string[]>();
  const re = /CarLauncher(?:\s+as\s+unknown\s+as\s+\{[^}]*\})?\s*\)?\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  for (const file of productionSources()) {
    const src = readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
      const list = calls.get(m[1]) ?? [];
      if (!list.includes(rel)) list.push(rel);
      calls.set(m[1], list);
    }
  }
  return calls;
}

const TS_SRC    = readFileSync(TS_PLUGIN, 'utf8');
const JAVA_SRC  = readFileSync(JAVA_PLUGIN, 'utf8');
const MEMBERS   = declaredMembers(pluginInterfaceBody(TS_SRC));
const JAVA      = javaPluginMethods(JAVA_SRC);
const CALLS     = productionCallSites();

/** Sözleşmenin bağlayıcı olduğu küme: zorunlu beyan + üretimde çağrılıyor. */
const BINDING = [...CALLS.keys()]
  .filter((name) => MEMBERS.get(name) === true)   // arayüzde ZORUNLU
  .filter((name) => !CAPACITOR_BASE.has(name))
  .sort();

// ── Çıkarımın kendisi doğru mu? (test sessizce boşa düşmesin) ────────────────

describe('F-10 · köprü yüzeyi ölçülebiliyor', () => {
  it('TS arayüzü, Java köprüsü ve üretim çağrıları OKUNABİLDİ', () => {
    /* Bu eşikler "çıkarım çalışıyor mu" sorusudur. Regex bozulup 0 üye
       bulursa aşağıdaki sözleşme testi BOŞ KÜME üzerinde yeşil olurdu —
       sahte güvenin ta kendisi. */
    expect(MEMBERS.size, 'TS arayüz üyeleri çıkarılamadı').toBeGreaterThan(100);
    expect(JAVA.size,    'Java @PluginMethod yüzeyi çıkarılamadı').toBeGreaterThan(100);
    expect(CALLS.size,   'üretim çağrı yerleri bulunamadı').toBeGreaterThan(50);
    expect(BINDING.length, 'bağlayıcı sözleşme kümesi boş — test hiçbir şey kanıtlamaz')
      .toBeGreaterThan(50);
  });
});

// ── Asıl sözleşme ────────────────────────────────────────────────────────────

describe('F-10 · TS zorunlu köprü metodu Android tarafında GERÇEKTEN var', () => {
  it('üretimde çağrılan her ZORUNLU metodun Java karşılığı vardır', () => {
    const missing = BINDING.filter((name) => !JAVA.has(name));
    const unexpected = missing.filter((name) => !KNOWN_MISSING.has(name));

    expect(
      unexpected,
      'TS ZORUNLU beyan ediyor ve üretim çağırıyor, ama Java\'da @PluginMethod YOK → '
      + 'cihazda UNIMPLEMENTED, çağıranın catch dalı sessizce devreye girer. '
      + 'Çağrı yerleri: '
      + unexpected.map((n) => `${n} ← ${(CALLS.get(n) ?? []).join(', ')}`).join(' | '),
    ).toEqual([]);
  });

  it('karantina listesi GÜNCEL — düzelen borç listede kalamaz', () => {
    /* Karantinadaki bir metod Java'ya eklendiyse liste küçültülmelidir;
       aksi hâlde "bilinen borç" ölçüsü gerçeği yansıtmayı bırakır. */
    const stillBroken = [...KNOWN_MISSING].filter((name) => !JAVA.has(name)).sort();
    expect([...KNOWN_MISSING].sort(), 'karantinadaki bir sözleşme artık KIRIK DEĞİL — listeden çıkarılmalı')
      .toEqual(stillBroken);
  });

  it('karantinadaki metodlar hâlâ ZORUNLU beyan + üretim çağrısı taşıyor', () => {
    /* Borcun ikinci kapanma yolu: beyanı `?` yapıp çağrı yerini `?.` ile
       dürüst hâle getirmek. O da olduysa liste güncellenmelidir. */
    for (const name of KNOWN_MISSING) {
      expect(BINDING, `${name} artık bağlayıcı sözleşmede değil — karantinadan çıkarılmalı`)
        .toContain(name);
    }
  });
});

// ── İsteğe bağlı yüzey: dürüst bozulma ───────────────────────────────────────

describe('F-10 · Java karşılığı olmayan isteğe bağlı metod DÜRÜST çağrılır', () => {
  it('`?` beyan edilip Java\'da bulunmayan metod, çağrı yerinde `?.` ile korunur', () => {
    const optionalMissing = [...CALLS.keys()]
      .filter((name) => MEMBERS.get(name) === false)  // arayüzde isteğe bağlı
      .filter((name) => !CAPACITOR_BASE.has(name))
      .filter((name) => !JAVA.has(name));

    /* Bu küme boş OLMAK ZORUNDA DEĞİL: isteğe bağlı beyan + korumalı çağrı
       meşru bir bozulma sözleşmesidir. Kontrol edilen şey, çağrının gerçekten
       korunmuş olmasıdır — aksi hâlde cihazda TypeError üretir. */
    const unguarded: string[] = [];
    for (const name of optionalMissing) {
      for (const rel of CALLS.get(name) ?? []) {
        const src = readFileSync(resolve(ROOT, rel), 'utf8');
        const guarded = new RegExp(`\\.\\s*${name}\\s*\\?\\.\\s*\\(`).test(src)
          || new RegExp(`\\.\\s*${name}\\s*\\?\\s*\\.`).test(src);
        if (!guarded) unguarded.push(`${name} ← ${rel}`);
      }
    }
    expect(unguarded, 'isteğe bağlı köprü metodu KORUMASIZ çağrılıyor — cihazda TypeError')
      .toEqual([]);
  });
});
