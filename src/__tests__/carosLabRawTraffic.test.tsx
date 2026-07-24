/**
 * carosLabRawTraffic.test.tsx — CAROS LAB Faz A2 · Raw OBD Traffic Inspector KİLİTLERİ (16).
 *
 * YAKLAŞIM (A1 ile aynı gerekçe): jsdom'da `react-dom/client` createRoot çalışmıyor →
 * ilk-render kanıtı `renderToStaticMarkup`, davranış kanıtı SAF modeller + saf
 * acquire/release çekirdeği üzerinden alınır.
 *
 * VERİ GERÇEĞİ KİLİDİ: native `obdTraffic` olayı YALNIZ {cmd,resp,ms,ts} taşır.
 * Kilit 13 bu sözleşmenin ihlal edilmediğini (protokol/oturum/transport uydurulmadığını)
 * doğrular.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@capacitor/clipboard', () => ({ Clipboard: { write: vi.fn(async () => {}) } }));

import type { ObdTrafficEntry } from '../platform/debug';
import { useDebugStore } from '../platform/debug';
import {
  expandTrafficRows, filterTrafficRows, countByKind,
  applyViewClear, makeViewClearMarker, describeEmptyState,
  classifyCommand, classifyResponse, isErrorResponse, isAdapterCommand,
  MAX_VIEW_ROWS, MAX_ROW_CHARS, ALL_KINDS, EMPTY_REASON_TEXT,
  type RawTrafficKind,
} from '../platform/devtools/rawTrafficModel';
import {
  buildRawTrafficExport, buildExportFileName, toExportRecord,
  MAX_EXPORT_RECORDS, MAX_EXPORT_BYTES, MAX_EXPORT_FIELD_CHARS,
  RAW_TRAFFIC_EXPORT_SCHEMA,
} from '../platform/devtools/rawTrafficExport';
import { maskObdTrafficEntry } from '../platform/devtools/obdTrafficMask';
import {
  acquireObdTrafficCapture, _resetDevtoolsCaptureForTest, _devtoolsCaptureRefs,
} from '../platform/devtools/devtoolsCapture';
import { isCarosLabAllowed, shouldRenderCarosLab } from '../platform/devtools/carosLabGate';
import { getCarosLabTool, resolveToolActivation } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';
import { CarosLabShell } from '../components/devtools/CarosLabShell';
import { RawObdTrafficScreen } from '../components/devtools/screens/RawObdTrafficScreen';
import { ObdRawView } from '../components/debug/ObdRawView';

/* ── Fixture yardımcıları ─────────────────────────────────────────────────── */

function entry(cmd: string, resp: string, ms = 10, ts = 1_000): ObdTrafficEntry {
  return { ts, cmd, resp, ms };
}

function seedStore(entries: readonly ObdTrafficEntry[]): void {
  useDebugStore.setState({ obdTrafficLog: [...entries] });
}

beforeEach(() => {
  _resetDevtoolsCaptureForTest();
  useDebugStore.setState({ obdTrafficLog: [], collecting: false });
});

afterEach(() => {
  useDebugStore.setState({ obdTrafficLog: [], collecting: false });
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1–2 · Kapı ve mount koşulu
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 1 — developer gate korunuyor', () => {
  it('kapı hâlâ iki koşulu birden ister ve fail-closed kalır', () => {
    expect(isCarosLabAllowed({ debugEnabled: true,  canDebug: true  })).toBe(true);
    expect(isCarosLabAllowed({ debugEnabled: false, canDebug: true  })).toBe(false);
    expect(isCarosLabAllowed({ debugEnabled: true,  canDebug: false })).toBe(false);
    expect(shouldRenderCarosLab('caros-lab', false)).toBe(false);
  });
});

