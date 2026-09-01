/**
 * P0-OBD-FINAL-02 · KWP TANI OTURUMU (0x10) KANIT PROBU — KİLİT TESTLERİ
 *
 * ── ÖLÇÜLEN SAHA DURUMU (2026-08-25 · gerçek araç · Protocol 5 / KWP) ──────
 * ECU keşfi başarılı: `ECU 7A (KWP)` · rx `86F17A` · tx `817AF1` · 8-bit ·
 * rol UNKNOWN. Fonksiyonel Mode 03/07 CEVAP VERDİ; fiziksel `817AF1` SUSTU.
 * Mevcut güvenlik kapısı fiziksel adreslenebilirlik kanıtlanmadığı için 0x18'i
 * GÖNDERMEDİ — BU DAVRANIŞ DOĞRUDUR ve bu dosya onu KİLİTLER.
 *
 * Bu turda eklenen tek şey KANITTIR: oturum komutu (`10 81` → `50 81`,
 * gerekirse `10 C0` → `50 C0`) kontrollü olarak sorulur ve sonucu KAYDEDİLİR.
 * Kilit: POZİTİF kanıt YOKSA hiçbir şey açılmaz.
 */
import { describe, it, expect, beforeEach } from 'vitest';
/* Native kaynağı OKUNUR (çalıştırılmaz): TS ile native arasındaki kanıt gücü
   sözleşmesi yalnız iki uçta AYNI kaldığı sürece geçerlidir — bkz. dosya
   sonundaki "native ↔ TS kanıt gücü sıralaması" bloğu. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  KWP_SESSION_COMMANDS, classifyKwpSessionResponse, compactHex,
  getKwpSessionProbes, recordKwpSessionProbe, summarizeKwpSession,
  _resetKwpSessionProbesForTest, KWP_SESSION_PROBE_RING,
  type KwpSessionProbeEntry, type KwpSessionResult,
} from '../platform/obd/kwpSessionProbe';

const STD = KWP_SESSION_COMMANDS[0]!;   // 1081 → 5081
const EXT = KWP_SESSION_COMMANDS[1]!;   // 10C0 → 50C0

const TX = '817AF1';
const RX = '86F17A';
const EPOCH = 7;

function entry(over: Partial<KwpSessionProbeEntry> = {}): KwpSessionProbeEntry {
  return {
    atMs: 1_000, sessionEpoch: EPOCH, tx: TX, rx: RX, protocol: '5',
    request: STD.request, positiveNeedle: STD.positive, raw: null,
    result: 'NO_RESPONSE', nrc: null, nativeOutcome: 'no_response', error: null,
    ...over,
  };
}

beforeEach(() => { _resetKwpSessionProbesForTest(); });

describe('P0-OBD-FINAL-02 — oturum komut sözleşmesi', () => {
  it('🔒 KİLİT: istek/pozitif çiftleri ISO 14230-4 ile birebir (10 81→50 81 · 10 C0→50 C0)', () => {
    expect(STD.request).toBe('1081');
    expect(STD.positive).toBe('5081');
    expect(EXT.request).toBe('10C0');
    expect(EXT.positive).toBe('50C0');
    // Standart oturum ÖNCE denenir — sıra bilinçlidir.
    expect(KWP_SESSION_COMMANDS.map((c) => c.request)).toEqual(['1081', '10C0']);
  });
});

describe('P0-OBD-FINAL-02 — classifyKwpSessionResponse (saf)', () => {
  it('pozitif yanıt (boşluklu ham hex dahil) → POSITIVE', () => {
    const r = classifyKwpSessionResponse(STD, {
      request: '1081', raw: '50 81 EF 8F', outcome: 'ok', nrc: null,
    });
    expect(r.result).toBe<KwpSessionResult>('POSITIVE');
  });

  it('alternatif oturum pozitifi (50 C0) da POSITIVE', () => {
    const r = classifyKwpSessionResponse(EXT, {
      request: '10C0', raw: '50C0', outcome: 'ok', nrc: null,
    });
    expect(r.result).toBe('POSITIVE');
  });

  it('🔒 KİLİT: native "ok" DESE BİLE pozitif önek yoksa POSITIVE DEĞİL (körlemesine güven yasak)', () => {
    const r = classifyKwpSessionResponse(STD, {
      request: '1081', raw: '', outcome: 'ok', nrc: null,
    });
    expect(r.result).toBe('MALFORMED');
  });

  it('🔒 KİLİT: ayrık negatif yanıt (7F 10 11) NEGATIVE + NRC — POSITIVE DEĞİL', () => {
    const r = classifyKwpSessionResponse(STD, {
      request: '1081', raw: '7F 10 11', outcome: 'negative_nrc', nrc: null,
    });
    expect(r.result).toBe('NEGATIVE');
    expect(r.nrc).toBe(0x11);
  });

  it('NRC ham yanıtta yoksa native NRC alanından taşınır (kanıt kaybolmaz)', () => {
    const r = classifyKwpSessionResponse(STD, {
      request: '1081', raw: null, outcome: 'negative_nrc', nrc: 0x12,
    });
    expect(r.result).toBe('NEGATIVE');
    expect(r.nrc).toBe(0x12);
  });

  it('🔒 KİLİT: SAHA SENARYOSU — ECU sustu → NO_RESPONSE (asla POSITIVE)', () => {
    for (const outcome of ['no_response', 'timeout', 'NO_RESPONSE', 'TIMEOUT']) {
      const r = classifyKwpSessionResponse(STD, { request: '1081', raw: null, outcome, nrc: null });
      expect(r.result).toBe('NO_RESPONSE');
    }
  });

  it('hat hatası ECU hakkında kanıt DEĞİLDİR → TRANSPORT_ERROR', () => {
    const r = classifyKwpSessionResponse(STD, {
      request: '1081', raw: null, outcome: 'transport_error', nrc: null,
    });
    expect(r.result).toBe('TRANSPORT_ERROR');
  });

  it('istek hiç gönderilmediyse NOT_ATTEMPTED ("sorulmadı" ≠ "olmadı")', () => {
    expect(classifyKwpSessionResponse(STD, {
      request: null, raw: null, outcome: null, nrc: null,
    }).result).toBe('NOT_ATTEMPTED');
    expect(classifyKwpSessionResponse(STD, {
      request: '1081', raw: null, outcome: 'not_attempted', nrc: null,
    }).result).toBe('NOT_ATTEMPTED');
  });

  it('tanınmayan yanıt ("?" klon adaptör) MALFORMED — "desteklenmiyor" DEĞİL', () => {
    const r = classifyKwpSessionResponse(STD, {
      request: '1081', raw: '?', outcome: 'malformed', nrc: null,
    });
    expect(r.result).toBe('MALFORMED');
  });

  it('compactHex boşluk/prompt temizler, hex olmayanı düşürür', () => {
    expect(compactHex(' 50 81 \r>')).toBe('5081');
    expect(compactHex(null)).toBe('');
  });
});

describe('P0-OBD-FINAL-02 — kanıt defteri + özet', () => {
  it('🔒 KİLİT: POZİTİF kanıt YOKSA proven=false (fail-closed)', () => {
    recordKwpSessionProbe(entry({ result: 'NO_RESPONSE' }));
    recordKwpSessionProbe(entry({ request: EXT.request, positiveNeedle: EXT.positive, result: 'NO_RESPONSE' }));
    const v = summarizeKwpSession(getKwpSessionProbes(), TX, EPOCH);
    expect(v.proven).toBe(false);
    expect(v.result).toBe('NO_RESPONSE');
    expect(v.attempts).toBe(2);
    expect(v.reason).toMatch(/SUSTU/);
  });

  it('🔒 KİLİT: NEGATIVE (ECU reddetti) POZİTİF SAYILMAZ', () => {
    recordKwpSessionProbe(entry({ result: 'NEGATIVE', nrc: 0x12, raw: '7F1012' }));
    const v = summarizeKwpSession(getKwpSessionProbes(), TX, EPOCH);
    expect(v.proven).toBe(false);
    expect(v.result).toBe('NEGATIVE');
    expect(v.reason).toMatch(/NRC 0x12/);
  });

  it('POZİTİF kanıt varsa proven=true ve istek/yanıt TAŞINIR', () => {
    recordKwpSessionProbe(entry({ result: 'NO_RESPONSE' }));
    recordKwpSessionProbe(entry({
      request: EXT.request, positiveNeedle: EXT.positive,
      raw: '50 C0 EF 8F', result: 'POSITIVE', nativeOutcome: 'ok',
    }));
    const v = summarizeKwpSession(getKwpSessionProbes(), TX, EPOCH);
    expect(v.proven).toBe(true);
    expect(v.request).toBe('10C0');
    expect(v.response).toBe('50C0EF8F');
  });

  it('🔒 KİLİT: sonradan gelen SESSİZLİK pozitif kanıtı EZEMEZ (monoton)', () => {
    recordKwpSessionProbe(entry({ raw: '5081', result: 'POSITIVE' }));
    recordKwpSessionProbe(entry({ raw: null, result: 'NO_RESPONSE' }));
    expect(summarizeKwpSession(getKwpSessionProbes(), TX, EPOCH).proven).toBe(true);
  });

  it('🔒 KİLİT: BAŞKA ECU’nun kanıtı bu ECU’ya YAZILAMAZ (provenance kilidi)', () => {
    recordKwpSessionProbe(entry({ tx: '8110F1', raw: '5081', result: 'POSITIVE' }));
    const v = summarizeKwpSession(getKwpSessionProbes(), TX, EPOCH);
    expect(v.proven).toBe(false);
    expect(v.result).toBe('NOT_ATTEMPTED');
  });

  it('🔒 KİLİT: BAŞKA OTURUMUN kanıtı sayılmaz (bayat kanıt karar veremez)', () => {
    recordKwpSessionProbe(entry({ sessionEpoch: EPOCH, raw: '5081', result: 'POSITIVE' }));
    expect(summarizeKwpSession(getKwpSessionProbes(), TX, EPOCH + 1).proven).toBe(false);
  });

  it('yeni oturum epoch’u defteri TEMİZLER (kendini temizleyen mühür)', () => {
    recordKwpSessionProbe(entry({ raw: '5081', result: 'POSITIVE' }));
    recordKwpSessionProbe(entry({ sessionEpoch: EPOCH + 1, result: 'NO_RESPONSE' }));
    expect(getKwpSessionProbes()).toHaveLength(1);
    expect(getKwpSessionProbes()[0]!.sessionEpoch).toBe(EPOCH + 1);
  });

  it('defter tavanı korunur (bounded — cihazda bellek sızıntısı yok)', () => {
    for (let i = 0; i < KWP_SESSION_PROBE_RING + 10; i++) {
      recordKwpSessionProbe(entry({ atMs: i, tx: `81${i.toString(16).padStart(2, '0')}F1` }));
    }
    expect(getKwpSessionProbes().length).toBe(KWP_SESSION_PROBE_RING);
  });

  it('hiç kayıt yoksa NOT_ATTEMPTED ("sorulmadı" ile "ulaşılamadı" AYRI)', () => {
    const v = summarizeKwpSession([], TX, EPOCH);
    expect(v.result).toBe('NOT_ATTEMPTED');
    expect(v.request).toBeNull();
    expect(v.response).toBeNull();
  });

  it('defter okuması KOPYA döner (çağıran kanıtı bozamaz)', () => {
    recordKwpSessionProbe(entry());
    const a = getKwpSessionProbes();
    (a as KwpSessionProbeEntry[]).length = 0;
    expect(getKwpSessionProbes()).toHaveLength(1);
  });
});

/**
 * P0-OBD-FINAL-02 · NATIVE ↔ TS KANIT GÜCÜ SÖZLEŞMESİ.
 *
 * ── KAPATILAN KUSUR ────────────────────────────────────────────────────────
 * Native (`ElmProtocol.probeKwpSessionRaw`) en fazla İKİ komut dener (`10 81`,
 * sonra `10 C0`) ama TS'e YALNIZ TEK bir kanıt taşır. Eskiden döngü "SONUNCU"
 * denemeyi döndürüyordu: `10 81` ayrık NEGATİF yanıt verip (adres CANLI, oturum
 * RED) ardından `10 C0` sustuğunda kanıt `no_response`a düşüyordu — yani ECU'nun
 * CEVAP VERDİĞİ ölçüm "ECU yok" gibi rapor ediliyordu. Bu, sahadaki (2026-08-25,
 * ECU 7A) teşhisi TAM TERSİNE çevirecek bir kanıt kaybıydı.
 *
 * `summarizeKwpSession` TS tarafında ZATEN güce göre sıralıyor; ama native tek
 * kaydı yanlış seçerse TS o sıralamayı HİÇ göremez. Bu yüzden iki uçtaki sıra
 * BİREBİR aynı olmak ZORUNDADIR ve bu test o eşitliği KİLİTLER.
 *
 * GÜVENLİK: sıralama yalnız TEŞHİS kalitesini belirler. Fiziksel
 * adreslenebilirlik ve 0x18 zinciri YALNIZ `POSITIVE` ile açılır — bu testlerin
 * hiçbiri o kapıyı gevşetmez (bkz. `kwpSessionProbeWiring.test.ts`).
 */
