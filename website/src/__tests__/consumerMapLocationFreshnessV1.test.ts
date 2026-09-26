/**
 * consumerMapLocationFreshnessV1.test.ts — HARİTA "ŞU ANDA BURADA" DEMEZ.
 *
 * ── TEMEL İLKE ──────────────────────────────────────────────────────────────
 *   STALE ≠ LIVE.  "Son bilinen konum" ≠ "araç şu anda burada".
 *
 * ── ÖLÇÜLEN KUSUR (V1 kapanış denetimi) ────────────────────────────────────
 * Arabam Cebimde harita sekmesi (`VehicleMapView`) aracı pin'liyor ve
 * "x km uzakta" yazıyordu ama TAZELİK HİÇ BELİRTİLMİYORDU. Günler önce
 * alınmış bir konum ekranda güncel konumla AYNI görünüyordu. Aynı ürünün
 * "Aracım" ekranı (`HomeLocation`) bu ayrımı zaten yapıyordu — yani kusur
 * eksik bir bağlantıydı, eksik bir yetenek değil.
 *
 * ── SINIR ────────────────────────────────────────────────────────────────
 * Bileşen HÜKÜM ÜRETMEZ. Tazelik kararı kanonik `vehicleTelemetryFreshness`
 * otoritesinindir (`locationIsLive` · `locationAgeMs`); bileşen yalnız OKUR
 * ve "Aracım" ekranıyla AYNI dili kullanır. İkinci bir tazelik otoritesi
 * kurulması bu kilitlerle DÜŞER.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildVehicleFreshness,
  ageLabel,
  FRESHNESS_WINDOWS_MS,
} from '@/lib/fleet/vehicleTelemetryFreshness';
import { buildAracimHome, type AracimHomeInput } from '@/lib/home/aracimHome';

const NOW = Date.parse('2026-09-19T12:00:00.000Z');
const LAT = 36.9175, LNG = 34.8621;   // Mersin

function telemetryAged(ageMs: number | null) {
  return buildVehicleFreshness({
    now: NOW,
    readable: true,
    row: ageMs === null ? null : {
      updatedAt: new Date(NOW - ageMs).toISOString(),
      lat: LAT, lng: LNG,
      /* Konum gözlem damgası kanonik alan adıyla verilir; `updatedAt`
         satırın yazılma anıdır, ÖLÇÜM anı değildir. */
      gpsObservedAt: new Date(NOW - ageMs).toISOString(),
    },
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · KANONİK TAZELİK GERÇEĞİ (davranış)
 * ══════════════════════════════════════════════════════════════════════════ */

