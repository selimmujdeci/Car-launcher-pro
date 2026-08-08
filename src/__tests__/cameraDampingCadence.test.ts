/**
 * cameraDampingCadence.test.ts — kamera sönümlemesi ÇAĞRI TEMPOSUNDAN bağımsız.
 *
 * ── KİLİTLENEN KUSUR ────────────────────────────────────────────────────────
 * `dampCameraToward` üstel bir ortalama uygular ve alfa **çağrı başınadır**.
 * Alfalar sahada 150 ms'lik tempoda ayarlandı, ama fonksiyon üründe üç farklı
 * tempoda çağrılıyor:
 *   · `FullMapView` normal takip  → 150 ms  (`cameraThrottleMs`)
 *   · `MiniMapWidget`             → GPS fix hızı ≈ 500 ms (2 Hz tavanı)
 *   · `FullMapView` ölü hesaplama → 16 ms   (`drInterval`)
 * Sabit alfa ile aynı `DAMP_PITCH = 0.11` şu zaman sabitlerini üretiyordu:
 *   150 ms → τ ≈ 1,29 s · 500 ms → τ ≈ 4,29 s (3,3× tembel) ·
 *    16 ms → τ ≈ 0,14 s (9,4× hırçın)
 * Yani mini harita "AYNI politika, AYNI argümanlar" ile çağırmasına rağmen
 * ÖLÇÜLEBİLİR biçimde farklı bir kamera hissi üretiyordu; fark politikada
 * değil TEMPODAYDI ve hiçbir yerde görünmüyordu.
 *
 * ── BU DOSYANIN İKİ GÖREVİ ──────────────────────────────────────────────────
 *  1. **REGRESYON KALKANI:** 150 ms'lik kalibrasyon temposunda çıktı BİREBİR
 *     eskisi gibi kalmalı — sahada tek tek ayarlanmış tam ekran davranışı
 *     değişmedi. (Referans değerler bu dosyada elle, eski sabit-alfa
 *     formülüyle hesaplanır; motorun kendi çıktısıyla karşılaştırılmaz.)
 *  2. **YENİ SÖZLEŞME:** aynı GERÇEK süre boyunca farklı tempolarda ilerleyen
 *     iki kamera, yakın bir sonuca varmalı.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CAMERA_CFG,
  computeCameraTarget,
  dampCameraToward,
  rateAdjustAlpha,
  clampCameraDt,
  resetCameraSmooth,
  getCameraDampingSnapshot,
  _resetCameraDampingCountersForTest,
} from '../platform/cameraEngine';

const CAL = CAMERA_CFG.CALIBRATION_DT_MS;

/** Sabit tempoda `ticks` kadar sönümle ve son pitch'i döndür. */
function runPitch(speedKmh: number, dtMs: number | undefined, ticks: number): number {
  const target = computeCameraTarget(speedKmh);
  let last = 0;
  for (let i = 0; i < ticks; i++) {
    last = dampCameraToward(target, undefined, speedKmh, dtMs).pitch;
  }
  return last;
}

beforeEach(() => {
  resetCameraSmooth();
  _resetCameraDampingCountersForTest();
});

describe('rateAdjustAlpha — kadans uyarlaması (saf)', () => {
  it('KALİBRASYON NOKTASI: Δt = 150 ms alfayı AYNEN döndürür', () => {
    for (const a of [
      CAMERA_CFG.DAMP_ZOOM, CAMERA_CFG.DAMP_PITCH, CAMERA_CFG.DAMP_LOOK,
      CAMERA_CFG.DAMP_BEARING_URBAN, CAMERA_CFG.DAMP_BEARING_HIGHWAY,
      CAMERA_CFG.CRUISE_DAMP_ZOOM, CAMERA_CFG.CRUISE_DAMP_PITCH,
    ]) {
      expect(rateAdjustAlpha(a, CAL), `α ${a} kalibrasyon temposunda kaymış`)
        .toBeCloseTo(a, 12);
    }
  });

  it('ZAMAN SABİTİ KORUNUR: farklı Δt, aynı τ', () => {
    const tau = (alpha: number, dtMs: number) => (dtMs / 1000) / -Math.log(1 - alpha);
    const ref = tau(CAMERA_CFG.DAMP_PITCH, CAL);
    for (const dt of [16, 33, 60, 150, 300, 500, 600]) {
      expect(tau(rateAdjustAlpha(CAMERA_CFG.DAMP_PITCH, dt), dt), `Δt=${dt} ms'te τ kaymış`)
        .toBeCloseTo(ref, 6);
    }
  });

  it('MONOTON: Δt büyüdükçe alfa büyür, 1\'i AŞMAZ', () => {
    let prev = -1;
    for (const dt of [16, 50, 150, 400, 600, 5_000]) {
      const a = rateAdjustAlpha(CAMERA_CFG.DAMP_PITCH, dt);
      expect(a).toBeGreaterThan(prev);
      expect(a).toBeLessThanOrEqual(1);
      prev = a;
    }
  });

  it('FAIL-SOFT: ölçülemeyen Δt alfayı DEĞİŞTİRMEZ', () => {
    const a = CAMERA_CFG.DAMP_PITCH;
    expect(rateAdjustAlpha(a, Number.NaN)).toBe(a);
    expect(rateAdjustAlpha(a, 0)).toBe(a);
    expect(rateAdjustAlpha(a, -50)).toBe(a);
  });
});

