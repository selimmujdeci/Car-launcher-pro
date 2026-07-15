/**
 * workerLegacyCompat.test — PR-RUNTIME-WORKER-1.
 *
 * KİLİT (regresyon kasası): eski head-unit WebView'ları (Chrome 52-79, ör. Duster/8227L)
 * module worker'ı DESTEKLEMEZ — `new Worker(url, {type:'module'})` dosya yüklenmeden ÖNCE
 * "Module scripts are not supported on DedicatedWorker" ile throw eder. Prod bundle worker'ı
 * IIFE paketler (worker.format:'iife') ama `type` seçeneği call-site'ta sabit 'module' kalırsa
 * yine throw olur → VehicleCompute ölür → ana-thread donması (Duster saha raporu 2026-07-15).
 *
 * Bu test CRITICAL (VehicleCompute) + OPTIONAL (VisionCompute) worker constructor'larının
 * type'ı BUILD-TIME sabitiyle (import.meta.env.DEV) seçtiğini kilitler; sabit 'module'a
 * geri dönüşü engeller. NavigationCompute BİLİNÇLİ module'dür ama `supportsModuleWorker()`
 * ile kapılıdır (eski WebView'de hiç kurulmaz) → bu testin kapsamı dışı.
 */

import { describe, it, expect } from 'vitest';
import vehicleResolverSrc from '../platform/vehicleDataLayer/VehicleSignalResolver.ts?raw';
import visionCoreSrc from '../platform/vision/visionCore.ts?raw';

/** Yorumları/boşlukları sadeleştir — kod satırlarında desen ararız (yorumdaki 'module' yanıltmasın). */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // blok yorumlar
    .replace(/^\s*\/\/.*$/gm, '');        // satır yorumlar
}

/** Prod (else) dalı: classic worker call-site VAR mı (WebView 52+ bunu alır). */
const CLASSIC = (name: string) =>
  new RegExp(`type:\\s*['"]classic['"]\\s*,\\s*name:\\s*['"]${name}['"]`);
/** Seçim BUILD-TIME sabitiyle (import.meta.env.DEV) yapılıyor mu — classic dalı DEV gate'i altında. */
const DEV_GATED_CLASSIC = (name: string) =>
  new RegExp(`import\\.meta\\.env\\.DEV[\\s\\S]{0,500}type:\\s*['"]classic['"]\\s*,\\s*name:\\s*['"]${name}['"]`);

describe('PR-RUNTIME-WORKER-1 — eski WebView worker uyumu (kilit)', () => {
  it('VehicleCompute prod dalı CLASSIC worker kurar (WebView<80 throw etmez)', () => {
    expect(codeOnly(vehicleResolverSrc)).toMatch(CLASSIC('VehicleCompute'));
  });

  it('VehicleCompute worker seçimi BUILD-TIME sabitiyle (import.meta.env.DEV) yapılır', () => {
    // Runtime UA-sniff DEĞİL; prod'da 'module' dalı ölü-kod elenir → yalnız classic kalır.
    expect(codeOnly(vehicleResolverSrc)).toMatch(DEV_GATED_CLASSIC('VehicleCompute'));
  });

  it('VisionCompute prod dalı CLASSIC worker kurar', () => {
    expect(codeOnly(visionCoreSrc)).toMatch(CLASSIC('VisionCompute'));
  });

  it('VisionCompute worker seçimi BUILD-TIME sabitiyle yapılır', () => {
    expect(codeOnly(visionCoreSrc)).toMatch(DEV_GATED_CLASSIC('VisionCompute'));
  });

  it('VehicleCompute worker hatası fail-soft (worker=null → ana-thread fallback korunur)', () => {
    // Constructor throw ederse catch bloğu _worker=null yapmalı (donma yerine boş gösterge).
    const code = codeOnly(vehicleResolverSrc);
    expect(code).toMatch(/catch\s*\([\s\S]*?\)\s*\{[\s\S]*?_worker\s*=\s*null/);
  });
});
