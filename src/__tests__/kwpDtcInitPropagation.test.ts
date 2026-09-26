/**
 * kwpDtcInitPropagation.test.ts — P0-OBD-DTC-INIT KİLİTLERİ.
 *
 * ── KAPATILAN KUSUR (saha: ECU 7A / KWP) ──────────────────────────────────
 * `kwpAddressingProbe` bir ECU için K-line yeniden-başlatmanın (ATFI/ATSI)
 * fiziksel isteğe cevap almak için ZORUNLU olduğunu ÖLÇEBİLİYORDU
 * (`KwpAddressingVerdict.requiredInit`) ama bu kanıt yalnız LAB'a gidiyordu:
 * gerçek DTC isteği (KWP 0x18/0x13) HER ZAMAN init'siz gönderiliyordu ve
 * matrisin kanıtladığı ön koşulla AYNI nedenle sessiz kalıyordu. Sonuç: adres
 * "PROVEN" görünse bile üretici DTC tabanı (P0571/P0089 sınıfı kodların olası
 * kaynağı) hiçbir zaman okunamıyordu.
 *
 * Kilitler üç katmanı birden korur: TS akışı (matris → okuma), native tip
 * sözleşmesi ve Java köprüsü (ElmProtocol/OBDManager/BleObdManager/Plugin).
 * Kaynak-metin eşleştirme deseni bu dosyanın komşularıyla (`kwpDtcWiring.
 * test.ts`, `kwpAddressingProbe.test.ts`) AYNIDIR.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { stripComments } from './helpers';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('kwpDtcInitPropagation › TS: matris kanıtı okumaya TAŞINIR', () => {
  const scan = stripComments(read('src/platform/obd/multiEcuScan.ts'));

  it('addressingVerdict.requiredInit bir değişkene YAKALANIR', () => {
    expect(scan).toMatch(/provenInitFirst = addressingVerdict\.requiredInit/);
  });

  it('proven olmadan requiredInit KULLANILMAZ (yalnız proven dalında atanır)', () => {
    const idx = scan.indexOf('provenInitFirst = addressingVerdict.requiredInit');
    expect(idx).toBeGreaterThan(-1);
    const before = scan.slice(Math.max(0, idx - 300), idx);
    expect(before).toMatch(/addressingVerdict\.proven/);
  });

  it('readKwpForEcu çağrısına provenInitFirst İLETİLİR', () => {
    expect(scan).toMatch(
      /readKwpForEcu\(\s*addressed, result, sessionEpoch, activeProtocol, txn, provenInitFirst\)/,
    );
  });

  it('readKwpForEcu KENDİSİ initFirst parametresini kabul eder ve native isteğe EKLER', () => {
    const start = scan.indexOf('async function readKwpForEcu(');
    expect(start).toBeGreaterThan(-1);
    const fn = scan.slice(start, start + 2400);
    expect(fn).toMatch(/initFirst: KwpInitKind \| null = null/);
    expect(fn).toMatch(/\.\.\.\(initFirst !== null \? \{ initFirst \} : \{\}\)/);
    /* 0x18 açıkça reddedilince 0x13'e düşen dal initFirst'ü KAYBETMEZ. */
    expect(fn).toMatch(/_readKwp13ForEcu\(ecu, result, sessionEpoch, protocol, txn, initFirst\)/);
  });

  it('_readKwp13ForEcu de initFirst parametresini kabul eder ve native isteğe EKLER', () => {
    const start = scan.indexOf('async function _readKwp13ForEcu(');
    expect(start).toBeGreaterThan(-1);
    const fn = scan.slice(start, start + 900);
    expect(fn).toMatch(/initFirst: KwpInitKind \| null = null/);
    expect(fn).toMatch(/\.\.\.\(initFirst !== null \? \{ initFirst \} : \{\}\)/);
  });

  it('ALAN ADDITIVE: initFirst opsiyoneldir — eski çağrı şekli BOZULMAZ', () => {
    /* Her iki fonksiyon da initFirst'e varsayılan `null` verir; imzayı
       genişletmek eski (initFirst'süz) çağrı yerlerini KIRMAZ. */
    const kwpStart = scan.indexOf('async function readKwpForEcu(');
    const kwp13Start = scan.indexOf('async function _readKwp13ForEcu(');
    expect(scan.slice(kwpStart, kwpStart + 400)).toMatch(/= null,\s*\): Promise<EcuDtc\[\]>/);
    expect(scan.slice(kwp13Start, kwp13Start + 400)).toMatch(/= null,\s*\): Promise<EcuDtc\[\]>/);
  });
});

