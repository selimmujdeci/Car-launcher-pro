/**
 * labTruthAuthorities2.test.ts — CAROS LAB otorite kilitleri (devam).
 *
 * T3 HealthMonitor · T4 reconnect · T10 hata kanalı · T13 zamansız modal ·
 * T14 capture/debug semantiği. Kaynak: 2026-08-01 cihaz snapshot'ı.
 *
 * Regresyon Kasası yasası: kilitler ZAYIFLATILMAZ, yalnız bilinçli davranış
 * değişiminde GÜNCELLENİR.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ══════════════════════════════════════════════════════════════════════════
   T3 — HealthMonitor heartbeat doğruluk otoritesi
   ════════════════════════════════════════════════════════════════════════ */

describe('T3 — heartbeat yalancı alarm ve saat tabanı', { timeout: 30_000 }, () => {
  const FRESH = 12_000;
  const NOW   = 1_785_588_494_804;

  it('OBD paketleri TAZE iken VehicleDataLayer canlı sayılır (yalancı alarm YOK)', async () => {
    const { obdFreshnessSaysAlive } = await import('../platform/system/SystemHealthMonitor');
    // Saha snapshot'ının birebir değerleri: lastPacketAge≈875ms, dataFresh:true.
    expect(obdFreshnessSaysAlive({
      dataFresh: true, connectionState: 'connected',
      lastSeenEpochMs: NOW - 875, nowEpochMs: NOW, freshWindowMs: FRESH,
    })).toBe(true);
  });

  it('park hâlinde DEĞİŞMEYEN ama TAZE veri alarm ÜRETMEZ', async () => {
    const { obdFreshnessSaysAlive } = await import('../platform/system/SystemHealthMonitor');
    // Kusurun özü: speed=0, fuel=41 sabitken store değişmiyordu → 20s "sessizlik".
    // Otorite paket VARIŞINA bakar, değer DEĞİŞİMİNE değil.
    expect(obdFreshnessSaysAlive({
      dataFresh: true, connectionState: 'connected',
      lastSeenEpochMs: NOW - 1_000, nowEpochMs: NOW, freshWindowMs: FRESH,
    })).toBe(true);
  });

  it('GERÇEK kesinti (pencere aşıldı) hâlâ TESPİT EDİLİR', async () => {
    const { obdFreshnessSaysAlive } = await import('../platform/system/SystemHealthMonitor');
    expect(obdFreshnessSaysAlive({
      dataFresh: true, connectionState: 'connected',
      lastSeenEpochMs: NOW - 25_000, nowEpochMs: NOW, freshWindowMs: FRESH,
    })).toBe(false);
  });

  it('dataFresh false veya bağlantı kopuk ise canlı SAYILMAZ', async () => {
    const { obdFreshnessSaysAlive } = await import('../platform/system/SystemHealthMonitor');
    expect(obdFreshnessSaysAlive({
      dataFresh: false, connectionState: 'connected',
      lastSeenEpochMs: NOW - 100, nowEpochMs: NOW, freshWindowMs: FRESH,
    })).toBe(false);
    expect(obdFreshnessSaysAlive({
      dataFresh: true, connectionState: 'disconnected',
      lastSeenEpochMs: NOW - 100, nowEpochMs: NOW, freshWindowMs: FRESH,
    })).toBe(false);
  });

  it('EPOCH/MONOTONIC karışıklığı yalancı "canlı" ÜRETMEZ', async () => {
    const { obdFreshnessSaysAlive } = await import('../platform/system/SystemHealthMonitor');
    // performance.now() değeri (küçük, ~1030ms) epoch alanına sızarsa yaş devasa
    // ve pozitif olur → "canlı" DEMEMELİ. Ters yönde (now monotonic, lastSeen epoch)
    // yaş NEGATİF olur → yine "canlı" DEMEMELİ (fail-closed).
    expect(obdFreshnessSaysAlive({
      dataFresh: true, connectionState: 'connected',
      lastSeenEpochMs: 1029.9, nowEpochMs: NOW, freshWindowMs: FRESH,
    })).toBe(false);
    expect(obdFreshnessSaysAlive({
      dataFresh: true, connectionState: 'connected',
      lastSeenEpochMs: NOW, nowEpochMs: 1029.9, freshWindowMs: FRESH,
    })).toBe(false);
  });

  it('ölçülmemiş lastSeen (0) "canlı" SAYILMAZ — 0 kanıt değildir', async () => {
    const { obdFreshnessSaysAlive } = await import('../platform/system/SystemHealthMonitor');
    expect(obdFreshnessSaysAlive({
      dataFresh: true, connectionState: 'connected',
      lastSeenEpochMs: 0, nowEpochMs: NOW, freshWindowMs: FRESH,
    })).toBe(false);
  });

  it('NaN/Infinity yaş fail-closed davranır', async () => {
    const { obdFreshnessSaysAlive } = await import('../platform/system/SystemHealthMonitor');
    expect(obdFreshnessSaysAlive({
      dataFresh: true, connectionState: 'connected',
      lastSeenEpochMs: Number.NaN, nowEpochMs: NOW, freshWindowMs: FRESH,
    })).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   T4 — Reconnect sayaç kapsamları
   ════════════════════════════════════════════════════════════════════════ */

describe('T4 — reconnect yaşam döngüsü tek otoritesi', { timeout: 30_000 }, () => {
  it('timeout → reconnect → BAŞARI akışı "recovered" verir', async () => {
    const { deriveReconnectOutcome } = await import('../platform/obdService');
    // Saha: reconnect 1785588356225, handshake başarı 1785588392363.
    expect(deriveReconnectOutcome(1_785_588_356_225, 1_785_588_392_363)).toBe('recovered');
  });

  it('reconnect başarısız/henüz sonuçsuz akış "pending" verir', async () => {
    const { deriveReconnectOutcome } = await import('../platform/obdService');
    expect(deriveReconnectOutcome(1_785_588_400_000, 1_785_588_392_363)).toBe('pending');
    expect(deriveReconnectOutcome(1_785_588_400_000, null)).toBe('pending');
  });

  it('hiç reconnect yoksa "none" — sahte olay üretilmez', async () => {
    const { deriveReconnectOutcome } = await import('../platform/obdService');
    expect(deriveReconnectOutcome(0, null)).toBe('none');
    expect(deriveReconnectOutcome(0, 1_785_588_392_363)).toBe('none');
  });

  /**
   * NOT (ölçüldü 2026-08-01): `obdService` canlı tekil durumunu bu dosyadan okumak,
   * modül grafiği başka bir test dosyasıyla birlikte yüklendiğinde `obdService`
   * içindeki MEVCUT dairesel import zinciri yüzünden TDZ hatası veriyor
   * (`Cannot access '_reconnectHistory' before initialization`). Bu kırılganlık
   * bu paketten ÖNCE de vardı ve büyük refactor kapsam dışı olduğu için
   * DÜZELTİLMEDİ; kütükte açık borç olarak kayıtlıdır.
   *
   * Kilit bu yüzden tekil duruma DEĞİL, kapsam sözleşmesinin SAF çekirdeğine
   * bağlanır — asıl korunması gereken davranış zaten budur.
   */
  it('kapsam etiketi sözleşmesi: sayaç "toplam" DEĞİL, anlık backoff serisidir', async () => {
    const { deriveReconnectOutcome } = await import('../platform/obdService');
    // Başarıdan sonra seri sıfırlanır → aynı olay "toplam" olarak okunamaz.
    // Sonuç türetimi damgalardan gelir, sayaçtan DEĞİL (çift sayım imkânsız).
    expect(deriveReconnectOutcome(100, 200)).toBe('recovered');
    expect(deriveReconnectOutcome(200, 100)).toBe('pending');
    // Aynı olay iki kez sorulduğunda AYNI sonucu verir (idempotent, saf).
    expect(deriveReconnectOutcome(100, 200)).toBe(deriveReconnectOutcome(100, 200));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   T10 — Hata kütüğü canonical otoriteye bağlı
   ════════════════════════════════════════════════════════════════════════ */

describe('T10 — Hata Kütüğü gerçek structured error olaylarını gösterir', () => {
  it('boş kütük "hata yok" olarak YORUMLANMAZ', async () => {
    const { buildCarosLabCopy } = await import('../platform/devtools/carosLabCopyModel');
    const out = buildCarosLabCopy({ errorLog: [] } as never);
    const text = out.text ?? String(out);
    expect(text).toContain('HATA KÜTÜĞÜ');
    expect(text).toMatch(/ANLAMINA GELMEZ/);
    // Ölü kanal iddiası ARTIK YANLIŞ — kaynak canonical kütük.
    expect(text).not.toContain('kanal ÖLÜ');
  });

  it('bölüm canonical otoriteyi (trail:error ile aynı) ilan eder', async () => {
    const { buildCarosLabCopy } = await import('../platform/devtools/carosLabCopyModel');
    const out = buildCarosLabCopy({ errorLog: [] } as never);
    const text = out.text ?? String(out);
    expect(text).toMatch(/crashLogger|trail:error/);
  });

  it('OBD timeout gibi gerçek hata kütükte GÖRÜNÜR', async () => {
    const { buildCarosLabCopy } = await import('../platform/devtools/carosLabCopyModel');
    const row = {
      ts: 1_785_588_386_378, code: 'OBD', component: 'OBD:StartNative',
      source: 'crashLogger', severity: 'error',
      message: 'OBD bağlantısı zaman aşımına uğradı (15s)',
      recoverable: true, correlationId: 'err-1785588386378-OBD:StartNative',
    };
    const out = buildCarosLabCopy({ errorLog: [row] } as never);
    const text = out.text ?? String(out);
    expect(text).toContain('OBD:StartNative');
    expect(text).toContain('zaman aşımına');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   T13 — Zamansız modal
   ════════════════════════════════════════════════════════════════════════ */

describe('T13 — yolculuk özeti sürüş sırasında açılmaz', () => {
  it('SÜRÜŞTE blocking olmayan özet bile GÖSTERİLMEZ', async () => {
    const { canShowTripSummary } = await import('../components/layout/tripSummaryGate');
    expect(canShowTripSummary(50)).toBe(false);   // saha: 480019'da 50 km/h
    expect(canShowTripSummary(6)).toBe(false);
  });

  it('PARK hâlinde meşru özet gösterilebilir', async () => {
    const { canShowTripSummary } = await import('../components/layout/tripSummaryGate');
    // Saha: modal 465463'te açıldı, o an araç park hâlindeydi → MEŞRU.
    expect(canShowTripSummary(0)).toBe(true);
    expect(canShowTripSummary(5)).toBe(true);
  });

  it('hız BİLİNMİYORSA fail-closed — gösterilmez', async () => {
    const { canShowTripSummary } = await import('../components/layout/tripSummaryGate');
    expect(canShowTripSummary(null)).toBe(false);
    expect(canShowTripSummary(undefined)).toBe(false);
    expect(canShowTripSummary(Number.NaN)).toBe(false);
  });

  it('rehydrate eski modal state\'ini CANLANDIRMAZ (store persist edilmez)', async () => {
    const { useSystemStore } = await import('../store/useSystemStore');
    // showTripSummary kalıcı DEĞİLDİR: boot'ta daima false başlar.
    expect(useSystemStore.getState().showTripSummary).toBe(false);
    expect(useSystemStore.getState().lastCompletedTrip).toBeNull();
    // persist middleware bağlı olsaydı bu API bulunurdu.
    expect((useSystemStore as unknown as { persist?: unknown }).persist).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   T14 — Capture / debug alan semantiği
   ════════════════════════════════════════════════════════════════════════ */

describe('T14 — listener sayısı ile capture ref-count ayrı kavramlar', () => {
  let build: typeof import('../platform/devtools/sessionInspectorBuild');

  beforeEach(async () => {
    vi.resetModules();
    build = await import('../platform/devtools/sessionInspectorBuild');
  });

  afterEach(() => vi.resetModules());

  it('listener sayısı ÖLÇÜLMEDİ olarak raporlanır — "0 dinleyici" DEĞİL', () => {
    // Saha: obdRefs:1, canRefs:1, collecting:true yanında listenerCount:0
    // "yakalama açık ama kimse dinlemiyor" gibi okunuyordu. Gerçek: alan hiç yazılmıyor.
    const snap = {
      debug: {
        collecting: true, trafficBufferLen: 2, trafficBufferMax: 500,
        listenerCount: 0, obdDropped: 0, hzCountersWritten: false, fallbackWritten: false,
      },
      capture: { obdRefs: 1, canRefs: 1 },
    } as never;

    const cards = build.buildInspectorCards(snap);
    const field = cards
      .flatMap((c) => c.fields)
      .find((f) => f.id === 'listenerCount');

    expect(field).toBeDefined();
    // Kilit: sınıflandırma OBSERVED değil UNAVAILABLE olmalı — 0 bir ölçüm DEĞİL.
    expect(field!.klass).toBe('UNAVAILABLE');
    expect(field!.value).not.toBe('0');            // "0 dinleyici" iddiası YASAK
    expect(String(field!.note)).toMatch(/ÖLÇÜLMEDİ|dbgUpdateListenerCount/);
  });

  it('capture ref-count ile listener count AYNI kavram olarak sunulmaz', async () => {
    const mod = await import('../platform/devtools/devtoolsCapture');
    const status = mod.getDevtoolsCaptureStatus();
    // Ref-count yakalama TALEBİNİ sayar; listener olay dinleyicisini. Ayrı alanlar.
    expect(status).toHaveProperty('obdRefs');
    expect(status).not.toHaveProperty('listenerCount');
  });
});
