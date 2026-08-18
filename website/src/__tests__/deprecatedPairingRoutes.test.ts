/**
 * deprecatedPairingRoutes.test.ts — TEK EŞLEŞTİRME OTORİTESİ KİLİTLERİ.
 *
 * Kapatılan gerçek kusurlar:
 *   · `/api/pwa/pair` var olmayan `pair_vehicle(text)` RPC'sini çağırıyordu
 *     (hiçbir migration'da tanımlı değil) → sessiz 500
 *   · aynı rota KİMLİK DOĞRULAMASIZ çalışıyor ve HAM `api_key` DÖNDÜRÜYORDU
 *   · `vehicles.pairing_code` kolonu hiç oluşturulmamıştı
 *   · PWA eşleştirme ekranı QR akışını DESTEKLENİYORMUŞ gibi gösteriyordu
 *
 * Bu kilitler ölü yolların "çalışıyor" görünümüne geri dönmesini engeller.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  CANONICAL_PAIRING_FLOW,
  DEPRECATED_PAIRING_ROUTES,
  deprecatedRouteBody,
  deprecatedRoutesSummary,
} from '../lib/deprecatedPairingRoutes';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Yorumları sıyırır — gerekçe yorumlarındaki teknik adlar KOD SAYILMAZ. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('eşleştirme · tek otorite', () => {
  it('1. 🔒 kanonik akış head unit kodu → /api/vehicle/link zinciridir', () => {
    /* Tek otorite DEĞİŞMEDİ: head unit `register_vehicle` ile kod üretir,
       kullanıcı onu GİRER, `/api/vehicle/link` → `pair_vehicle_to_user` bağlar.
       #631'de değişen tek şey KODU NEREYE GİRDİĞİDİR: artık uygulamanın kendi
       "Eşleştir" ekranı da aynı rotayı çağırır (bireysel hesap → company_id
       null). Filo panosu ikinci bir OTORİTE değil, aynı rotanın ikinci
       giriş noktasıdır. */
    expect(CANONICAL_PAIRING_FLOW).toContain('register_vehicle');
    expect(CANONICAL_PAIRING_FLOW).toContain('/api/vehicle/link');
    expect(CANONICAL_PAIRING_FLOW).toContain('pair_vehicle_to_user');
    // Kullanıcıya dönen gövde akış adını ROTAYA göre taşır, panoya göre değil.
    expect(deprecatedRouteBody(DEPRECATED_PAIRING_ROUTES[0]).canonicalFlow)
      .toBe('VEHICLE_LINK_6_DIGIT_CODE');
  });

  it('2. 🔒 kapatılan her rota GEREKÇESİYLE kayıtlıdır', () => {
    expect(DEPRECATED_PAIRING_ROUTES.length).toBeGreaterThanOrEqual(3);
    for (const r of DEPRECATED_PAIRING_ROUTES) {
      expect(r.path.startsWith('/api/')).toBe(true);
      expect(r.reason.length).toBeGreaterThan(20);   // gerekçe ZORUNLU
    }
  });

  it('3. 🔒 kapalı rota gövdesi kullanıcıyı KANONİK akışa yönlendirir', () => {
    for (const route of DEPRECATED_PAIRING_ROUTES) {
      const body = deprecatedRouteBody(route);
      expect(body.canonicalFlow).toBe('VEHICLE_LINK_6_DIGIT_CODE');
      /* Mesaj, kullanıcıyı GERÇEKTEN çalışan yola göndermeli. #631 öncesinde
         "yalnız Filo panosu" diyordu — bireysel kullanıcı için bu YANLIŞ
         bilgiydi ve uygulamanın kendi ekranı zaten kapalıydı. */
      expect(body.error).toMatch(/Eşleştir/);
      expect(body.error).toMatch(/6 haneli/);
      // Teknik iç detay (RPC/kolon adı) kullanıcıya SIZMAZ.
      expect(body.error).not.toMatch(/rpc|api_key|pairing_code|column/i);
    }
  });

  it('4. 🔒 LAB özeti gizli veri TAŞIMAZ', () => {
    const s = JSON.stringify(deprecatedRoutesSummary());
    expect(s).not.toMatch(/api[_-]?key/i);
    expect(s).not.toMatch(/eyJ/);           // JWT parçası
    expect(s).not.toMatch(/service_role/);
  });
});

