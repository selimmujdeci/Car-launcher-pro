/**
 * memoryWatchdog.ts — Android LMK RAM Baskısı Yöneticisi
 *
 * thermalWatchdog'a paralel mimari:
 *   Native (MainActivity / CarLauncherPlugin)
 *     → onTrimMemory(RUNNING_CRITICAL | MODERATE)
 *     → notifyListeners("memoryPressure", { level })
 *     → JS: _handleMemoryPressure()
 *
 * Seviyeler:
 *   MODERATE  → BASIC_JS (animasyon/blur kapat, cache yarıya indir)
 *   CRITICAL  → SAFE_MODE + reportFailure('RAM') + Worker askıya al + cache boşalt
 *
 * Zero-Leak:
 *   stop() → Capacitor listener + tüm callback'ler temizlenir.
 */

import { Capacitor }    from '@capacitor/core';
import { CarLauncher }  from './nativePlugin';
import { runtimeManager } from '../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode }    from '../core/runtime/runtimeTypes';
/* ARCH-06/F1 — T0 sayaç (tek tamsayı artırımı). Bu satır hiçbir kararı,
   kadansı ya da sahipliği DEĞİŞTİRMEZ. */
import { bumpPerf } from './perf/perfCounters';

/* ── Tipler ──────────────────────────────────────────────────────────────── */

export type MemoryPressureLevel = 'MODERATE' | 'CRITICAL';

export interface MemoryPressureEvent {
  level:  MemoryPressureLevel;
  ts:     number;
}

type MemoryPressureCallback = (evt: MemoryPressureEvent) => void;

/* ── Modül state ─────────────────────────────────────────────────────────── */

let _running   = false;
let _nativeSub: (() => void) | null = null;

const _callbacks = new Set<MemoryPressureCallback>();

/* ══════════════════════════════════════════════════════════════════════════
   ARCH-06/F5 — KADEMELİ BASKI MERDİVENİ VE KATILIMCI SÖZLEŞMESİ
   ══════════════════════════════════════════════════════════════════════════

   ── ÇÖZDÜĞÜ KUSUR ──────────────────────────────────────────────────────
   Önceki davranış İKİLİYDİ: `CRITICAL` gelince kayıtlı TÜM purge
   fonksiyonları AYNI ANDA çağrılıyordu. Bu iki ayrı sorun üretir:

    (1) AŞIRI YIKIM — ucuz bir önyükleme (prefetch) ile pahalı bir arama
        veritabanı aynı anda gider; oysa ilki bedava geri gelir, ikincisi
        yeniden kurulması PAHALIDIR.
    (2) KÖR SIRA — hangi kaynağın ne kadar yer açtığı bilinmediği için
        "en çok yeri açan" değil "listede ilk olan" silinir.

   ── ÇÖZÜM ──────────────────────────────────────────────────────────────
   Native sinyal AYNEN kalır (`MODERATE`/`CRITICAL`) — ikinci bir baskı
   kaynağı KURULMADI. Buradaki kademeler o sinyalden TÜRETİLİR ve katılımcılar
   yalnız KENDİ kademelerinde çağrılır.

   ── OTORİTE DEĞİŞMEDİ ──────────────────────────────────────────────────
   Bu modül trim'i YAPMAZ: katılımcıya "şu kademedeyiz" der, EYLEMİ sahibi
   uygular. Merkezî bir cache deposu KURULMADI.
   ══════════════════════════════════════════════════════════════════════════ */

/** Kademeler — sırası ANLAMLIDIR: küçük numara önce feda edilir. */
export type MemoryTrimLevel =
  /** Baskı yok. */
  | 'NORMAL'
  /** Geliştirici yüzeyleri ve geçmiş halkaları — kullanıcı görmez. */
  | 'TRIM_DEVTOOLS'
  /** Önyükleme; bedava geri gelir (yeniden indirilir). */
  | 'TRIM_PREFETCH'
  /** Sunum önbelleği (decoded görsel, tile RAM). */
  | 'TRIM_PRESENTATION'
  /** Arka plan indeksleme/öğrenme DURUR. */
  | 'PAUSE_BACKGROUND'
  /** Yalnız korunanlar çalışır; yeniden kurulabilir türevler bırakılır. */
  | 'CRITICAL_PROTECT';

