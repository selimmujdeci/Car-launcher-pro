/**
 * deepScanPidBreakdown.test — derin tarama "yeni / zaten kayıtlı" kırılımının kilitleri.
 *
 * SAHA KÖKENİ (2026-07-31): kullanıcı "25 PID bulundu ama HİÇBİRİ eklenmedi" dedi ve
 * sessiz bir veri kaybı sandı. Kayıp yoktu — bulunan PID'lerin hepsi standart katalogda
 * ZATEN vardı (`status:'known'` → `captured:false`); panel bunu SÖYLEMİYORDU.
 *
 * Kırılım eklenirken ikinci bir kusur doğdu: gözlem listesi uygulama ömrü boyunca
 * BİRİKİR; ham sayımı tek bir taramanın sonucuyla yan yana yazmak toplamı tutmayan
 * ("25 bulundu · 40 tanesi zaten kayıtlı") bir cümle üretebilirdi. Bu testler her iki
 * kusuru da kilitler.
 */
import { describe, it, expect } from 'vitest';
import { computeDeepScanPidBreakdown } from '../components/discovery/deepScanBreakdownModel';
import { createDiscoveryRecord } from '../platform/obd/discovery/discoveryModel';
import type { DiscoveryObservation } from '../platform/obd/discovery/DiscoveryCaptureService';

function obs(
  pidOrDid: string,
  status: 'new' | 'known',
  discoverySource: 'PID' | 'DID' = 'PID',
): DiscoveryObservation {
  const record = createDiscoveryRecord({ pidOrDid, discoverySource, mode: '01', timestamp: 1 });
  return { record, status, seenCount: 1, firstAt: 1, lastAt: 1 };
}

describe('deepScanPidBreakdown — oturum kapsamı', () => {
  it('kırılım YALNIZ bu taramanın PID\'lerinden üretilir (ömür boyu birikim sızmaz)', () => {
    const scanned = [{ pid: '0C' }, { pid: '0D' }];
    const observations = [
      obs('0C', 'known'), obs('0D', 'known'),
      // Önceki taramalardan/başka kaynaklardan biriken gözlemler — bu taramaya ait DEĞİL.
      obs('05', 'known'), obs('2F', 'known'), obs('78', 'new'),
    ];
    const b = computeDeepScanPidBreakdown(scanned, observations);
    expect(b.known).toBe(2);
    expect(b.fresh).toBe(0);
    expect(b.unclassified).toBe(0);
  });

  it('INVARYANT: known + fresh + unclassified === taranan PID sayısı', () => {
    const scanned = [{ pid: '0C' }, { pid: '78' }, { pid: 'A1' }];
    const b = computeDeepScanPidBreakdown(scanned, [obs('0C', 'known'), obs('78', 'new')]);
    expect(b.known + b.fresh + b.unclassified).toBe(scanned.length);
    expect(b).toEqual({ known: 1, fresh: 1, unclassified: 1 });
  });

  it('gözlemi olmayan PID TAHMİN EDİLMEZ → unclassified (sahte "yeni" yok)', () => {
    const b = computeDeepScanPidBreakdown([{ pid: '5C' }], []);
    expect(b).toEqual({ known: 0, fresh: 0, unclassified: 1 });
  });

  it('DID gözlemleri PID kırılımına KARIŞMAZ', () => {
    const b = computeDeepScanPidBreakdown(
      [{ pid: 'F190' }],
      [obs('F190', 'new', 'DID')], // aynı kimlik ama DID → PID sayımına girmez
    );
    expect(b).toEqual({ known: 0, fresh: 0, unclassified: 1 });
  });

  it('hex normalizasyonu: " 0c " ile "0C" aynı PID sayılır (boşluk/küçük harf)', () => {
    const b = computeDeepScanPidBreakdown([{ pid: ' 0c ' }], [obs('0C', 'known')]);
    expect(b.known).toBe(1);
  });

  it('aynı PID iki ECU\'dan gözlendiyse ve biri YENİ ise keşif kaybolmaz', () => {
    const b = computeDeepScanPidBreakdown([{ pid: '78' }], [obs('78', 'known'), obs('78', 'new')]);
    expect(b.fresh).toBe(1);
    expect(b.known).toBe(0);
  });

  it('boş tarama sonucu sıfır kırılım üretir (bölme/NaN yok)', () => {
    expect(computeDeepScanPidBreakdown([], [obs('0C', 'known')]))
      .toEqual({ known: 0, fresh: 0, unclassified: 0 });
  });
});
