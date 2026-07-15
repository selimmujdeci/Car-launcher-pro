/**
 * hwSpeedContradiction.test.ts — Zero-trust donanım hız çelişki kapısı kilitleri.
 *
 * KANIT (saha raporu 2026-07-15, id=8edd61a6, KWP/protokol 5):
 *   GPS 38.1 km/h · OBD hız 0 · RPM 1434 · gaz %13 · engineTemp 69
 * Motor verisi tutarlı, yalnız hız PID'i 0. KWP/Renault'da hız ABS ECU'sundadır;
 * motor ECU'su `010D`'ye `41 0D 00` döner. Native doğru (okunamazsa -1) → bu "veri yok"
 * DEĞİL, ECU "sıfır" DİYOR. Eski davranış: "donanım = kesin değer" → gösterge 0'da kaldı,
 * sürüş/park modu 7 kez flip-flop yaptı.
 *
 * Worker bir Web Worker modülüdür (jsdom'da çalıştırılamaz) → YAPISAL kilitler (`?raw`),
 * mevcut `workerSourceHealthTransport.test.ts` stiliyle aynı.
 */

import { describe, it, expect } from 'vitest';
import workerSrc from '../platform/vehicleDataLayer/VehicleCompute.worker.ts?raw';
import kbSrc from '../platform/rootCauseKb.ts?raw';

