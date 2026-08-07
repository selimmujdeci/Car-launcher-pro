/**
 * dormantCapabilityActivation.test.ts — UYUYAN YETENEK AKTİVASYONU P0 KİLİTLERİ.
 *
 * İki kapı burada kilitlenir:
 *   1. AI Gateway — varsayılan KAPALI · kapsamsız açılmaz · "izin" ≠ "hazır"
 *   2. Çevrimdışı rota — sahte başarı YOK · kalıcı hatada tekrar denenmez
 *
 * SQL karşılığı: `supabase/tests/061_ai_gateway_access_matrix.sql`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  deriveGatewayStatus, gatewaySourceLabel, providerReadinessLabel, UNREAD_ACCESS,
  type AiGatewayAccessSnapshot,
} from '../platform/ai/gateway/aiGatewayAccess';
import {
  recordOfflineGraphOutcome, getOfflineRoutingStatus, shouldAttemptOfflineRoute,
  offlineGraphStateLabel, offlineRoutingUserMessage,
  _resetOfflineRoutingStatusForTest,
} from '../platform/navigation/offlineRoutingStatus';

const snap = (o: Partial<AiGatewayAccessSnapshot> = {}): AiGatewayAccessSnapshot => ({
  killSwitchOn: false, companyGranted: false, vehicleGrantCount: 0, effective: false, ...o,
});

/* ══════════════════════════════════════════════════════════════════════
   A · AI GATEWAY — VARSAYILAN KAPALI
   ════════════════════════════════════════════════════════════════════ */

describe('A · AI Gateway varsayılan kapalı', () => {
  it('hiçbir şey okunmadıysa KAPALI (fail-closed)', () => {
    const s = deriveGatewayStatus({ snapshot: null, localOverride: false, provider: 'UNKNOWN' });
    expect(s.accessGranted).toBe(false);
    expect(s.ready).toBe(false);
    expect(s.source).toBe('NOT_READ');
  });

  it('okundu ama hiçbir izin yoksa KAPALI', () => {
    const s = deriveGatewayStatus({ snapshot: UNREAD_ACCESS, localOverride: false, provider: 'READY' });
    expect(s.accessGranted).toBe(false);
    expect(s.source).toBe('KILL_SWITCH_OFF');
  });

  it('ANA ŞALTER tek başına kimseyi AÇMAZ', () => {
    // Global feature_flags satırı açık ama bu şirkete izin yok.
    const s = deriveGatewayStatus({
      snapshot: snap({ killSwitchOn: true }), localOverride: false, provider: 'READY',
    });
    expect(s.accessGranted).toBe(false);
    expect(s.source).toBe('NO_GRANT');
    expect(s.ready).toBe(false);
  });

  it('İZİN tek başına yetmez — ana şalter kapalıysa açılmaz', () => {
    const s = deriveGatewayStatus({
      snapshot: snap({ companyGranted: true }), localOverride: false, provider: 'READY',
    });
    expect(s.accessGranted).toBe(false);
    expect(s.source).toBe('KILL_SWITCH_OFF');
  });
});

/* ══════════════════════════════════════════════════════════════════════
   B · KAPSAM — ŞİRKET / ARAÇ
   ════════════════════════════════════════════════════════════════════ */