describe('P0-OBD-FINAL-02 — native ↔ TS kanıt gücü sıralaması', () => {
  /** Java `ElmProtocol.sessionOutcomeRank` ↔ TS `_RESULT_RANK` eşlemesi. */
  const NATIVE_TO_TS: ReadonlyArray<readonly [string, KwpSessionResult, number]> = [
    ['ok',              'POSITIVE',        5],
    ['negative_nrc',    'NEGATIVE',        4],
    ['malformed',       'MALFORMED',       3],
    ['no_response',     'NO_RESPONSE',     2],
    ['transport_error', 'TRANSPORT_ERROR', 1],
    ['not_attempted',   'NOT_ATTEMPTED',   0],
  ];

  it('native sıralama tablosu TS kaynağında BİREBİR aynı sırayla durur', () => {
    const java = readFileSync(
      join(process.cwd(), 'android/app/src/main/java/com/cockpitos/pro/obd/ElmProtocol.java'),
      'utf8');
    const start = java.indexOf('private static int sessionOutcomeRank');
    expect(start, 'native rank fonksiyonu kaybolmuş').toBeGreaterThan(-1);
    /* Boşluklar tek boşluğa indirgenir — hizalama değişikliği kilidi kırmasın. */
    const fn = java.slice(start).replace(/\s+/g, ' ');
    for (const [nativeOutcome, , rank] of NATIVE_TO_TS) {
      if (nativeOutcome === 'not_attempted') continue;   // `default` dalı
      expect(
        fn.includes(`case "${nativeOutcome}": return ${rank};`),
        `native '${nativeOutcome}' → ${rank} eşlemesi TS ile ayrışmış`,
      ).toBe(true);
    }
  });

  it('native POZİTİF bulunca İKİNCİ komutu GÖNDERMEZ (gereksiz K-line trafiği yok)', () => {
    const java = readFileSync(
      join(process.cwd(), 'android/app/src/main/java/com/cockpitos/pro/obd/ElmProtocol.java'),
      'utf8');
    const fn = java.slice(java.indexOf('public SessionEvidence probeKwpSessionRaw'));
    expect(/if\s*\("ok"\.equals\(ev\.outcome\)\)\s*return\s+ev;/.test(fn)).toBe(true);
  });

  it('native EN GÜÇLÜ ölçümü döndürür — "sonuncu"yu DEĞİL', () => {
    const java = readFileSync(
      join(process.cwd(), 'android/app/src/main/java/com/cockpitos/pro/obd/ElmProtocol.java'),
      'utf8');
    const fn = java.slice(
      java.indexOf('public SessionEvidence probeKwpSessionRaw'),
      java.indexOf('private static int sessionOutcomeRank'));
    expect(/sessionOutcomeRank\(ev\.outcome\)\s*>\s*sessionOutcomeRank\(best\.outcome\)/.test(fn),
      'native yine "sonuncu" kanıtı döndürüyor — NEGATIVE sessizlikle eziliyor').toBe(true);
  });

  it('TS özeti aynı sırayı uygular: NEGATIVE, sonraki NO_RESPONSE tarafından EZİLMEZ', () => {
    recordKwpSessionProbe(entry({ result: 'NEGATIVE', nrc: 0x12, raw: '7F1012' }));
    recordKwpSessionProbe(entry({
      request: EXT.request, positiveNeedle: EXT.positive, result: 'NO_RESPONSE', raw: null,
    }));
    const v = summarizeKwpSession(getKwpSessionProbes(), TX, EPOCH);
    expect(v.result).toBe('NEGATIVE');
    expect(v.proven).toBe(false);            // adres canlı ≠ oturum açıldı
  });

  it('hiçbir sonuç POZİTİF kanıdı EZEMEZ (0x18 kapısı kanıta bağlı kalır)', () => {
    recordKwpSessionProbe(entry({ raw: '5081', result: 'POSITIVE' }));
    for (const r of ['NEGATIVE', 'MALFORMED', 'NO_RESPONSE', 'TRANSPORT_ERROR'] as const) {
      recordKwpSessionProbe(entry({ result: r, raw: null }));
    }
    const v = summarizeKwpSession(getKwpSessionProbes(), TX, EPOCH);
    expect(v.result).toBe('POSITIVE');
    expect(v.proven).toBe(true);
  });

  it('POZİTİF DIŞINDA hiçbir sonuç `proven` ÜRETMEZ (fail-closed)', () => {
    for (const r of ['NEGATIVE', 'MALFORMED', 'NO_RESPONSE', 'TRANSPORT_ERROR', 'NOT_ATTEMPTED'] as const) {
      _resetKwpSessionProbesForTest();
      recordKwpSessionProbe(entry({ result: r, raw: null }));
      expect(summarizeKwpSession(getKwpSessionProbes(), TX, EPOCH).proven,
        `${r} yanlışlıkla oturum kanıtı sayılmış`).toBe(false);
    }
  });
});
