/**
 * destinationHandoff.test.ts — araç DIŞINDAN gelen hedefin KİLİTLERİ.
 *
 * SAHA KUSURU (2026-08-21, kullanıcı bildirdi):
 *  ① "Arabam Cebimde" → Araca Gönder → araçta **Google Maps** açılıyordu;
 *     aracın kendi navigasyonu hiç çalışmıyordu (`buildNavIntent` + `window.open`).
 *  ② WhatsApp konumuna basınca seçicide CarOS Pro ÇIKMIYORDU (manifest filtresi yok).
 *
 * ANA İLKELER:
 *  (a) VARSAYILAN KENDİ NAVİGASYONUMUZ — harici uygulamaya yalnız AÇIK istekle gidilir.
 *  (b) FAIL-CLOSED koordinat — geçersiz/0,0 hedef rotaya GİRMEZ.
 *  (c) SAHİPLİK — `USER_HANDOFF` kullanıcı kaynağıdır; aktif oturumda sessizce
 *      engellenmez, ama defterde araç dışından geldiği görünür.
 *  (d) ÇİFT TETİK — aynı hedef iki kanaldan gelirse TEK rota kurulur.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import commandListenerSrc from '../platform/commandListener.ts?raw';
import handoffSrc from '../platform/navigation/destinationHandoff.ts?raw';

const nav = vi.hoisted(() => ({ started: [] as unknown[] }));
const ui  = vi.hoisted(() => ({ mapOpened: 0, spoken: [] as string[] }));

vi.mock('../platform/navigationService', () => ({
  startNavigation: (dest: unknown, offline: boolean, source: string) => {
    nav.started.push({ dest, offline, source });
  },
}));
vi.mock('../platform/mapViewBus', () => ({
  setFullMapView: (open: boolean) => { if (open) ui.mapOpened++; },
}));
vi.mock('../platform/ttsService', () => ({
  speakNavigation: (t: string) => { ui.spoken.push(t); },
}));
vi.mock('../platform/crashLogger', () => ({ logError: () => { /* sessiz */ } }));

import {
  acceptHandoffDestination, recordHandoffOutcome, getHandoffSnapshot,
  HANDOFF_DEDUPE_MS,
  _resetHandoffGuardForTest, _resetHandoffCountersForTest,
} from '../platform/navigation/destinationHandoff';
import {
  judgeDestinationChange, isUserSource,
} from '../platform/navigation/core/destinationOwnershipModel';

const NOW = 1_700_000_000_000;

