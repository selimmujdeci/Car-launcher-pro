/**
 * memoryCacheStorageF5.test.ts — ARCH-06/F5 · BELLEK/CACHE/DEPOLAMA KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * NEDEN VAR: Bellek baskısı yönetiminin en tehlikeli arızası, baskı ANINDA
 * ürünü BOZMAKTIR — çalmayı kesmek, navigasyonu düşürmek, araç gerçeğini
 * silmek. Bunlar "bellek kazandık" diye raporlanır ama kullanıcı için
 * çökmeden farksızdır.
 *
 * Bu dosyanın en önemli kilidi şudur: **`NON_EVICTABLE_TRUTH` bir katılımcı
 * OLAMAZ.** Koruma bir `if` koşuluna değil, kayıt edilememeye dayanır —
 * kaydedilmeyen şey silinemez.
 *
 * Kilitler ZAYIFLATILAMAZ.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  registerMemoryParticipant, registerCachePurge, getMemoryTrimEvidence,
  memoryTrimLadder, _simulateMemoryPressureForTest, _resetMemoryParticipantsForTest,
  type MemoryTrimLevel,
} from '../platform/memoryWatchdog';
import {
  storageDurabilityClass, getStorageWriteReasons,
} from '../utils/safeStorage';
import { getPerformanceDiagnosticsSnapshot } from '../platform/perf/performanceAggregator';

const WATCHDOG = readFileSync('src/platform/memoryWatchdog.ts', 'utf8');
const STORAGE = readFileSync('src/utils/safeStorage.ts', 'utf8');
const MEDIA = readFileSync('src/platform/mediaService.ts', 'utf8');

function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

beforeEach(() => { _resetMemoryParticipantsForTest(); });
afterEach(() => { _resetMemoryParticipantsForTest(); });

/* ═══════════════════════════════════════════════════════════════════════════
   A) KADEMELİ MERDİVEN
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F5/A · kademeli baskı merdiveni', () => {
  it('A1 — merdiven SIRASI tanımlı ve doğru', () => {
    expect(memoryTrimLadder()).toEqual([
      'NORMAL', 'TRIM_DEVTOOLS', 'TRIM_PREFETCH',
      'TRIM_PRESENTATION', 'PAUSE_BACKGROUND', 'CRITICAL_PROTECT',
    ]);
  });

  it('A2 — MODERATE yalnız DEVTOOLS + PREFETCH feda eder', () => {
    const hit: string[] = [];
    const mk = (id: string, cls: Parameters<typeof registerMemoryParticipant>[0]['participantClass']) =>
      registerMemoryParticipant({
        id, owner: 't', participantClass: cls, estimatedBytes: () => null,
        evictable: true, rebuildCost: 'FREE', onTrim: () => { hit.push(id); },
      });
    mk('dev', 'DEVTOOLS');
    mk('pre', 'PREFETCH_CACHE');
    mk('pres', 'PRESENTATION_CACHE');
    mk('bg', 'BACKGROUND_WORK');
    mk('reb', 'REBUILDABLE_DERIVED');

    _simulateMemoryPressureForTest('MODERATE');
    /* Sunum önbelleği, arka plan ve pahalı türev BU KADEMEDE DOKUNULMAZ. */
    expect(hit.sort()).toEqual(['dev', 'pre']);
  });

  it('A3 — CRITICAL merdivenin TEPESİNE çıkar (tüm sınıflar)', () => {
    const hit: string[] = [];
    for (const [id, cls] of [['dev', 'DEVTOOLS'], ['pre', 'PREFETCH_CACHE'],
      ['pres', 'PRESENTATION_CACHE'], ['bg', 'BACKGROUND_WORK'],
      ['reb', 'REBUILDABLE_DERIVED']] as const) {
      registerMemoryParticipant({
        id, owner: 't', participantClass: cls, estimatedBytes: () => null,
        evictable: true, rebuildCost: 'FREE', onTrim: () => { hit.push(id); },
      });
    }
    _simulateMemoryPressureForTest('CRITICAL');
    expect(hit.sort()).toEqual(['bg', 'dev', 'pre', 'pres', 'reb']);
  });

  it('A4 — ölçülmüş bayt ÖNCE, `null` olan SONRA çağrılır', () => {
    const order: string[] = [];
    const mk = (id: string, bytes: number | null) =>
      registerMemoryParticipant({
        id, owner: 't', participantClass: 'DEVTOOLS',
        estimatedBytes: () => bytes, evictable: true, rebuildCost: 'FREE',
        onTrim: () => { order.push(id); },
      });
    mk('unknown', null);
    mk('small', 100);
    mk('big', 9_000);
    _simulateMemoryPressureForTest('MODERATE');
    /* Büyükten küçüğe, bilinmeyen EN SON: bilinmeyeni önce silmek, ne kadar
       yer açtığını bilmeden pahalı bir şeyi yok etmek olabilir. */
    expect(order).toEqual(['big', 'small', 'unknown']);
  });

  it('A5 — bir sahibin hatası merdiveni DURDURMAZ', () => {
    const hit: string[] = [];
    registerMemoryParticipant({
      id: 'bad', owner: 't', participantClass: 'DEVTOOLS', estimatedBytes: () => null,
      evictable: true, rebuildCost: 'FREE', onTrim: () => { throw new Error('boom'); },
    });
    registerMemoryParticipant({
      id: 'good', owner: 't', participantClass: 'DEVTOOLS', estimatedBytes: () => null,
      evictable: true, rebuildCost: 'FREE', onTrim: () => { hit.push('good'); },
    });
    expect(() => _simulateMemoryPressureForTest('MODERATE')).not.toThrow();
    expect(hit).toEqual(['good']);
  });

  it('A6 — söküm thunk’ı katılımcıyı kaydırır (zero-leak)', () => {
    let hits = 0;
    const off = registerMemoryParticipant({
      id: 'x', owner: 't', participantClass: 'DEVTOOLS', estimatedBytes: () => null,
      evictable: true, rebuildCost: 'FREE', onTrim: () => { hits += 1; },
    });
    off();
    _simulateMemoryPressureForTest('CRITICAL');
    expect(hits).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) TRUTH KORUMASI — YAPISAL
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F5/B · truth koruması', () => {
  it('B1 — 🔒 NON_EVICTABLE_TRUTH bir katılımcı SINIFI DEĞİLDİR', () => {
    /* Koruma bir `if` koşuluna değil, TİPE dayanır: canlı araç gerçeğini,
       aktif navigasyonu, medya oturumunu ve güvenlik durumunu kaydetmenin
       YOLU YOKTUR. Kaydedilmeyen şey silinemez. */
    const code = codeOnly(WATCHDOG);
    expect(code).not.toMatch(/NON_EVICTABLE_TRUTH/);
    const classes = WATCHDOG.slice(
      WATCHDOG.indexOf('export type MemoryParticipantClass'),
      WATCHDOG.indexOf(';', WATCHDOG.indexOf('export type MemoryParticipantClass')));
    for (const banned of ['TRUTH', 'VDL', 'NAVIGATION', 'PLAYBACK', 'SECURITY']) {
      expect(classes, banned).not.toContain(banned);
    }
  });

  it('B2 — 🔒 truth sahipleri katılımcı OLARAK KAYDEDİLMEMİŞ', () => {
    for (const f of ['src/platform/vehicleDataLayer/UnifiedVehicleStore.ts',
      'src/platform/navigation/navigationSessionRuntime.ts',
      'src/platform/media/authority/mediaAuthorityRuntime.ts',
      'src/platform/security/authorization.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toContain('registerMemoryParticipant');
      expect(src, f).not.toContain('registerCachePurge');
    }
  });

  it('B3 — 🔒 baskı bir ARIZA DEĞİLDİR (kademe yükselmesi failure üretmez)', () => {
    /* `reportFailure` YALNIZ CRITICAL dalında ve MEVCUT davranıştır;
       yeni kademeler kendi başına arıza sinyali ÜRETMEZ. */
    const applyBody = WATCHDOG.slice(
      WATCHDOG.indexOf('function _applyTrimLevel'),
      WATCHDOG.indexOf('\n}', WATCHDOG.indexOf('function _applyTrimLevel')));
    expect(applyBody).not.toContain('reportFailure');
    expect(applyBody).not.toContain('setMode');
  });

  it('B4 — 🔒 aktif routing/POI DB EN SON kademede feda edilir', () => {
    const svc = readFileSync('src/platform/offlineSearchService.ts', 'utf8');
    expect(svc).toContain("participantClass: 'REBUILDABLE_DERIVED'");
    expect(svc).toContain("rebuildCost: 'EXPENSIVE'");
  });

  it('B5 — 🔒 artwork trim playback’i ETKİLEYEMEZ', () => {
    /* Artwork bir SUNUM katmanıdır; medya oturumu ve çalma durumu
       `mediaService` truth’undadır ve katılımcı değildir. */
    expect(MEDIA).not.toContain('registerMemoryParticipant');
    expect(MEDIA).not.toContain('registerCachePurge');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) GERİ UYUMLULUK VE KATILIMCILAR
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F5/C · katılımcılar', () => {
  it('C1 — eski `registerCachePurge` ÇALIŞMAYA DEVAM eder', () => {
    let purged = 0;
    registerCachePurge(() => { purged += 1; });
    /* Sınıfı bilinmeyen legacy purge en güvenli kademededir: MODERATE’te
       DOKUNULMAZ, yalnız gerçek krizde çağrılır. */
    _simulateMemoryPressureForTest('MODERATE');
    expect(purged).toBe(0);
    _simulateMemoryPressureForTest('CRITICAL');
    expect(purged).toBe(1);
  });

  it('C2 — legacy purge söküm thunk’ı ÇALIŞIR', () => {
    let purged = 0;
    const off = registerCachePurge(() => { purged += 1; });
    off();
    _simulateMemoryPressureForTest('CRITICAL');
    expect(purged).toBe(0);
  });

  it('C3 — gerçek katılımcılar üretim yollarında KAYITLI', () => {
    expect(readFileSync('src/platform/offlineSearchService.ts', 'utf8'))
      .toContain("id: 'poi.searchDatabase'");
    expect(readFileSync('src/platform/debug/debugStore.ts', 'utf8'))
      .toContain("id: 'debug.rings'");
  });

  it('C4 — kanıt ölçülen/bilinmeyen bayt ayrımını RAPORLAR', () => {
    registerMemoryParticipant({
      id: 'm', owner: 't', participantClass: 'DEVTOOLS', estimatedBytes: () => 512,
      evictable: true, rebuildCost: 'FREE', onTrim: () => {},
    });
    registerMemoryParticipant({
      id: 'u', owner: 't', participantClass: 'DEVTOOLS', estimatedBytes: () => null,
      evictable: true, rebuildCost: 'FREE', onTrim: () => {},
    });
    const ev = getMemoryTrimEvidence();
    expect(ev.participantCount).toBe(2);
    expect(ev.measuredByteParticipants).toBe(1);
    expect(ev.participants.find((r) => r.id === 'u')?.estimatedBytes).toBeNull();
  });

  it('C5 — 🔒 UNKNOWN bayt SIFIRA çevrilmez', () => {
    registerMemoryParticipant({
      id: 'nan', owner: 't', participantClass: 'DEVTOOLS',
      estimatedBytes: () => NaN, evictable: true, rebuildCost: 'FREE', onTrim: () => {},
    });
    registerMemoryParticipant({
      id: 'throws', owner: 't', participantClass: 'DEVTOOLS',
      estimatedBytes: () => { throw new Error('x'); },
      evictable: true, rebuildCost: 'FREE', onTrim: () => {},
    });
    const ev = getMemoryTrimEvidence();
    for (const id of ['nan', 'throws']) {
      expect(ev.participants.find((r) => r.id === id)?.estimatedBytes, id).toBeNull();
    }
    expect(ev.measuredByteParticipants).toBe(0);
  });

  it('C6 — merkezî cache DEPOSU kurulmadı', () => {
    const code = codeOnly(WATCHDOG);
    /* Watchdog cache VERİSİ tutmaz — yalnız katılımcı kaydı ve kademe. */
    expect(code).not.toMatch(/cacheData|_caches\s*=\s*new Map<[^>]*unknown/);
    expect(code).not.toMatch(/\.set\(key,\s*value\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) DEPOLAMA — DAYANIKLILIK DEĞİŞMEDİ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F5/D · depolama dayanıklılığı', () => {
  it('D1 — 🔒 debounce penceresi UZATILMADI', () => {
    expect(STORAGE).toContain('WRITE_DEBOUNCE_MS = 5_000');
  });

  it('D2 — 🔒 CRITICAL_SYNC double-lock yolu duruyor', () => {
    expect(STORAGE).toContain('localStorage.setItem(key, value)');
    expect(STORAGE).toContain('await _commitToStorage(key, value');
  });

  it('D3 — dayanıklılık sınıfı MEVCUT kapılardan türer (yeni politika YOK)', () => {
    const body = STORAGE.slice(STORAGE.indexOf('export function storageDurabilityClass'));
    const fn = body.slice(0, body.indexOf('\n}'));
    expect(fn).toContain('IMMEDIATE_WRITE_KEYS');
    expect(fn).toContain('_isCritical');
    /* Sınıf ADLANDIRIR, karar VERMEZ: yeni bir eşik/anahtar listesi yok. */
    expect(fn).not.toMatch(/new Set|push\(|=\s*\[/);
  });

  it('D4 — flush GEREKÇESİ sayılıyor', () => {
    const reasons = getStorageWriteReasons();
    for (const r of ['DEBOUNCE', 'IMMEDIATE', 'EXPLICIT', 'QUOTA', 'UNKNOWN']) {
      expect(Object.keys(reasons), r).toContain(r);
    }
  });

  it('D5 — anahtar DEĞERİ kanıta girmez', () => {
    const evid = STORAGE.slice(STORAGE.indexOf('function _noteFlush'));
    const fn = evid.slice(0, evid.indexOf('\n}'));
    expect(fn).not.toContain('value');
    expect(fn).not.toContain('key');
  });

  it('D6 — dayanıklılık sınıfı doğru cevap verir', () => {
    /* Kritik olmayan bir anahtar normal debounce sınıfındadır. */
    expect(storageDurabilityClass('rastgele-anahtar')).toBe('NORMAL_DEBOUNCED');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   E) ARTWORK — MEVCUT MEKANİZMA KORUNDU (yeniden yazım YOK)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F5/E · artwork', () => {
  it('E1 — 🔒 djb2 hash dedup KORUNDU', () => {
    expect(MEDIA).toContain('_lastArtHash');
    expect(MEDIA).toContain('_lastAccentHash');
    expect(MEDIA).toContain("bumpPerf('artwork.hashDedupHit')");
  });

  it('E2 — 🔒 accent örneklemesi 16×16 downsample KORUNDU', () => {
    expect(MEDIA).toContain('canvas.width = canvas.height = 16');
  });

  it('E3 — 🔒 liste görselleri LAZY yükleniyor (IntersectionObserver)', () => {
    const browser = readFileSync('src/components/media/LocalMusicBrowser.tsx', 'utf8');
    expect(browser).toContain('IntersectionObserver');
    expect(browser).toContain('rootMargin');
  });

  it('E4 — çoklu-decode SORUNU KANITLANMADI → cache KURULMADI', () => {
    /* F5 §5: "Gerçek çoklu decode/RAM problemi KANITLANIRSA ... kur."
       Kanıt yok: ingest’te hash dedup, accent’te downsample, listede lazy
       yükleme var. Ölçülmemiş bir soruna cache yazmak, bilinmeyen bir
       kazanç için bilinen bir karmaşıklık eklemek olurdu. */
    const snap = getPerformanceDiagnosticsSnapshot();
    const art = snap.sections.find((s) => s.sectionId === 'artwork');
    const bytes = art?.metrics.find((m) => m.name === 'artwork.decodedBytes');
    expect(bytes?.kind).toBe('UNMEASURED');
    expect(bytes?.value).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   F) PROFILER — SALT-OKUNUR
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F5/F · profiler kanıtı', () => {
  it('F1 — yeni bölümler mevcut', () => {
    const ids = getPerformanceDiagnosticsSnapshot().sections.map((s) => s.sectionId);
    for (const need of ['memory_pressure', 'storage_durability']) {
      expect(ids, need).toContain(need);
    }
  });

  it('F2 — profiler trim TETİKLEMEZ', () => {
    registerMemoryParticipant({
      id: 'probe', owner: 't', participantClass: 'DEVTOOLS', estimatedBytes: () => 1,
      evictable: true, rebuildCost: 'FREE',
      onTrim: () => { throw new Error('profiler trim tetikledi!'); },
    });
    expect(() => getPerformanceDiagnosticsSnapshot()).not.toThrow();
  });

  it('F3 — toplayıcı memoryWatchdog durumunu DEĞİŞTİRMEZ', () => {
    const before = getMemoryTrimEvidence().currentLevel;
    getPerformanceDiagnosticsSnapshot();
    expect(getMemoryTrimEvidence().currentLevel).toBe(before);
  });

  it('F4 — kademe kanıtı LAB’a taşınıyor', () => {
    const sec = getPerformanceDiagnosticsSnapshot().sections
      .find((s) => s.sectionId === 'memory_pressure');
    expect(sec?.notes.join(' ')).toMatch(/NON_EVICTABLE_TRUTH bir katılımcı OLAMAZ/);
    expect(sec?.notes.join(' ')).toMatch(/Baskı bir ARIZA DEĞİLDİR/);
  });

  it('F5 — F1–F4 bölümleri hâlâ mevcut', () => {
    const ids = getPerformanceDiagnosticsSnapshot().sections.map((s) => s.sectionId);
    for (const need of ['boot', 'render', 'bridge', 'bridge_policy',
      'can_vdl', 'obd', 'gps', 'map', 'timers', 'memory']) {
      expect(ids, need).toContain(need);
    }
  });

  it('F6 — kademe adı LAB notunda GÖRÜNÜR (sahte "sağlıklı" yok)', () => {
    _simulateMemoryPressureForTest('MODERATE');
    const sec = getPerformanceDiagnosticsSnapshot().sections
      .find((s) => s.sectionId === 'memory_pressure');
    expect(sec?.notes.join(' ')).toContain('TRIM_PREFETCH');
    const lvl: MemoryTrimLevel = getMemoryTrimEvidence().currentLevel;
    expect(lvl).toBe('TRIM_PREFETCH');
  });
});
