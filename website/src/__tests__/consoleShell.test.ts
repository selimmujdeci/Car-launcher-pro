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