describe('V1 · konum tazeliği kanonik otoriteden gelir', () => {
  it('1. 🔒 TAZE konum → canlı ve yaşı insan dilinde', () => {
    const t = telemetryAged(30_000);
    expect(t.locationIsLive).toBe(true);
    expect(t.locationAgeMs).not.toBeNull();
    expect(ageLabel(t.locationAgeMs)).toBe('Az önce');
  });

  it('2. 🔒 BAYAT konum CANLI SAYILMAZ (pencere aşıldı)', () => {
    /* MUTASYON KAPISI: burası `true` olursa harita günler önceki bir konumu
       "araç şu anda burada" gibi gösterir. */
    const t = telemetryAged(FRESHNESS_WINDOWS_MS.LOCATION + 60_000);
    expect(t.locationIsLive).toBe(false);
    expect(t.location).not.toBe('LIVE');
  });

  it('3. 🔒 ÇOK ESKİ konumun yaşı gizlenmez', () => {
    const t = telemetryAged(3 * 24 * 60 * 60_000);
    expect(t.locationIsLive).toBe(false);
    expect(ageLabel(t.locationAgeMs)).toBe('3 gün önce');
  });

  it('4. 🔒 HİÇ gözlenmemiş konum "şimdi" DEĞİL, BİLİNMİYOR', () => {
    const t = telemetryAged(null);
    expect(t.locationAgeMs).toBeNull();
    expect(t.locationIsLive).toBe(false);
    expect(ageLabel(null)).toBe('Bilinmiyor');
    /* Uydurma koordinat da YOK — 0,0'a düşmez. */
    expect(t.latitude).toBeNull();
    expect(t.longitude).toBeNull();
  });

  it('5. 🔒 harita ile Aracım ekranı AYNI gerçeği anlatır', () => {
    /* İki yüzey ayrı hüküm üretirse kullanıcı aynı araç için iki farklı
       "ne zaman" görür — tam olarak bu turda kapatılan kusurun kaynağı. */
    for (const ageMs of [30_000, FRESHNESS_WINDOWS_MS.LOCATION + 60_000, 3 * 24 * 60 * 60_000]) {
      const t = telemetryAged(ageMs);
      const home = buildAracimHome({
        now: NOW,
        vehicle: { name: 'Doblo', plate: '33 ABC 33', status: 'offline', telemetry: t },
        health: null, trips: [],
      } as unknown as AracimHomeInput);
      if (home.location.kind !== 'LAST_KNOWN') continue;
      expect(home.location.isLive).toBe(t.locationIsLive);
      expect(home.location.ageLabel).toBe(ageLabel(t.locationAgeMs));
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · BİLEŞEN KİLİTLERİ — bağlantı kopmasın
 * ══════════════════════════════════════════════════════════════════════════ */

describe('V1 · harita bileşeni kanonik tazeliği GÖSTERİR', () => {
  const SRC = readFileSync(
    resolve(process.cwd(), 'src/components/pwa/VehicleMapView.tsx'), 'utf8');
  /** Yorumları söker — kuralı AÇIKLAYAN yorum ihlal sanılmasın (`://` korunur). */
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');

  it('6. 🔒 tazelik KANONİK otoriteden okunur', () => {
    expect(CODE).toContain("from '@/lib/fleet/vehicleTelemetryFreshness'");
    expect(CODE).toContain('telemetry?.locationIsLive');
    expect(CODE).toContain('telemetry?.locationAgeMs');
  });

  it('7. 🔒 canlı olmayan konum "son bilinen" olarak adlandırılır', () => {
    expect(CODE).toContain('Aracın son bilinen konumu');
    expect(CODE).toContain('Aracın güncel konumu');
    /* MUTASYON KAPISI: etiket koşulsuzlaşırsa bayat konum "güncel" olur. */
    expect(CODE).toMatch(/locationIsLive\s*\?\s*'Aracın güncel konumu'\s*:\s*'Aracın son bilinen konumu'/);
  });

  it('8. 🔒 bileşen KENDİ yaş hesabını ARAÇ konumu için yapmaz', () => {
    /* Park yeri kullanıcının KENDİ kaydıdır ve kendi damgasını taşır; araç
       telemetrisiyle karıştırılmaması için ayrı tutulur. Araç konumu için
       ikinci bir yaş matematiği YASAKTIR. */
    const aracYasHesabi = /Date\.now\(\)\s*-\s*[^;]*telemetry/;
    expect(CODE).not.toMatch(aracYasHesabi);
    expect(CODE).toContain('ageLabel(');
  });

  it('9. 🔒 konum yokken uydurma pin/uzaklık YOK', () => {
    expect(CODE).toContain('Araç konumu henüz alınmadı');
    /* Mesafe rozeti yalnız gerçek koordinat VARKEN çizilir. */
    expect(CODE).toMatch(/vehicle\?\.lat\s*&&\s*distVeh/);
  });

  it('10. 🔒 ham koordinat kullanıcıya DÖKÜLMEZ (rozet metninde)', () => {
    /* Paylaşım bağlantısı koordinat taşır (kasıtlı, kullanıcı ister);
       ama ekrandaki rozet enlem/boylam basmaz. */
    const rozet = CODE.slice(CODE.indexOf('uzakta'), CODE.indexOf('uzakta') + 900);
    expect(rozet).not.toMatch(/toFixed\(5\)/);
  });
});
