/**
 * buildProvenance.test.ts — "APK eski dosyalarla derlendi" tuzağına karşı kilitler.
 *
 *   · Derleme damgası: commit + değişiklik bayrağı + dal; git yoksa SAHTE değer yok.
 *   · Debug APK'da OTA sorgusu YAPILMAZ (test derlemesi yayınla sessizce değiştirilmez);
 *     alan yoksa (eski APK) mevcut davranış korunur.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeBuildStamp, parseBuildStamp, stampVersionTag, formatBuildStamp, UNKNOWN_COMMIT,
} from '../utils/buildStamp';

// ── OTA sahteleri ────────────────────────────────────────────────────────────
const M = vi.hoisted(() => ({
  debugBuild: undefined as boolean | undefined,
  fromCalls: 0,
}));
vi.mock('../platform/vehicleDataLayer/UnifiedVehicleStore', () => ({
  useUnifiedVehicleStore: { getState: () => ({ speed: 0 }) },
}));
vi.mock('../platform/nativeCommandBridge', () => ({
  getAppVersionInfo: vi.fn(async () => ({ versionCode: 5, versionName: '1.0.2-dev+abc1234', packageName: 'p', debugBuild: M.debugBuild })),
  downloadOtaApk: vi.fn(),
  installOtaApk: vi.fn(),
}));
vi.mock('../platform/supabaseClient', () => ({
  getSupabaseClient: () => {
    const b: Record<string, unknown> = {};
    const self = () => b;
    b['select'] = self; b['eq'] = self; b['gt'] = self; b['order'] = self;
    b['limit'] = async () => ({ data: [], error: null });
    return { from: () => { M.fromCalls++; return b; } };
  },
}));
vi.mock('../platform/debug', () => ({ logInfo: vi.fn() }));
vi.mock('../platform/vehicleIdentityService', () => ({ pushVehicleEvent: vi.fn(async () => {}) }));

import { checkForUpdate, useOtaStore, _resetOtaServiceForTest } from '../platform/otaUpdateService';

const NOW = new Date('2026-10-01T07:12:34.000Z');

describe('derleme damgası', () => {
  const git = (out: Record<string, string | null>) => (args: string) => (args in out ? out[args] : null);

  it('temiz ağaç: commit + dal + dirty=false', () => {
    const s = computeBuildStamp(git({
      'rev-parse --short HEAD': '79ac083\n', 'rev-parse --abbrev-ref HEAD': 'main\n', 'status --porcelain': '',
    }), NOW);
    expect(s).toEqual({ commit: '79ac083', dirty: false, branch: 'main', time: '2026-10-01T07:12:34.000Z' });
    expect(stampVersionTag(s)).toBe('79ac083.20261001T071234');
  });

  it('commit\'lenmemiş değişiklik (izlenmeyen dosya dahil) → dirty=true, sonek .dirty', () => {
    const s = computeBuildStamp(git({
      'rev-parse --short HEAD': '79ac083', 'rev-parse --abbrev-ref HEAD': 'x', 'status --porcelain': '?? src/yeni.ts\n',
    }), NOW);
    expect(s.dirty).toBe(true);
    expect(stampVersionTag(s)).toBe('79ac083.dirty.20261001T071234');
    expect(formatBuildStamp(s)).toContain('commit\'lenmemiş değişiklikli');
  });

  it('git yok → unknown / null; sahte "temiz" üretilmez', () => {
    const s = computeBuildStamp(() => null, NOW);
    expect(s.commit).toBe(UNKNOWN_COMMIT);
    expect(s.dirty).toBeNull();
    expect(formatBuildStamp(s)).toContain('bilinmiyor');
  });

  it('JSON doğrulama: şema dışı → null', () => {
    expect(parseBuildStamp({ commit: 'a', dirty: false, branch: 'b', time: 't' })).not.toBeNull();
    expect(parseBuildStamp({ commit: '', dirty: false, branch: 'b', time: 't' })).toBeNull();
    expect(parseBuildStamp({ commit: 'a', dirty: 'no', branch: 'b', time: 't' })).toBeNull();
    expect(parseBuildStamp(null)).toBeNull();
  });
});

describe('OTA — debug APK kapısı', () => {
  beforeEach(() => {
    _resetOtaServiceForTest();
    M.fromCalls = 0;
  });

  it('debug derlemede sunucu sorgulanmaz, durum idle kalır', async () => {
    M.debugBuild = true;
    await checkForUpdate();
    expect(M.fromCalls).toBe(0);
    expect(useOtaStore.getState().state).toBe('idle');
  });

  it('release derlemede sorgu yapılır (davranış değişmedi)', async () => {
    M.debugBuild = false;
    await checkForUpdate();
    expect(M.fromCalls).toBe(1);
  });

  it('eski APK (alan yok) → mevcut davranış: sorgu yapılır', async () => {
    M.debugBuild = undefined;
    await checkForUpdate();
    expect(M.fromCalls).toBe(1);
  });
});

// ═══════════════════ apk-dev zinciri: saf yardımcılar ═══════════════════
import { deflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { stampVersionTag as tsTag } from '../utils/buildStamp';
import { readZipEntry, versionTag, sameStamp, parseDumpsysPackage, installSucceeded } from '../../scripts/lib/apkProvenance.mjs';

/** Minimal zip üretici: [ad, içerik, deflate?] girdileri. */
function makeZip(entries: Array<[string, string, boolean]>): Buffer {
  const locals: Buffer[] = [];
  const cens: Buffer[] = [];
  let off = 0;
  for (const [name, text, deflate] of entries) {
    const raw = Buffer.from(text, 'utf8');
    const data = deflate ? deflateRawSync(raw) : raw;
    const n = Buffer.from(name, 'utf8');
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(deflate ? 8 : 0, 8);
    loc.writeUInt32LE(data.length, 18); loc.writeUInt32LE(raw.length, 22); loc.writeUInt16LE(n.length, 26);
    locals.push(loc, n, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(deflate ? 8 : 0, 10);
    cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(raw.length, 24); cen.writeUInt16LE(n.length, 28);
    cen.writeUInt32LE(off, 42);
    cens.push(cen, n);
    off += 30 + n.length + data.length;
  }
  const cenBuf = Buffer.concat(cens);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cenBuf.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cenBuf, eocd]);
}

