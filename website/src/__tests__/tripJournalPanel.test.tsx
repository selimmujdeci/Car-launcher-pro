/**
 * tripJournalPanel.test.tsx — SEYİR DEFTERİ EKRAN KİLİTLERİ.
 *
 * `tripJournalView.test.ts` KARAR mantığını kilitler; bu dosya kararın
 * EKRANA dürüst yansıdığını kilitler. İkisi ayrıdır: doğru model + yanlış
 * ekran = kullanıcı yine yanlış şey anlar.
 *
 * ANA KİLİTLER:
 *   · Okunamadı ekranı, "yolculuğunuz yok" ekranıyla AYNI DEĞİLDİR.
 *   · Çevrimdışı ve yetkisiz AYRI ekranlardır; yetkisizde "Tekrar dene" YOK.
 *   · Araç DEĞİŞİNCE liste o aracın kapsamıyla yeniden okunur ve geç dönen
 *     eski yanıt yeni aracın listesini EZEMEZ.
 *   · Bozuk satır bütün listeyi düşürmez.
 *   · Ekranda KOORDİNAT/rota çizgisi YOKTUR.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/* ── Servis ikizi ─────────────────────────────────────────────── */

type FetchResult =
  | { ok: true; rows: unknown[] }
  | { ok: false; reason: 'NOT_CONFIGURED' | 'OFFLINE' | 'UNAUTHORIZED' | 'UNAVAILABLE' };

const _calls: { vehicleId: string; limit: number }[] = [];
let _reply: (vehicleId: string) => Promise<FetchResult> =
  async () => ({ ok: true, rows: [] });

vi.mock('@/lib/vehicles.service', () => ({
  fetchVehicleTripsResult: vi.fn(async (vehicleId: string, limit: number) => {
    _calls.push({ vehicleId, limit });
    return _reply(vehicleId);
  }),
}));

import TripJournalPanel from '@/components/pwa/TripJournalPanel';
import type { LiveVehicle } from '@/types/realtime';

/* ── Yardımcılar ──────────────────────────────────────────────── */

function vehicle(id: string): LiveVehicle {
  return { id, name: `Araç ${id}` } as unknown as LiveVehicle;
}

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    trip_key: 't1757600000-1757605700-6430',
    started_at: '2026-09-11T15:12:00.000Z',
    ended_at: '2026-09-11T16:47:00.000Z',
    start_area: 'Tarsus',
    end_area: 'Mersin',
    distance_km: '64.3',
    duration_min: 95,
    moving_time_min: 78,
    idle_time_min: 17,
    avg_speed_kmh: '49',
    max_speed_kmh: '112',
    score: 86,
    end_reason: 'IDLE_WINDOW',
    confidence: 'HIGH',
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;

async function render(v: LiveVehicle | null): Promise<void> {
  await act(async () => { root.render(<TripJournalPanel vehicle={v} />); });
}

function stateEl(): HTMLElement | null {
  return container.querySelector('[data-testid="journal-state"]');
}

function entries(): HTMLElement[] {
  return [...container.querySelectorAll('[data-testid="journal-entry"]')] as HTMLElement[];
}