/** Merdiven sırası — trim bu sırayla tırmanır. */
const TRIM_LADDER: readonly MemoryTrimLevel[] = Object.freeze([
  'NORMAL', 'TRIM_DEVTOOLS', 'TRIM_PREFETCH',
  'TRIM_PRESENTATION', 'PAUSE_BACKGROUND', 'CRITICAL_PROTECT',
]);

/**
 * Kaynağın bellek sınıfı. `NON_EVICTABLE_TRUTH` bilinçli olarak BURADA
 * TANIMLI DEĞİLDİR: o sınıf bir katılımcı OLAMAZ — kaydedilemeyen şey
 * silinemez de. Koruma böylece yapısal olur, bir `if` koşuluna bağlı kalmaz.
 */
export type MemoryParticipantClass =
  | 'DEVTOOLS' | 'PREFETCH_CACHE' | 'PRESENTATION_CACHE'
  | 'BACKGROUND_WORK' | 'REBUILDABLE_DERIVED';

/** Sınıf → o sınıfın feda edildiği İLK kademe. */
const CLASS_TRIGGER: Readonly<Record<MemoryParticipantClass, MemoryTrimLevel>> = Object.freeze({
  DEVTOOLS:           'TRIM_DEVTOOLS',
  PREFETCH_CACHE:     'TRIM_PREFETCH',
  PRESENTATION_CACHE: 'TRIM_PRESENTATION',
  BACKGROUND_WORK:    'PAUSE_BACKGROUND',
  REBUILDABLE_DERIVED:'CRITICAL_PROTECT',
});

export type MemoryRebuildCost = 'FREE' | 'CHEAP' | 'EXPENSIVE' | 'NETWORK_REQUIRED' | 'UNKNOWN';

export interface MemoryParticipant {
  readonly id: string;
  readonly owner: string;
  readonly participantClass: MemoryParticipantClass;
  /**
   * Ucuz bir boyut tahmini. **Ölçülemiyorsa `null` DÖNER — 0 DÖNMEZ.**
   * Pahalı bir sayım yapan sağlayıcı, ölçmek istediğimiz maliyeti üretir.
   */
  readonly estimatedBytes: () => number | null;
  readonly evictable: boolean;
  readonly rebuildCost: MemoryRebuildCost;
  /** Kademe geldiğinde SAHİBİN uyguladığı eylem. */
  readonly onTrim: (level: MemoryTrimLevel) => void;
}

interface ParticipantRecord {
  readonly p: MemoryParticipant;
  lastAction: MemoryTrimLevel | null;
  lastActionAt: number | null;
  trimCount: number;
}

const _participants = new Map<string, ParticipantRecord>();
let _currentLevel: MemoryTrimLevel = 'NORMAL';
let _lastPressureAt: number | null = null;

/**
 * Bir cache/arka plan sahibini baskı merdivenine kaydeder.
 *
 * ⚠️ `NON_EVICTABLE_TRUTH` bir kaynak BURAYA KAYDEDİLMEZ: canlı araç
 * gerçeği, aktif navigasyon oturumu, medya oturumu ve güvenlik durumu
 * silinemez. Kaydedilmemek, korunmanın YAPISAL biçimidir.
 *
 * @returns kaydı sökeni thunk (zero-leak)
 */
export function registerMemoryParticipant(p: MemoryParticipant): () => void {
  _participants.set(p.id, { p, lastAction: null, lastActionAt: null, trimCount: 0 });
  return () => { _participants.delete(p.id); };
}

/**
 * GERİ UYUMLULUK: mevcut `registerCachePurge` çağıranları BOZULMAZ.
 *
 * Kayıtsız bir purge fonksiyonunun sınıfı bilinmez; en güvenli varsayım
 * onu `CRITICAL_PROTECT` kademesine koymaktır — yani ESKİ davranıştaki gibi
 * yalnız gerçek krizde çağrılır, ama artık MODERATE'te de tetiklenmez.
 */