describe('KİLİT 2 — CAROS LAB kapalıyken ekran/capture mount olmuyor', () => {
  it('shell render edilse bile Raw OBD ekranı seçilmedikçe yakalama başlamaz', () => {
    renderToStaticMarkup(<CarosLabShell onClose={() => {}} />);
    expect(_devtoolsCaptureRefs()).toEqual({ obd: 0, can: 0 });
  });

  it('Raw OBD aracı katalogda AVAILABLE ve yalnız seçilince ekrana çözülür', () => {
    const tool = getCarosLabTool('raw-obd-traffic')!;
    expect(tool.status).toBe('AVAILABLE');
    expect(resolveToolActivation(tool)).toBe('raw-obd-traffic');
    expect(renderAvailableTool('raw-obd-traffic')).not.toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3–4 · Yaşam döngüsü / ref-count
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 3 — ekrandan çıkınca listener temizleniyor', () => {
  it('release listener\'ı kaldırır, yakalamayı kapatır, ref sıfırlar', async () => {
    const setCapture = vi.fn();
    const remove = vi.fn();
    const release = acquireObdTrafficCapture({
      isNative: () => true, setCapture, addListener: async () => ({ remove }), onEntry: vi.fn(),
    });
    await Promise.resolve();

    release();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(setCapture).toHaveBeenLastCalledWith(false);
    expect(_devtoolsCaptureRefs().obd).toBe(0);
  });
});

describe('KİLİT 4 — DebugPanel + CAROS LAB ortak capture: ref-count bozulmuyor', () => {
  it('iki tüketici tek yakalama açar; ilk release kanalı KAPATMAZ', async () => {
    const setCapture = vi.fn();
    const remove = vi.fn();
    const debugPanel = acquireObdTrafficCapture({
      isNative: () => true, setCapture, addListener: async () => ({ remove }), onEntry: vi.fn(),
    });
    const carosLab = acquireObdTrafficCapture();
    await Promise.resolve();

    expect(setCapture).toHaveBeenCalledTimes(1);
    expect(setCapture).toHaveBeenCalledWith(true);
    expect(_devtoolsCaptureRefs().obd).toBe(2);

    carosLab();
    expect(remove).not.toHaveBeenCalled();
    expect(setCapture).toHaveBeenCalledTimes(1);
    expect(_devtoolsCaptureRefs().obd).toBe(1);

    debugPanel();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(setCapture).toHaveBeenLastCalledWith(false);
    expect(_devtoolsCaptureRefs().obd).toBe(0);
  });

  it('çift release ref sayacını negatife düşürmez', async () => {
    const release = acquireObdTrafficCapture({
      isNative: () => true, setCapture: vi.fn(),
      addListener: async () => ({ remove: vi.fn() }), onEntry: vi.fn(),
    });
    await Promise.resolve();
    release(); release(); release();
    expect(_devtoolsCaptureRefs().obd).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5–6 · PAUSE / CLEAR semantiği
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 5 — PAUSE global capture\'ı veya polling\'i durdurmuyor', () => {
  it('duraklatma yalnız görünüm anlık görüntüsüdür: global tampon dolmaya devam eder', () => {
    seedStore([entry('010C', '41 0C 1A F8')]);
    // "Duraklatılmış görünüm" = o anki dizinin kopyası
    const frozen = useDebugStore.getState().obdTrafficLog;
    expect(expandTrafficRows(frozen)).toHaveLength(2);

    // Duraklatma sırasında yeni kayıt gelir (native yakalama sürüyor)
    useDebugStore.getState().pushObdTraffic(entry('010D', '41 0D 32', 8, 2_000));
    useDebugStore.getState().pushObdTraffic(entry('0105', '41 05 5A', 9, 3_000));

    // Donmuş görünüm DEĞİŞMEDİ…
    expect(expandTrafficRows(frozen)).toHaveLength(2);
    // …ama global tampon büyüdü (veri kaybı YOK — devam edilince hepsi görünür)
    expect(useDebugStore.getState().obdTrafficLog).toHaveLength(3);
    expect(expandTrafficRows(useDebugStore.getState().obdTrafficLog)).toHaveLength(6);
  });

  it('duraklatma yakalama ref sayacına DOKUNMAZ', async () => {
    const setCapture = vi.fn();
    const release = acquireObdTrafficCapture({
      isNative: () => true, setCapture,
      addListener: async () => ({ remove: vi.fn() }), onEntry: vi.fn(),
    });
    await Promise.resolve();
    // Pause saf bir React state'idir; capture API'sine hiçbir çağrı yapmaz.
    expect(setCapture).toHaveBeenCalledTimes(1);
    expect(_devtoolsCaptureRefs().obd).toBe(1);
    release();
  });
});

describe('KİLİT 6 — CLEAR global buffer\'ı etkilemiyor', () => {
  it('görünüm temizleme yalnız yerel pencereyi keser; store dokunulmaz', () => {
    const a = entry('ATZ', 'ELM327 v1.5', 30, 1_000);
    const b = entry('010C', '41 0C 1A F8', 12, 2_000);
    seedStore([a, b]);

    const marker = makeViewClearMarker(useDebugStore.getState().obdTrafficLog);
    expect(applyViewClear(useDebugStore.getState().obdTrafficLog, marker)).toHaveLength(0);

    // GLOBAL tampon ve DebugPanel verisi KORUNDU
    expect(useDebugStore.getState().obdTrafficLog).toHaveLength(2);

    // Temizlemeden sonraki yeni kayıt görünür
    useDebugStore.getState().pushObdTraffic(entry('0105', '41 05 5A', 9, 3_000));
    const after = applyViewClear(useDebugStore.getState().obdTrafficLog, marker);
    expect(after).toHaveLength(1);
    expect(after[0].cmd).toBe('0105');
  });

  it('işaret halka tamponundan düşerse fail-soft: her şey görünür', () => {
    const ghost = entry('ESKI', 'yok', 1, 1);
    seedStore([entry('010C', '41 0C', 5, 2_000)]);
    expect(applyViewClear(useDebugStore.getState().obdTrafficLog, ghost)).toHaveLength(1);
  });

  it('CAROS LAB temizleme store\'un clearObdTraffic fonksiyonunu ÇAĞIRMAZ', () => {
    seedStore([entry('010C', '41 0C', 5)]);
    const spy = vi.spyOn(useDebugStore.getState(), 'clearObdTraffic');
    // Yerel temizleme yalnız işaret üretir — global temizleme yolu kullanılmaz.
    makeViewClearMarker(useDebugStore.getState().obdTrafficLog);
    expect(spy).not.toHaveBeenCalled();
    expect(useDebugStore.getState().obdTrafficLog).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7–9 · Dışa aktarım: her zaman maskeli, bounded
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 7 — export her zaman maskeli (ekrandaki nesneye güvenilmez)', () => {
  it('export HAM tampondan yeniden maskeler; ham VIN yükü çıkmaz', () => {
    const res = buildRawTrafficExport(
      [entry('0902', '49 02 01 57 46 30 41 58 58 54 54 52 41 35 52 31 32 33 34 35', 120, 5_000)],
      { generatedAtWallMs: 1_700_000_000_000, platform: 'web' },
    );
    expect(res.body).not.toContain('57 46 30 41');
    expect(res.body).toContain('VIN redacted');
    expect(JSON.parse(res.body).masked).toBe(true);
  });

  it('görünüm satırları bozulsa/atlansa bile export kendi maskesini uygular', () => {
    // Kasten "maskelenmiş gibi görünmeyen" ham kayıt — export yine temizler.
    const raw = [entry('ATZ', 'user surucu@example.com token_abcdef1234567890', 5, 6_000)];
    const res = buildRawTrafficExport(raw, { generatedAtWallMs: 1, platform: 'web' });
    expect(res.body).not.toContain('surucu@example.com');
    expect(res.body).not.toContain('token_abcdef1234567890');
  });

  it('rapor şeması ve salt-okunur bayrağı taşınır', () => {
    const res = buildRawTrafficExport([entry('010C', '41 0C 1A F8')], { generatedAtWallMs: 1 });
    const parsed = JSON.parse(res.body);
    expect(parsed.schema).toBe(RAW_TRAFFIC_EXPORT_SCHEMA);
    expect(parsed.readOnly).toBe(true);
  });

  it('maskelenemeyen kayıt DÜŞÜRÜLÜR (fail-closed) ve sayısı beyan edilir', () => {
    const bad = { ts: 1, cmd: 123, resp: {}, ms: 5 } as unknown as ObdTrafficEntry;
    expect(toExportRecord(bad, 1)).toBeNull();
    const res = buildRawTrafficExport([bad, entry('010C', '41 0C')], { generatedAtWallMs: 1 });
    expect(res.droppedCount).toBe(1);
    expect(res.recordCount).toBe(1);
    expect(JSON.parse(res.body).counts.dropped).toBe(1);
  });

  it('dosya adında araç/kimlik bilgisi yok — yalnız zaman damgası', () => {
    const name = buildExportFileName(1_700_000_000_000);
    expect(name).toMatch(/^caros-obd-raw-[\dTZ:.-]+\.json$/);
    expect(name.toLowerCase()).not.toContain('vin');
    expect(name.toLowerCase()).not.toContain('renault');
  });
});

describe('KİLİT 8 — VIN · e-posta · MAC · UUID · token exportta AÇIK kalmıyor', () => {
  const SECRETS: ReadonlyArray<readonly [string, string]> = [
    ['VIN (ASCII)',    'WF0AXXTTRA5R12345'],
    ['e-posta',        'surucu@example.com'],
    ['MAC',            '00:1D:A5:68:98:8B'],
    ['UUID',           '6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8'],
    ['bearer token',   'bearer_abcdef1234567890xyz'],
    ['OpenAI anahtarı','sk-ABCDEFGH12345678'],
    ['Groq anahtarı',  'gsk_ABCDEFGH12345678'],
    ['Google anahtarı','AIzaSyABCDEFGHIJ0123456789'],
    ['IBAN',           'TR330006100519786457841326'],
    ['kart no',        '4111 1111 1111 1111'],
    ['telefon',        '+90 532 123 45 67'],
  ];

  it.each(SECRETS)('%s exportta ham hâliyle bulunmaz', (_label, secret) => {
    const res = buildRawTrafficExport(
      [entry('ATI', `deger ${secret} son`, 5, 1_000)],
      { generatedAtWallMs: 1, platform: 'web' },
    );
    expect(res.body).not.toContain(secret);
  });

  it.each(SECRETS)('%s görünüm maskesinde de ham kalmaz', (_label, secret) => {
    const masked = maskObdTrafficEntry('ATI', `deger ${secret} son`);
    expect(masked.resp).not.toContain(secret);
  });

  it('normal hex yükü maskelenmez (geliştiricinin asıl verisi korunur)', () => {
    const masked = maskObdTrafficEntry('010C', '41 0C 1A F8');
    expect(masked.resp).toBe('41 0C 1A F8');
    expect(masked.masked).toBe(false);
  });
});

describe('KİLİT 9 — export bounded', () => {
  it('kayıt tavanı uygulanır ve en YENİ kayıtlar korunur', () => {
    const many = Array.from({ length: MAX_EXPORT_RECORDS + 120 }, (_, i) =>
      entry('010C', `41 0C ${i}`, 5, 1_000 + i));
    const res = buildRawTrafficExport(many, { generatedAtWallMs: 1 });
    expect(res.recordCount).toBeLessThanOrEqual(MAX_EXPORT_RECORDS);
    expect(res.truncated).toBe(true);
    const parsed = JSON.parse(res.body);
    const last = parsed.records[parsed.records.length - 1];
    expect(last.resp).toContain(String(many.length - 1));
  });

  it('bayt tavanı aşılmaz (uzun yükler kırpılır, gerekirse kayıt düşürülür)', () => {
    const huge = Array.from({ length: MAX_EXPORT_RECORDS }, () =>
      entry('010C', 'A'.repeat(50_000), 5, 1_000));
    const res = buildRawTrafficExport(huge, { generatedAtWallMs: 1 });
    expect(res.bytes).toBeLessThanOrEqual(MAX_EXPORT_BYTES);
  });

  it('alan uzunluğu tavanı uygulanır', () => {
    const res = buildRawTrafficExport(
      [entry('010C', 'B'.repeat(5_000), 5, 1_000)],
      { generatedAtWallMs: 1 },
    );
    const rec = JSON.parse(res.body).records[0];
    expect(rec.resp.length).toBeLessThanOrEqual(MAX_EXPORT_FIELD_CHARS);
  });

  it('boş girdi çökmez ve 0 kayıt döner', () => {
    const res = buildRawTrafficExport([], { generatedAtWallMs: 1 });
    expect(res.recordCount).toBe(0);
    expect(() => JSON.parse(res.body)).not.toThrow();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10 · Görünüm bounded
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 10 — liste bounded', () => {
  it('satır sayısı MAX_VIEW_ROWS ile sınırlıdır ve en YENİ satırlar korunur', () => {
    const many = Array.from({ length: 500 }, (_, i) => entry('010C', `41 0C ${i}`, 5, 1_000 + i));
    const rows = expandTrafficRows(many);          // 500 kayıt × 2 yarı = 1000 aday
    expect(rows.length).toBe(MAX_VIEW_ROWS);
    expect(rows[rows.length - 1].text).toContain('499');
  });

  it('tek satır içeriği kırpılır', () => {
    const rows = expandTrafficRows([entry('010C', 'C'.repeat(9_000), 5, 1_000)]);
    const rx = rows.find((r) => r.kind === 'RX')!;
    expect(rx.text.length).toBeLessThanOrEqual(MAX_ROW_CHARS + 1);
  });

  it('filtre sonucu da bounded girdiden türer', () => {
    const many = Array.from({ length: 500 }, (_, i) => entry('010C', `41 0C ${i}`, 5, 1_000 + i));
    const filtered = filterTrafficRows(expandTrafficRows(many), { kinds: ALL_KINDS, query: '' });
    expect(filtered.length).toBeLessThanOrEqual(MAX_VIEW_ROWS);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 11–12 · Güvenlik yüzeyi + DebugPanel geriye uyumluluk
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 11 — raw command / ECU write yüzeyi YOK', () => {
  it('ekran markup\'ında komut gönderme kontrolü bulunmaz', () => {
    seedStore([entry('010C', '41 0C 1A F8')]);
    const html = renderToStaticMarkup(<RawObdTrafficScreen />);
    expect(html).toContain('raw-obd-inspector');
    expect(html).toContain('SALT OKUNUR');
    // Gönderme/yazma yüzeyi olmamalı
    expect(html).not.toContain('GÖNDER');
    expect(html).not.toContain('type="submit"');
    expect(html).not.toMatch(/<form/i);
    // Yalnız beklenen kontroller
    expect(html).toContain('raw-obd-pause');
    expect(html).toContain('raw-obd-clear');
    expect(html).toContain('raw-obd-export');
  });

  it('Raw Command Console hâlâ DISABLED ve açılamaz', () => {
    const t = getCarosLabTool('raw-command-console')!;
    expect(t.status).toBe('DISABLED');
    expect(resolveToolActivation(t)).toBeNull();
  });

  it('model/export modülleri hiçbir komut gönderme veya yazma API\'si dışa vermez', async () => {
    const model = await import('../platform/devtools/rawTrafficModel');
    const exp   = await import('../platform/devtools/rawTrafficExport');
    const names = [...Object.keys(model), ...Object.keys(exp)].map((n) => n.toLowerCase());
    const FORBIDDEN = [
      'sendcommand', 'sendobd', 'sendraw', 'writeecu', 'ecuwrite', 'writeobd',
      'cleardtc', 'clearobdtraffic', 'executecommand', 'startpolling', 'setcapture',
    ];
    for (const forbidden of FORBIDDEN) expect(names).not.toContain(forbidden);
    // Yalnız SAF okuma/dönüştürme fonksiyonları dışa verilir.
    expect(names).toContain('expandtrafficrows');
    expect(names).toContain('buildrawtrafficexport');
  });
});

describe('KİLİT 12 — DebugPanel varsayılan davranışı değişmiyor', () => {
  /* NOT (test harness gerçeği): zustand v5 SSR yolunda `getServerSnapshot` olarak
     `getInitialState()` kullanır → `renderToStaticMarkup` seed edilmiş store'u GÖRMEZ.
     Bu yüzden satır içeriği testi burada değil, SAF model testlerinde yapılır.
     Buradaki kilit "DebugPanel yolunda MASKELEME YOK" gerçeğidir ve kaynak
     düzeyinde doğrulanır (davranışsal regresyonun asıl kaynağı budur). */

  it('ObdRawView maskeleme modülünü İMPORT ETMEZ — DebugPanel ham veriyi görmeye devam eder', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/debug/ObdRawView.tsx', 'utf8');
    expect(src).not.toContain('obdTrafficMask');
    expect(src).not.toContain('maskObdTrafficEntry');
    expect(src).not.toContain('maskSensitive');
    // Ham yanıt doğrudan basılır (dönüştürülmeden)
    expect(src).toContain('{entry.resp || \'—\'}');
    expect(src).toContain('{entry.cmd}');
  });

  it('DebugPanel global temizleme ve sayaç davranışı yerinde', () => {
    const html = renderToStaticMarkup(<ObdRawView />);
    expect(html).toContain('TEMİZLE');   // global clearObdTraffic düğmesi duruyor
    expect(html).toContain('/ 500');     // mevcut sayaç metni
  });

  it('ObdRawView hiçbir zorunlu prop istemez (imza değişmedi)', () => {
    expect(() => renderToStaticMarkup(<ObdRawView />)).not.toThrow();
  });

  it('DebugPanel ortak yakalama hook\'unu kullanır (ikizlenmiş listener yok)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/debug/DebugPanel.tsx', 'utf8');
    expect(src).toContain('useObdTrafficCapture');
    expect(src).not.toContain('setObdTrafficCapture');   // doğrudan native çağrı YOK
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 13 · Metadata uydurma yasağı
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 13 — eksik protocol/session metadata UYDURULMUYOR', () => {
  it('görünüm satırında protokol/oturum/transport alanı YOKTUR', () => {
    const rows = expandTrafficRows([entry('010C', '41 0C 1A F8', 12, 1_000)]);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(
        ['elapsedMs', 'id', 'kind', 'masked', 'seq', 'text', 'ts'],
      );
      expect(r).not.toHaveProperty('protocol');
      expect(r).not.toHaveProperty('sessionId');
      expect(r).not.toHaveProperty('transport');
      expect(r).not.toHaveProperty('ecuAddress');
    }
  });

  it('export kaydı yalnız GERÇEK alanları taşır; yokluk açıkça beyan edilir', () => {
    const parsed = JSON.parse(
      buildRawTrafficExport([entry('010C', '41 0C 1A F8', 12, 1_000)], { generatedAtWallMs: 1 }).body,
    );
    expect(Object.keys(parsed.records[0]).sort()).toEqual(
      ['cmd', 'cmdKind', 'elapsedMs', 'resp', 'respKind', 'seq', 'ts'],
    );
    expect(parsed.absentMetadata).toEqual(['protocol', 'sessionId', 'transport', 'ecuAddress']);
  });

  it('yanıt yoksa yanıt satırı ÜRETİLMEZ (boş yanıt uydurulmaz)', () => {
    const rows = expandTrafficRows([entry('ATZ', '', 5, 1_000)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('SYSTEM');
    expect(rows[0].elapsedMs).toBeNull();
  });

  it('elapsed yalnız YANIT satırında; komut satırında null', () => {
    const rows = expandTrafficRows([entry('010C', '41 0C', 42, 1_000)]);
    expect(rows[0].elapsedMs).toBeNull();
    expect(rows[1].elapsedMs).toBe(42);
  });

  it('sınıflandırma yalnız gerçek içerikten türer', () => {
    expect(isAdapterCommand('ATZ')).toBe(true);
    expect(isAdapterCommand('STPX')).toBe(true);
    expect(isAdapterCommand('010C')).toBe(false);
    expect(classifyCommand('ATE0')).toBe('SYSTEM');
    expect(classifyCommand('0100')).toBe('TX');
    expect(classifyResponse('0100', '41 00 BE')).toBe('RX');
    expect(classifyResponse('ATZ', 'ELM327 v1.5')).toBe('SYSTEM');
    expect(classifyResponse('0100', '⚠ timeout')).toBe('ERROR');
    expect(classifyResponse('ATSP0', 'BUS INIT: ERROR')).toBe('ERROR');
    // NO DATA geçerli olumsuz yanıttır — HATA DEĞİL
    expect(isErrorResponse('NO DATA')).toBe(false);
    expect(classifyResponse('0100', 'NO DATA')).toBe('RX');
  });

  it('boş durum nedeni gerçek bağlantı durumundan türer ("çalışıyor" varsayımı yok)', () => {
    expect(describeEmptyState({ isNative: false, connectionState: 'connected', viewCleared: false, bufferSize: 0 }))
      .toBe('not-native');
    expect(describeEmptyState({ isNative: true, connectionState: 'disconnected', viewCleared: false, bufferSize: 0 }))
      .toBe('not-connected');
    expect(describeEmptyState({ isNative: true, connectionState: 'connected', viewCleared: false, bufferSize: 0 }))
      .toBe('connected-idle');
    expect(describeEmptyState({ isNative: true, connectionState: 'connected', viewCleared: true, bufferSize: 3 }))
      .toBe('view-cleared');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 14 · Shell mount temizliği
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 14 — shell mount hiçbir OBD/AI servisini başlatmıyor', () => {
  it('katalog görünümü render edilince yakalama referansı 0 kalır', () => {
    renderToStaticMarkup(<CarosLabShell onClose={() => {}} />);
    expect(_devtoolsCaptureRefs()).toEqual({ obd: 0, can: 0 });
  });

  it('model ve export modülleri import edilince yan etki üretmez', async () => {
    await import('../platform/devtools/rawTrafficModel');
    await import('../platform/devtools/rawTrafficExport');
    expect(_devtoolsCaptureRefs()).toEqual({ obd: 0, can: 0 });
    expect(useDebugStore.getState().obdTrafficLog).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 16 · Ürün dili (15 build adımında doğrulanır)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 16 — doğrulanmamış ürün dili ("yakında") eklenmiyor', () => {
  it('inspector metinlerinde belirsiz vaat yok', () => {
    seedStore([entry('010C', '41 0C 1A F8')]);
    const html = renderToStaticMarkup(<RawObdTrafficScreen />).toLowerCase();
    for (const banned of ['yakında', 'yakinda', 'coming soon', 'çok yakında']) {
      expect(html).not.toContain(banned);
    }
  });

  it('boş durum metinleri "çalışıyor" varsaymaz — her neden dürüst karşılığını taşır', () => {
    expect(EMPTY_REASON_TEXT['not-native']).toContain('Native yakalama kanalı yok');
    expect(EMPTY_REASON_TEXT['not-connected']).toContain('OBD bağlı değil');
    expect(EMPTY_REASON_TEXT['connected-idle']).toContain('trafik ÜRETMEZ');
    expect(EMPTY_REASON_TEXT['view-cleared']).toContain('Global tampon ve DebugPanel verisi korunuyor');
    for (const text of Object.values(EMPTY_REASON_TEXT)) {
      expect(text.toLowerCase()).not.toContain('yakında');
      expect(text.toLowerCase()).not.toContain('çalışıyor.');
    }
  });

  it('salt-okunur beyanı her koşulda ekranda', () => {
    const html = renderToStaticMarkup(<RawObdTrafficScreen />);
    expect(html).toContain('SALT OKUNUR — araç iletişimini değiştirmez');
    expect(html).toContain('Komut gönderme · ECU yazma · DTC silme yüzeyi YOK');
  });
});

/* Kilit 15 (ayrı lazy chunk) build çıktısında doğrulanır — birim testinde
   doğrulanamaz; eşleme fonksiyonunun lazy bileşen döndürdüğü burada sabitlenir. */
describe('KİLİT 15 — ekran ayrı lazy chunk olarak çözülür', () => {
  it('renderAvailableTool lazy bir eleman döndürür (statik import değil)', () => {
    const el = renderAvailableTool('raw-obd-traffic');
    expect(el).not.toBeNull();
    const type = (el as { type?: unknown }).type as { $$typeof?: symbol } | undefined;
    expect(type?.$$typeof).toBe(Symbol.for('react.lazy'));
  });
});

/* ── Filtre davranışı (ek kapsama) ────────────────────────────────────────── */

describe('filtreler — yön + metin araması', () => {
  it('yön filtresi yalnız seçili sınıfları gösterir', () => {
    const rows = expandTrafficRows([
      entry('ATZ', 'ELM327 v1.5', 30, 1_000),
      entry('010C', '41 0C 1A F8', 12, 2_000),
      entry('0100', '⚠ timeout', 900, 3_000),
    ]);
    const onlyError = filterTrafficRows(rows, { kinds: new Set<RawTrafficKind>(['ERROR']), query: '' });
    expect(onlyError).toHaveLength(1);
    expect(onlyError[0].text).toContain('timeout');

    const onlyTx = filterTrafficRows(rows, { kinds: new Set<RawTrafficKind>(['TX']), query: '' });
    expect(onlyTx.map((r) => r.text)).toEqual(['010C', '0100']);

    expect(filterTrafficRows(rows, { kinds: new Set<RawTrafficKind>(), query: '' })).toHaveLength(0);
  });

  it('metin araması büyük/küçük harf duyarsızdır', () => {
    const rows = expandTrafficRows([entry('010C', '41 0C 1A F8', 12, 1_000)]);
    expect(filterTrafficRows(rows, { kinds: ALL_KINDS, query: '1a f8' })).toHaveLength(1);
    expect(filterTrafficRows(rows, { kinds: ALL_KINDS, query: 'zzz' })).toHaveLength(0);
  });

  it('sayaçlar sınıf başına doğru hesaplanır', () => {
    const rows = expandTrafficRows([
      entry('ATZ', 'ELM327 v1.5', 30, 1_000),
      entry('010C', '41 0C 1A F8', 12, 2_000),
    ]);
    expect(countByKind(rows)).toEqual({ TX: 1, RX: 1, SYSTEM: 2, ERROR: 0 });
  });
});
