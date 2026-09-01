/**
 * kwp13AndClearGate.test.ts — P0-OBD-DIAG-02 KİLİTLERİ.
 *
 * İKİ KONU:
 *  A) ISO 14230-3 SERVİS 0x13 zinciri — 0x18'i bilmeyen KWP ECU'larında üretici
 *     arızasının okunabilmesi. Ürün bugüne kadar 0x13'ü HİÇ sormadı; o araçlarda
 *     üretici kodu yapısal olarak GÖRÜNMEZDİ.
 *  B) ÜRETİCİ DTC SİLME KAPISI — yazıldı ama KAPALI. Adresini bile kanıtlayamadığımız
 *     bir ECU'ya destructive komut göndermemek için koşullar ÖLÇÜLEBİLİR yapıldı.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DTC_CLASS_OF_SERVICE_CANON, type DtcSourceService,
} from '../platform/obd/dtcAuthority';
import { parseKwpDtcResponse, validateKwpDtcResponse } from '../platform/obd/kwpDtc';
import {
  evaluateManufacturerClearGate, MANUFACTURER_CLEAR_DENY_LABEL,
  type ManufacturerClearGateInput,
} from '../platform/obd/manufacturerClearGate';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const scan   = () => read('src/platform/obd/multiEcuScan.ts');
const elm    = () => read('android/app/src/main/java/com/cockpitos/pro/obd/ElmProtocol.java');
const plugin = () => read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
const panel  = () => read('src/components/obd/DTCPanel.tsx');

/* ══════════════════════════════════════════════════════════════════════════
 * A) KWP 0x13 ZİNCİRİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('P0-OBD-DIAG-02 › 0x13 kanonik otoritede AYRI kaynaktır', () => {
  it('🔒 KİLİT: 0x13 kaynak servisi VAR ve sınıfı KWP', () => {
    expect(DTC_CLASS_OF_SERVICE_CANON['13' as DtcSourceService]).toBe('KWP');
    expect(DTC_CLASS_OF_SERVICE_CANON['18']).toBe('KWP');
  });

  it('🔒 KİLİT: 0x18 ile 0x13 AYRI kaynaklardır (provenance birleştirilemez)', () => {
    /* Sınıf aynı ama KAYNAK farklı: bir araçta 0x18 yok / 0x13 var ise bu
       teşhis için kalıcı bir gerçektir ve kaybolursa her turda 0x18 aranır. */
    const src = scan();
    expect(src, 'kodun hangi KWP servisinden geldiği taşınmıyor').toContain('kwpService');
    expect(src).toContain("service: c.kwpService === '13' ? '13' : '18'");
  });

  it('gövde çözücüsü PAYLAŞILIR — ikinci ayrıştırıcı yazılmadı', () => {
    /* 0x13 pozitif yanıtı `53 <count> (hi lo status)*`, 0x18 ise `58 <count> …` —
       SID soyulduktan sonra gövde AYNIDIR. Ayrı çözücü yazmak, kayıt boyu (3
       bayt) kuralını iki yere kopyalamak olurdu. */
    const body = '02 01 30 24 04 20 68';           // 2 kayıt
    expect(validateKwpDtcResponse(body).valid).toBe(true);
    const parsed = parseKwpDtcResponse(body);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.rawDtc).toBe('0130');
    expect(parsed[1]!.rawDtc).toBe('0420');
  });

  it('🔒 KİLİT: 0x13 YALNIZ 0x18 AÇIKÇA reddedildiğinde sorulur', () => {
    /* Sessizlikte ya da hat hatasında denemek yanlış olurdu: o durumda adres/hat
       şüphelidir ve fazladan istek yalnız K-line'ı meşgul eder. */
    const src = scan();
    expect(src, '0x13 kapısı kaldırılmış')
      .toContain("if (outcome === 'unsupported') return await _readKwp13ForEcu(");
    /* Kapı, 0x18 sonucu ok DEĞİLKEN çalışan dalın İÇİNDE olmalı. */
    const gateIdx = src.indexOf("if (outcome === 'unsupported') return await _readKwp13ForEcu(");
    const okIdx   = src.indexOf("const envelope = validateKwpDtcResponse(res.raw);");
    expect(gateIdx, '0x13 kapısı pozitif dalın içine kaymış').toBeLessThan(okIdx);
  });

  it('🔒 KİLİT: 0x13 de HEDEF KANITI olmadan gönderilmez (native kapı)', () => {
    const p = plugin();
    expect(p, '0x13 hedef kapısının DIŞINDA kalmış')
      .toContain('if (("18".equals(service) || "13".equals(service)) && !targetVerified)');
    /* Kapı, gönderim dalından ÖNCE olmalı. */
    const gate = p.indexOf('|| "13".equals(service)) && !targetVerified');
    const send = p.indexOf('readAdvancedKwp13Dtc(tx, rx)');
    expect(gate).toBeGreaterThan(0);
    expect(gate, 'kapı gönderimden SONRA').toBeLessThan(send);
  });

  it('🔒 KİLİT: native 0x13 isteği PARAMETRESİZDİR (13) ve pozitif yanıt 53', () => {
    /* 0x18'in status/group parametreleri 0x13'te YOKTUR; eklemek NRC üretir. */
    const src = elm();
    expect(src).toContain('udsRequestDetailed("13", "13", "53"');
    expect(src, '0x13 isteğine parametre eklenmiş').not.toContain('udsRequestDetailed("1300');
  });

  it('🔒 KİLİT: 0x13 sonucu AYRI kanalda raporlanır (sorulmadı ≠ desteklenmiyor)', () => {
    const src = scan();
    expect(src).toContain('kwp13: EcuModeStatus | null;');
    expect(src, '0x13 tarama satırı otoriteye yazılmıyor').toContain("rows.push(['13', r.kwp13])");
  });

  it('🔒 KİLİT: 0x13 satırı SORULMADIYSA otoriteye YAZILMAZ (sahte kapsam kaybı yok)', () => {
    /* `null` outcome kanonik otoritede `not_scanned`e düşer ve o bir KAPSAM
       KAYBIDIR → hüküm motoru "temiz" diyemez. 0x13 yalnız 0x18 reddedilince
       sorulur; sorulmadığı turda satırı yazmak HER araca kalıcı ve SAHTE bir
       kapsam kaybı eklerdi (canlı hüküm zincirinde regresyon). */
    const src = scan();
    expect(src).toContain("if (r.kwp13 !== null) rows.push(['13', r.kwp13]);");
    /* Koşulsuz satır geri gelmesin. */
    expect(src).not.toContain("['18', r.kwp],   ['13', r.kwp13],");
  });

  it('🔒 KİLİT: 0x13 NRC/bozuk gövde KOD ÜRETMEZ (fail-closed)', () => {
    const src = scan();
    const fn = src.slice(src.indexOf('async function _readKwp13ForEcu'));
    const body = fn.slice(0, fn.indexOf('\nfunction _tagKwpCodes'));
    expect(body).toContain("if (outcome !== 'ok') {");
    expect(body).toContain("result.kwp13DiagnosticOutcome = 'malformed'");
    /* Kod ancak zarf GEÇERLİYSE üretilir. */
    const okIdx    = body.indexOf('const parsed = parseKwpDtcResponse(res.raw);');
    const validIdx = body.indexOf('const envelope = validateKwpDtcResponse(res.raw);');
    expect(validIdx).toBeGreaterThan(0);
    expect(validIdx, 'zarf doğrulaması ayrıştırmadan SONRA').toBeLessThan(okIdx);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B) ÜRETİCİ KODU KULLANICIYA TAM KÜNYESİYLE GÖRÜNÜR
 * ════════════════════════════════════════════════════════════════════════ */

describe('P0-OBD-DIAG-02 › üretici kodu ekranda KÜNYELİ görünür', () => {
  it('🔒 KİLİT: satır KOD · SINIF · KAYNAK · ECU · AÇIKLAMA taşır', () => {
    const p = panel();
    expect(p, 'sınıf kanonik otoriteden gelmiyor').toContain('DTC_OBSERVATION_CLASS_LABEL[obsCls]');
    expect(p, 'kaynak servis gösterilmiyor').toContain('dtc-source-');
    expect(p, 'açıklama gösterilmiyor').toContain('lookupDtc(c.code).description');
    expect(p, 'ECU etiketi kaldırılmış').toContain('{c.ecuLabel}');
  });

  it('🔒 KİLİT: KWP kodu "ONAYLANMIŞ" diye ETİKETLENMEZ (provenance kaybı)', () => {
    /* Ölçülen kusur: `mode` KWP kodlarında 'stored'dur → ekran "ONAYLANMIŞ"
       yazıyordu ve kodun üretici tabanından geldiği kayboluyordu. */
    const p = panel();
    expect(p).toContain("c.fromKwp === true ? 'KWP'");
    expect(p).toContain("c.kwpService === '13' ? 'KWP 0x13' : 'KWP 0x18'");
  });

  it('🔒 KİLİT: KATALOG DIŞI kod "türetildi" diye İŞARETLENİR', () => {
    /* `lookupDtc` bilinmeyen kod için ön ekten genel bir cümle üretir. Bunu
       tanım gibi göstermek, bilmediğimiz bir arızayı biliyormuş gibi sunmaktır. */
    const p = panel();
    expect(p).toContain('isKnownDtcCode(c.code)');
    expect(p).toContain('türetildi');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C) ÜRETİCİ SİLME KAPISI — YAZILDI, KAPALI
 * ════════════════════════════════════════════════════════════════════════ */

const FULL: ManufacturerClearGateInput = {
  target: {
    txHeader: '817AF1', rxHeader: '86F17A', addressability: 'PROVEN',
    sourceService: '18', observedCodeCount: 2, sessionEpoch: 9,
  },
  currentSessionEpoch: 9,
  protocolActive: '5',
  bridgeAvailable: true,
  vehicleStopped: true,
  userConfirmed: true,
  clearPathFieldVerified: true,
};

describe('P0-OBD-DIAG-02 › üretici silme kapısı FAIL-CLOSED', () => {
  it('🔒 KİLİT: BUGÜNKÜ saha durumu → REDDEDİLİR (adres kanıtsız, kod yok, yol doğrulanmamış)', () => {
    const d = evaluateManufacturerClearGate({
      ...FULL,
      target: { ...FULL.target, addressability: 'NOT_ADDRESSABLE', observedCodeCount: 0 },
      userConfirmed: false,
      clearPathFieldVerified: false,
    });
    expect(d.allowed).toBe(false);
    expect(d.denyReasons).toContain('ADDRESS_NOT_PROVEN');
    expect(d.denyReasons).toContain('NO_OBSERVED_CODE');
    expect(d.denyReasons).toContain('CLEAR_PATH_UNVERIFIED');
    expect(d.resolvedTarget, 'reddedilmiş kararda hedef sızmış').toBeNull();
  });

  it('🔒 KİLİT: SAHA DOĞRULAMASI olmadan kapı ASLA açılmaz', () => {
    const d = evaluateManufacturerClearGate({ ...FULL, clearPathFieldVerified: false });
    expect(d.allowed).toBe(false);
    expect(d.denyReasons).toEqual(['CLEAR_PATH_UNVERIFIED']);
  });

  it('🔒 KİLİT: AÇIK KULLANICI ONAYI olmadan destructive komut açılmaz', () => {
    const d = evaluateManufacturerClearGate({ ...FULL, userConfirmed: false });
    expect(d.allowed).toBe(false);
    expect(d.denyReasons).toContain('NO_USER_CONFIRMATION');
  });

  it('🔒 KİLİT: "araç duruyor mu" ÖLÇÜLMEDİYSE (null) izin YOK', () => {
    /* Bilinmeyen ASLA izinli sayılmaz — bu kapının tüm meselesi budur. */
    const d = evaluateManufacturerClearGate({ ...FULL, vehicleStopped: null });
    expect(d.allowed).toBe(false);
    expect(d.denyReasons).toContain('VEHICLE_NOT_STOPPED');
  });

  it('🔒 KİLİT: BAYAT oturum kanıtı izin ÜRETMEZ (araç değişmiş olabilir)', () => {
    const d = evaluateManufacturerClearGate({ ...FULL, currentSessionEpoch: 10 });
    expect(d.allowed).toBe(false);
    expect(d.denyReasons).toContain('STALE_SESSION');
  });

  it('🔒 KİLİT: protokol BİLİNMİYORSA izin YOK (hangi silme yolu belirsiz)', () => {
    expect(evaluateManufacturerClearGate({ ...FULL, protocolActive: null }).denyReasons)
      .toContain('PROTOCOL_UNKNOWN');
    expect(evaluateManufacturerClearGate({ ...FULL, protocolActive: '  ' }).denyReasons)
      .toContain('PROTOCOL_UNKNOWN');
  });

  it('🔒 KİLİT: emisyon servisleri (03/07/0A) bu kapıdan GEÇMEZ — Mode 04 yolu ayrıdır', () => {
    for (const svc of ['03', '07', '0A'] as const) {
      const d = evaluateManufacturerClearGate({
        ...FULL, target: { ...FULL.target, sourceService: svc },
      });
      expect(d.allowed, `${svc} üretici kapısından geçti`).toBe(false);
      expect(d.denyReasons).toContain('UNSUPPORTED_SOURCE');
    }
  });

  it('🔒 KİLİT: hedef header yoksa adres UYDURULMAZ', () => {
    for (const tx of [null, '', '7A']) {
      const d = evaluateManufacturerClearGate({
        ...FULL, target: { ...FULL.target, txHeader: tx },
      });
      expect(d.denyReasons).toContain('NO_TARGET');
      expect(d.resolvedTarget).toBeNull();
    }
  });

  it('TÜM koşullar kanıtla sağlanırsa karar POZİTİF olur (kapı ölü değil)', () => {
    const d = evaluateManufacturerClearGate(FULL);
    expect(d.allowed).toBe(true);
    expect(d.denyReasons).toHaveLength(0);
    expect(d.resolvedTarget).toBe('817AF1');
  });

  it('0x13 ve 0x19 kaynakları da üretici hafızası SAYILIR', () => {
    for (const svc of ['13', '19'] as const) {
      expect(evaluateManufacturerClearGate({
        ...FULL, target: { ...FULL.target, sourceService: svc },
      }).allowed, `${svc} reddedildi`).toBe(true);
    }
  });

  it('her ret gerekçesinin TR etiketi vardır (sessiz ret YOK)', () => {
    const d = evaluateManufacturerClearGate({
      ...FULL, target: { ...FULL.target, txHeader: null }, userConfirmed: false,
    });
    for (const r of d.denyReasons) {
      expect(MANUFACTURER_CLEAR_DENY_LABEL[r].length).toBeGreaterThan(10);
    }
    expect(d.reason).toContain('REDDEDİLDİ');
  });

  it('🔒 KİLİT: kapı HİÇBİR komut göndermez (saf karar modeli)', () => {
    /* Yorumlar SOYULUR: docblock bir KULLANIM değildir (kapının kendisi
       "Date.now YOK" diye yazıyor ve bu bir ihlal sayılamaz). */
    const src = read('src/platform/obd/manufacturerClearGate.ts')
      .replace(new RegExp(String.raw`/\*[\s\S]*?\*/`, 'g'), ' ')
      .replace(new RegExp(String.raw`//[^\n]*`, 'g'), ' ');
    for (const bad of ['CarLauncher', 'Capacitor', 'fetch(', 'setTimeout', 'Date.now']) {
      expect(src, `silme kapısına yan etki girmiş: ${bad}`).not.toContain(bad);
    }
  });
});
