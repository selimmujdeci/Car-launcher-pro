/**
 * obdAdaptiveFreshness.test.ts — SAHA P0 (snapshot 2026-07-25, KWP/protokol 5 araç).
 *
 * BULGU: OBD `connected` + rpm 758 (rölanti) + son paket 7.8 s önce iken sabit 5 s
 * tazelik eşiği aşıldı → `obdAlive=false` → HAL `activeSource=GPS`,
 * `canPhase=FALLBACK_ACTIVE` → hız füzyonu GPS'e düştü → park hâlindeki GPS gürültüsü
 * 10.6 km/h üretti → sürüş/park modu 5 sn'de bir flip-flop + odometreye 48 m SAHTE km.
 *
 * ÖLÇÜM: 102 olay / 438 s ≈ 4.3 s ortalama kadans, jitter'lı → 5 s eşiğe marj %14.
 *
 * İki kilit:
 *  1) DAVRANIŞ — `obdCadenceGate` saf modülü (deterministik, zaman dışarıdan).
 *  2) YAPISAL  — worker'ın adaptif eşiği ve GPS hayalet kapısını atlamadığı.
 */
/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import {
  createObdCadenceGate,
  OBD_TIMEOUT_FLOOR_MS,
  OBD_TIMEOUT_CEIL_MS,
  OBD_GAP_SANE_MAX_MS,
} from '../platform/vehicleDataLayer/obdCadenceGate';
import workerSrc from '../platform/vehicleDataLayer/VehicleCompute.worker.ts?raw';

describe('obdCadenceGate — adaptif OBD tazelik eşiği', () => {
  it('hiç gözlem yokken TABAN eşiği verir (boot davranışı değişmez)', () => {
    const g = createObdCadenceGate();
    expect(g.timeoutMs()).toBe(OBD_TIMEOUT_FLOOR_MS);
    expect(g.peakGapMs()).toBe(0);
  });

  it('HIZLI kadans eşiği TABANIN ALTINA indirmez (kopma tespiti gecikmesin)', () => {
    const g = createObdCadenceGate();
    for (let i = 0; i < 50; i++) g.observe(500); // 2 Hz
    expect(g.timeoutMs()).toBe(OBD_TIMEOUT_FLOOR_MS);
  });

  it('SAHA VAKASI: ~4.3 s kadans + 7.8 s jitter tepesi → 7.8 s CANLI sayılır', () => {
    const g = createObdCadenceGate();
    // Gözlenen kadans: çoğunlukla ~4.3 s, arada jitter tepeleri
    const gaps = [4300, 4100, 4500, 6200, 4300, 7800, 4200, 4400];
    for (const gap of gaps) g.observe(gap);

    const timeout = g.timeoutMs();
    expect(timeout).toBeGreaterThan(7800);          // snapshot anındaki 7.8 s boşluk ARTIK stale DEĞİL
    expect(timeout).toBeLessThanOrEqual(OBD_TIMEOUT_CEIL_MS);
    // Regresyon: eski sabit eşik bu vakada yetersizdi
    expect(timeout).toBeGreaterThan(OBD_TIMEOUT_FLOOR_MS);
  });

  it('TAVAN aşılamaz — gerçek kopma sonsuza dek "canlı" görünemez', () => {
    const g = createObdCadenceGate();
    g.observe(25_000); // sane sınırın altında ama çok yavaş
    expect(g.timeoutMs()).toBe(OBD_TIMEOUT_CEIL_MS);
  });

  it('KOPMA boşluğu kadans SAYILMAZ (ölü kaynak kendi eşiğini büyütemez)', () => {
    const g = createObdCadenceGate();
    g.observe(4300);
    const before = g.timeoutMs();
    g.observe(OBD_GAP_SANE_MAX_MS);       // tam sınır — elenmeli
    g.observe(120_000);                   // 2 dakikalık kopma sonrası dönüş
    expect(g.timeoutMs()).toBe(before);   // öğrenme DEĞİŞMEDİ
  });

  it('geçersiz ölçüm elenir (NaN / 0 / negatif — saat anomalisi)', () => {
    const g = createObdCadenceGate();
    g.observe(NaN);
    g.observe(0);
    g.observe(-1200);
    g.observe(Infinity);
    expect(g.peakGapMs()).toBe(0);
    expect(g.timeoutMs()).toBe(OBD_TIMEOUT_FLOOR_MS);
  });

  it('YAVAŞLAMAYI anında öğrenir, HIZLANMAYI yavaşça unutur (histerezis)', () => {
    const g = createObdCadenceGate();
    g.observe(9000);
    const peakAfterSlow = g.peakGapMs();
    expect(peakAfterSlow).toBe(9000);           // yavaşlama ANINDA

    g.observe(1000);
    expect(g.peakGapMs()).toBeLessThan(peakAfterSlow);   // sönüm başladı
    expect(g.peakGapMs()).toBeGreaterThan(8000);         // ama ÇÖKMEDİ (tek örnekle sıfırlanmaz)

    for (let i = 0; i < 200; i++) g.observe(1000);       // uzun süre hızlı
    expect(g.timeoutMs()).toBe(OBD_TIMEOUT_FLOOR_MS);    // sonunda tabana döner
  });

  it('reset() öğrenilen kadansı sıfırlar (adaptör/oturum değişimi)', () => {
    const g = createObdCadenceGate();
    g.observe(9000);
    g.reset();
    expect(g.peakGapMs()).toBe(0);
    expect(g.timeoutMs()).toBe(OBD_TIMEOUT_FLOOR_MS);
  });

  it('BOUNDED: durum yalnız tek sayı — sınırsız geçmiş biriktirmez', () => {
    const g = createObdCadenceGate();
    for (let i = 0; i < 10_000; i++) g.observe(3000 + (i % 7) * 100);
    expect(Number.isFinite(g.peakGapMs())).toBe(true);
    expect(g.timeoutMs()).toBeLessThanOrEqual(OBD_TIMEOUT_CEIL_MS);
  });
});