describe('eşleştirme · ölü rotalar GERÇEKTEN kapalı', () => {
  const routes = [
    'src/app/api/pwa/pair/route.ts',
    'src/app/api/vehicle/register/route.ts',
    'src/app/api/vehicle/code/route.ts',
  ];

  it('5. 🔒 kayıttaki her ölü rota 410 statüsüyle işaretli', () => {
    for (const r of DEPRECATED_PAIRING_ROUTES) {
      expect(r.status, `${r.path} 410 değil`).toBe(410);
    }
  });

  it('6. 🔒 üç ölü rota dosyası GERÇEKTEN 410 döndürüyor', () => {
    for (const rel of routes) {
      expect(existsSync(join(ROOT, rel)), `${rel} bulunamadı`).toBe(true);
      const c = code(rel);
      // Ya doğrudan 410 ya da kayıttaki `status` alanı (o da 410 — test 5).
      expect(c, `${rel} 410 dönmüyor`).toMatch(/status:\s*(410|ROUTE\.status|GONE_STATUS)/);
      expect(c, `${rel} NextResponse döndürmüyor`).toMatch(/NextResponse\.json/);
    }
  });

  it('7. 🔒 ölü rotalar ARTIK Supabase çağırmıyor (sessiz 500 kaynağı)', () => {
    for (const rel of routes) {
      const c = code(rel);
      expect(c, `${rel} hâlâ RPC çağırıyor`).not.toMatch(/\.rpc\(/);
      expect(c, `${rel} hâlâ tablo sorguluyor`).not.toMatch(/\.from\(/);
      expect(c, `${rel} hâlâ Supabase istemcisi kuruyor`).not.toMatch(/createClient|supabase/i);
    }
  });

  it('8. 🔒 ölü rotalar HAM api_key DÖNDÜRMÜYOR', () => {
    for (const rel of routes) {
      expect(code(rel), `${rel} kodunda api_key var`).not.toMatch(/api_?[kK]ey/);
    }
  });

  it('9. 🔒 var olmayan `pair_vehicle(text)` RPC\'si KODDAN çağrılmıyor', () => {
    for (const rel of routes) {
      expect(code(rel), `${rel} pair_vehicle çağırıyor`).not.toMatch(/pair_vehicle/);
    }
  });

  it('10. 🔒 ölü rotalar istek gövdesi OKUMUYOR (yan etki yok)', () => {
    for (const rel of routes) {
      expect(code(rel), `${rel} gövde okuyor`).not.toMatch(/\.json\(\)|req\.|request\./);
    }
  });
});

describe('eşleştirme · PWA ekranı dürüstlüğü', () => {
  const PAIRING = 'src/components/pwa/PairingScreen.tsx';

  /* ── KİLİT GÜNCELLENDİ (#631) ─────────────────────────────────────────────
   * Eski sözleşme: "ekran kullanıcıyı Filo panosuna yönlendirir". O, ekranın
   * kendi eşleştirme yolu KAPALI olduğu için doğruydu. Kullanıcı bunu şöyle
   * tarif etti: *"pwa sadece araç uygulaması ile işlemeli, filo da araç ile
   * eşleşmesi ikisi ayrı."* Ekran artık kanonik rotayı KENDİSİ çağırır;
   * bireysel kullanıcıyı var olmayan bir filo zorunluluğuna göndermek YANLIŞ
   * bilgidir. */
  it('11. 🔒 ekran kendi akışını anlatır, filo ZORUNLU gibi sunulmaz', () => {
    const src = read(PAIRING);
    expect(src).toMatch(/6 haneli/);
    expect(src, 'ekran hâlâ "buradan eşleştirme kullanılamıyor" diyor')
      .not.toMatch(/eşleştirme şu an kullanılamıyor/);
    expect(src, 'kullanıcı yine Filo panosuna gönderiliyor')
      .not.toMatch(/Filo panosu → Araç Ekle/);
  });

  it('11b. 🔒 PWA eşleştirmesi KANONİK rotayı çağırır, kapalı rotayı ÇAĞIRMAZ', () => {
    const svc = read('src/lib/pairingService.ts');
    expect(svc, 'PWA hâlâ 410 dönen rotayı çağırıyor → düğme hiç çalışmaz')
      .not.toMatch(/['"]\/api\/pwa\/pair['"]/);
    expect(svc).toMatch(/['"]\/api\/vehicle\/link['"]/);
  });

  /* ── #632 — "eşleşti diyor yine bu ekran çıkıyor" ──────────────────────────
   * Sahada ölçüldü: eşleştirme başarılı oluyor ama araç listesi boş kalıyor ve
   * sayfa kullanıcıyı otomatik eşleştirme sekmesine geri atıyordu. Kök, #631'in
   * kaçırdığı İKİNCİ OKUMA NOKTASIYDI: `vehicleStore.initializeFromLocal` aynı
   * `caros_pair_*` anahtarlarını KENDİ okuyor ve `api_key` yoksa erken
   * dönüyordu. Kanonik rota anahtar döndürmediği için araç sessizce düşüyordu.
   * Okuma artık TEK otoritededir. */
  it('11d. 🔒 araç kimliği `api_key` VARLIĞINA bağlanamaz', () => {
    const store = read('src/store/vehicleStore.ts');
    expect(store, 'store yine kendi localStorage kopyasını okuyor (ikinci otorite)')
      .not.toMatch(/caros_pair_api_key/);
    expect(store, 'yerel araç okuması tek otoriteden gelmiyor')
      .toMatch(/getLocalVehicle/);
  });

  it('11e. 🔒 yerel araç okuması yalnız `vehicleId` ister', () => {
    const svc = read('src/lib/pairingService.ts');
    /* `!id || !apiKey` deseni geri gelirse yeni akışla eşleşen araç kaybolur. */
    expect(svc).not.toMatch(/!id\s*\|\|\s*!apiKey/);
    expect(svc).toMatch(/if\s*\(!id\)\s*return null/);
  });

  it('11c. 🔒 eşleştirme OTURUM ister ve ham anahtar SAKLAMAZ', () => {
    const svc = read('src/lib/pairingService.ts');
    /* Kapalı rotanın kapatılma sebeplerinden biri oturumsuz çalışıp yanıtta
       ham `api_key` döndürmesiydi; yeni yol o hatayı tekrarlamamalı. */
    expect(svc).toMatch(/Authorization/);
    expect(svc).toMatch(/access_token/);
    expect(svc, 'yanıttan api_key okunuyor — kapatılan kusur geri geldi')
      .not.toMatch(/data\.apiKey/);
  });

  it('12. 🔒 QR sekmesi DESTEKLENİYORMUŞ gibi gösterilmiyor', () => {
    // Mod sekmeleri yalnız 'pin' içerir.
    expect(read(PAIRING)).toMatch(/\(\[\s*'pin'\s*\]\s*as\s*Mode\[\]\)/);
  });

  it('13. 🔒 ekran KODDAN kapalı rotayı çağırmıyor', () => {
    expect(code(PAIRING), 'PairingScreen kapalı /api/pwa/pair rotasını çağırıyor')
      .not.toMatch(/['"`]\/api\/pwa\/pair/);
  });
});
