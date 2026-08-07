/**
 * mediaAuthorityLab.test.tsx — CAROS LAB · Medya Otoritesi ekranı DAVRANIŞ KİLİTLERİ.
 *
 * ZORUNLU GÖZLEMLENEBİLİRLİK KURALI (CLAUDE.md): "gözlemlenemeyen özellik
 * tamamlanmış değildir." Bu dosya yedi şartın test edilebilir olanlarını kilitler:
 *   · katalog↔ekran eşlemesi GERÇEKTEN var (PLACEHOLDER değil)
 *   · ekran salt-okunur (komut göndermez, timer kurmaz)
 *   · kanıtsız bilgi ÜRETİLMEZ (UNAVAILABLE; sahte 0 / sahte "sağlıklı" yok)
 *   · gizli veri (başlık · sanatçı · URI · kapak) LAB'a TAŞINMAZ
 */

import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  CAROS_LAB_TOOLS, getCarosLabTool, isToolOpenable, resolveToolActivation,
} from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';
import {
  buildMediaAuthorityCards, deriveMediaAuthorityVerdict, countByMediaAuthorityClass,
} from '../platform/devtools/mediaAuthorityModel';
import type { MediaAuthorityRawSnapshot } from '../platform/devtools/mediaAuthoritySources';
import { readMediaAuthoritySnapshot } from '../platform/devtools/mediaAuthoritySources';
import { DEVICE_SCENARIOS } from '../platform/media/authority/deviceValidationModel';

/* ── Test fixture: otorite YOK (web / servis başlamadı) ──────────────────── */

