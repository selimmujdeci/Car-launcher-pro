/**
 * miniMapStandstillDrift.test.ts — #618 KİLİDİ
 *
 * SAHA KUSURU (cihazda ölçüldü 2026-08-17, Xiaomi 23090RA98I; kullanıcı: *"yolda
 * değilim"*): araç DURURKEN mini harita sürüş görünümüne kayıyordu.
 * 12 s boyunca 2 s'de bir ölçüm: GPS `speedKmh` = 0 (hepsinde), doğruluk
 * 1,8–4,2 m, fix yaşı ~1 s — ama kamera zoom 16,4 → 17,5 ve pitch 2° → 10°.
 *
 * KÖK: yer-değiştirme hızı üç yerden şişiyordu — Manhattan toplamı (Öklit değil),
 * `cos(lat)` düzeltmesinin yokluğu ve **doğruluk kapısının yokluğu**. Ölçülen
 * örnek: 2 s'de 4,7 m sürüklenme → 8,4 km/h → 5 km/h eşiği aşılıyor.
 *
 * BU KİLİTLER ZAYIFLATILMAZ.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { _haversineMeters } from '../platform/gps/gpsMath';

const SRC = readFileSync(
  join(process.cwd(), 'src/components/map/MiniMapWidget.tsx'),
  'utf8',
);
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

describe('#618 — durur hâlde GPS sürüklenmesi HAREKET sayılmaz', () => {
  it('🔒 mesafe tek otoriteden gelir — elle Manhattan/derece aritmetiği YOK', () => {
    expect(code).toMatch(/_haversineMeters\(/);
    // Eski şişiren biçim geri gelmemeli: `lastApplied*` referansına karşı
    // Manhattan (|Δlat| + |Δlng|) toplamı — ne metre ne derece cinsinden.
    expect(code).not.toMatch(/Math\.abs\(latitude - lastAppliedLatRef\.current\)\s*\+/);
    expect(code).not.toMatch(/movedDeg/);
    // Boylam farkı ASLA cos(lat) düzeltmesiz kullanılmamalı.
    expect(code).not.toMatch(/Math\.abs\(longitude - lastAppliedLngRef\.current\)/);
    // Dosyadaki her `111_320` boylam çarpımı cos düzeltmesi taşımalı:
    for (const line of code.split('\n')) {
      if (/_dLon|\.lon - |longitude - /.test(line) && line.includes('111_320')) {
        expect(line, `cos(lat) düzeltmesi yok: ${line.trim()}`).toMatch(/Math\.cos/);
      }
    }
  });

  it('🔒 yer değiştirme DOĞRULUK yarıçapını aşmadıkça hız üretilmez', () => {
    expect(code).toMatch(/_movedM\s*>\s*_moveGate/);
    // Kapı doğruluk ile taban arasından büyüğü olmalı (taban asla 0 olamaz).
    expect(code).toMatch(/Math\.max\(_accM,\s*[1-9]\d*\)/);
  });

  it('🔒 GPS\'in KENDİ hız bildirimi bu kapıya tabi değildir (ayrı kanıt)', () => {
    // _effKmh hâlâ ham GPS hızını da dikkate almalı — kapı yalnız türetilen hıza.
    expect(code).toMatch(/Math\.max\(speedKmh,\s*_dispKmh\)/);
  });

  it('sahada ölçülen sürüklenme (2 s / 4,7 m, doğruluk 4 m) sürüş eşiğini AÇMAZ', () => {
    // Cihazda kaydedilen iki ardışık örnek (i=1 → i=2):
    const a = { lat: 36.917568, lon: 34.861958 };
    const b = { lat: 36.917553, lon: 34.861985 };
    const movedM = _haversineMeters(a.lat, a.lon, b.lat, b.lon);
    const dtSec  = 2;
    const accM   = 4.2;
    const gate   = Math.max(accM, 8);

    // Ön koşul: gerçekten küçük bir sürüklenme (doğruluk mertebesinde)
    expect(movedM).toBeLessThan(gate);

    const dispKmh = movedM > gate ? (movedM / dtSec) * 3.6 : 0;
    expect(dispKmh).toBe(0);                 // hareket ÜRETİLMEZ
    expect(dispKmh > 5).toBe(false);         // sürüş görünümü AÇILMAZ

    // Eski (kusurlu) formül aynı veriyle eşiği AŞIYORDU — kilidin anlamı bu:
    const eskiManhattanM = (Math.abs(b.lat - a.lat) + Math.abs(b.lon - a.lon)) * 111_320;
    expect((eskiManhattanM / dtSec) * 3.6).toBeGreaterThan(5);
  });

  it('gerçek hareket (2 s / 25 m) hâlâ sürüş olarak algılanır — kapı fazla sıkı DEĞİL', () => {
    const a = { lat: 36.917568, lon: 34.861958 };
    // ~25 m kuzeye
    const b = { lat: a.lat + 25 / 111_320, lon: a.lon };
    const movedM = _haversineMeters(a.lat, a.lon, b.lat, b.lon);
    const gate   = Math.max(4.2, 8);
    expect(movedM).toBeGreaterThan(gate);
    const dispKmh = (movedM / 2) * 3.6;
    expect(dispKmh).toBeGreaterThan(5);
  });
});