describe('B · AI Gateway kapsamı', () => {
  it('şalter + şirket izni → AÇIK, kaynak COMPANY_GRANT', () => {
    const s = deriveGatewayStatus({
      snapshot: snap({ killSwitchOn: true, companyGranted: true }),
      localOverride: false, provider: 'READY',
    });
    expect(s.accessGranted).toBe(true);
    expect(s.source).toBe('COMPANY_GRANT');
    expect(s.ready).toBe(true);
  });

  it('şalter + YALNIZ araç izni → AÇIK, kaynak VEHICLE_GRANT (kademeli)', () => {
    const s = deriveGatewayStatus({
      snapshot: snap({ killSwitchOn: true, vehicleGrantCount: 2 }),
      localOverride: false, provider: 'READY',
    });
    expect(s.accessGranted).toBe(true);
    expect(s.source).toBe('VEHICLE_GRANT');
  });

  it('yerel geliştirici kaldıracı GİZLİ açılmaz — kaynağı AÇIKÇA görünür', () => {
    const s = deriveGatewayStatus({ snapshot: null, localOverride: true, provider: 'READY' });
    expect(s.accessGranted).toBe(true);
    expect(s.source).toBe('LOCAL_OVERRIDE');
    expect(gatewaySourceLabel(s.source)).toMatch(/GELİŞTİRİCİ/);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   C · "İZİN VAR" ≠ "HAZIR"  (görev şartı)
   ════════════════════════════════════════════════════════════════════ */

describe('C · izin ile hazırlık ayrı', () => {
  it('sağlayıcı anahtarı YOKSA sistem HAZIR sayılmaz', () => {
    const s = deriveGatewayStatus({
      snapshot: snap({ killSwitchOn: true, companyGranted: true }),
      localOverride: false, provider: 'NOT_CONFIGURED',
    });
    expect(s.accessGranted).toBe(true);    // izin var
    expect(s.ready).toBe(false);           // ama HAZIR DEĞİL
  });

  it('anahtar durumu BİLİNMİYORSA da hazır sayılmaz (fail-closed)', () => {
    const s = deriveGatewayStatus({
      snapshot: snap({ killSwitchOn: true, companyGranted: true }),
      localOverride: false, provider: 'UNKNOWN',
    });
    expect(s.ready).toBe(false);
  });

  /* KİLİT GÜNCELLENDİ (P0 COMPLETION): hazırlık artık ALTI durum. `CONFIGURED`
     "anahtar var ama erişim DOĞRULANMADI" anlamına gelir ve HAZIR SAYILMAZ —
     eski iki-durumlu model bunu gizliyordu. */
  it('etiketler bounded — serbest metin yok', () => {
    expect(providerReadinessLabel('NOT_CONFIGURED')).toBe('YAPILANDIRILMAMIŞ');
    expect(providerReadinessLabel('CONFIGURED')).toMatch(/doğrulanmadı/);
    expect(providerReadinessLabel('READY')).toBe('HAZIR');
    expect(gatewaySourceLabel('KILL_SWITCH_OFF')).toBe('ANA ŞALTER KAPALI');
  });

  it('CONFIGURED tek başına HAZIR yapmaz (yeni bağlayıcı kural)', () => {
    const s = deriveGatewayStatus({
      snapshot: snap({ killSwitchOn: true, companyGranted: true }),
      localOverride: false, provider: 'CONFIGURED',
    });
    expect(s.accessGranted).toBe(true);
    expect(s.ready).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   D · KAPI ÇEVİRME — açma/kapama anında etkili
   ════════════════════════════════════════════════════════════════════ */

describe('D · aiGatewayFlag kapsam beslemesi', () => {
  beforeEach(async () => {
    const m = await import('../platform/ai/gateway/aiGatewayFlag');
    m._resetAiGatewayFlagForTest();
  });

  it('kapsam izni beslenmediyse gateway KAPALI', async () => {
    const m = await import('../platform/ai/gateway/aiGatewayFlag');
    expect(m._getScopedGatewayAccess()).toBe(false);
    expect(m.isAiGatewayEnabled()).toBe(false);
  });

  it('izin kaldırılınca erişim ANINDA kapanır (önbellek sıfırlanır)', async () => {
    const m = await import('../platform/ai/gateway/aiGatewayFlag');
    m.applyScopedGatewayAccess(true);
    expect(m._getScopedGatewayAccess()).toBe(true);
    m.applyScopedGatewayAccess(false);
    expect(m._getScopedGatewayAccess()).toBe(false);
    // Ana şalter zaten kapalı olduğu için sonuç da kapalı.
    expect(m.isAiGatewayEnabled()).toBe(false);
  });

  it('test sıfırlaması kapsam iznini de temizler (sızıntı yok)', async () => {
    const m = await import('../platform/ai/gateway/aiGatewayFlag');
    m.applyScopedGatewayAccess(true);
    m._resetAiGatewayFlagForTest();
    expect(m._getScopedGatewayAccess()).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   E · ÇEVRİMDIŞI ROTA — SAHTE BAŞARI YOK
   ════════════════════════════════════════════════════════════════════ */

describe('E · çevrimdışı rota dürüstlüğü', () => {
  beforeEach(() => _resetOfflineRoutingStatusForTest());

  it('hiç denenmediyse ÖLÇÜLMEDİ — "yok" DEĞİL', () => {
    const s = getOfflineRoutingStatus();
    expect(s.state).toBe('UNKNOWN');
    expect(s.usable).toBe(false);
    expect(s.attemptCount).toBe(0);
    // Ölçülmemiş durum kullanıcıya iddia ÜRETMEZ.
    expect(offlineRoutingUserMessage('UNKNOWN')).toBeNull();
  });

  it('graph yoksa KULLANILAMAZ ve kullanıcıya dürüst mesaj verilir', () => {
    recordOfflineGraphOutcome('GRAPH_MISSING', 1000);
    const s = getOfflineRoutingStatus();
    expect(s.state).toBe('GRAPH_MISSING');
    expect(s.usable).toBe(false);
    const msg = offlineRoutingUserMessage('GRAPH_MISSING')!;
    expect(msg).toMatch(/yüklü değil/);
    // "çevrimdışı rota hazır" iması ASLA olmamalı.
    expect(msg).not.toMatch(/hazır/i);
  });

  it('KALICI hatada bir daha DENENMEZ (sessiz israf kalkar)', () => {
    expect(shouldAttemptOfflineRoute()).toBe(true);       // başlangıçta dener
    recordOfflineGraphOutcome('GRAPH_MISSING', 1000);
    expect(shouldAttemptOfflineRoute()).toBe(false);
    _resetOfflineRoutingStatusForTest();
    recordOfflineGraphOutcome('WORKER_UNSUPPORTED', 1000);
    expect(shouldAttemptOfflineRoute()).toBe(false);
    _resetOfflineRoutingStatusForTest();
    recordOfflineGraphOutcome('GRAPH_CORRUPT', 1000);
    expect(shouldAttemptOfflineRoute()).toBe(false);
  });

  it('graph HAZIRSA kullanılabilir ve mesaj üretilmez', () => {
    recordOfflineGraphOutcome('AVAILABLE', 2000);
    const s = getOfflineRoutingStatus();
    expect(s.state).toBe('AVAILABLE');
    expect(s.usable).toBe(true);
    expect(offlineRoutingUserMessage('AVAILABLE')).toBeNull();
    expect(shouldAttemptOfflineRoute()).toBe(true);
  });

  it('deneme sayısı ve son deneme kaydedilir (görünmez tekrar yok)', () => {
    recordOfflineGraphOutcome('GRAPH_MISSING', 1000);
    recordOfflineGraphOutcome('GRAPH_MISSING', 2000);
    const s = getOfflineRoutingStatus();
    expect(s.attemptCount).toBe(2);
    expect(s.lastAttemptAt).toBe(2000);
  });

  it('etiketler bounded ve GRAPH_MISSING açıkça adlandırılır', () => {
    expect(offlineGraphStateLabel('GRAPH_MISSING')).toMatch(/GRAPH YOK/);
    expect(offlineGraphStateLabel('AVAILABLE')).toBe('HAZIR');
  });
});