describe('apk-dev yardımcıları', () => {
  const STAMP = { commit: '79ac083', dirty: true, branch: 'x', time: '2026-10-01T07:12:34.000Z' };

  it('APK (zip) içinden damga okunur — sıkıştırmasız ve deflate', () => {
    const zip = makeZip([
      ['AndroidManifest.xml', 'x'.repeat(50), false],
      ['assets/public/build-stamp.json', JSON.stringify(STAMP), true],
      ['assets/public/index.html', '<html/>', false],
    ]);
    expect(JSON.parse(readZipEntry(zip, 'assets/public/build-stamp.json').toString('utf8'))).toEqual(STAMP);
    expect(readZipEntry(zip, 'assets/public/index.html').toString('utf8')).toBe('<html/>');
    expect(readZipEntry(zip, 'yok.json')).toBeNull();
    expect(() => readZipEntry(Buffer.from('zip değil'), 'a')).toThrow();
  });

  it('etiket: TS = JS betik = Gradle biçimi', () => {
    for (const s of [STAMP, { ...STAMP, dirty: false }, { ...STAMP, dirty: null }]) {
      expect(versionTag(s)).toBe(tsTag(s));
    }
    // build.gradle aynı formülü taşıyor mu (Groovy burada koşulamaz → kaynak kilidi)
    const gradle = readFileSync('android/app/build.gradle', 'utf8');
    expect(gradle).toContain(`replaceAll('[-:]', '').take(15)`);
    expect(gradle).toContain('"${c}.dirty.${id}" : "${c}.${id}"');
    expect(gradle).toContain('versionNameSuffix "-dev+${webBuildTag}"');
    expect(gradle).toContain("file('src/main/assets/public/build-stamp.json')");
  });

  it('aynı derleme kontrolü commit + dirty + zamanı ister', () => {
    expect(sameStamp(STAMP, { ...STAMP })).toBe(true);
    expect(sameStamp(STAMP, { ...STAMP, time: '2026-10-01T07:12:35.000Z' })).toBe(false);
    expect(sameStamp(STAMP, null)).toBe(false);
  });

  it('dumpsys ve adb install çıktısı ayrıştırılır', () => {
    const d = parseDumpsysPackage('  versionCode=5 minSdk=24\n    versionName=1.0.2-dev+79ac083.20261001T071234\n    lastUpdateTime=2026-10-01 10:12:40\n');
    expect(d).toEqual({ versionName: '1.0.2-dev+79ac083.20261001T071234', lastUpdateTime: '2026-10-01 10:12:40' });
    expect(parseDumpsysPackage('boş')).toEqual({ versionName: null, lastUpdateTime: null });
    expect(installSucceeded('Performing Streamed Install\nSuccess\n')).toBe(true);
    expect(installSucceeded('adb: failed to install x.apk: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]')).toBe(false);
  });

  it('npm betiği tanımlı', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['apk:dev']).toBe('node scripts/apk-dev.mjs');
  });
});
