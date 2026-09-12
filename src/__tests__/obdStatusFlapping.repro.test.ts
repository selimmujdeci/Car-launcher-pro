/**
 * obdStatusFlapping.repro.test.ts — REPRODUCER: OBD bağlı/kopuk dalgalanması.
 *
 * SAHA ŞİKAYETİ: bağlantı sağlıklıyken UI 1–2 saniyede bir "bağlı/kopuk" arasında
 * dalgalanıyor; bazen "OBD bağlı değil" gösteriyor.
 *
 * KÖK NEDEN HİPOTEZİ (bu testler kanıtlar):
 *   1. `OBD_FRESH_MS = 3000` tazelik eşiği, ÇEKİRDEK POLL PERİYODUYLA aynı büyüklükte.
 *      BALANCED modda native FAST poll 3000ms → paketler arası yaş TAM eşiğin etrafında
 *      salınır → connected ↔ stale dalgalanması.
 *   2. Zayıf head unit modunda (BASIC_JS/termal/limp) poll periyodu 10s/30s
 *      (performanceMode.obdPollInterval) → yaş `OBD_STALE_MS`(10s)'i AŞAR →
 *      `deriveObdStatus` sağlıklı transport'ta bile 'disconnected' der → KALICI sahte
 *      "OBD: Bağlı değil".
 *   3. `deriveObdStatus` "veri taze değil" ile "transport koptu"yu AYNI 'disconnected'
 *      kovasına atıyor → UI gerçek kopmayı sahte kopmadan ayırt EDEMİYOR.
 *
 * Bu dosya davranışı OLMASI GEREKTİĞİ gibi tarif eder; düzeltmeden ÖNCE kırmızıdır.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveObdStatus,
  OBD_FRESH_MS,
  OBD_STALE_MS,
  type ObdStatus,
} from '../platform/vehicleStatusModel';

/** Sağlıklı, GERÇEKTEN bağlı bir oturumun taban girdisi (link DOĞRULANMIŞ canlı). */
const HEALTHY = {
  connectionState: 'connected',
  source: 'real',
  available: true,
  transportConnected: true,
} as const;

/**
 * Bir poll kadansında ardışık UI render'larını simüle eder ve üretilen durum
 * dizisini döner. Paketler `pollMs`'de bir gelir; UI `renderMs`'de bir yeniden çizer
 * (VehicleStatusIndicators `Date.now()`'ı RENDER anında okur — bu yüzden ikisi ayrı).
 */
function simulate(opts: {
  pollMs: number; renderMs: number; durationMs: number;
}): ObdStatus[] {
  const { pollMs, renderMs, durationMs } = opts;
  const out: ObdStatus[] = [];
  const t0 = 1_000_000;
  let lastSeenMs = t0; // ilk paket t0'da geldi
  for (let now = t0; now <= t0 + durationMs; now += renderMs) {
    // O ana kadar gelmiş EN SON paketin zamanı (poll kadansı).
    const packets = Math.floor((now - t0) / pollMs);
    lastSeenMs = t0 + packets * pollMs;
    out.push(deriveObdStatus({ ...HEALTHY, lastSeenMs, now }));
  }
  return out;
}

/** Ardışık farklı durumlar arasındaki geçiş sayısı (dalgalanma ölçüsü). */
function transitions(states: readonly ObdStatus[]): number {
  let n = 0;
  for (let i = 1; i < states.length; i++) if (states[i] !== states[i - 1]) n++;
  return n;
}

describe('KÖK 1 — tazelik eşiği poll periyoduyla aynı büyüklükte → dalgalanma', () => {
  it('BALANCED (3s poll): sağlıklı bağlantı 60s boyunca DALGALANMAMALI', () => {
    // performanceMode BALANCED → obdPollInterval 3_000; OBD_FRESH_MS de 3_000.
    // Paket 3s'de bir gelirse yaş her turda 0→3000 arası gezer ve eşiği DÖVER.
    const states = simulate({ pollMs: 3_000, renderMs: 250, durationMs: 60_000 });
    const uniq = [...new Set(states)];

    // Sağlıklı bir bağlantı TEK bir durumda kalmalı ('connected').
    expect(uniq).toEqual(['connected']);
    expect(transitions(states)).toBe(0);
  });

  it('düşük-uç NORMAL (1s poll) sağlıklı kalır — bu senaryo bugün ÇALIŞIYOR (regresyon kilidi)', () => {
    const states = simulate({ pollMs: 1_000, renderMs: 250, durationMs: 30_000 });
    expect([...new Set(states)]).toEqual(['connected']);
  });
});

describe('KÖK 2 — zayıf head unit poll periyodu tazelik bandını aşıyor', () => {
  it('KRİTİK: 10s poll (BASIC_JS/termal) sağlıklı transport"ta "disconnected" DEMEMELİ', () => {
    // performanceMode zayıf mod → obdPollInterval 10_000; computeObdPollProfile bu modda
    // native poll'u moda BİREBİR uyduruyor → çekirdek PID 10s'de bir gelir.
    // OBD_STALE_MS de 10_000 → yaş eşiği aşar → sahte "OBD: Bağlı değil".
    const states = simulate({ pollMs: 10_000, renderMs: 500, durationMs: 60_000 });
    expect(states).not.toContain('disconnected');
  });

  it('KRİTİK: 30s poll (limp mode) sağlıklı transport"ta "disconnected" DEMEMELİ', () => {
    const states = simulate({ pollMs: 30_000, renderMs: 500, durationMs: 120_000 });
    expect(states).not.toContain('disconnected');
  });
});