describe('clampCameraDt — güvenli Δt bandı', () => {
  it('ÖLÇÜM YOKSA kalibrasyon aralığı varsayılır (bugünkü davranış korunur)', () => {
    expect(clampCameraDt(undefined)).toBe(CAL);
    expect(clampCameraDt(null)).toBe(CAL);
    expect(clampCameraDt(Number.NaN)).toBe(CAL);
    expect(clampCameraDt(-1)).toBe(CAL);
  });

  it('UZUN BOŞLUK KIRPILIR: arka plandan dönüşte kamera SIÇRAMAZ', () => {
    // Tavan olmasaydı α → 1 olur, kamera tek karede hedefe atlardı.
    expect(clampCameraDt(30_000)).toBe(CAMERA_CFG.DT_MAX_MS);
    expect(rateAdjustAlpha(CAMERA_CFG.DAMP_PITCH, clampCameraDt(30_000)))
      .toBeLessThan(0.5);
  });

  it('TABAN: bir kareden kısa aralık ölçüm gürültüsüdür', () => {
    expect(clampCameraDt(0.4)).toBe(CAMERA_CFG.DT_MIN_MS);
  });
});

describe('REGRESYON KALKANI — 150 ms\'te davranış BİREBİR korunur', () => {
  it('pitch akışı eski sabit-alfa + tick-sayan cruise algoritmasıyla AYNI', () => {
    const speed = 60;
    const target = computeCameraTarget(speed);
    /* ESKİ ALGORİTMANIN BAĞIMSIZ KOPYASI (oracle) — motorun çıktısıyla
       karşılaştırmak yerine eski davranış burada elle yeniden kurulur:
         · alfa SABİT (Δt uyarlaması yok)
         · cruise ölçütü TICK SAYISI (7 ardışık tick)
       Sabit hızda delta ≈ 0 olduğundan cruise ilk tick'ten itibaren birikir. */
    let ref = CAMERA_CFG.PITCH_IDLE;
    let cruiseTicks = 0;
    for (let i = 0; i < 20; i++) {
      cruiseTicks = Math.min(cruiseTicks + 1, 7 + 2);
      const alpha = cruiseTicks >= 7 ? CAMERA_CFG.CRUISE_DAMP_PITCH : CAMERA_CFG.DAMP_PITCH;
      ref += (target.pitch - ref) * alpha;
    }

    const got = runPitch(speed, CAL, 20);
    expect(got, 'kalibrasyon temposunda sahada ayarlanmış davranış değişmiş')
      .toBeCloseTo(ref, 9);
  });

  it('Δt HİÇ verilmezse de eski davranış korunur (geriye dönük uyum)', () => {
    const a = runPitch(60, CAL, 12);
    resetCameraSmooth();
    const b = runPitch(60, undefined, 12);
    expect(b).toBeCloseTo(a, 12);
  });

  it('CRUISE eşiği 150 ms\'te tam 7 tick sonra kilitlenir (eski tick sayısı)', () => {
    // Sabit hız → delta ≈ 0 → her tick cruise sayılır.
    const target = computeCameraTarget(80);
    for (let i = 0; i < 6; i++) dampCameraToward(target, undefined, 80, CAL);
    expect(getCameraDampingSnapshot().inCruise, '6 tickte kilitlenmiş — eşik erkene kaymış')
      .toBe(false);
    dampCameraToward(target, undefined, 80, CAL);
    expect(getCameraDampingSnapshot().inCruise, '7. tickte kilitlenmemiş — eşik geriye kaymış')
      .toBe(true);
  });
});

