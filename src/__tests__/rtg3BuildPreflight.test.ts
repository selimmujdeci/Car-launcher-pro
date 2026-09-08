import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  RTG3_TOOLCHAIN, assertPreflight, compareSemver, runRtg3BuildPreflight,
} from '../../scripts/rtg3BuildPreflight.mjs';

/* Gerçek PBF'ler `field-runs/.../raw` altında ve gitignore'ludur; bu testler
   ONLARA BAĞLI OLAMAZ. Bu yüzden imza doğrulaması sentetik baytla sınanır. */
const work = mkdtempSync(resolve(tmpdir(), 'rtg3-preflight-'));
const temp = resolve(work, 'tmp');
const out = resolve(work, 'regions');
mkdirSync(temp, { recursive: true });
mkdirSync(out, { recursive: true });

/** Geçerli görünüşlü OSM PBF başlığı: BE uint32 uzunluk + `OSMHeader` blob'u. */
function writePbfLike(path: string): string {
  const head = Buffer.alloc(64);
  head.writeUInt32BE(14, 0);
  head.write('\n\tOSMHeader', 4, 'binary');
  writeFileSync(path, head);
  return path;
}

const validSource = writePbfLike(resolve(work, 'valid.osm.pbf'));
const junkSource = resolve(work, 'junk.osm.pbf');
writeFileSync(junkSource, Buffer.alloc(64, 0x41));

const byName = (report: Awaited<ReturnType<typeof runRtg3BuildPreflight>>, name: string) =>
  report.checks.find((c) => c.check === name)!;

afterAll(() => { rmSync(work, { recursive: true, force: true }); });

describe('RTG3 build preflight', () => {
  it('araç zinciri sözleşmesi package.json#engines ile SENKRON', () => {
    /* İki yerde iki farklı Node alt sınırı = reproducible build DEĞİL. */
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    expect(pkg.engines?.node).toBe(`>=${RTG3_TOOLCHAIN.node.min}`);
  });

  it('sürüm karşılaştırması eksik parçalarla da doğru', () => {
    expect(compareSemver('22.13.0', '22.13.0')).toBe(0);
    expect(compareSemver('22.12.9', '22.13.0')).toBe(-1);
    expect(compareSemver('24.15.0', '22.13.0')).toBe(1);
    expect(compareSemver('1.19', '1.14.0')).toBe(1);
    expect(compareSemver('1.9', '1.14.0')).toBe(-1);   // sayısal, sözlüksel DEĞİL
  });

  it('bu çalıştırıcıda Node ve node:sqlite yeteneğini GERÇEKTEN kanıtlar', async () => {
    const report = await runRtg3BuildPreflight({
      sourcePath: validSource, tempDir: temp, outputDir: out, memoryBudgetMiB: 512,
    });
    expect(byName(report, 'node-runtime').result).toBe('PASS');
    /* Yetenek `import` edilebilmesiyle değil, CREATE+INSERT+SELECT ile ölçülür. */
    expect(byName(report, 'node-sqlite-capability').result).toBe('PASS');
    expect(byName(report, 'node-sqlite-capability').measured).toBe('USABLE');
    expect(byName(report, 'source-pbf').result).toBe('PASS');
    expect(byName(report, 'temp-writable').result).toBe('PASS');
    expect(byName(report, 'output-writable').result).toBe('PASS');
    expect(byName(report, 'memory-budget').result).toBe('PASS');
  });

  it('eksik kaynağı, bozuk imzayı ve geçersiz bütçeyi fail-fast reddeder', async () => {
    const missing = await runRtg3BuildPreflight({
      sourcePath: resolve(work, 'yok.osm.pbf'), tempDir: temp, outputDir: out, memoryBudgetMiB: 512,
    });
    expect(missing.ok).toBe(false);
    expect(byName(missing, 'source-pbf').result).toBe('FAIL');

    const junk = await runRtg3BuildPreflight({
      sourcePath: junkSource, tempDir: temp, outputDir: out, memoryBudgetMiB: 512,
    });
    expect(byName(junk, 'source-pbf').result).toBe('FAIL');
    expect(byName(junk, 'source-pbf').detail).toBeTruthy();

    const budget = await runRtg3BuildPreflight({
      sourcePath: validSource, tempDir: temp, outputDir: out, memoryBudgetMiB: 64,
    });
    expect(byName(budget, 'memory-budget').result).toBe('FAIL');
  });

  it('disk eşiği aşılırsa kapı düşer (yarım graf üretilmez)', async () => {
    const report = await runRtg3BuildPreflight({
      sourcePath: validSource, tempDir: temp, outputDir: out, memoryBudgetMiB: 512,
      minFreeBytes: Number.MAX_SAFE_INTEGER,
    });
    const disk = byName(report, 'free-disk');
    /* statfs okunamayan platformda ölçüm UNAVAILABLE'dır; sahte PASS ÜRETİLMEZ. */
    expect(disk.measured === 'UNAVAILABLE' ? 'FAIL' : disk.result).toBe('FAIL');
  });

  it('assertPreflight eyleme dönüştürülebilir mesajla atar', async () => {
    const report = await runRtg3BuildPreflight({
      sourcePath: resolve(work, 'yok.osm.pbf'), tempDir: temp, outputDir: out, memoryBudgetMiB: 512,
    });
    expect(() => assertPreflight(report)).toThrow(/RTG3_PREFLIGHT_FAILED/);
    expect(() => assertPreflight(report)).toThrow(/source-pbf/);
    expect(assertPreflight({ ok: true, checks: [] })).toEqual({ ok: true, checks: [] });
  });

  it('streaming builder preflight OLMADAN veritabanı açmaz', () => {
    const source = readFileSync(resolve('scripts/build-pbf-streaming-rtg3.mjs'), 'utf8');
    const preflightAt = source.indexOf('assertPreflight(preflight)');
    const databaseAt = source.indexOf('new DatabaseSync(DB_PATH)');
    expect(preflightAt, 'preflight çağrısı yok').toBeGreaterThan(0);
    expect(databaseAt, 'DB açılışı yok').toBeGreaterThan(0);
    expect(preflightAt, 'DB preflight ÖNCESİ açılıyor').toBeLessThan(databaseAt);
  });
});
