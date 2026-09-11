/**
 * tripJournalMaviLab.test.ts — MAVİ BAĞLAMI + CAROS LAB KANIT KİLİTLERİ.
 *
 * ── NEDEN ────────────────────────────────────────────────────────────
 * "Şu anda hareket ediyor muyuz?" ANLIK bir olgudur ve birikmiş süreden
 * TÜRETİLEMEZ: 40 dakikadır yolda olan bir araç şu an kırmızı ışıkta
 * duruyor olabilir. Mavi bunu tahmin etmemeli, kanonik projeksiyondan
 * OKUMALIDIR — ve ölçemediğinde "duruyoruz" DEMEMELİDİR.
 *
 * LAB tarafında kilit tek cümledir: gözlemler, üretmez.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { interpretMotionState } from '../platform/companion/companionContext';

/* ══════════════════════════════════════════════════════════════════════════
 * 1. MAVİ — hareket durumu yorumu
 * ════════════════════════════════════════════════════════════════════════ */

describe('Mavi hareket durumu yorumu', () => {
  it('hareket hâlinde açıkça söyler', () => {
    expect(interpretMotionState('MOVING')).toContain('hareket hâlindeyiz');
  });

  it('trip içi duruşu "yolculuk bitti" SANMAZ', () => {
    const line = interpretMotionState('STOPPED_IN_TRIP') ?? '';
    expect(line).toContain('duruyoruz');
    expect(line).toContain('yolculuk bitmedi');
  });

  it('kapanış penceresini kesinleşmiş bitiş gibi ANLATMAZ', () => {
    const line = interpretMotionState('TRIP_ENDING') ?? '';
    expect(line).toContain('kapanabilir');
    expect(line).not.toContain('yolculuk bitti');
  });

  it('ÖLÇEMEDİĞİNDE "duruyoruz" DEMEZ — açıkça bilinmiyor der', () => {
    const line = interpretMotionState('UNKNOWN_DEGRADED') ?? '';
    expect(line).toContain('ölçemiyorum');
    expect(line).not.toMatch(/hareket hâlindeyiz|duruyoruz\./);
  });

  it('park hâlinde ve tamamlanmışta satır ÜRETİLMEZ (boşta sıfır token)', () => {
    expect(interpretMotionState('PARKED')).toBeNull();
    expect(interpretMotionState('COMPLETED')).toBeNull();
  });

  it('durum bilinmiyorsa (null/undefined) satır üretilmez', () => {
    expect(interpretMotionState(null)).toBeNull();
    expect(interpretMotionState(undefined)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. MAVİ — bağlam kablolaması (kaynak kilidi)
 * ════════════════════════════════════════════════════════════════════════ */

describe('Mavi bağlam kablolaması', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'src/platform/companion/companionChatProvider.ts'),
    'utf8',
  );

  it('hareket durumu KANONİK projeksiyondan okunur', () => {
    expect(src).toMatch(/interpretMotionState\(getTripJournalGlance\(\)\.state\)/);
  });

  it('Mavi kendi mesafe/süre hesabını YAPMAZ — oturum otoritesini kullanır', () => {
    /* Süre/mesafe satırı `tripSessionService` projeksiyonundan gelir. */
    expect(src).toMatch(/interpretTripSession\(\{/);
    expect(src).toMatch(/readTripSessionOrNull\(\)/);
    /* Kendi haversine/toplama hesabı OLMAMALI. */
    expect(src).not.toMatch(/haversine/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. CAROS LAB — Seyir Defteri kanıtı
 * ════════════════════════════════════════════════════════════════════════ */

describe('CarOS LAB · Trip Journal kanıtı', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'src/components/devtools/screens/TripEngineScreen.tsx'),
    'utf8',
  );

  it('istenen kanıt alanlarının hepsi ekranda', () => {
    for (const field of [
      'tripId', 'tripState', 'motionState', 'startedAt',
      'duration', 'movingDuration', 'stoppedDuration',
      'distance', 'maxSpeed', 'syncState', 'pendingSync',
      'lastTripEndReason', 'completionCardTripId',
    ]) {
      expect(src).toContain(field);
    }
  });

  it('LAB hiçbir şey BAŞLATMAZ / YAZMAZ (salt gözlem)', () => {
    expect(src).not.toMatch(/\bbeginJournal\(/);
    expect(src).not.toMatch(/\bfinalizeJournal\(/);
    expect(src).not.toMatch(/\brecordJournal\w*\(/);
    expect(src).not.toMatch(/\battachJournalAreas\(/);
    expect(src).not.toMatch(/\bstartTripLog\(|\bstopTripLog\(/);
  });

  it('okuma AYRI AYRI fail-soft (biri düşse öteki kanıt kaybolmasın)', () => {
    expect(src).toMatch(/try \{ journal = getTripJournalGlance\(\); \} catch/);
    expect(src).toMatch(/try \{ openJournal = readOpenJournal\(\); \} catch/);
    expect(src).toMatch(/try \{ journalRecordCount = listJournalIds\(\)\.length; \} catch/);
  });

  it('süre/mesafe LAB içinde YENİDEN HESAPLANMAZ (sahiplerinden okunur)', () => {
    expect(src).toMatch(/snap\.session\.elapsedMs/);
    expect(src).toMatch(/snap\.session\.distanceMeters/);
  });

  it('rota izinin cihazda kaldığı ekranda AÇIKÇA yazar', () => {
    expect(src).toMatch(/YALNIZ bu cihazda saklanır/);
  });
});
