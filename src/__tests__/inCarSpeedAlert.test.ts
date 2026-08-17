/**
 * inCarSpeedAlert.test.ts — ARAÇ İÇİ hız uyarısının UÇTAN UCA kilitleri.
 *
 * ── KİLİTLENEN ÖLÇÜLEN KUSUR (2026-08-14, devir belgesi B3) ────────────────
 * Hız eşiği aşıldığında uyarı YALNIZ telefona push olarak gidiyordu. Direksiyon
 * başındaki kişi — uyarının asıl muhatabı — hiçbir şey görmüyordu. Üstelik
 * telefon ucu ağ gerektirdiği için çevrimdışıyken uyarı TAMAMEN kayboluyordu.
 *
 * Bu dosya zincirin KOPMAZLIĞINI kilitler:
 *   speedAlertRuntime (karar) → dispatchSpeedLimitExceeded (olay)
 *   → SystemOrchestrator (TEK sunum otoritesi) → useSystemStore (sürücü ekranı)
 *
 * En büyük risk "ölü uç"tur: olay yayınlanır ama kimse dinlemez. Bu yüzden
 * kilit olayı GERÇEKTEN yayınlar ve store'da SONUCU arar — kaynak taraması
 * değil, davranış ölçümü.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Orchestrator'ın hız uyarısıyla İLGİSİZ bağımlılıkları susturulur ────────
 * Amaç yalnız uyarı zincirini ölçmek; termal/bilişsel/topluluk katmanları bu
 * kilidin konusu değildir. Olay hub'ı ve sistem deposu GERÇEKTİR — zincirin
 * kopup kopmadığı ancak gerçek uçlarla ölçülebilir. */
const _speak = vi.fn();
vi.mock('../platform/ttsService', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  speakAlert: (m: string) => _speak(m),
}));
vi.mock('../platform/tripLogService', () => ({ onTripState: () => () => {} }));
vi.mock('../platform/system/CognitivePriorityEngine', () => ({
  startCognitiveEngine: () => {}, stopCognitiveEngine: () => {},
}));
vi.mock('../platform/thermalWatchdog', () => ({
  onThermalLevelChange: () => () => {},
  getThermalSnapshot: () => ({ level: 0 }),
}));
/* `AdaptiveRuntimeManager` MOCK'LANMAZ: dolaylı bağımlılıklar (gpsService →
   SystemHealthMonitor) onun birçok getter'ını modül yüklenirken okur ve eksik
   bir taklit, ölçülen kusurla ilgisi olmayan çökmeler üretir. Gerçeği zaten
   saftır — bu testte yalnız termal kısıt yazılır, yan etkisi yoktur. */
vi.mock('../platform/communityService', () => ({
  setCommunityThermalLevel: () => {}, stopCommunityService: () => {},
}));
vi.mock('../platform/errorBus', () => ({ showToast: () => {} }));
vi.mock('../platform/system/ThermalJournal', () => ({
  thermalJournal: { start: () => {}, stop: () => {}, record: () => {} },
}));
vi.mock('../platform/remoteConfigService', () => ({
  startRemoteConfigService: () => () => {},
}));

import { startSystemOrchestrator } from '../platform/system/SystemOrchestrator';
import { dispatchSpeedLimitExceeded } from '../platform/vehicleDataLayer/VehicleEventHub';
import { useSystemStore } from '../store/useSystemStore';

let stop: (() => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  useSystemStore.setState({ activeAlerts: [], isReverseActive: false });
  stop = startSystemOrchestrator();
});

afterEach(() => { stop?.(); stop = null; });

function alerts() { return useSystemStore.getState().activeAlerts; }

describe('araç içi hız uyarısı — zincir kopmuyor', () => {
  it('KİLİT: eşik aşımı SÜRÜCÜNÜN EKRANINA düşer (telefon tek muhatap değil)', () => {
    dispatchSpeedLimitExceeded(131, 100);

    const a = alerts().find((x) => x.type === 'SPEED_LIMIT_EXCEEDED');
    expect(a).toBeDefined();
    expect(a?.severity).toBe('WARNING');
    // Ölçülen hız ve KULLANICININ KENDİ eşiği ayrı ayrı görünür — sürücü
    // uyarının nereden geldiğini bilmeli (yol levhası değil, kendi ayarı).
    expect(a?.label).toContain('131');
    expect(a?.sublabel).toContain('100');
  });

  it('KİLİT: uyarı SESLİ de verilir (sürüşte ekrana bakmak zorunda kalınmaz)', () => {
    dispatchSpeedLimitExceeded(131, 100);
    expect(_speak).toHaveBeenCalledTimes(1);
    expect(String(_speak.mock.calls[0]?.[0])).toContain('131');
  });

  it('KİLİT: GERİ VİTESTE bastırılır — manevra ekranını WARNING bölemez', () => {
    useSystemStore.setState({ isReverseActive: true });
    dispatchSpeedLimitExceeded(131, 100);

    expect(alerts().find((x) => x.type === 'SPEED_LIMIT_EXCEEDED')).toBeUndefined();
    expect(_speak).not.toHaveBeenCalled();
  });

  it('KİLİT: uyarı KRİTİK değildir — kritik uyarıları (ısınma/kaza) bastıramaz', () => {
    /* Geri vites bastırması yalnız non-CRITICAL uyarıları gizler. Hız uyarısı
       CRITICAL olsaydı geri viteste kamerayı böler ve kritik uyarı ailesiyle
       aynı ağırlığa çıkardı — bu bilinçli olarak reddedildi. */
    dispatchSpeedLimitExceeded(200, 100);
    const a = alerts().find((x) => x.type === 'SPEED_LIMIT_EXCEEDED');
    expect(a?.severity).not.toBe('CRITICAL');
  });

  it('sunum otoritesi TEKTİR — orchestrator durunca uyarı ÜRETİLMEZ', () => {
    stop?.();
    stop = null;
    dispatchSpeedLimitExceeded(180, 100);
    expect(alerts().find((x) => x.type === 'SPEED_LIMIT_EXCEEDED')).toBeUndefined();
  });

  it('olay ALANLARI doğru taşınır (karar veren yer değerleri kaybetmez)', () => {
    dispatchSpeedLimitExceeded(96, 90);
    const a = alerts().find((x) => x.type === 'SPEED_LIMIT_EXCEEDED');
    expect(a?.label).toContain('96');
    expect(a?.sublabel).toContain('90');
    expect(typeof a?.ts).toBe('number');
    expect(a?.ts).toBeGreaterThan(0);
  });
});