export function registerCachePurge(fn: () => void): () => void {
  const id = `legacy:${_legacySeq++}`;
  return registerMemoryParticipant({
    id,
    owner: 'legacy registerCachePurge',
    participantClass: 'REBUILDABLE_DERIVED',
    estimatedBytes: () => null,
    evictable: true,
    rebuildCost: 'UNKNOWN',
    onTrim: () => { fn(); },
  });
}
let _legacySeq = 0;

/** Bir kademe, katılımcının sınıfını feda ediyor mu. */
function _levelReaches(level: MemoryTrimLevel, cls: MemoryParticipantClass): boolean {
  const at = TRIM_LADDER.indexOf(level);
  const trigger = TRIM_LADDER.indexOf(CLASS_TRIGGER[cls]);
  return at >= 0 && trigger >= 0 && at >= trigger;
}

/**
 * Kademeyi uygular — SIRAYLA ve YALNIZ ilgili sınıflara.
 *
 * `estimatedBytes === null` olan katılımcı, aynı kademedeki ölçülmüş
 * katılımcılardan SONRA çağrılır: bilinmeyeni önce silmek, ne kadar yer
 * açtığını bilmeden pahalı bir şeyi yok etmek olabilir.
 */
function _applyTrimLevel(level: MemoryTrimLevel): void {
  _currentLevel = level;
  _lastPressureAt = Date.now();
  if (level === 'NORMAL') return;

  const due: ParticipantRecord[] = [];
  for (const rec of _participants.values()) {
    if (_levelReaches(level, rec.p.participantClass)) due.push(rec);
  }
  /* Ölçülmüş olanlar ÖNCE (büyükten küçüğe), ölçülemeyenler SONRA. */
  due.sort((a, b) => {
    let ba: number | null = null; let bb: number | null = null;
    try { ba = a.p.estimatedBytes(); } catch { ba = null; }
    try { bb = b.p.estimatedBytes(); } catch { bb = null; }
    if (ba === null && bb === null) return 0;
    if (ba === null) return 1;
    if (bb === null) return -1;
    return bb - ba;
  });

  for (const rec of due) {
    try {
      rec.p.onTrim(level);
      rec.lastAction = level;
      rec.lastActionAt = Date.now();
      rec.trimCount += 1;
    } catch { /* bir sahibin hatası merdiveni DURDURMAZ */ }
  }
}

export interface MemoryTrimEvidence {
  readonly currentLevel: MemoryTrimLevel;
  readonly lastPressureAt: number | null;
  readonly participantCount: number;
  /** Bayt ölçümü OLAN katılımcı adedi — dürüstlük göstergesi. */
  readonly measuredByteParticipants: number;
  readonly participants: readonly {
    readonly id: string;
    readonly owner: string;
    readonly participantClass: MemoryParticipantClass;
    readonly estimatedBytes: number | null;
    readonly evictable: boolean;
    readonly rebuildCost: MemoryRebuildCost;
    readonly trimLevel: MemoryTrimLevel;
    readonly lastAction: MemoryTrimLevel | null;
    readonly trimCount: number;
  }[];
  readonly ladder: readonly MemoryTrimLevel[];
}

/** Salt-okunur kanıt. Hiçbir şeyi trim ETMEZ. */
export function getMemoryTrimEvidence(): MemoryTrimEvidence {
  const rows: MemoryTrimEvidence['participants'][number][] = [];
  let measured = 0;
  for (const rec of _participants.values()) {
    let bytes: number | null = null;
    try {
      const v = rec.p.estimatedBytes();
      bytes = typeof v === 'number' && Number.isFinite(v) ? v : null;
    } catch { bytes = null; }
    if (bytes !== null) measured += 1;
    rows.push(Object.freeze({
      id: rec.p.id, owner: rec.p.owner,
      participantClass: rec.p.participantClass,
      estimatedBytes: bytes,
      evictable: rec.p.evictable,
      rebuildCost: rec.p.rebuildCost,
      trimLevel: CLASS_TRIGGER[rec.p.participantClass],
      lastAction: rec.lastAction,
      trimCount: rec.trimCount,
    }));
  }
  return Object.freeze({
    currentLevel: _currentLevel,
    lastPressureAt: _lastPressureAt,
    participantCount: _participants.size,
    measuredByteParticipants: measured,
    participants: Object.freeze(rows),
    ladder: TRIM_LADDER,
  });
}