describe('YENİ SÖZLEŞME — aynı SÜRE, farklı tempo, aynı sonuç', () => {
  it('pitch: 3 sn boyunca 2 Hz · 6,7 Hz · 60 Hz yakınsar', () => {
    const speed = 90;
    const TOTAL_MS = 3_000;
    const results = [500, CAL, 16].map((dt) => {
      resetCameraSmooth();
      return runPitch(speed, dt, Math.round(TOTAL_MS / dt));
    });
    const [slow, mid, fast] = results;
    // Kadans-bağımlıyken mini harita (500 ms) tam ekranın ÇOK gerisinde kalıyordu.
    expect(Math.abs(slow - mid), `mini harita temposu sapmış (${slow} vs ${mid})`)
      .toBeLessThan(1.0);
    expect(Math.abs(fast - mid), `ölü hesaplama temposu sapmış (${fast} vs ${mid})`)
      .toBeLessThan(1.0);
  });

  it('KUSUR KANITI: uyarlama olmasaydı 500 ms tempo belirgin sapardı', () => {
    // Eski davranışın simülasyonu: sabit alfa, 3 sn'de 6 tick (2 Hz).
    const target = computeCameraTarget(90);
    let oldSlow = CAMERA_CFG.PITCH_IDLE;
    for (let i = 0; i < 6; i++) oldSlow += (target.pitch - oldSlow) * CAMERA_CFG.DAMP_PITCH;

    resetCameraSmooth();
    const newSlow = runPitch(90, 500, 6);
    expect(newSlow - oldSlow, 'sapma yok — kusur zaten yokmuş gibi görünüyor, kilit anlamsız')
      .toBeGreaterThan(3);
  });

  it('bearing: 60 Hz tempo dönüşü ANİ tamamlamaz', () => {
    // Kadans-bağımlıyken 16 ms'lik ölü hesaplama yolunda bearing 9,4× hızlı
    // yakınsıyordu → harita dönüşte savruluyordu.
    const target = computeCameraTarget(60);
    resetCameraSmooth({ bearing: 0 });
    // 150 ms'lik TEK tick kadar gerçek süre = 16 ms'lik ~9 tick.
    for (let i = 0; i < 9; i++) dampCameraToward(target, 90, 60, 16);
    const fast = dampCameraToward(target, 90, 60, 16).bearing;

    resetCameraSmooth({ bearing: 0 });
    const mid = dampCameraToward(target, 90, 60, CAL).bearing;

    expect(Math.abs(fast - mid), `bearing tempoya bağlı kalmış (${fast} vs ${mid})`)
      .toBeLessThan(3);
  });
});

describe('GÖZLEM UCU — kadans sapması GÖRÜNÜR (CAROS LAB)', () => {
  it('hiç sürülmeden ölçüm UYDURULMAZ', () => {
    const s = getCameraDampingSnapshot();
    expect(s.lastDtMs, 'ölçüm yokken sahte Δt üretilmiş').toBeNull();
    expect(s.effectivePitchTauSec, 'ölçüm yokken sahte τ üretilmiş').toBeNull();
    expect(s.tickCount).toBe(0);
  });

  it('kalibrasyon dışı tempo SAYILIR', () => {
    const target = computeCameraTarget(50);
    dampCameraToward(target, undefined, 50, CAL);      // banda içinde
    dampCameraToward(target, undefined, 50, 500);      // 3,3× → banda dışı
    dampCameraToward(target, undefined, 50, 16);       // 0,1× → banda dışı
    const s = getCameraDampingSnapshot();
    expect(s.tickCount).toBe(3);
    expect(s.offCadenceTicks, 'kalibrasyon dışı tempo görünmüyor').toBe(2);
  });

  it('ölçülen τ tempo ne olursa olsun hedefe YAKIN kalır', () => {
    const target = computeCameraTarget(70);
    for (const dt of [16, 150, 500]) {
      dampCameraToward(target, undefined, 70, dt);
      const s = getCameraDampingSnapshot();
      expect(s.effectivePitchTauSec, `Δt=${dt} ms'te τ hedeften sapmış`)
        .toBeCloseTo(s.calibrationPitchTauSec, 2);
    }
  });
});
