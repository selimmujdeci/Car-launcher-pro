/**
 * Patent Validation Logger
 * Kural: yalnızca runtime'da ölçülen veri kaydedilir.
 * Ölçülemeyen her alan null → raporda "N/A".
 *
 * Aktif olduğu durumlar:
 *   1. NODE_ENV === 'test'          (Vitest — fs'e yazar)
 *   2. ENABLE_DEVICE_TEST === 'true' (build-time env — fs'e yazar)
 *   3. localStorage['ENABLE_DEVICE_TEST'] === 'true'  (APK runtime toggle — localStorage'a yazar)
 */

/* ── Dead Reckoning ─────────────────────────────────────────────── */

export interface DRScenario {
  speedKmh:    number;
  headingDeg:  number;
  gpsLossDurationMs: number;
  estimatedLat: number;
  estimatedLng: number;
  gpsRecoveredLat: null;
  gpsRecoveredLng: null;
  errorMeters: null;
}

export interface DeadReckoningResult {
  scenarios: DRScenario[];
  passed:    boolean;
  note:      string;
}

/* ── SafeStorage ────────────────────────────────────────────────── */

export interface SafeStorageResult {
  scenario: string;
  totalWriteRequests: number;
  actualDiskWrites: number;
  writeReductionPercent: number | null;
  corruptionCount: number;
  recoveryTimeMs: null;
  passed: boolean;
  note:   string;
}

/* ── Dead Reckoning Real-World ──────────────────────────────────── */

export interface DRRealWorldResult {
  test:        string;
  durationSec: number;
  speedKmh:    number | null;
  startGps:    { lat: number; lng: number } | null;
  estimatedPosition: { lat: number; lng: number } | null;
  endGps:      { lat: number; lng: number } | null;
  errorMeters: number | null;
  driftPerSecond: number | null;
  skipped:     boolean;
  skipReason:  string | null;
}

interface PatentReport {
  generatedAt:   string;
  totalTests:    number;
  totalPassed:   number;
  deadReckoning: DeadReckoningResult[];
  safeStorage:   SafeStorageResult[];
}

/* ── Enable flag ─────────────────────────────────────────────────── */

const ENABLE_TEST_LOGGER: boolean = (() => {
  if (process.env.NODE_ENV === 'test') return true;
  if (process.env.ENABLE_DEVICE_TEST === 'true') return true;
  // APK runtime toggle — localStorage güvenli erişim
  try {
    return typeof localStorage !== 'undefined' &&
      localStorage.getItem('ENABLE_DEVICE_TEST') === 'true';
  } catch {
    return false;
  }
})();

/** APK'da runtime'da toggle etmek için. */
export function setDeviceTestLogging(enabled: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      if (enabled) {
        localStorage.setItem('ENABLE_DEVICE_TEST', 'true');
      } else {
        localStorage.removeItem('ENABLE_DEVICE_TEST');
      }
    }
  } catch { /* ignore */ }
}

/* ── Environment detection ───────────────────────────────────────── */

const IS_NODE =
  typeof process !== 'undefined' &&
  typeof process.versions?.node === 'string';

/* ── Logger ─────────────────────────────────────────────────────── */

export class PatentLogger {
  private dr:    DeadReckoningResult[] = [];
  private ss:    SafeStorageResult[]   = [];
  private drReal: DRRealWorldResult[]  = [];
  private stamp: string;

  constructor() {
    this.stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  }

  logDeadReckoning(r: DeadReckoningResult): void { if (ENABLE_TEST_LOGGER) this.dr.push(r); }
  logSafeStorage(r: SafeStorageResult):     void { if (ENABLE_TEST_LOGGER) this.ss.push(r); }
  logDRRealWorld(r: DRRealWorldResult):      void { if (ENABLE_TEST_LOGGER) this.drReal.push(r); }

  flush(): void {
    if (!ENABLE_TEST_LOGGER) return;
    if (IS_NODE) {
      this._flushToFs();
    } else {
      this._flushToLocalStorage();
    }
  }

