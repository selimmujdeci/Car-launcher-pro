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

  it('aynı KAYIT iki kez listelenmez — ama alt kodu farklı kayıt AYRI KALIR', () => {
    /* Dedup mantığı `readKwpForEcu` gövdesinden `_tagKwpCodes` yardımcısına
       ÇIKARILDI (iki çağrı yeri paylaşıyor). Kilit davranışa bağlandı, konuma
       ve değişken adına DEĞİL — aksi hâlde her refactor'da kırılır ve gerçek
       kusuru değil, ismi kollar. Korunan iki ayrı dedup vardır ve İKİSİ DE şart:
         (a) `seen` → AYNI yanıt içinde tekrar eden KAYIT ikinci kez işlenmez,
         (b) `existing` → listede ZATEN olan kod tekrar döndürülmez.

       ── P0-OBD-FINISH: (a) BİLİNÇLİ OLARAK DEĞİŞTİ ─────────────────────────
       Kilit eskiden `seen.has(d.code)` metnini arıyordu, yani anahtarın YALNIZ
       koda bakmasını KORUYORDU. Ölçülen kusur tam oradaydı: aynı araçta Car
       Scanner'ın gösterdiği `P0380(11)` · `P0380(12)` · `P0380(13)` ·
       `P0380(96)` dört AYRI kayıttır ve o anahtar üçünü sessizce ATIYORDU.
       Kilit KALDIRILMADI, YENİ DOĞRU DAVRANIŞA taşındı: anahtar kod + ALT KOD
       + STATUS baytıdır (`_recordKey`). (b) DEĞİŞMEDİ. */
    const scan = stripComments(read('src/platform/obd/multiEcuScan.ts'));
    const start = scan.indexOf('function _tagKwpCodes(');
    expect(start, 'KWP etiketleme yolu bulunamadı — dedup kilidi kör kaldı')
      .toBeGreaterThan(-1);
    const fn = scan.slice(start, start + 1400);

    expect(fn, 'yanıt-içi dedup (seen) kaldırılmış').toMatch(/seen\.has\(key\)/);
    expect(fn, 'dedup anahtarı alt kod/status taşımıyor')
      .toMatch(/_recordKey\(d\.code,\s*d\.failureType,\s*d\.rawStatus\)/);
    expect(fn, 'mevcut-liste dedup (existing) kaldırılmış').toMatch(/existing\.has\(d\.code\)/);
    /* Yeni kod yalnız listede YOKKEN döndürülür — koşul ters çevrilemez. */
    expect(fn, 'yalnız yeni kod döndürme koşulu bozulmuş')
      .toMatch(/if\s*\(!existing\.has\(d\.code\)\)\s*out\.push/);

    /* Anahtarın kendisi de kilitlenir — üç bileşenin biri düşerse kayıt kaybolur. */
    const keyStart = scan.indexOf('function _recordKey(');
    expect(keyStart, '_recordKey kaldırılmış — alt kod ayrımı kör kaldı').toBeGreaterThan(-1);
    expect(scan.slice(keyStart, keyStart + 200))
      .toMatch(/\$\{code\}\|\$\{subCode \?\? ''\}\|\$\{rawStatus \?\? ''\}/);
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
    /* ── P0-OBD-PARITY: KİLİT BİLİNÇLİ OLARAK GENİŞLETİLDİ ─────────────────
       Eskiden yalnız İKİ kanal aranıyordu (`[r.uds, r.kwp]`). Üretici tabanı
       artık DÖRT kanaldan okunabilir: UDS 0x19-02 · UDS 0x19-0A · KWP 0x18 ·
       KWP 0x13. Yalnız 0x19-0A cevap veren bir araçta eski rozet "üretici
       taraması yapılmadı" diyordu — yani kapsamı OLDUĞUNDAN KÖTÜ gösteriyordu.
       Kilit KALDIRILMADI, dördünü birden zorunlu kılacak biçimde güncellendi. */
    expect(panel).toMatch(/r\.uds, r\.udsSupported, r\.kwp, r\.kwp13/);
    /* Tarama hiç koşmadıysa "sorulmadı" demeli — sessizce "covered" DEMEMELİ. */
    expect(panel).toMatch(/return 'not_asked'/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * E) CAROS LAB GÖZLEM SATIRI (gözlemlenebilirlik mandate'i)
 * ═════════════════════════════════════════════════════════════════════════ */
describe('kwpDtcWiring › LAB gözlem satırı', () => {
  it('KWP İzleyici ekranında DTC bölümü VARDIR', async () => {
    const { KWP_SECTION_ORDER, KWP_SECTION_TITLE } =
      await import('../platform/devtools/kwpMonitorModel');
    expect(KWP_SECTION_ORDER).toContain('dtc');
    expect(KWP_SECTION_TITLE.dtc).toMatch(/0x18/);
  });

  it('"hiç taranmadı" ile "tarandı, sonuç yok" AYRI gösterilir', async () => {
    const { buildKwpSections } = await import('../platform/devtools/kwpMonitorModel');
    const base = {
      readAt: 1_700_000_000_000,
      protocolActive: '4', protocolTried: '4', protocolClass: 'kwp', slowSerial: true,
      transportConnected: true, connectionState: 'connected', dataFresh: true,
      lastRxAt: null, freshWindowMs: null, pollingActive: true, recovery: null,
    };

    /* Hiç tarama yok → hüküm YOK (KAYNAK YOK). */
    const never = buildKwpSections({
      ...base,
      dtc: {
        lastScanAtMs: null, protocolAtScan: null, attempted: false,
        channelAvailable: true, okCount: 0, unsupportedCount: 0, failedCount: 0, codeCount: 0,
      },
    } as never).find((x) => x.id === 'dtc');
    const neverScan = never!.fields.find((f) => f.id === 'dtcScan');
    expect(neverScan?.klass).toBe('UNAVAILABLE');
    expect(neverScan?.note).toMatch(/hüküm YOK/i);

    /* Tarandı ama KWP dalı denenmedi (CAN) → bu bir HATA DEĞİL, kapsam kararı. */
    const notTried = buildKwpSections({
      ...base,
      dtc: {
        lastScanAtMs: base.readAt - 5000, protocolAtScan: '6', attempted: false,
        channelAvailable: true, okCount: 0, unsupportedCount: 0, failedCount: 0, codeCount: 0,
      },
    } as never).find((x) => x.id === 'dtc');
    const attempt = notTried!.fields.find((f) => f.id === 'dtcAttempt');
    expect(attempt?.klass).toBe('UNAVAILABLE');
    expect(attempt?.note).toMatch(/hata DEĞİL/i);
  });

  it('denendiğinde ECU sonuçları ve kod sayısı GÖSTERİLİR', async () => {
    const { buildKwpSections } = await import('../platform/devtools/kwpMonitorModel');
    const sec = buildKwpSections({
      readAt: 1_700_000_000_000,
      protocolActive: '4', protocolTried: '4', protocolClass: 'kwp', slowSerial: true,
      transportConnected: true, connectionState: 'connected', dataFresh: true,
      lastRxAt: null, freshWindowMs: null, pollingActive: true, recovery: null,
      dtc: {
        lastScanAtMs: 1_700_000_000_000 - 1000, protocolAtScan: '4', attempted: true,
        channelAvailable: true, okCount: 2, unsupportedCount: 1, failedCount: 0, codeCount: 3,
      },
    } as never).find((x) => x.id === 'dtc');
    expect(sec!.fields.find((f) => f.id === 'dtcEcuStates')?.value).toMatch(/2 ok/);
    expect(sec!.fields.find((f) => f.id === 'dtcCodes')?.value).toBe('3');
  });

  it('kanıt YENİ ÖLÇÜM üretmez — tarama sonucunu hatırlar', () => {
    const scan = stripComments(read('src/platform/obd/multiEcuScan.ts'));
    /* Kanıt yazımı taramanın SONUNDA, zaten hesaplanmış `results`tan türetilir. */
    expect(scan).toMatch(/_kwpEvidence = Object\.freeze\(/);
    expect(scan).toMatch(/results\.map\(\(r\) => r\.kwp\)/);
    /* Kanıt toplama taramayı bozamaz — YAPIYA bakılır, yoruma değil
       (`stripComments` yorumları zaten söküyor). */
    expect(scan).toMatch(/try \{[\s\S]*?_kwpEvidence = Object\.freeze\([\s\S]*?\} catch \{/);
  });
});