function snapshot(over: Partial<MediaAuthorityRawSnapshot> = {}): MediaAuthorityRawSnapshot {
  return {
    readAt: 1_000,
    isNativePlatform: true,
    authorityAvailable: false,
    activeSourceNative: 'NONE',
    activeSourceGateway: null,
    focusState: 'NONE',
    hasAudioFocus: null,
    userPaused: null,
    pausedByFocus: null,
    playing: false,
    playWhenReady: null,
    renderingVerified: false,
    buffering: null,
    audioRoute: 'UNKNOWN',
    noisyReceiverActive: null,
    duckVolume: null,
    duckReasonsNative: [],
    duckReasonsGateway: [],
    effectiveVolumeNative: null,
    effectiveVolumeGateway: null,
    userVolumeNative: null,
    queueRevision: null,
    queueLength: null,
    currentIndex: null,
    positionMs: null,
    durationMs: null,
    shuffle: null,
    repeat: 'off',
    lastPauseReason: '',
    lastFailureCode: '',
    recoveryCountNative: null,
    hasTrackMetadata: false,
    evidence: {
      status: 'UNAVAILABLE',
      counters: {
        commandsTotal: 0, verified: 0, acceptedUnverified: 0, failed: 0,
        timedOut: 0, superseded: 0, rejected: 0, duplicateBackendDetected: 0,
        recoveryCount: 0, handoverTotal: 0, handoverFailed: 0,
      },
      sourceSwitchLatencyMs: null,
      playStartLatencyMs: null,
      lastFailure: null,
      recentCommands: [],
      recordCapacity: 30,
    },
    recoveryDecision: 'YOK (no_saved_state)',
    recoveryItemCount: null,
    uiQueueRevision: null,
    uiQueueLength: null,
    uiQueueIndex: null,
    projectedRevision: null,
    projectedLength: null,
    projectedIndex: null,
    queueDrift: 'UNKNOWN',
    queueDriftReason: 'Native timeline okunamadı.',
    recoveryOutcome: 'HENÜZ ÇALIŞMADI',
    recoveryAction: '',
    recoveryCode: '',
    recoveryReason: '',
    recoveryAtMs: null,
    recoveryBreakersOpen: 0,
    recoveryLedgerSize: 0,
    handoverInFlight: false,
    userCommandInFlight: false,
    authorityGeneration: 0,
    eventTotal: 0,
    eventDropped: 0,
    eventCapacity: 120,
    recentEvents: [],
    validationSummary: {
      total: 0, pass: 0, fail: 0, blocked: 0,
      notRun: DEVICE_SCENARIOS.length,
      coveredScenarios: 0, totalScenarios: DEVICE_SCENARIOS.length,
    },
    validationActiveState: 'idle',
    validationActiveScenario: '',
    validationResults: {},
    ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · Katalog ↔ ekran eşlemesi
 * ════════════════════════════════════════════════════════════════════════ */

describe('LAB KİLİT — Medya Otoritesi aracı katalogda ve GERÇEKTEN açılıyor', () => {
  it('katalogda AVAILABLE olarak kayıtlı (runtime kategorisi)', () => {
    const tool = getCarosLabTool('media-authority');
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('runtime');
    expect(tool?.status).toBe('AVAILABLE');
    expect(isToolOpenable(tool ?? null)).toBe(true);
    expect(resolveToolActivation(tool ?? null)).toBe('media-authority');
  });

  it('AVAILABLE olan her araç gibi GERÇEK bir ekrana eşlenir (sahte "hazır" yok)', () => {
    expect(renderAvailableTool('media-authority')).not.toBeNull();
  });

  it('katalogdaki tüm AVAILABLE araçların ekranı vardır — katalog↔kod ayrışması yok', () => {
    const orphans = CAROS_LAB_TOOLS
      .filter((t) => t.status === 'AVAILABLE')
      .filter((t) => renderAvailableTool(t.id) === null)
      .map((t) => t.id);
    expect(orphans).toEqual([]);
  });

  it('katalog notu oynatma komutu göndermediğini açıkça beyan eder', () => {
    const note = getCarosLabTool('media-authority')?.note ?? '';
    expect(note).toContain('GÖNDERMEZ');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · Fail-closed hüküm — kanıt yoksa "sağlıklı" DENMEZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('LAB KİLİT — hüküm fail-closed', () => {
  it('otorite yoksa UNAVAILABLE ("duraklatıldı" VARSAYILMAZ)', () => {
    const v = deriveMediaAuthorityVerdict(snapshot());
    expect(v.status).toBe('UNAVAILABLE');
    expect(v.reasons.join(' ')).toContain('BİLİNMİYOR');
  });

  it('web modunda native otorite YOKTUR', () => {
    expect(deriveMediaAuthorityVerdict(snapshot({ isNativePlatform: false })).status)
      .toBe('UNAVAILABLE');
  });

  it('"çalıyor" diyor ama ses kanıtı yoksa → YALNIZ İSTEK', () => {
    const v = deriveMediaAuthorityVerdict(snapshot({
      authorityAvailable: true, playing: true, renderingVerified: false,
      hasAudioFocus: false,
    }));
    expect(v.status).toBe('REQUESTED_ONLY');
    expect(v.reasons.join(' ')).toContain('Ses odağı BİZDE DEĞİL');
  });

  it('render + odak + seviye varsa → SES ÜRETİLİYOR (kanıtlı)', () => {
    expect(deriveMediaAuthorityVerdict(snapshot({
      authorityAvailable: true, playing: true, renderingVerified: true,
    })).status).toBe('RENDERING');
  });

  it('kullanıcı duraklatması ile odak duraklatması AYRI hükümdür', () => {
    expect(deriveMediaAuthorityVerdict(snapshot({
      authorityAvailable: true, userPaused: true,
    })).status).toBe('PAUSED_BY_USER');

    expect(deriveMediaAuthorityVerdict(snapshot({
      authorityAvailable: true, userPaused: false, pausedByFocus: true,
      lastPauseReason: 'focus_loss_transient',
    })).status).toBe('PAUSED_BY_FOCUS');
  });

  it('çift ses kaynağı ihlali HER ŞEYİN ÖNÜNDE raporlanır', () => {
    const v = deriveMediaAuthorityVerdict(snapshot({
      authorityAvailable: true, playing: true, renderingVerified: true,
      evidence: { ...snapshot().evidence, counters: {
        ...snapshot().evidence.counters, duplicateBackendDetected: 1,
      } },
    }));
    // Ses kanıtı olsa BİLE ihlal gizlenmez.
    expect(v.status).toBe('DUPLICATE_BACKEND');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · Kanıtsız bilgi üretilmez
 * ════════════════════════════════════════════════════════════════════════ */

describe('LAB KİLİT — bilinmeyen alan UNAVAILABLE, sahte 0 YOK', () => {
  it('otorite yokken NATIVE\'e bağlı hiçbir alan OBSERVED sunulmaz', () => {
    // KİLİDİN ÖZÜ: native servise bağlı kartlar (oynatma gerçeği · ses odağı ·
    // ses/ducking) otorite erişilemezken "ölçüldü" DİYEMEZ. JS tarafında yerel
    // olarak gerçekten sayılan alanlar (gateway kapıları, olay tamponu, kanıt
    // sayaçları, doğrulama kayıtları) bu kuralın DIŞINDADIR — onlar native'den
    // bağımsız ölçümlerdir ve UNAVAILABLE göstermek YANLIŞ olurdu.
    const cards = buildMediaAuthorityCards(snapshot());
    const nativeBackedCards = ['playback', 'focus', 'volume'];
    const jsLocalFields = new Set(['duck-reasons-gw', 'vol-eff-gw']);

    cards
      .filter((c) => nativeBackedCards.includes(c.id))
      .flatMap((c) => c.fields)
      .filter((f) => !jsLocalFields.has(f.id))
      .forEach((f) => {
        expect(`${f.id}:${f.klass}`).toBe(`${f.id}:UNAVAILABLE`);
      });
  });

  it('otorite kartında yalnız platform ve erişilebilirlik ÖLÇÜLDÜ sayılır', () => {
    const authority = buildMediaAuthorityCards(snapshot()).find((c) => c.id === 'authority');
    const observed = authority?.fields.filter((f) => f.klass === 'OBSERVED').map((f) => f.id);
    expect(observed).toEqual(['platform', 'available']);
  });

  it('ölçülmemiş gecikmeler "—" gösterilir (sahte 0 DEĞİL)', () => {
    const truth = buildMediaAuthorityCards(snapshot()).find((c) => c.id === 'truth');
    const latency = truth?.fields.find((f) => f.id === 'lat-play');
    expect(latency?.value).toBe('—');
    expect(latency?.klass).toBe('UNAVAILABLE');
  });

  it('kuyruk uzlaştırması karşılaştırılamadığında UNAVAILABLE olur', () => {
    const queue = buildMediaAuthorityCards(snapshot()).find((c) => c.id === 'queue');
    const drift = queue?.fields.find((f) => f.id === 'q-drift');
    expect(drift?.value).toBe('KARŞILAŞTIRILAMADI');
    expect(drift?.klass).toBe('UNAVAILABLE');
  });

  it('on kart da üretilir ve sınıf sayacı tutarlıdır', () => {
    const cards = buildMediaAuthorityCards(snapshot());
    expect(cards.map((c) => c.id)).toEqual([
      'authority', 'playback', 'focus', 'volume', 'queue', 'truth', 'recovery',
      'queue-recovery', 'events', 'device-validation',
    ]);
    const counts = countByMediaAuthorityClass(cards);
    const total = cards.reduce((n, c) => n + c.fields.length, 0);
    expect(counts.OBSERVED + counts.DERIVED + counts.UNAVAILABLE + counts.STALE).toBe(total);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · Gizlilik — kullanıcı verisi LAB'a taşınmaz
 * ════════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════════
 * 3b · PAKET B — kurtarma / olay / doğrulama görünürlüğü
 * ════════════════════════════════════════════════════════════════════════ */

describe('LAB KİLİT — Paket B alanları dürüstçe gösterilir', () => {
  it('kurtarma hiç çalışmadıysa "HENÜZ ÇALIŞMADI" (sahte başarı YOK)', () => {
    const qr = buildMediaAuthorityCards(snapshot()).find((c) => c.id === 'queue-recovery');
    const outcome = qr?.fields.find((f) => f.id === 'qr-outcome');
    expect(outcome?.value).toBe('HENÜZ ÇALIŞMADI');
    expect(outcome?.klass).toBe('UNAVAILABLE');
  });

  it('kurtarma kapıları (kullanıcı komutu / devir) görünür', () => {
    const qr = buildMediaAuthorityCards(snapshot({
      userCommandInFlight: true, handoverInFlight: true,
    })).find((c) => c.id === 'queue-recovery');
    expect(qr?.fields.find((f) => f.id === 'qr-gate-user')?.value).toBe('EVET');
    expect(qr?.fields.find((f) => f.id === 'qr-gate-handover')?.value).toBe('EVET');
  });

  it('düşen olay sayısı gizlenmez ("hiç olmadı" ile karıştırılmaz)', () => {
    const ev = buildMediaAuthorityCards(snapshot({ eventDropped: 7, eventTotal: 200 }))
      .find((c) => c.id === 'events');
    expect(ev?.fields.find((f) => f.id === 'ev-dropped')?.value).toBe('7');
  });

  it('cihaz doğrulama kapsamı KOŞULMADI ile başlar', () => {
    const dv = buildMediaAuthorityCards(snapshot()).find((c) => c.id === 'device-validation');
    expect(dv?.fields.find((f) => f.id === 'dv-pass')?.value).toBe('0');
    expect(dv?.fields.find((f) => f.id === 'dv-notrun')?.value)
      .toBe(String(DEVICE_SCENARIOS.length));
    expect(dv?.fields.find((f) => f.id === 'dv-coverage')?.klass).toBe('UNAVAILABLE');
  });

  it('gönderilen pencere ile UI kuyruğu AYRI alanlardır (yanlış pozitif önleme)', () => {
    const q = buildMediaAuthorityCards(snapshot({
      uiQueueRevision: 2, uiQueueLength: 900, uiQueueIndex: 500,
      projectedRevision: 2, projectedLength: 120, projectedIndex: 60,
    })).find((c) => c.id === 'queue');
    expect(q?.fields.find((f) => f.id === 'q-ui')?.value).toBe('2 / 900 / 500');
    expect(q?.fields.find((f) => f.id === 'q-projected')?.value).toBe('2 / 120 / 60');
  });
});

describe('LAB KİLİT — parça başlığı · sanatçı · URI · kapak LAB\'a GİRMEZ', () => {
  it('anlık görüntü tipinde ham metadata alanı YOKTUR', () => {
    const s = snapshot({ authorityAvailable: true, hasTrackMetadata: true }) as unknown as
      Record<string, unknown>;
    ['title', 'artist', 'artworkUri', 'currentTrackId', 'uri', 'url']
      .forEach((k) => expect(Object.prototype.hasOwnProperty.call(s, k)).toBe(false));
    // Yalnız VAR/YOK bilgisi taşınır.
    expect(typeof s.hasTrackMetadata).toBe('boolean');
  });

  it('kart değerlerinde gerçek metadata sızıntısı olmaz', () => {
    const cards = buildMediaAuthorityCards(snapshot({
      authorityAvailable: true, hasTrackMetadata: true,
    }));
    const values = cards.flatMap((c) => c.fields.map((f) => f.value)).join(' | ');
    expect(values).not.toContain('file://');
    expect(values).not.toContain('http');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · Ekran salt-okunur ve zamanlayıcısız
 * ════════════════════════════════════════════════════════════════════════ */

describe('LAB KİLİT — ekran komut GÖNDERMEZ, timer KURMAZ', () => {
  it('ilk render sırasında setInterval/setTimeout KURULMAZ', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { MediaAuthorityScreen } = await import(
      '../components/devtools/screens/MediaAuthorityScreen'
    );

    const html = renderToStaticMarkup(<MediaAuthorityScreen />);
    expect(html).toContain('SALT OKUNUR');
    expect(html).toContain('OYNATMA GERÇEĞİ');
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();

    setIntervalSpy.mockRestore();
    setTimeoutSpy.mockRestore();
  });

  it('okuma katmanı web modunda bile PATLAMAZ ve dürüst "otorite yok" döner', () => {
    const s = readMediaAuthoritySnapshot();
    expect(s.authorityAvailable).toBe(false);
    expect(s.hasTrackMetadata).toBe(false);
    expect(typeof s.readAt).toBe('number');
  });
});