  /* ── Node.js / Vitest path ───────────────────────────────────── */

  private _flushToFs(): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs   = require('node:fs')   as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('path');
    const ARTIFACTS_DIR = path.resolve(process.cwd(), 'test-artifacts');

    try {
      fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

      const all    = [...this.dr, ...this.ss];
      const passed = all.filter((r) => r.passed).length;

      const report: PatentReport = {
        generatedAt:   new Date().toISOString(),
        totalTests:    all.length,
        totalPassed:   passed,
        deadReckoning: this.dr,
        safeStorage:   this.ss,
      };

      const json = JSON.stringify(report, null, 2);
      fs.writeFileSync(
        path.join(ARTIFACTS_DIR, `patent-validation-${this.stamp}.json`), json, 'utf8',
      );
      fs.writeFileSync(
        path.join(ARTIFACTS_DIR, 'patent-validation-results.json'), json, 'utf8',
      );
      fs.writeFileSync(
        path.join(ARTIFACTS_DIR, 'patent-validation-summary.md'),
        this._buildMarkdown(report), 'utf8',
      );

      if (this.drReal.length > 0) {
        const allSkipped = this.drReal.every((r) => r.skipped);
        const drPayload = {
          generatedAt: new Date().toISOString(),
          status: allSkipped ? 'SKIPPED' : 'COMPLETED',
          results: this.drReal,
        };
        try {
          fs.writeFileSync(
            path.join(ARTIFACTS_DIR, `dr-real-test-${this.stamp}.json`),
            JSON.stringify(drPayload, null, 2),
            'utf8',
          );
        } catch (e) {
          console.warn(`[PatentLogger] dr-real-test yazılamadı: ${(e as Error).message}`);
        }
        try {
          fs.appendFileSync(
            path.join(ARTIFACTS_DIR, 'patent-validation-summary.md'),
            this._buildDRRealSection(),
            'utf8',
          );
        } catch (e) {
          console.warn(`[PatentLogger] summary.md güncellenemedi: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      console.warn(`[PatentLogger] Artefact yazılamadı: ${(e as Error).message}`);
    }
  }

  /* ── Browser / APK path ──────────────────────────────────────── */

  private _flushToLocalStorage(): void {
    try {
      if (typeof localStorage === 'undefined') return;

      const all    = [...this.dr, ...this.ss];
      const passed = all.filter((r) => r.passed).length;

      const report: PatentReport = {
        generatedAt:   new Date().toISOString(),
        totalTests:    all.length,
        totalPassed:   passed,
        deadReckoning: this.dr,
        safeStorage:   this.ss,
      };

      localStorage.setItem(
        `patent_validation_${this.stamp}`,
        JSON.stringify(report, null, 2),
      );

      if (this.drReal.length > 0) {
        const allSkipped = this.drReal.every((r) => r.skipped);
        localStorage.setItem(
          `dr_real_test_${this.stamp}`,
          JSON.stringify({
            generatedAt: new Date().toISOString(),
            status: allSkipped ? 'SKIPPED' : 'COMPLETED',
            results: this.drReal,
          }, null, 2),
        );
      }
    } catch (e) {
      console.warn(`[PatentLogger] localStorage yazılamadı: ${(e as Error).message}`);
    }
  }

  private _na(v: number | null, unit = ''): string {
    return v === null ? 'N/A' : `${v}${unit}`;
  }

  private _buildDRRealSection(): string {
    if (this.drReal.length === 0) return '';

    const rows = this.drReal.map((r) => {
      const status = r.skipped
        ? `SKIPPED — ${r.skipReason ?? 'unknown'}`
        : r.errorMeters !== null
          ? `${r.errorMeters.toFixed(1)} m hata (${this._na(r.driftPerSecond, ' m/s sürükleme')})`
          : 'Tamamlandı — errorMeters N/A (GPS geri dönmedi)';

      return `### DR Real-World — ${r.test}

- Süre: ${r.durationSec} s
- Hız: ${this._na(r.speedKmh, ' km/h')}
- Başlangıç GPS: ${r.startGps ? `${r.startGps.lat.toFixed(6)}, ${r.startGps.lng.toFixed(6)}` : 'N/A'}
- DR tahmini konum: ${r.estimatedPosition ? `${r.estimatedPosition.lat.toFixed(6)}, ${r.estimatedPosition.lng.toFixed(6)}` : 'N/A'}
- Bitiş GPS: ${r.endGps ? `${r.endGps.lat.toFixed(6)}, ${r.endGps.lng.toFixed(6)}` : 'N/A'}
- Hata (m): ${this._na(r.errorMeters, ' m')}
- Sürükleme: ${this._na(r.driftPerSecond, ' m/s')}
- Sonuç: ${status}`;
    }).join('\n\n');

    return `\n\n---\n\n## Gerçek Dünya DR Testi (Android Cihaz)\n\n${rows}\n`;
  }

  private _buildMarkdown(r: PatentReport): string {
    const drSections = r.deadReckoning.flatMap((result) =>
      result.scenarios.map((s, i) =>
        `### Dead Reckoning — Senaryo ${i + 1} (${s.speedKmh} km/h, ${s.headingDeg}° yön)

- GPS kaybı süresi: ${s.gpsLossDurationMs} ms (simülasyon parametresi)
- Tahmini konum: ${s.estimatedLat.toFixed(6)}, ${s.estimatedLng.toFixed(6)} (algoritma çıktısı)
- GPS geri geldiği konum: N/A
- Hata metre: N/A
- Not: Gerçek araç/GPS testi yapılmadı — estimatedPosition hesaplanmış, ölçülmemiş`,
      ),
    ).join('\n\n');

    const ssSections = r.safeStorage.map((m) =>
      `### SafeStorage — ${m.scenario}

- Toplam write isteği: ${m.totalWriteRequests} (gerçek)
- Gerçek disk write: ${m.actualDiskWrites} (localStorage spy ile ölçüldü)
- Azalma yüzdesi: ${this._na(m.writeReductionPercent, '%')}${m.writeReductionPercent !== null ? ' (gerçek sayaçlardan hesaplandı)' : ' (write isteği yok)'}
- Veri bozulması: ${m.corruptionCount > 0 ? `${m.corruptionCount} (simülasyon — gerçek disk bozulması değil)` : '0'}
- Recovery süresi: N/A (vi.useFakeTimers() ortamında Date.now() donduruldu — ölçüm anlamsız)
- Not: ${m.note}`,
    ).join('\n\n');

    const totalRequests   = r.safeStorage.reduce((a, m) => a + m.totalWriteRequests, 0);
    const totalDiskWrites = r.safeStorage.reduce((a, m) => a + m.actualDiskWrites, 0);

    return `# Patent Validation Report

**Tarih:** ${r.generatedAt}
**Toplam test:** ${r.totalTests} | **Geçen:** ${r.totalPassed}

---

## Innovation #1 — Dead Reckoning

${drSections}

---

## Innovation #2 — SafeStorage

${ssSections}

---

## Özet Sayaçlar (SafeStorage)

| | Değer | Kaynak |
|---|---|---|
| Toplam write isteği | ${totalRequests} | safeSetRaw çağrı sayacı |
| Toplam disk write | ${totalDiskWrites} | localStorage.setItem spy |
| Recovery süresi | N/A | fake timer — ölçülmedi |
| Gerçek Android FS testi | Yapılmadı | — |

---

## Ölçülemeyen Alanlar

| Alan | Neden N/A |
|------|-----------|
| errorMeters | GPS sinyal dönüşü olmadan hesaplanamaz |
| gpsRecoveredPosition | Gerçek GPS donanımı gerektirir |
| recoveryTimeMs | vi.useFakeTimers() Date.now()'u dondurur |
| atomicRenameUsed | Yalnızca Android native modda çalışır |
| tmpFileUsed | Yalnızca Android native modda çalışır |
`;
  }
}