describe('Zero-trust · donanım hız çelişki kapısı', () => {
  it('çelişki predikatı MEVCUT ve saf (mutasyon yok)', () => {
    expect(workerSrc).toMatch(/function _hwSpeedContradicted\(/);
    const body = workerSrc.slice(
      workerSrc.indexOf('function _hwSpeedContradicted('),
      workerSrc.indexOf('function _resolveSpeedSource('),
    );
    // Saf predikat: yalnız okur, hiçbir modül state'ini YAZMAZ.
    expect(body).not.toMatch(/_resolvedSpeed\s*=|_resolvedSrc\s*=|_dispSpeed\s*=|_postPatch\(/);
    expect(body).toMatch(/return/);
  });

  it('üç koşul da şart: donanım~0 + GPS hareket + motor dönüyor', () => {
    const body = workerSrc.slice(
      workerSrc.indexOf('function _hwSpeedContradicted('),
      workerSrc.indexOf('function _resolveSpeedSource('),
    );
    expect(body).toMatch(/HW_ZERO_KMH/);            // donanım "duruyorum" diyor
    expect(body).toMatch(/HW_CONTRADICT_GPS_KMH/);  // GPS gerçek hareket görüyor
    expect(body).toMatch(/HW_CONTRADICT_RPM_MIN/);  // motor rölanti üstünde (hayalet GPS koruması)
    expect(body).toMatch(/_obd\.rpm/);
  });

  it('eşikler fail-closed: GPS eşiği ZERO_HOLD gürültü eşiğinin ÜSTÜNDE', () => {
    const zeroHold = /const ZERO_HOLD_KMH\s*=\s*([\d.]+)/.exec(workerSrc);
    const gpsMin   = /const HW_CONTRADICT_GPS_KMH\s*=\s*([\d.]+)/.exec(workerSrc);
    const rpmMin   = /const HW_CONTRADICT_RPM_MIN\s*=\s*([\d.]+)/.exec(workerSrc);
    const hwZero   = /const HW_ZERO_KMH\s*=\s*([\d.]+)/.exec(workerSrc);
    expect(zeroHold).not.toBeNull();
    expect(gpsMin).not.toBeNull();
    expect(rpmMin).not.toBeNull();
    expect(hwZero).not.toBeNull();
    // GPS gürültüsü (≤1.5) çelişki sayılmamalı → eşik belirgin şekilde üstünde
    expect(Number(gpsMin![1])).toBeGreaterThan(Number(zeroHold![1]) * 2);
    // Rölanti üstü: duran araçta klima yükü ~1000'e çıkabilir; eşik rölantiyi kapsamalı
    expect(Number(rpmMin![1])).toBeGreaterThanOrEqual(800);
    // "Duruyorum" eşiği dar tutulmalı (yavaş sürüşü çelişki sanmasın)
    expect(Number(hwZero![1])).toBeLessThanOrEqual(2);
  });

  it('VAL yolu: HAL/CAN/OBD güveni çelişkide 0’a düşer (GPS düşmez)', () => {
    const val = workerSrc.slice(
      workerSrc.indexOf('const valHAL = _valSignals.HAL?.speed;'),
      workerSrc.indexOf('// ── Legacy yol'),
    );
    for (const src of ['cHAL', 'cCAN', 'cOBD']) {
      const line = new RegExp(`const ${src} = _hwSpeedContradicted\\(`);
      expect(val).toMatch(line);
    }
    // GPS referans kaynaktır — kendi kendini çelişkiye düşüremez
    expect(val).not.toMatch(/const cGPS = _hwSpeedContradicted/);
  });

  it('legacy yol: çelişen donanım kaynağı ATLANIR → GPS’e düşülür', () => {
    const legacy = workerSrc.slice(workerSrc.indexOf('// ── Legacy yol'));
    expect(legacy).toMatch(/_alive\(_canLastSeen[^)]*\)\s*&&\s*!_hwSpeedContradicted\(/);
    expect(legacy).toMatch(/_alive\(_obdLastSeen[^)]*\)\s*&&\s*!_hwSpeedContradicted\(/);
    // GPS dalı kapıya TABİ DEĞİL (son çare kaynak)
    expect(legacy).toMatch(/_alive\(_gpsLastSeen[^)]*\)\)\s*\{/);
  });

  it('mevcut RPM çapraz kontrolü KALDIRILMADI (ters yön: hız var, RPM 0)', () => {
    // Regresyon kasası: eski kilit korunuyor — yeni kural onun SİMETRİĞİ, yerine geçmez.
    expect(workerSrc).toMatch(/src === 'OBD' && raw > 10 && _obd\.rpm === 0/);
  });

  it('“donanım kesin değer” varsayımı artık koşulsuz DEĞİL', () => {
    // Gösterim yolu hâlâ donanımı yumuşatmaz (doğru), ama kaynak seçimi artık kapıdan geçer.
    expect(workerSrc).toMatch(/Donanım kaynağı \(HAL\/CAN\/OBD\): kesin değer/);
    expect(workerSrc).toMatch(/_hwSpeedContradicted/);
  });
});

describe('Root Cause KB · fusion çelişkisi doğru dosyayı gösterir', () => {
  it('ANA YOL (worker) suspectFiles’ta ve ilk sırada', () => {
    const entry = kbSrc.slice(
      kbSrc.indexOf("code: 'FUSION_LOW_CONFIDENCE'"),
      kbSrc.indexOf("code: 'GPS_PERMISSION_DENIED'"),
    );
    // Yalnız suspectFiles DİZİSİ ölçülür (yorum metni değil — orada da adı geçiyor).
    const files = entry.slice(entry.indexOf('suspectFiles:'), entry.indexOf('suspectSymbols:'));
    const iWorker = files.indexOf('vehicleDataLayer/VehicleCompute.worker.ts');
    const iFusion = files.indexOf('src/platform/speedFusion.ts');
    expect(iWorker).toBeGreaterThan(-1);
    // İkincil yol (yalnız MiniMap/telemetry) hâlâ listede ama ana yoldan SONRA
    expect(iFusion).toBeGreaterThan(iWorker);
  });

  it('kaynak seçimi sembolleri kayıtlı', () => {
    const entry = kbSrc.slice(
      kbSrc.indexOf("code: 'FUSION_LOW_CONFIDENCE'"),
      kbSrc.indexOf("code: 'GPS_PERMISSION_DENIED'"),
    );
    expect(entry).toMatch(/_resolveSpeedSource/);
    expect(entry).toMatch(/_isSpeedRejected/);
  });
});
