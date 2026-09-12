/**
 * blackBoxCrashLogSurface.test.tsx — E-33 KİLİDİ: kaza günlükleri OKUNABİLİR.
 *
 * ── BULUNAN KUSUR (envanter denetimi E-33) ─────────────────────────────
 * `listCrashLogKeys` · `readCrashLog` · `deleteCrashLog` · `getBlackBoxSnapshot`
 * ürün yolunda SIFIR çağırana sahipti: kaza kayıtları diske yazılıyor ama
 * hiçbir yüzeyde görünmüyordu — yani kaza sonrası tek kanıt kaynağı ölüydü.
 *
 * ── NE KİLİTLENİYOR ────────────────────────────────────────────────────
 * 1. Kayıt varsa listelenir (zaman · tepe G · örnek sayısı).
 * 2. KONTROL — kayıt yoksa "KAYIT YOK" der; sahte satır/sahte 0 üretmez.
 * 3. GİZLİLİK — lat/lng ekrana TAŞINMAZ, yalnız "konum örneği VAR/YOK".
 * 4. Bozuk kayıt "OKUNAMADI" olur; sessizce atlanmaz (yokluk ≠ okunamama).
 * 5. Kalıcı defter TIMER KURMAZ (elle YENİLE) — canlı tamponun 2 sn'lik
 *    döngüsü bu bölüme sirayet etmez.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';

const h = vi.hoisted(() => ({
  keys: [] as string[],
  records: new Map<string, unknown>(),
  deleted: [] as string[],
}));

vi.mock('../platform/security/blackBoxService', () => ({
  getReplayData: () => [],
  getBlackBoxSnapshot: () => [],
  listCrashLogKeys: () => h.keys,
  readCrashLog: (key: string) => h.records.get(key) ?? null,
  deleteCrashLog: (key: string) => { h.deleted.push(key); },
  getCrashDetectionHealth: () => ({
    recorded: 2, rejectedNoMotion: 1, motionEvidenceSeen: true,
    storedRecords: h.keys.length, minSpeedKmh: 20, motionWindowMs: 5_000, maxStored: 5,
  }),
}));

import { BlackBoxReplayView } from '../components/debug/BlackBoxReplayView';

const SRC = readFileSync('src/components/debug/BlackBoxReplayView.tsx', 'utf8');

const SECRET_LAT = 37.8746123;
const SECRET_LNG = 32.4931987;

function slot(over: Record<string, number> = {}) {
  return {
    ts: 0, speed: 22, obdSpeed: -1, rpm: 2400, brake: -1,
    heading: 180, lat: 0, lng: 0, fuel: 55,
    gForce: 1.2, gx: 0, gy: 0, gz: 0, ...over,
  };
}

function render(): string {
  return renderToStaticMarkup(<BlackBoxReplayView />);
}

describe('E-33 — kaza günlüğü okuma yüzeyi', () => {
  beforeEach(() => {
    h.keys = [];
    h.records.clear();
    h.deleted.length = 0;
  });

  it('KONTROL — kayıt yokken "KAYIT YOK" der, sahte satır üretmez', () => {
    const html = render();
    expect(html).toContain('bb-crash-logs');
    expect(html).toContain('KAYIT YOK');
    expect(html).not.toContain('bb-crash-row-');
  });

  it('kayıt varsa zaman · tepe G · örnek sayısıyla listelenir', () => {
    h.keys = ['crash-log-1786000000000'];
    h.records.set('crash-log-1786000000000', {
      version: 3, crashAt: 1786000000000, crashMono: 10, originEpoch: 0,
      peakG: 4.37, buffer: [slot(), slot({ ts: 100 })],
    });

    const html = render();
    expect(html).toContain('bb-crash-row-crash-log-1786000000000');
    expect(html).toContain('4.37 G');
    expect(html).toContain('2 örnek');
    expect(html).toContain('KALICI KAZA GÜNLÜKLERİ — 1 kayıt');
  });

  it('GİZLİLİK — koordinat ekrana TAŞINMAZ, yalnız VAR/YOK bilgisi çıkar', () => {
    h.keys = ['crash-log-1786000000001'];
    h.records.set('crash-log-1786000000001', {
      version: 3, crashAt: 1786000000001, crashMono: 10, originEpoch: 0,
      peakG: 5, buffer: [slot({ lat: SECRET_LAT, lng: SECRET_LNG })],
    });

    const html = render();
    expect(html).not.toContain(String(SECRET_LAT));
    expect(html).not.toContain(String(SECRET_LNG));
    expect(html).toContain('konum örneği VAR');
  });

  it('bozuk/okunamayan kayıt SESSİZCE ATLANMAZ', () => {
    h.keys = ['crash-log-1786000000002'];
    /* readCrashLog null döner (bozuk JSON) → satır yine görünür. */
    const html = render();
    expect(html).toContain('bb-crash-row-crash-log-1786000000002');
    expect(html).toContain('KAYIT OKUNAMADI');
  });

  it('kalıcı defter TIMER KURMAZ (yalnız canlı tamponun kendi döngüsü var)', () => {
    const section = SRC.slice(SRC.indexOf('const CrashLogSection'), SRC.indexOf('export const BlackBoxReplayView'));
    expect(section).not.toContain('setInterval');
    expect(section).not.toContain('setTimeout');
    /* Silme İKİ ADIMDIR — tek tıkla kalıcı veri yok edilemez. */
    expect(section).toContain('confirmKey');
    expect(section).toContain('KALICI SİL');
  });
});