beforeEach(() => {
  nav.started = [];
  ui.mapOpened = 0;
  ui.spoken = [];
  _resetHandoffGuardForTest();
  _resetHandoffCountersForTest();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1. KÖK KUSUR — uzak komut artık HARİCİ uygulamaya gitmiyor
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 1 — telefondan gelen rota KENDİ navigasyonumuzda açılır', () => {
  it('komut dinleyici rotayı hedef kapısına verir (window.open değil)', () => {
    expect(commandListenerSrc, 'handoff kapısı kaldırılmış — rota yine dışarı çıkar')
      .toMatch(/acceptHandoffDestination\(/);
  });

  it('varsayılan sağlayıcı artık google_maps DEĞİL', () => {
    /* Eski hâl: `route.provider_intent ?? 'google_maps'` → hiçbir şey
       seçilmese bile harici uygulama açılıyordu. */
    expect(commandListenerSrc.includes("provider_intent ?? 'google_maps'"),
      'varsayılan hâlâ Google Maps — kusur geri gelmiş').toBe(false);
  });

  it('harici sağlayıcı YALNIZ açık istekle çalışır (beyaz liste)', () => {
    expect(commandListenerSrc).toMatch(/EXTERNAL\s*=\s*new Set\(\[/);
    expect(commandListenerSrc).toMatch(/EXTERNAL\.has\(provider\)/);
  });

  it('hedef kapısı harici uygulama AÇMAZ', () => {
    const code = handoffSrc.split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    for (const forbidden of ['window.open', 'buildNavIntent', 'geo:']) {
      expect(code.includes(forbidden),
        `hedef kapısı ${forbidden} kullanıyor — dışarı çıkış yolu açılmış`).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. ROTA GERÇEKTEN KURULUYOR
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 2 — kabul edilen hedef rotaya girer', () => {
  it('geçerli koordinat startNavigation çağırır ve haritayı açar', () => {
    const r = acceptHandoffDestination(
      { lat: 41.0082, lng: 28.9784, label: 'Sultanahmet', channel: 'REMOTE_COMMAND' }, NOW);
    expect(r.ok).toBe(true);
    expect(nav.started).toHaveLength(1);
    expect(ui.mapOpened).toBe(1);
  });

  it('hedef sahipliği USER_HANDOFF olarak bildirilir', () => {
    acceptHandoffDestination({ lat: 41, lng: 29, channel: 'GEO_INTENT' }, NOW);
    expect((nav.started[0] as { source: string }).source).toBe('USER_HANDOFF');
  });

  it('ad yoksa UYDURULMAZ — koordinat metni kullanılır', () => {
    const r = acceptHandoffDestination({ lat: 41.5, lng: 29.25, channel: 'GEO_INTENT' }, NOW);
    expect(r.ok && r.destination.name).toBe('41.50000, 29.25000');
  });

  it('sürücüye kısa sesli onay verilir', () => {
    acceptHandoffDestination({ lat: 41, lng: 29, label: 'Ofis', channel: 'REMOTE_COMMAND' }, NOW);
    expect(ui.spoken.join(' ')).toMatch(/Ofis/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. FAIL-CLOSED KOORDİNAT
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 3 — geçersiz hedef rotaya GİRMEZ', () => {
  const BAD: Array<[string, number, number]> = [
    ['NaN',        Number.NaN, 29],
    ['enlem >90',  91, 29],
    ['boylam>180', 41, 181],
    ['sonsuz',     Number.POSITIVE_INFINITY, 29],
  ];

  BAD.forEach(([name, lat, lng]) => {
    it(`${name} reddedilir ve startNavigation ÇAĞRILMAZ`, () => {
      const r = acceptHandoffDestination({ lat, lng, channel: 'REMOTE_COMMAND' }, NOW);
      expect(r.ok).toBe(false);
      expect(nav.started).toHaveLength(0);
    });
  });

  it('0,0 (Null Island) reddedilir — sahte 0 hedefe dönüşmez', () => {
    const r = acceptHandoffDestination({ lat: 0, lng: 0, channel: 'GEO_INTENT' }, NOW);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('null_island');
    expect(nav.started).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. ÇİFT TETİK
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 4 — aynı hedef iki kez gelirse TEK rota', () => {
  it('pencere içinde aynı hedef yutulur', () => {
    acceptHandoffDestination({ lat: 41, lng: 29, channel: 'REMOTE_COMMAND' }, NOW);
    const second = acceptHandoffDestination({ lat: 41, lng: 29, channel: 'GEO_INTENT' }, NOW + 500);
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.reason).toBe('debounced');
    expect(nav.started).toHaveLength(1);
  });

  it('pencere geçince aynı hedef yeniden kabul edilir', () => {
    acceptHandoffDestination({ lat: 41, lng: 29, channel: 'REMOTE_COMMAND' }, NOW);
    const later = acceptHandoffDestination(
      { lat: 41, lng: 29, channel: 'REMOTE_COMMAND' }, NOW + HANDOFF_DEDUPE_MS + 1);
    expect(later.ok).toBe(true);
    expect(nav.started).toHaveLength(2);
  });

  it('FARKLI hedef yutulmaz (pencere içinde bile)', () => {
    acceptHandoffDestination({ lat: 41, lng: 29, channel: 'REMOTE_COMMAND' }, NOW);
    const other = acceptHandoffDestination({ lat: 39.92, lng: 32.85, channel: 'REMOTE_COMMAND' }, NOW + 100);
    expect(other.ok).toBe(true);
    expect(nav.started).toHaveLength(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. SAHİPLİK — aktif oturumda sessizce engellenmemeli
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 5 — USER_HANDOFF kullanıcı kaynağıdır', () => {
  it('kullanıcı kaynağı sayılır', () => {
    expect(isUserSource('USER_HANDOFF')).toBe(true);
  });

  it('aktif oturum sürerken hedefi DEĞİŞTİREBİLİR', () => {
    /* SYSTEM olsaydı `UNOWNED_CHANGE_DURING_SESSION` ile BLOCK edilirdi:
       kullanıcı telefondan rota gönderir, araçta hiçbir şey olmazdı. */
    const v = judgeDestinationChange({
      current: { id: 'a', name: 'Eski', latitude: 41, longitude: 29 },
      sessionActive: true,
      next: { id: 'b', name: 'Yeni', latitude: 39.92, longitude: 32.85 },
      source: 'USER_HANDOFF',
      tsMs: NOW,
    });
    expect(v.decision).toBe('ALLOW');
    expect(v.reason).toBe('USER_ACTION');
  });

  it('SYSTEM aynı senaryoda hâlâ ENGELLENİR (kapı gevşetilmedi)', () => {
    const v = judgeDestinationChange({
      current: { id: 'a', name: 'Eski', latitude: 41, longitude: 29 },
      sessionActive: true,
      next: { id: 'b', name: 'Yeni', latitude: 39.92, longitude: 32.85 },
      source: 'SYSTEM',
      tsMs: NOW,
    });
    expect(v.decision).toBe('BLOCK');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6. GÖZLEM SAYAÇLARI
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 6 — sonuç sessizce yutulmaz', () => {
  it('kabul ve ret ayrı sayılır, son sebep taşınır', () => {
    const ok = acceptHandoffDestination({ lat: 41, lng: 29, channel: 'REMOTE_COMMAND' }, NOW);
    recordHandoffOutcome(ok, 'REMOTE_COMMAND');
    const bad = acceptHandoffDestination({ lat: 0, lng: 0, channel: 'GEO_INTENT' }, NOW + 10_000);
    recordHandoffOutcome(bad, 'GEO_INTENT');

    const snap = getHandoffSnapshot();
    expect(snap.accepted).toBe(1);
    expect(snap.rejected).toBe(1);
    expect(snap.lastReason).toBe('null_island');
    expect(snap.lastChannel).toBe('GEO_INTENT');
  });

  it('hiç hedef gelmediyse damga null kalır — sahte tarih yok', () => {
    expect(getHandoffSnapshot().lastAcceptedAt).toBeNull();
  });
});