describe('VehicleCompute.worker — adaptif eşik ve hayalet kapısı bağlantısı', () => {
  it('KİLİT: worker SABİT OBD eşiğine geri dönmez', () => {
    expect(workerSrc, 'sabit SRC_TIMEOUT_OBD_MS geri geldi — adaptif eşik atlanıyor')
      .not.toMatch(/SRC_TIMEOUT_OBD_MS/);
    expect(workerSrc).toMatch(/createObdCadenceGate/);
  });

  it('KİLİT: TÜM OBD tazelik kararları `_obdTimeoutMs()` üzerinden geçer', () => {
    const obdAliveCalls = workerSrc.match(/_alive\(_obdLastSeen,\s*([^)]+)\)/g) ?? [];
    expect(obdAliveCalls.length).toBeGreaterThan(0);
    for (const call of obdAliveCalls) {
      expect(call, `sabit eşikli OBD tazelik kontrolü kaldı: ${call}`)
        .toMatch(/_obdTimeoutMs\(\)/);
    }
    // VAL füzyonundaki güven hesabı da adaptif eşiği kullanmalı
    expect(workerSrc).toMatch(/_effectiveConf\(valOBD,\s*_obdTimeoutMs\(\)\)/);
    // Sağlık kapısı (SOURCE_HEALTH → HAL) da aynı eşiği görmeli
    expect(workerSrc).toMatch(/_healthGate\.decide\(now,\s*_obdLastSeen,\s*_obdTimeoutMs\(\)/);
  });

  it('KİLİT: OBD ingest yolları kadans ölçümünü ATLAMAZ', () => {
    // `_markObdSeen` gövdesi dışında `_obdLastSeen`e yazan tek meşru biçim
    // watchdog'un kasıtlı sıfırlamasıdır (`= 0`). Başka her yazım kadansı atlar.
    const markFn = workerSrc.slice(
      workerSrc.indexOf('function _markObdSeen'),
      workerSrc.indexOf('function _obdTimeoutMs'),
    );
    expect(markFn, '_markObdSeen kaldırılmış').not.toBe('');
    const directWrites = (workerSrc.replace(markFn, '').match(/_obdLastSeen\s*=\s*[^;]+;/g) ?? [])
      .filter((w) => !/=\s*0\s*;/.test(w));
    expect(directWrites, `kadans öğrenmeyi atlayan doğrudan yazım: ${directWrites.join(' | ')}`)
      .toEqual([]);
    expect(workerSrc).toMatch(/_markObdSeen\(nowPerf\)/);          // VEHICLE_DATA yolu
    expect(workerSrc).toMatch(/_markObdSeen\(performance\.now\(\)\)/); // legacy OBD_DATA yolu
  });

  it('KİLİT: GPS hayalet hızı füzyonu KAZANAMAZ (duran araçta sahte km yok)', () => {
    expect(workerSrc, 'GPS hayalet kapısı kaldırıldı — park hâlinde GPS gürültüsü geri döner')
      .toMatch(/_gpsGhostSpeed\(valGPS\?\.value\)\s*\n?\s*\?\s*0\s*:\s*_effectiveConf\(valGPS/);
  });

  it('KİLİT: hayalet kapısı ile `_hwSpeedContradicted` ÇAKIŞMAZ (Trafic vakası korunur)', () => {
    const ghost = workerSrc.slice(
      workerSrc.indexOf('function _gpsGhostSpeed'),
      workerSrc.indexOf('function _resolveSpeedSource'),
    );
    expect(ghost).not.toBe('');
    // İki kapı da AYNI iki sabitten okur → aralarında boşluk/örtüşme oluşamaz
    expect(ghost).toMatch(/HW_CONTRADICT_GPS_KMH/);
    expect(ghost).toMatch(/HW_CONTRADICT_RPM_MIN/);
    // Ters yön: bu kapı GPS'i ANCAK eşiğin ALTINDA ve motor rölanti üstüne çıkmamışken susturur
    expect(ghost).toMatch(/<=\s*HW_CONTRADICT_GPS_KMH/);
    expect(ghost).toMatch(/>\s*HW_CONTRADICT_RPM_MIN\)\s*return false/);
    // OBD ölüyse kapı AÇILMAZ (tek kaynak GPS iken onu susturmak körlük olur)
    expect(ghost).toMatch(/if \(!_alive\(_obdLastSeen, _obdTimeoutMs\(\)\)\) return false/);
    // "Okuma yok" ≠ "0 km/h" — null hız hayalet kararı ürettirmez
    expect(ghost).toMatch(/hw == null/);
  });
});
