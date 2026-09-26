import { describe, it, expect } from 'vitest';
import { formatAppStateLine } from '../platform/companion/appStateContext';

const base = { media: null, nav: null, driverName: null, volume: null, brightness: null, theme: null };

describe('Mavi beyni uygulama durumunu görür (saha 2026-09-26)', () => {
  it('çalan parça, rota, sürücü ve ayarlar tek satırda', () => {
    const line = formatAppStateLine({
      media: { playing: true, title: 'Acem Kızı', artist: 'Sezen Aksu', source: 'youtube' },
      nav: { status: 'ACTIVE', destination: 'Tarsus Şelalesi', remainingKm: 12.34, etaMin: 17.6 },
      driverName: 'Selim', volume: 45, brightness: 92, theme: 'expedition',
    });
    expect(line).toContain('Şu an çalan: "Acem Kızı" — Sezen Aksu (YouTube).');
    expect(line).toContain('Aktif rota: Tarsus Şelalesi, kalan 12 km, tahmini varış 18 dk.');
    expect(line).toContain('Sürücü: Selim.');
    expect(line).toContain('ses %45, parlaklık %92, tema gece');
  });

  it('bilinmeyen alan UYDURULMAZ', () => {
    expect(formatAppStateLine(base)).toBe('');
    const l = formatAppStateLine({ ...base, nav: { status: 'ACTIVE', destination: 'Ev', remainingKm: null, etaMin: null } });
    expect(l).toBe('Aktif rota: Ev.');
    expect(formatAppStateLine({ ...base, nav: { status: 'IDLE', destination: null, remainingKm: null, etaMin: null } })).toBe('Aktif rota yok.');
  });

  it('duraklatılmış parça "çalıyor" diye sunulmaz', () => {
    const l = formatAppStateLine({ ...base, media: { playing: false, title: 'Firuze', artist: null, source: 'radio' } });
    expect(l).toBe('Müzik duraklatılmış; son parça: "Firuze" (radyo).');
  });
});
