/**
 * #663 KİLİTLERİ — dashboard'un TAMAMI Kanıt Konsolu dilinde.
 *
 * #662'de yalnız filo bölümü çevrilmişti; kullanıcı *"sadece filo değişmiş,
 * site komple değişecekti"* dedi. Bu kilitler, çevrilen ekranların sessizce
 * eski dile geri dönmesini ve sökülen tiyatro yüzeylerin geri gelmesini
 * engeller.
 *
 * ZAYIFLATILMAZ; davranış bilinçli değişirse kilit GÜNCELLENİR.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  formatMeasurementValue,
  measurementLabel,
  plausibleSignal,
  SPEED_NOISE_FLOOR_KMH,
} from '@/lib/fleet/vehicleTelemetryFreshness';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

const SCREENS = [
  'src/app/dashboard/page.tsx',
  'src/app/dashboard/vehicles/page.tsx',
  'src/app/dashboard/map/page.tsx',
  'src/app/dashboard/notifications/page.tsx',
  'src/app/dashboard/diagnostic/page.tsx',
  'src/app/dashboard/settings/page.tsx',
];

describe('#663 · konsol kabuğu', () => {
  it('KİLİT: konsol kökü dashboard layout içinde tanımlı', () => {
    const layout = read('src/app/dashboard/layout.tsx');
    expect(layout).toContain('data-console-root');
    expect(layout).toContain('--cn-bg-void');
  });

  it('KİLİT: zemin kuralı [data-console] değil [data-console-root] üzerinde', () => {
    /* `[data-console]` `<html>` üzerindedir (token tanımı). Zemin kuralı ona
       bağlanırsa PAZARLAMA sayfalarının zemini de konsol rengine döner. */
    const css = read('src/app/globals.css');
    expect(css).toContain('[data-console-root] {');
    expect(css).toContain('[data-console-root] :focus-visible');
    expect(css).toMatch(/\[data-console-root\][\s\S]{0,120}background-color/);
  });

  it('KİLİT: konsol teması ilk boyamadan ÖNCE basılır', () => {
    const layout = read('src/app/layout.tsx');
    expect(layout).toContain('CONSOLE_THEME_BOOT_SCRIPT');
    expect(layout).toContain('consoleThemeScript');
  });

  it('KİLİT: kabuk üç yüzeyi de konsol tokenlarını kullanır', () => {
    for (const rel of [
      'src/components/layout/Sidebar.tsx',
      'src/components/layout/Topbar.tsx',
      'src/components/layout/BottomNav.tsx',
    ]) {
      expect(read(rel), rel).toContain('--cn-');
    }
  });

  it('KİLİT: tema anahtarı Topbar üzerinden her ekranda erişilebilir', () => {
    expect(read('src/components/layout/Topbar.tsx')).toContain('ConsoleThemeToggle');
  });
});

describe('#663 · ekranlar eski dile GERİ DÖNMEZ', () => {
  it('KİLİT: eski zemin/aksan literalleri ürün ekranlarında yok', () => {
    for (const rel of SCREENS) {
      const src = read(rel);
      expect(src, rel + ' eski sayfa zemini').not.toContain('bg-[#060d1a]');
      expect(src, rel + ' eski kart zemini').not.toContain('bg-white/[0.03]');
      expect(src, rel + ' eski mavi aksan').not.toMatch(/text-accent\b/);
      expect(src, rel + ' yuvarlak SaaS kartı').not.toMatch(/rounded-2xl|rounded-3xl/);
    }
  });

  it('KİLİT: ekranlar konsol yüzeylerini kullanır', () => {
    for (const rel of SCREENS) {
      expect(read(rel), rel).toContain('@/components/console/primitives');
    }
  });
});

describe('#663 · sökülen tiyatro geri gelmez', () => {
  it('KİLİT: Ayarlar ekranında sahte profil formu ve ölü Kaydet YOK', () => {
    /* Eski ekran `defaultValue` ile doldurulmuş "Admin Kullanıcı" alanları ve
       `onClick`i olmayan bir "Kaydet" düğmesi taşıyordu: kullanıcı kaydettiğini
       sanıyor, hiçbir şey kaydedilmiyordu. */
    const src = read('src/app/dashboard/settings/page.tsx');
    expect(src).not.toContain('Admin Kullanıcı');
    expect(src).not.toContain('admin@carlauncher.pro');
    expect(src).not.toContain('defaultValue');
  });

  it('KİLİT: Tanı ekranı ölçümü GERÇEK katmandan okur (sahte 0 yasağı)', () => {
    /* Eski ekran `v.engineTemp` / `v.fuel` okuyordu; o yüzey bilinmeyeni 0
       yapar ve telemetrisiz araçta "Yakıt %0" sahte alarmı üretiyordu. */
    const src = read('src/app/dashboard/diagnostic/page.tsx');
    expect(src).toContain('telemetry');
    expect(src).not.toContain('{v.engineTemp}');
    expect(src).not.toContain('{v.fuel}');
    expect(src).not.toContain('v.rpm.toLocaleString()');
  });

  it('KİLİT: Harita ekranı KENDİ kabuğunu kurmaz (çift alt menü yasağı)', () => {
    /* Eski ekran `h-screen w-screen` ile ikinci bir kabuk çiziyor, içinde
       hiçbir yere gitmeyen dekoratif bir alt menü barındırıyordu. */
    const src = read('src/app/dashboard/map/page.tsx');
    expect(src).not.toContain('h-screen w-screen');
    expect(src).not.toContain('pb-safe');
  });

  it('KİLİT: bildirim ekranı kaynağını AÇIKÇA söyler', () => {
    /* Bu ekran istemci içi `notificationStore`u okur; sunucudaki
       `notifications` tablosu Filo → Uyarılar'dadır. İkisini aynı görünümde
       birleştirmek, kalıcı olmayan kaydı kalıcı gibi gösterirdi. */
    const src = read('src/app/dashboard/notifications/page.tsx');
    expect(src).toContain('/dashboard/fleet/alerts');
    expect(src).toContain('sunucuda saklanmaz');
  });
});

