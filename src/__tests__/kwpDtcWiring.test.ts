/**
 * kwpDtcWiring.test.ts — V-08 KWP DTC hattı KİLİTLERİ.
 *
 * ── KAPATILAN KUSUR ────────────────────────────────────────────────────────
 * KWP protokolü Türkiye'de çok yaygın (Renault sınıfı) ve o araçlarda UDS 0x19
 * YOKTUR — üretici arızaları 0x18'de yaşar. Zincir **ÜÇ KATMANDA BİRDEN** ölüydü:
 *   1. `ElmProtocol.readKwpDtcsRaw()` yazılmış, Java'da bile ÇAĞIRANI YOK
 *   2. Capacitor köprüsü YOK (`readKwpDtcs` plugin metodu yok)
 *   3. `kwpDtc.ts` ayrıştırıcısının TÜKETİCİSİ YOK
 * Sonuç: KWP araçlarda yalnız emisyon kodları görünüyor, üretici arızası
 * "yok" sanılıyordu — ve panel bunu **sessizce "temiz"** diye sunuyordu.
 *
 * Kilitler dört şeyi korur:
 *  (A) Üç katmanın da bağlı olduğu
 *  (B) KWP'nin CAN'den AYRI çözücü kullandığı (2 bayt vs 3 bayt)
 *  (C) Protokol kapısı: KWP dalı yalnız yavaş seri hatta denenir
 *  (D) FAIL-CLOSED HÜKÜM: üretici tabanına bakılmadıysa "temiz" DENMEZ
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { stripComments } from './helpers';
import { computeDtcVerdict } from '../platform/obd/dtcVerdict';
import { parseKwpDtcResponse } from '../platform/obd/kwpDtc';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/* ══════════════════════════════════════════════════════════════════════════
 * A) ÜÇ KATMAN BAĞLI
 * ═════════════════════════════════════════════════════════════════════════ */