/** Kademe merdiveni (test ve LAB için). */
export function memoryTrimLadder(): readonly MemoryTrimLevel[] { return TRIM_LADDER; }

/** @internal YALNIZ TEST. */
export function _resetMemoryParticipantsForTest(): void {
  _participants.clear();
  _currentLevel = 'NORMAL';
  _lastPressureAt = null;
}

/* ── Core handler ────────────────────────────────────────────────────────── */

function _handleMemoryPressure(level: MemoryPressureLevel): void {
  const evt: MemoryPressureEvent = { level, ts: Date.now() };

  if (level === 'CRITICAL') {
    // Anlık SAFE_MODE geçişi + arıza sinyal
    runtimeManager.setMode(RuntimeMode.SAFE_MODE, 'Memory Pressure');
    runtimeManager.reportFailure('RAM');
    // OPTIONAL worker'ları sonlandır (VisionCompute, NavigationCompute)
    runtimeManager.handleMemoryPressure('CRITICAL');
    /* ARCH-06/F5: merdiven TEPEYE tırmanır — ama artık "hepsini birden sil"
       DEĞİL: `_applyTrimLevel` her sınıfı KENDİ kademesinde ve ölçülmüş
       boyut sırasına göre çağırır. Canlı araç gerçeği, aktif navigasyon,
       medya oturumu ve güvenlik durumu KATILIMCI OLAMAZ → yapısal olarak
       korunur. */
    _applyTrimLevel('CRITICAL_PROTECT');

  } else if (level === 'MODERATE') {
    // Hafif baskı: animasyon/blur kapat, OPTIONAL worker'ları sonlandır
    runtimeManager.setMode(RuntimeMode.BASIC_JS, 'Memory Moderate');
    runtimeManager.handleMemoryPressure('MODERATE');
    /* ARCH-06/F5: ÖNCEKİ davranışta MODERATE hiçbir cache'e dokunmuyordu ve
       tüm yük CRITICAL'a bırakılıyordu. Artık ucuz ve kullanıcı-görünmez
       olanlar burada bırakılır: geliştirici yüzeyleri ve önyükleme. Sunum
       önbelleği ve arka plan işleri BU KADEMEDE DOKUNULMAZ. */
    _applyTrimLevel('TRIM_PREFETCH');
  }

  // Aboneleri bildir (VisionAROverlay, bileşenler)
  _callbacks.forEach(cb => { try { cb(evt); } catch { /* sessiz */ } });
}

/* ── Public API ──────────────────────────────────────────────────────────── */

/**
 * Memory watchdog'u başlatır. İdempotent.
 * Native platformda CarLauncher'ı dinler; web'de no-op.
 */
export function startMemoryWatchdog(): void {
  if (_running) return;
  _running = true;

  if (!Capacitor.isNativePlatform()) return; // web modda native event yok

  // Capacitor plugin event listener
  CarLauncher.addListener('memoryPressure', (data: { level?: string }) => {
    bumpPerf('bridge.memoryPressure.received');
    const raw = data?.level;
    if (raw === 'CRITICAL' || raw === 'MODERATE') {
      _handleMemoryPressure(raw as MemoryPressureLevel);
    }
  }).then(listener => {
    _nativeSub = () => listener.remove();
  }).catch(() => { /* eski plugin versiyonu — sessiz */ });
}

/**
 * Watchdog'u durdurur ve tüm listener'ları temizler.
 * Zero-Leak garantisi.
 */
export function stopMemoryWatchdog(): void {
  if (!_running) return;
  _running = false;

  _nativeSub?.();
  _nativeSub = null;
  _callbacks.clear();
  _participants.clear();
  _currentLevel = 'NORMAL';
}

/**
 * RAM baskısı olaylarına abone ol.
 * @returns  Aboneliği iptal eden thunk — useEffect cleanup'ında kullan.
 */
export function onMemoryPressure(cb: MemoryPressureCallback): () => void {
  _callbacks.add(cb);
  return () => { _callbacks.delete(cb); };
}

/** Aktif RAM baskısı seviyesini test veya debug için simüle et. */
export function _simulateMemoryPressureForTest(level: MemoryPressureLevel): void {
  _handleMemoryPressure(level);
}