describe('#664 · harita kabı çökmez (ölçülmüş kök)', () => {
  const liveMap = read('src/components/map/LiveMap.tsx');

  it('KİLİT: harita kabının konumlandırması INLINE verilir, sınıfla DEĞİL', () => {
    /* ÖLÇÜLDÜ (Playwright, izole sayfa): MapLibre'nin kendi stil sayfası
       `.maplibregl-map { position: relative }` kuralını taşır ve Next.js onu
       Tailwind utilities'ten SONRA yerleştirir. Kaba `absolute inset-0` SINIFI
       verildiğinde bu kural kazanıyor, `inset-0` ölüyor ve kap `height: 0`
       kalıyordu: canvas oluşuyor, kontroller çiziliyor, ama harita hiç
       görünmüyordu. Ölçüm: kap h=0 → düzeltme sonrası h=540. */
    expect(liveMap).toMatch(/ref=\{containerRef\}[\s\S]{0,220}position: 'absolute'/);
    expect(liveMap).not.toMatch(/ref=\{containerRef\}\s+className="absolute inset-0"/);
  });

  it('KİLİT: yükleme zemini taban stiliyle uyumlu', () => {
    expect(liveMap).toContain("activeStyle === 'clear'");
  });

  it('KİLİT: teşhis logları üründe kalmadı', () => {
    expect(liveMap).not.toContain('MAPDBG');
    expect(liveMap).not.toContain('console.log');
  });
});

describe('#665 · harita teması ve kartı', () => {
  const liveMap = read('src/components/map/LiveMap.tsx');
  const card = read('src/components/map/VehicleMapCard.tsx');
  const style = read('src/lib/console/mapStyle.ts');

  it('KİLİT: harita tabanı UYGULAMANIN temasından türetilir', () => {
    /* Kullanıcı: "gündüz modunda gündüz haritası, gece modunda gece haritası".
       ÖLÇÜLDÜ: tema=night → dark-matter, tema=day → voyager. */
    expect(liveMap).toContain('styleKeyForTheme');
    expect(liveMap).toContain('CONSOLE_THEME_ATTR');
    expect(style).toContain('baseForTheme');
  });

  it('KİLİT: taban RENDER SIRASINDA türetilir — senkron tutulan ikinci kopya YOK', () => {
    /* İki ayrı state (tema + taban) ayrışmıştı: harita voyager yüklerken
       düğme "Koyu"yu işaretliyordu. Artık tek türetme. */
    expect(liveMap).toContain('override ?? styleKeyForTheme(themeState)');
    expect(liveMap).not.toContain('setActiveStyle');
  });

  it('KİLİT: gece tabanına okunurluk yaması uygulanır', () => {
    /* ÖLÇÜLDÜ: dark-matter yol DOLGULARI #0b0b0b — zeminden ayırt edilemiyor
       ("kapkara bir şey"). Yol hiyerarşisi parlatılır, zemin bir tık açılır. */
    expect(liveMap).toContain('applyNightLegibility');
    expect(style).toContain('NIGHT_ROAD_RULES');
    expect(style).toContain('NIGHT_BACKGROUND');
  });

  it('KİLİT: araç kartı TEMA-FARKINDA (sabit koyu zemin yok)', () => {
    expect(card).toContain('var(--cn-bg-panel)');
    expect(card).not.toContain('rgba(6,13,26,0.92)');
    expect(card).not.toMatch(/text-white\/\d/);
  });

  it('KİLİT: haritada araç noktası kart açar (dokunma hedefi dahil)', () => {
    expect(liveMap).toContain("'vehicle-hit'");
    expect(liveMap).toContain("map.on('click', 'vehicle-hit'");
  });
});