beforeEach(() => {
  _calls.length = 0;
  _reply = async () => ({ ok: true, rows: [] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1. DURUM EKRANLARI
 * ════════════════════════════════════════════════════════════════════════ */

describe('durum ekranları', () => {
  it('araç yokken ağa HİÇ çıkılmaz', async () => {
    await render(null);
    expect(stateEl()?.dataset.state).toBe('NO_VEHICLE');
    expect(_calls).toHaveLength(0);
  });

  it('BAŞARILI okuma + 0 satır = EMPTY', async () => {
    await render(vehicle('v1'));
    expect(stateEl()?.dataset.state).toBe('EMPTY');
    expect(container.textContent).toContain('Henüz tamamlanmış yolculuk yok');
  });

  it('OKUNAMADI ekranı "yolculuğunuz yok" DEMEZ', async () => {
    _reply = async () => ({ ok: false, reason: 'UNAVAILABLE' });
    await render(vehicle('v1'));

    expect(stateEl()?.dataset.state).toBe('ERROR');
    expect(container.textContent).not.toContain('Henüz tamamlanmış yolculuk yok');
    expect(container.textContent).toContain('olmadığı anlamına gelmez');
  });

  it('çevrimdışı ekranı ayrıdır ve yeniden denenebilir', async () => {
    _reply = async () => ({ ok: false, reason: 'OFFLINE' });
    await render(vehicle('v1'));

    expect(stateEl()?.dataset.state).toBe('OFFLINE');
    expect(container.textContent).toContain('Çevrimdışısınız');
    expect(container.querySelector('[data-testid="journal-retry"]')).not.toBeNull();
  });

  it('YETKİSİZ ekranında "Tekrar dene" ÜRETİLMEZ (sonuçsuz döngü yok)', async () => {
    _reply = async () => ({ ok: false, reason: 'UNAUTHORIZED' });
    await render(vehicle('v1'));

    expect(stateEl()?.dataset.state).toBe('UNAUTHORIZED');
    expect(container.textContent).toContain('yetkiniz yok');
    expect(container.querySelector('[data-testid="journal-retry"]')).toBeNull();
  });

  it('ham sunucu kodu/hata metni ekrana ÇIKMAZ', async () => {
    _reply = async () => ({ ok: false, reason: 'NOT_CONFIGURED' });
    await render(vehicle('v1'));

    const text = container.textContent ?? '';
    expect(text).not.toContain('NOT_CONFIGURED');
    expect(text).not.toContain('PGRST');
    expect(text).not.toContain('42501');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. LİSTE VE DETAY
 * ════════════════════════════════════════════════════════════════════════ */

describe('liste ve detay', () => {
  it('yolculuk satırı beklenen özeti gösterir', async () => {
    _reply = async () => ({ ok: true, rows: [row()] });
    await render(vehicle('v1'));

    expect(entries()).toHaveLength(1);
    const text = container.textContent ?? '';
    expect(text).toContain('Tarsus → Mersin');
    expect(text).toContain('64.3 km');
    expect(text).toContain('1 sa 35 dk');
    expect(text).toContain('49 km/sa');
    expect(text).toContain('112 km/sa');
    expect(text).toContain('86');
  });

  it('detay kapalı başlar, dokununca açılır', async () => {
    _reply = async () => ({ ok: true, rows: [row()] });
    await render(vehicle('v1'));

    expect(container.querySelector('[data-testid="journal-detail"]')).toBeNull();

    const btn = entries()[0]?.querySelector('button') as HTMLButtonElement;
    await act(async () => { btn.click(); });

    const detail = container.querySelector('[data-testid="journal-detail"]');
    expect(detail).not.toBeNull();
    expect(detail?.textContent).toContain('Hareket süresi');
    expect(detail?.textContent).toContain('Duruş / mola');
  });

  it('detayda TAM ROTA vaat EDİLMEZ — rotanın cihazda kaldığı söylenir', async () => {
    _reply = async () => ({ ok: true, rows: [row()] });
    await render(vehicle('v1'));
    const btn = entries()[0]?.querySelector('button') as HTMLButtonElement;
    await act(async () => { btn.click(); });

    const detail = container.querySelector('[data-testid="journal-detail"]');
    expect(detail?.textContent).toContain('yalnız aracınızda saklanır');
    /* Koordinat ekrana ÇIKMAZ. */
    expect(container.querySelector('svg polyline')).toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('anormal kapanış kullanıcıya AÇIKÇA söylenir', async () => {
    _reply = async () => ({ ok: true, rows: [row({ end_reason: 'DATA_SILENCE' })] });
    await render(vehicle('v1'));

    expect(entries()[0]?.dataset.cleanEnd).toBe('false');
    expect(container.querySelector('[data-testid="journal-note"]')?.textContent)
      .toContain('eksik olabilir');
  });

  it('skoru olmayan yolculukta rozet ÇİZİLMEZ (sahte 0 yok)', async () => {
    _reply = async () => ({ ok: true, rows: [row({ score: null })] });
    await render(vehicle('v1'));

    expect(container.querySelector('[data-testid="journal-score"]')).toBeNull();
    expect(container.textContent).not.toContain('SKOR 0');
  });

  it('BOZUK satır bütün listeyi düşürmez', async () => {
    _reply = async () => ({
      ok: true,
      rows: [row(), null, { trip_key: null }, { trip_key: 'k2' }],
    });
    await render(vehicle('v1'));

    expect(entries()).toHaveLength(2);
    expect(stateEl()).toBeNull();
  });

  it('eksik metrikli satır "Bilinmiyor" der, gizlenmez', async () => {
    _reply = async () => ({ ok: true, rows: [{ trip_key: 'k2' }] });
    await render(vehicle('v1'));

    expect(entries()).toHaveLength(1);
    expect(container.textContent).toContain('Bilinmiyor');
    expect(container.textContent).toContain('--:-- → --:--');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. ARAÇ KAPSAMI
 * ════════════════════════════════════════════════════════════════════════ */

describe('araç kapsamı', () => {
  it('yalnız SEÇİLİ aracın kimliğiyle okuma yapılır', async () => {
    _reply = async () => ({ ok: true, rows: [row()] });
    await render(vehicle('v1'));

    expect(_calls).toHaveLength(1);
    expect(_calls[0]?.vehicleId).toBe('v1');
  });

  it('araç değişince O ARACIN kapsamıyla yeniden okunur', async () => {
    _reply = async (id) => ({
      ok: true,
      rows: [row({ trip_key: `key-${id}`, start_area: id === 'v1' ? 'Tarsus' : 'Adana' })],
    });

    await render(vehicle('v1'));
    expect(container.textContent).toContain('Tarsus');

    await render(vehicle('v2'));
    expect(_calls.map((c) => c.vehicleId)).toEqual(['v1', 'v2']);
    expect(container.textContent).toContain('Adana');
    expect(container.textContent).not.toContain('Tarsus');
  });

  it('GEÇ dönen eski araç yanıtı yeni aracın listesini EZEMEZ', async () => {
    let releaseV1: (() => void) | null = null;
    const v1Gate = new Promise<void>((r) => { releaseV1 = r; });

    _reply = async (id) => {
      if (id === 'v1') {
        await v1Gate;
        return { ok: true, rows: [row({ trip_key: 'eski', start_area: 'ESKI' })] };
      }
      return { ok: true, rows: [row({ trip_key: 'yeni', start_area: 'YENI' })] };
    };

    await render(vehicle('v1'));   // v1 yanıtı ASILI
    await render(vehicle('v2'));   // v2 yanıtı geldi

    expect(container.textContent).toContain('YENI');

    /* v1'in geç yanıtı şimdi düşüyor — ekranı EZMEMELİ. */
    await act(async () => { releaseV1?.(); await Promise.resolve(); });

    expect(container.textContent).toContain('YENI');
    expect(container.textContent).not.toContain('ESKI');
  });
});