describe('kwpDtcInitPropagation › STANDART modlar kanıtlanmış hedefle YENİDEN sorulur', () => {
  const scan = stripComments(read('src/platform/obd/multiEcuScan.ts'));

  it('problardan ÖNCEKİ adreslenebilirlik ayrı tutulur (kapının girdisi)', () => {
    expect(scan).toMatch(/const addressabilityFromModes = addressability;/);
  });

  it('yeniden okuma YALNIZ "standart modlar sustu · PROB kanıtladı" durumunda koşar', () => {
    expect(scan).toMatch(
      /isSlowSerialProtocol\(activeProtocol\)\s*&&\s*addressabilityFromModes !== 'PROVEN' && addressability === 'PROVEN'/,
    );
    /* Kanıtlanmış hedef (`addressed`) kullanılır — ilk turun çürütülmüş
       varsayımı DEĞİL. */
    expect(scan).toMatch(/_retryStandardModesOnProvenTarget\(\s*addressed, result, sessionEpoch, activeProtocol, txn,/);
  });

  it('ölçülmüş sonuçlar EZİLMEZ: yalnız `failed` modlar yeniden sorulur', () => {
    const start = scan.indexOf('async function _retryStandardModesOnProvenTarget(');
    expect(start, 'yeniden okuma fonksiyonu bulunamadı').toBeGreaterThan(-1);
    const fn = scan.slice(start, start + 3600);
    expect(fn).toMatch(/if \(result\[key\] !== 'failed'\) continue;/);
  });

  it('bütçe ve geç yanıt kapıları ilk ölçümü DÜŞÜRMEZ (break, downgrade değil)', () => {
    const start = scan.indexOf('async function _retryStandardModesOnProvenTarget(');
    const fn = scan.slice(start, start + 3600);
    expect(fn).toMatch(/if \(!consumeRequest\(txn\)\) break;/);
    expect(fn).toMatch(/if \(!acceptResponse\(txn\)\) break;/);
  });

  it('İKİNCİ ÇÖZÜMLEYİCİ YOK — kanonik otorite yeniden kullanılır', () => {
    const start = scan.indexOf('async function _retryStandardModesOnProvenTarget(');
    const fn = scan.slice(start, start + 3600);
    expect(fn).toMatch(/resolveFunctionalDtcSource\(\{/);
    expect(fn).toMatch(/recordFunctionalDtcEvidence\(fnSrc, isReplayActive\(\)\)/);
    expect(fn).toMatch(/recordDtcEvidence\(\{/);
  });

  it('ölçülen init zorunluluğu standart moda da TAŞINIR', () => {
    const start = scan.indexOf('async function _retryStandardModesOnProvenTarget(');
    const fn = scan.slice(start, start + 3600);
    expect(fn).toMatch(/\.\.\.\(initFirst !== null \? \{ initFirst \} : \{\}\)/);
  });

  it('kurtarılan okuma kapsam kaybı sayacından düşer ve sayaç negatife inemez', () => {
    expect(scan).toMatch(/failedReads = Math\.max\(0, failedReads - recovered\);/);
  });
});

describe('kwpDtcInitPropagation › SC81: protokol seviyesi StartCommunication ÖLÇÜLÜR', () => {
  it('matriste 0x81 satırı VAR ve fiziksel olarak işaretli', async () => {
    const { KWP_ADDRESSING_VARIANTS } = await import('../platform/obd/kwpAddressingProbe');
    const sc = KWP_ADDRESSING_VARIANTS.find((v) => v.id === 'PHY_STARTCOMM_81');
    expect(sc, 'StartCommunication ölçüm satırı yok').toBeDefined();
    expect(sc!.request).toBe('81');
    expect(sc!.physical).toBe(true);
    /* Kendisi bir ÖLÇÜMDÜR — başka bir başlatmaya İHTİYAÇ DUYMAZ. */
    expect(sc!.initFirst).toBeUndefined();
  });

  it('pozitif yanıt öneki ISO 14230-2 ile aynı: 0x81 + 0x40 = C1', async () => {
    const { positiveSidOf } = await import('../platform/obd/kwpAddressingProbe');
    expect(positiveSidOf('81')).toBe('C1');
  });

  it('SC81 ile bağlantı kurup Mode 03 soran satır VAR', async () => {
    const { KWP_ADDRESSING_VARIANTS } = await import('../platform/obd/kwpAddressingProbe');
    const row = KWP_ADDRESSING_VARIANTS.find((v) => v.id === 'PHY_SC81_03');
    expect(row, 'SC81 + Mode 03 satırı yok').toBeDefined();
    expect(row!.initFirst).toBe('SC81');
    expect(row!.request).toBe('03');
  });

  it('SC81 satırları ADAPTÖR başlatma (ATFI/ATSI) satırlarından ÖNCE gelir', () => {
    /* ATFI/ATSI hattı GERÇEKTEN böler ve sahada zaten reddedildi; ucuz ve
       kesintisiz olan protokol seviyesi önce denenmelidir. */
    return import('../platform/obd/kwpAddressingProbe').then(({ KWP_ADDRESSING_VARIANTS }) => {
      const idx = (id: string) => KWP_ADDRESSING_VARIANTS.findIndex((v) => v.id === id);
      expect(idx('PHY_STARTCOMM_81')).toBeLessThan(idx('PHY_FASTINIT_03'));
      expect(idx('PHY_SC81_03')).toBeLessThan(idx('PHY_FASTINIT_03'));
    });
  });

  it('matris tavanı yeni satırları KAPSAR (satırlar sessizce kırpılmaz)', async () => {
    const { KWP_ADDRESSING_VARIANTS, KWP_ADDRESSING_MAX_VARIANTS } =
      await import('../platform/obd/kwpAddressingProbe');
    expect(KWP_ADDRESSING_VARIANTS.length).toBeLessThanOrEqual(KWP_ADDRESSING_MAX_VARIANTS);
  });

  it('NATIVE: 0x81 salt-okunur beyaz listede, destructive liste DEĞİŞMEDİ', () => {
    const elm = read('android/app/src/main/java/com/cockpitos/pro/obd/ElmProtocol.java');
    const block = elm.slice(elm.indexOf('KWP_PROBE_ALLOWED_SIDS'),
      elm.indexOf('probeKwpAddressingRow'));
    expect(block, '0x81 beyaz listeye alınmamış').toContain('"81"');
    for (const bad of ['"04"', '"11"', '"14"', '"27"', '"28"', '"2E"', '"2F"', '"31"', '"85"']) {
      expect(block, `beyaz listeye destructive servis girmiş: ${bad}`).not.toContain(bad);
    }
  });

  it('NATIVE: SC81 ayrı bir yolda ve POZİTİF KANIT (C1) şartına bağlı', () => {
    const elm = read('android/app/src/main/java/com/cockpitos/pro/obd/ElmProtocol.java');
    expect(elm).toMatch(/if \("SC81"\.equals\(init\)\) return startCommunicationInit\(\);/);
    const fn = elm.slice(elm.indexOf('private InitResult startCommunicationInit()'));
    expect(fn.slice(0, 900)).toContain('sendChecked("81", 2000)');
    /* Sessizlik ve ayrık negatif "bağlantı kuruldu" SAYILMAZ. */
    expect(fn.slice(0, 900)).toContain('compact.contains("C1") && !compact.contains("7F81")');
  });
});

describe('kwpDtcInitPropagation › native köprü tip sözleşmesi', () => {
  it('nativePlugin.ts readAdvancedDtcs artık initFirst alanı taşır', () => {
    const ts = read('src/platform/nativePlugin.ts');
    const start = ts.indexOf('readAdvancedDtcs?(options: {');
    expect(start).toBeGreaterThan(-1);
    expect(ts.slice(start, start + 1600)).toMatch(/initFirst\?: 'FAST' \| 'SLOW' \| 'SC81'/);
  });

  it('nativePlugin.ts readDtcFromEcu (STANDART modlar) da initFirst taşır', () => {
    const ts = read('src/platform/nativePlugin.ts');
    const start = ts.indexOf('readDtcFromEcu?(options: {');
    expect(start).toBeGreaterThan(-1);
    expect(ts.slice(start, start + 900)).toMatch(/initFirst\?: 'FAST' \| 'SLOW' \| 'SC81'/);
  });
});

describe('kwpDtcInitPropagation › Java: STANDART mod zinciri de init taşır', () => {
  it('ElmProtocol readDtcClassFromEcu init-taşıyan overload sunar ve withEcuHeader\'a geçirir', () => {
    const elm = read('android/app/src/main/java/com/cockpitos/pro/obd/ElmProtocol.java');
    expect(elm).toMatch(
      /public DtcClassResult readDtcClassFromEcu\(String tx, String rx, String mode, String initFirst\)/,
    );
    expect(elm).toMatch(/return withEcuHeader\(tx, rx, initFirst, \(\) -> readDtcClass\(mode\)\);/);
    /* Eski imza yeni overload'a DELEGE eder — davranış regresyonu YOK. */
    expect(elm).toMatch(/return readDtcClassFromEcu\(tx, rx, mode, null\);/);
  });

  for (const file of ['OBDManager', 'BleObdManager']) {
    it(`${file}: readDtcClassFromEcu init overload'u zinciri kırmadan taşır`, () => {
      const j = read(`android/app/src/main/java/com/cockpitos/pro/obd/${file}.java`);
      expect(j, file).toMatch(
        /readDtcClassFromEcu\(String tx, String rx, String mode, String init\)/,
      );
      expect(j, file).toMatch(/p\.readDtcClassFromEcu\(tx, rx, mode, init\)/);
    });
  }

  it('CarLauncherPlugin readDtcFromEcu initFirst\'i beyaz listeyle okur ve iletir', () => {
    const plugin = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
    const start = plugin.indexOf('public void readDtcFromEcu(PluginCall call) {');
    expect(start).toBeGreaterThan(-1);
    const fn = plugin.slice(start, start + 1600);
    expect(fn).toMatch(/"FAST"\.equals\(initArg\) \|\| "SLOW"\.equals\(initArg\)/);
    expect(fn, 'SC81 (protokol seviyesi StartCommunication) beyaz listede yok')
      .toMatch(/"SC81"\.equals\(initArg\)\) \? initArg : null/);
    expect(fn).toMatch(/readDtcClassFromEcuActive\(tx, rx, mode, initFirst\)/);
  });
});

describe('kwpDtcInitPropagation › Java: ElmProtocol init\'i ATSH SONRASI, gönderimden ÖNCE tekrarlar', () => {
  const elm = read('android/app/src/main/java/com/cockpitos/pro/obd/ElmProtocol.java');

  it('withEcuHeader initFirst TAŞIYAN bir overload sunar', () => {
    expect(elm).toMatch(
      /public <T> T withEcuHeader\(String tx, String rx, String initFirst,\s*\n\s*java\.util\.concurrent\.Callable<T> action\) throws Exception \{/,
    );
    /* Eski (initFirst'süz) imza yeni overload'a DELEGE eder — davranış regresyon YOK. */
    expect(elm).toMatch(/return withEcuHeader\(tx, rx, null, action\);/);
  });

  it('withEcuHeaderKwp: ATSH BAŞARILI olduktan sonra initKLineForRow çağrılır, action ONDAN SONRA çalışır', () => {
    const start = elm.indexOf('private <T> T withEcuHeaderKwp(String tx, String initFirst,');
    expect(start, 'initFirst taşıyan withEcuHeaderKwp bulunamadı').toBeGreaterThan(-1);
    const fn = elm.slice(start, start + 1200);
    const atshIdx = fn.indexOf('channel.send("ATSH" + tx, 500)');
    const initIdx = fn.indexOf('initKLineForRow(initFirst)');
    const actionIdx = fn.indexOf('result = action.call();');
    expect(atshIdx).toBeGreaterThan(-1);
    expect(initIdx).toBeGreaterThan(atshIdx);
    expect(actionIdx).toBeGreaterThan(initIdx);
  });

  it('init BAŞARISIZSA istek HİÇ GÖNDERİLMEZ (fail-closed)', () => {
    const start = elm.indexOf('private <T> T withEcuHeaderKwp(String tx, String initFirst,');
    const fn = elm.slice(start, start + 1200);
    expect(fn).toMatch(/if \(!init\.ok\) \{\s*\n\s*throw new IOException/);
  });
});

describe('kwpDtcInitPropagation › Java: OBDManager/BleObdManager init parametresini TAŞIR', () => {
  for (const file of ['OBDManager', 'BleObdManager']) {
    it(`${file}: readAdvancedKwpDtc/readAdvancedKwp13Dtc/readAdvancedUdsDtc init-taşıyan overload sunar`, () => {
      const j = read(`android/app/src/main/java/com/cockpitos/pro/obd/${file}.java`);
      expect(j, file).toMatch(/readAdvancedKwpDtc\(String tx, String rx, String init\)/);
      expect(j, file).toMatch(/readAdvancedKwp13Dtc\(String tx, String rx, String init\)/);
      expect(j, file).toMatch(
        /readAdvancedUdsDtc\(\s*\n\s*String tx, String rx, String sub, String payload, String init\)/,
      );
      /* Üçü de nihayetinde withEcuHeader'a init'i GEÇİRİR — kopya bir yol AÇILMADI. */
      expect(j, file).toMatch(/p\.withEcuHeader\(tx, rx, init, p::readKwpDtcsDetailed\)/);
      expect(j, file).toMatch(/p\.withEcuHeader\(tx, rx, init, p::readKwpDtcs13Detailed\)/);
    });
  }
});

describe('kwpDtcInitPropagation › Java: CarLauncherPlugin initFirst\'i beyaz listeyle OKUR ve İLETİR', () => {
  const plugin = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
  const start = plugin.indexOf('public void readAdvancedDtcs(PluginCall call) {');
  const fn = plugin.slice(start, start + 4200);

  it('yalnız "FAST"/"SLOW"/"SC81" kabul edilir — başka her şey null olur (uydurma komut YOK)', () => {
    expect(start).toBeGreaterThan(-1);
    expect(fn).toMatch(/"FAST"\.equals\(initFirstArg\) \|\| "SLOW"\.equals\(initFirstArg\)/);
    expect(fn, 'SC81 (protokol seviyesi StartCommunication) beyaz listede yok')
      .toMatch(/"SC81"\.equals\(initFirstArg\)\) \? initFirstArg : null/);
  });

  it('18/13/19 dallarının ÜÇÜ de initFirst\'i ilgili Manager metoduna geçirir', () => {
    expect(fn).toMatch(/readAdvancedKwp13Dtc\(tx, rx, initFirst\)/);
    expect(fn).toMatch(/readAdvancedKwpDtc\(tx, rx, initFirst\)/);
    expect(fn).toMatch(/readAdvancedUdsDtc\(tx, rx, sub, payload, initFirst\)/);
  });
});