describe('#666 · ölçüm gösterimi ham değer BASMAZ', () => {
  it('KİLİT: hız birime göre yuvarlanır — ham GPS ondalığı ekrana çıkmaz', () => {
    /* Saha: ekranda `1.57855 km/h` görünüyordu. Sebep GPS: hız `m/s × 3.6`
       ile üretilir, yani ondalıklıdır (OBD `010D` tam sayıdır — kusur bu
       yüzden aralıklı görünürdü). APK tarafında #548'de düzeltilen kusurun
       web karşılığı; çözüm aynı: TEK biçimleyici. */
    expect(formatMeasurementValue(1.57855, 'km/h')).toBe('0');
    expect(formatMeasurementValue(67.1544, 'km/h')).toBe('67');
    expect(formatMeasurementValue(67.9, 'km/h')).toBe('68');
  });

  it('KİLİT: durağan araçta GPS gürültüsü hareket olarak GÖSTERİLMEZ', () => {
    /* ±2 m hassasiyetli GPS park hâlinde 1–3 km/h "hareket" üretir; olduğu
       gibi basmak duran aracı hareket ediyormuş gibi gösterir. Ham değer
       `Measurement.value` içinde KANIT olarak korunur, yalnız gösterim kırpılır
       — bu, "bilinmeyeni 0 yapmak" (sahte 0) DEĞİLDİR. */
    expect(SPEED_NOISE_FLOOR_KMH).toBe(3);
    expect(formatMeasurementValue(2.9, 'km/h')).toBe('0');
    expect(formatMeasurementValue(3.4, 'km/h')).toBe('3');
  });

  it('KİLİT: gürültü tabanı YALNIZ hıza uygulanır', () => {
    expect(formatMeasurementValue(2.4, '°C')).toBe('2');
    expect(formatMeasurementValue(2.4, '%')).toBe('2');
    expect(formatMeasurementValue(12.64, 'V')).toBe('12.6');
    expect(formatMeasurementValue(776.3, 'rpm')).toBe('776');
  });

  it('KİLİT: ölçüm etiketi biçimleyiciyi kullanır (bayat/çevrimdışı eki korunur)', () => {
    const m = { value: 1.57855, state: 'LIVE', observedAt: 1, ageMs: 1, source: 'HEAD_UNIT_GPS' } as const;
    expect(measurementLabel(m, 'km/h')).toBe('0 km/h');
    const stale = { ...m, state: 'STALE' } as const;
    expect(measurementLabel(stale, 'km/h')).toBe('0 km/h · eski veri');
  });

  it('KİLİT: ham değer basan gösterim noktası kalmadı', () => {
    for (const rel of [
      'src/components/dashboard/VehicleCard.tsx',
      'src/components/console/primitives.tsx',
    ]) {
      expect(read(rel), rel).toContain('formatMeasurementValue');
    }
  });
});

describe('#667 · sahte -1 ve sahte 0 yasağı (LAB kopyasından)', () => {
  it('KİLİT: araç "-1" sentineli ölçüm SAYILMAZ', () => {
    /* CAROS LAB kopyası (cihazdan) araç veri sözleşmesini gösterdi: okunamayan
       sinyal `-1` ile gelir (fuelLevel:-1, boostPressure:-1, egt:-1, range:-1).
       Web `Number.isFinite` baktığı için -1'i GEÇERLİ ölçüm sayıyordu: araç
       "yakıtı okuyamadım" derken panel "-1 %" yazar, araç kartı da bunu
       `fuelPct < 20` ile KIRMIZI "yakıt bitti" alarmına çevirirdi. */
    expect(plausibleSignal('fuel', -1)).toBeNull();
    expect(plausibleSignal('rpm', -1)).toBeNull();
    expect(plausibleSignal('speed', -1)).toBeNull();
  });

  it('KİLİT: geçerli aralık korunur — ölçülmüş 0 REDDEDİLMEZ', () => {
    /* Ölçülmüş sıfır gerçek bir gözlemdir: park hâlinde hız 0, depo boşken
       yakıt 0. Sentinel reddi bunları elemez. */
    expect(plausibleSignal('speed', 0)).toBe(0);
    expect(plausibleSignal('fuel', 0)).toBe(0);
    expect(plausibleSignal('rpm', 0)).toBe(0);
    expect(plausibleSignal('temp', -1)).toBe(-1); // -1 °C gerçek bir sıcaklık
  });

  it('KİLİT: imkânsız değer elenir', () => {
    expect(plausibleSignal('speed', 999)).toBeNull();
    expect(plausibleSignal('fuel', 140)).toBeNull();
    expect(plausibleSignal('rpm', 99_000)).toBeNull();
    expect(plausibleSignal('temp', -80)).toBeNull();
  });

  it('KİLİT: sunucu rotası eksik alanı SIFIRA çevirmez', () => {
    /* `body.fuel ?? 0` bilinmeyeni ölçülmüş sıfıra çeviriyordu. */
    const route = read('src/app/api/vehicle/update/route.ts');
    expect(route).not.toContain('body.fuel        ?? 0');
    expect(route).not.toContain('body.speed       ?? 0');
    expect(route).toContain('orMissing');
    expect(route).toContain('Number.NaN');
  });
});
