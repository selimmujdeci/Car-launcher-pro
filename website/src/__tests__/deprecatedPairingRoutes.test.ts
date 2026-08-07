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
    // Tek otorite: head unit `register_vehicle` ile kod üretir, kullanıcı onu
    // Filo panosuna girer, `/api/vehicle/link` → `pair_vehicle_to_user` bağlar.
    expect(CANONICAL_PAIRING_FLOW).toContain('register_vehicle');
    expect(CANONICAL_PAIRING_FLOW).toContain('/api/vehicle/link');
    expect(CANONICAL_PAIRING_FLOW).toContain('pair_vehicle_to_user');
    // Kullanıcıya dönen gövde ise sade akış adını taşır.
    expect(deprecatedRouteBody(DEPRECATED_PAIRING_ROUTES[0]).canonicalFlow)
      .toBe('FLEET_DASHBOARD_6_DIGIT_CODE');
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
      expect(body.canonicalFlow).toBe('FLEET_DASHBOARD_6_DIGIT_CODE');
      expect(body.error).toMatch(/Araç Ekle/);
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

  it('11. 🔒 ekran kullanıcıyı Filo panosuna yönlendirir', () => {
    const src = read(PAIRING);
    expect(src).toMatch(/Filo panosu/);
    expect(src).toMatch(/6 haneli/);
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