describe('kwpDtcWiring › üç katman', () => {
  it('1. NATIVE: iki Manager da `readKwpDtcs` sunar', () => {
    for (const f of ['BleObdManager', 'OBDManager']) {
      const j = read(`android/app/src/main/java/com/cockpitos/pro/obd/${f}.java`);
      expect(j, f).toMatch(/public String readKwpDtcs\(String tx, String rx\)/);
      expect(j, f).toMatch(/readKwpDtcsRaw\(\)/);
    }
  });

  it('1b. NATIVE: KWP isteği USER önceliğiyle ve header korumasıyla gider', () => {
    const j = read('android/app/src/main/java/com/cockpitos/pro/obd/BleObdManager.java');
    const m = j.slice(j.indexOf('public String readKwpDtcs('));
    expect(m).toMatch(/ElmCommandQueue\.Priority\.USER/);
    expect(m).toMatch(/withEcuHeader\(tx, rx/);
  });

  it('2. KÖPRÜ: plugin metodu ve TS tipi var', () => {
    const plugin = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
    expect(plugin).toMatch(/@PluginMethod\s*\n\s*public void readKwpDtcs\(PluginCall call\)/);
    /* Desteklenmiyor bir HATA DEĞİLDİR — `supported:false` ile döner. */
    expect(plugin).toMatch(/ret\.put\("supported", false\)/);

    const ts = read('src/platform/nativePlugin.ts');
    expect(ts).toMatch(/readKwpDtcs\?\(options: \{ tx: string; rx: string \}\)/);
  });

  it('3. TS: ayrıştırıcının artık ÜRÜN tüketicisi var', () => {
    const scan = stripComments(read('src/platform/obd/multiEcuScan.ts'));
    expect(scan).toMatch(/parseKwpDtcResponse/);
    expect(scan).toMatch(/CarLauncher\.readKwpDtcs/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B) AYRI ÇÖZÜCÜ (2 bayt ≠ 3 bayt)
 * ═════════════════════════════════════════════════════════════════════════ */
describe('kwpDtcWiring › KWP çözücüsü ayrıdır', () => {
  it('KWP kaydı 3 BAYTTIR (2 DTC + 1 status) — liste kaymaz', () => {
    /* count=02, sonra iki kayıt: 0301/24 ve 1234/2F */
    const r = parseKwpDtcResponse('02' + '0301' + '24' + '1234' + '2F');
    expect(r).toHaveLength(2);
    expect(r[0].rawDtc).toBe('0301');
    expect(r[1].rawDtc).toBe('1234');
  });

  it('`count` alanına KÖR GÜVENİLMEZ — gerçek kayıtlar sayılır', () => {
    /* count 9 diyor ama tek kayıt var. */
    const r = parseKwpDtcResponse('09' + '0301' + '24');
    expect(r).toHaveLength(1);
  });

  it('bozuk/dolgu kayıt SESSİZCE atlanır, tur devam eder', () => {
    const r = parseKwpDtcResponse('02' + '0000' + '00' + '0301' + '24');
    expect(r).toHaveLength(1);
    expect(r[0].rawDtc).toBe('0301');
  });

  it('çok kısa gövde boş döner (uydurma kod YOK)', () => {
    expect(parseKwpDtcResponse('')).toEqual([]);
    expect(parseKwpDtcResponse('0203')).toEqual([]);
  });

  it('tarama KWP kodlarını `fromKwp` ile ETİKETLER (provenance kaybolmaz)', () => {
    const scan = stripComments(read('src/platform/obd/multiEcuScan.ts'));
    expect(scan).toMatch(/fromKwp: true/);
    /* `fromUds` ile birleştirilmemeli — hangi protokolden geldiği kaybolmaz. */
    expect(scan).toMatch(/fromUds\?: boolean/);
  });

  it('aynı kod iki kez listelenmez (dedupe)', () => {
    const scan = stripComments(read('src/platform/obd/multiEcuScan.ts'));
    const fn = scan.slice(scan.indexOf('async function readKwpForEcu('));
    expect(fn).toMatch(/already\.has\(d\.code\)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C) PROTOKOL KAPISI
 * ═════════════════════════════════════════════════════════════════════════ */
describe('kwpDtcWiring › protokol kapısı', () => {
  const scan = stripComments(read('src/platform/obd/multiEcuScan.ts'));

  it('KWP dalı YALNIZ yavaş seri protokolde denenir', () => {
    expect(scan).toMatch(/isSlowSerialProtocol\(activeProtocol\)/);
  });

  it('protokol tarama başında BİR KEZ okunur (tur içinde değişmez)', () => {
    /* ECU başına okumak, tur ortasında yeniden bağlanma olursa aynı raporun
       bir kısmını KWP bir kısmını CAN kuralıyla işlerdi. */
    const loopStart = scan.indexOf('for (const ecu of scanList)');
    const protoRead = scan.indexOf('getHandshakeDiagnostics().protocolActive');
    expect(protoRead).toBeGreaterThan(0);
    expect(protoRead).toBeLessThan(loopStart);
  });

  it('protokol okunamazsa KWP DENENMEZ (fail-closed) ve `kwp` null kalır', () => {
    expect(scan).toMatch(/activeProtocol = null;/);
    expect(scan).toMatch(/kwp: null,/);
  });

  it('`null` (sorulmadı) ile `unsupported` (soruldu, yok) AYRI tutulur', () => {
    const raw = read('src/platform/obd/multiEcuScan.ts');
    expect(raw).toMatch(/kwp: EcuModeStatus \| null;/);
    expect(raw).toMatch(/sorulmadı/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D) FAIL-CLOSED HÜKÜM — V-08'in ASIL ÖLÇÜTÜ
 * ═════════════════════════════════════════════════════════════════════════ */
describe('kwpDtcWiring › üretici tabanına bakılmadıysa "temiz" DENMEZ', () => {
  const base = {
    scanRan: true,
    storedCount: 0, pendingCount: 0, permanentCount: 0,
    mil: false as boolean | null,
    pid01DtcCount: 0 as number | null,
    failedModes: [],
  };

  it('HİÇ SORULMADIYSA hüküm `inconclusive` — sessiz "temiz" YOK', () => {
    const v = computeDtcVerdict({ ...base, manufacturerScope: 'not_asked' });
    expect(v.verdict).toBe('inconclusive');
    expect(v.reason).toMatch(/kapsam dışı/);
  });

  it('sorgu DÜŞTÜYSE de `inconclusive`', () => {
    const v = computeDtcVerdict({ ...base, manufacturerScope: 'failed' });
    expect(v.verdict).toBe('inconclusive');
    expect(v.reason).toMatch(/okunamadı/);
  });

  it('okunduysa `clean` verilebilir', () => {
    expect(computeDtcVerdict({ ...base, manufacturerScope: 'covered' }).verdict).toBe('clean');
  });

  it('ECU desteklemiyorsa bu GERÇEK bir cevaptır → `clean`', () => {
    expect(computeDtcVerdict({ ...base, manufacturerScope: 'not_supported' }).verdict).toBe('clean');
  });

  it('ALAN ADDITIVE: bildirmeyen çağıranın davranışı BİREBİR aynı kalır', () => {
    /* Eski çağrılar `manufacturerScope` geçmiyor — hüküm eskisi gibi `clean`. */
    expect(computeDtcVerdict(base).verdict).toBe('clean');
    expect(computeDtcVerdict({ ...base, manufacturerScope: 'unknown' }).verdict).toBe('clean');
  });

  it('BULGU varsa kapsam eksikliği onu EZMEZ (issues önceliklidir)', () => {
    const v = computeDtcVerdict({ ...base, storedCount: 1, manufacturerScope: 'not_asked' });
    expect(v.verdict).toBe('issues');
  });

  it('panel kapsamı GERÇEK tarama raporundan türetir', () => {
    const panel = stripComments(read('src/components/obd/DTCPanel.tsx'));
    expect(panel).toMatch(/manufacturerScope/);
    expect(panel).toMatch(/multiEcu\.results\.flatMap\(\(r\) => \[r\.uds, r\.kwp\]\)/);
    /* Tarama hiç koşmadıysa "sorulmadı" demeli — sessizce "covered" DEMEMELİ. */
    expect(panel).toMatch(/return 'not_asked'/);
  });
});