describe('KÖK 3 — "veri taze değil" ile "transport koptu" AYRI olmalı', () => {
  it('KRİTİK: transport bağlıyken uzun veri boşluğu "disconnected" ÜRETMEMELİ', () => {
    // connectionState hâlâ 'connected' (transport doğrulanmış link) ama ECU 60s susmuş.
    // Bu bir "stale" durumudur — "kopuk" DEĞİLDİR. Kullanıcıya "OBD bağlı değil" demek
    // YALAN olur; adaptör takılı, hat sağlam, yalnız ECU veri vermiyor.
    const st = deriveObdStatus({ ...HEALTHY, lastSeenMs: 1_000_000, now: 1_060_000 });
    expect(st).not.toBe('disconnected');
    expect(st).toBe('stale');
  });

  it('kısa veri boşluğunda son değerler KORUNUR (stale), bağlantı düşmez', () => {
    const st = deriveObdStatus({ ...HEALTHY, lastSeenMs: 1_000_000, now: 1_005_000 });
    expect(st).toBe('stale');
  });

  it('GERÇEK kopma gizlenmez: connectionState kopukken durum disconnected olmalı', () => {
    // Dürüstlük kilidi — grace period gerçek kopmayı SAKLAMAMALI.
    const st = deriveObdStatus({
      connectionState: 'idle', source: 'none', available: true,
      lastSeenMs: 1_000_000, now: 1_000_100,
    });
    expect(st).toBe('disconnected');
  });

  it('GERÇEK kopma gizlenmez: transportConnected=false → taze veri olsa BİLE disconnected', () => {
    // Adaptör fiziksel çıkarıldı; son paket 100ms önce geldi (hâlâ "taze"). Doğrulanmış
    // link kopması tazeliği EZER — gerçek kopma gizlenmez.
    const st = deriveObdStatus({
      connectionState: 'connected', source: 'real', available: true,
      transportConnected: false, lastSeenMs: 1_000_000, now: 1_000_100,
    });
    expect(st).toBe('disconnected');
  });

  it('geriye dönük uyum: transportConnected verilmezse eski davranış (connectionState"e güven)', () => {
    const st = deriveObdStatus({
      connectionState: 'connected', source: 'real', available: true,
      lastSeenMs: 1_000_000, now: 1_000_100,
    });
    expect(st).toBe('connected');
  });

  it('kadans-farkındalı freshMs: POWER_SAVE penceresiyle 15s yaş TAZE sayılır', () => {
    // freshMs = fastMs×3 + 2000 = 47_000 (POWER_SAVE). 15s yaş → hâlâ connected.
    const st = deriveObdStatus({
      ...HEALTHY, lastSeenMs: 1_000_000, now: 1_015_000, freshMs: 47_000,
    });
    expect(st).toBe('connected');
  });

  it('mock/none kaynak asla bağlı sayılmaz (mevcut sözleşme korunur)', () => {
    expect(deriveObdStatus({
      connectionState: 'connected', source: 'mock', available: true,
      lastSeenMs: 1_000_000, now: 1_000_100,
    })).toBe('disconnected');
  });
});

describe('mevcut sözleşme — korunmalı (regresyon kilidi)', () => {
  it('native değilse unavailable', () => {
    expect(deriveObdStatus({
      connectionState: 'connected', source: 'real', available: false,
      lastSeenMs: 1_000_000, now: 1_000_100,
    })).toBe('unavailable');
  });

  it('error state korunur', () => {
    expect(deriveObdStatus({
      connectionState: 'error', source: 'none', available: true,
      lastSeenMs: 0, now: 1_000_000,
    })).toBe('error');
  });

  it('bağlanma aşamaları connecting', () => {
    for (const cs of ['connecting', 'initializing', 'scanning', 'reconnecting']) {
      expect(deriveObdStatus({
        connectionState: cs, source: 'none', available: true, lastSeenMs: 0, now: 1_000_000,
      })).toBe('connecting');
    }
  });

  it('connected ama hiç paket yok → connecting', () => {
    expect(deriveObdStatus({ ...HEALTHY, lastSeenMs: 0, now: 1_000_000 })).toBe('connecting');
  });

  it('saat atlaması (negatif yaş) son bilineni korur', () => {
    expect(deriveObdStatus({ ...HEALTHY, lastSeenMs: 2_000_000, now: 1_000_000 })).toBe('connected');
  });

  it('taze paket connected', () => {
    expect(deriveObdStatus({ ...HEALTHY, lastSeenMs: 1_000_000, now: 1_000_500 })).toBe('connected');
  });

  it('eşik sabitleri tanımlı (bant sırası korunur)', () => {
    expect(OBD_FRESH_MS).toBeLessThan(OBD_STALE_MS);
  });
});
