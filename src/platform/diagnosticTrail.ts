/**
 * diagnosticTrail.ts — merkezi olay izi (breadcrumb) · "soruna ne yol açtı".
 *
 * GENİŞLİK BACKBONE'U (kullanıcı: rapor herhangi bir sınıf sorunu yakalayacak
 * genişlikte olsun). Tanı raporuna, sorunun ÖNCESİNDEKİ olayların KRONOLOJİK
 * hikâyesini ekler — böylece "modal zamansız açıldı", "sürüşe geçince kasma
 * oldu", "OBD kopunca hata patladı" gibi NEDEN-SONUÇ zincirleri görülebilir.
 *
 * MERKEZİ + DÜŞÜK-TEMAS: her alt sisteme dokunmaz. Kendi halka tamponuna
 * doğrudan yazılanlar (mod/ekran/aksiyon) + snapshot anında BİRLEŞTİRİLEN
 * mevcut kaynaklar (crashLogger hataları + uiActivityRecorder modal olayları).
 * Hepsi Date.now damgalı → tek zaman çizgisinde harmanlanır.
 *
 * PII yok: yalnız olay türü + kısa etiket (konum/VIN/plaka/MAC yok).
 */

import { useUnifiedVehicleStore } from './vehicleDataLayer/UnifiedVehicleStore';
import { getOBDStatusSnapshot }   from './obdService';
import { getErrorLog }            from './crashLogger';
import { getUiActivitySnapshot }  from './uiActivityRecorder';
import {
  type TrailEvent, type TrailKind, pushOwn, getOwnTrail, resetOwnTrail,
} from './diagnosticTrailCore';
import { safeGetRaw, safeSetRaw, safeRemoveRaw, safeFlushKey } from '../utils/safeStorage';

// Yazma yolu (pushTrail) çekirdekten re-export edilir — geriye dönük uyumluluk;
// AMA üreticiler (voiceService/media) doğrudan `diagnosticTrailCore`'dan import
// etmeli ki ağır obd/store zinciri modül grafiğine girmesin.
export { pushTrail } from './diagnosticTrailCore';
export type { TrailEvent, TrailKind } from './diagnosticTrailCore';

/* ── Modül durumu ───────────────────────────────────────────── */

const MAX_OUT = 60;   // dışa verilen birleşik iz uzunluğu
// 🔴 HİSTEREZİS + DWELL (SAHA 2026-07-06): tek eşik (speed>5) hız 5 civarı
// titreyince (GPS gürültüsü / durağan araç) ~1-2sn'de bir "sürüş↔park" satırı
// üretip izi BOĞUYORDU (sinyal kaybı). Bant (ON≥8, OFF≤3) küçük jitter'ı yutar;
// min-dwell son mod-logundan bu yana 4sn geçmeden yeni geçiş YAZMAZ → iz
// yalnız ANLAMLI mod değişimini gösterir.
const DRIVE_ON_KMH  = 8;
const DRIVE_OFF_KMH = 3;
const MODE_DWELL_MS = 4_000;

let _installed = false;
let _unsub: (() => void) | null = null;

// Geçiş tespiti için önceki durum
let _prevReverse = false;
let _prevDriving = false;
let _lastModeMono = Number.NEGATIVE_INFINITY;  // son mod-logunun monotonik damgası (dwell throttle)

function _mono(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now() : Date.now();
}
let _prevObdSource = 'none';

/* ── Kurulum ────────────────────────────────────────────────── */

/**
 * İzi başlatır. SystemBoot Wave 1'de çağrılır. Store'a abone olup mod/OBD
 * geçişlerini kaydeder. İdempotent; dönen cleanup aboneliği söker (zero-leak).
 */
export function startDiagnosticTrail(): () => void {
  if (_installed) return () => { /* zaten kurulu */ };
  _installed = true;
  // Önceki oturumun izini ÖNCE yükle: "boot başladı" satırı yeni oturumu açar,
  // ondan önceki her şey geçen oturuma aittir (zaman çizgisi karışmaz).
  loadPreviousDiagnosticTrail();
  pushOwn('boot', 'boot başladı');

  try {
    const st = useUnifiedVehicleStore.getState();
    _prevReverse = st.reverse;
    _prevDriving = (st.speed ?? 0) >= DRIVE_ON_KMH;
    _prevObdSource = safeObdSource();
  } catch { /* fail-soft */ }

  try {
    _unsub = useUnifiedVehicleStore.subscribe((state) => {
      // Geri vites geçişi
      if (state.reverse !== _prevReverse) {
        _prevReverse = state.reverse;
        pushOwn('mode', state.reverse ? 'geri vitese geçildi' : 'geri vites bırakıldı');
      }
      // Sürüş/park geçişi — histerezis bandı (ON≥8, OFF≤3) + min-dwell throttle
      // (eşik jitter'ı izi boğmasın; yalnız SÜRDÜRÜLEN geçiş yazılır).
      const spd = state.speed ?? 0;
      let driving = _prevDriving;
      if (!_prevDriving && spd >= DRIVE_ON_KMH)      driving = true;
      else if (_prevDriving && spd <= DRIVE_OFF_KMH) driving = false;
      if (driving !== _prevDriving) {
        const now = _mono();
        if (now - _lastModeMono >= MODE_DWELL_MS) {
          _prevDriving  = driving;
          _lastModeMono = now;
          pushOwn('mode', driving ? 'sürüşe geçildi' : 'durdu/park');
        }
        // dwell dolmadıysa geçişi YAZMA + _prevDriving'i çevirme → titreme yutulur
      }
      // OBD kaynak değişimi (bağlan/kopma) — getOBDStatusSnapshot ucuz (cache)
      const src = safeObdSource();
      if (src !== _prevObdSource) {
        pushOwn('obd', `OBD kaynak: ${_prevObdSource} → ${src}`);
        _prevObdSource = src;
      }
      // Kalıcılaştırma yalnız ANLAMLI geçiş anlarında denenir ve kendi 30 sn
      // penceresi vardır → hot-path'te (3Hz sinyal akışı) disk yazması OLMAZ.
      persistDiagnosticTrail();
    });
  } catch { /* fail-soft — abonelik kurulamazsa iz yine manuel/merge çalışır */ }

  return () => {
    if (_unsub) { _unsub(); _unsub = null; }
    // Tamponu SİLMEDEN ÖNCE diske yaz (immediate: kapanışta debounce beklenmez) —
    // aksi hâlde kapanış anındaki en değerli son olaylar kaybolurdu.
    persistDiagnosticTrail(true);
    resetOwnTrail();
    _lastModeMono = Number.NEGATIVE_INFINITY;
    _installed = false;
  };
}

function safeObdSource(): string {
  try { return getOBDStatusSnapshot().source; } catch { return 'none'; }
}

/* ══════════════════════════════════════════════════════════════════════════
 * ÖNCEKİ OTURUM İZİ — kalıcılık (#125)
 *
 * KÖK: iz yalnız RAM halkasındaydı; uygulama kapanınca "soruna ne yol açtı"
 * hikâyesi SİLİNİYORDU. Çöküş/yeniden başlatma sonrası tanı raporu boş kalıyordu —
 * yani en çok ihtiyaç duyulan anda kanıt yoktu.
 *
 * SINIRLAR (CLAUDE.md §3 I/O + gizlilik):
 *  · eMMC AŞINMASI: yazma `safeSetRaw` debounce'una devredilir (varsayılan pencere);
 *    ayrıca {@link TRAIL_PERSIST_DEBOUNCE_MS} altında İKİNCİ yazma HİÇ denenmez.
 *    Yazma yalnız `startDiagnosticTrail` cleanup'ında ve mod/OBD geçişlerinde tetiklenir —
 *    hot-path'te (3Hz sinyal) YAZMA YOKTUR.
 *  · BOUNDED: diske en fazla {@link MAX_PERSISTED} olay yazılır (en yeniler).
 *  · PII YOK: yalnız zaten PII'siz olan `kind`/`label`/`detail` taşınır; kayıt
 *    okunurken de alan alan doğrulanır (bozuk/şişmiş kayıt REDDEDİLİR).
 *  · FAIL-SOFT: disk okuma/yazma hatası izi ÇALIŞMAZ HÂLE GETİRMEZ (RAM devam eder).
 * ════════════════════════════════════════════════════════════════════════ */

const TRAIL_STORAGE_KEY = 'caros-diagnostic-trail-prev';
/** Diske yazılan azami olay (en yeniler). */
export const MAX_PERSISTED = 50;
/** İki disk yazması arası asgari süre (monotonik) — eMMC koruması. */
export const TRAIL_PERSIST_DEBOUNCE_MS = 30_000;
/** Tek etiket/detay uzunluk tavanı (şişmiş kayıt diske gitmesin). */
const MAX_LABEL = 80;
const MAX_DETAIL = 160;

const VALID_KINDS: ReadonlySet<string> = new Set<TrailKind>([
  'boot', 'mode', 'screen', 'obd', 'action', 'error', 'modal',
]);

/** Önceki oturumdan geri yüklenen iz — RAM halkasına KARIŞTIRILMAZ, ayrı tutulur. */
let _previousSession: TrailEvent[] = [];
let _lastPersistMono = Number.NEGATIVE_INFINITY;

/** Diske yazılacak/okunacak tek olayı doğrular + kırpar. Geçersiz → null (atılır). */
function _sanitizeEvent(raw: unknown): TrailEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const ts = typeof e.ts === 'number' && Number.isFinite(e.ts) && e.ts > 0 ? e.ts : null;
  const kind = typeof e.kind === 'string' && VALID_KINDS.has(e.kind) ? (e.kind as TrailKind) : null;
  const label = typeof e.label === 'string' ? e.label.slice(0, MAX_LABEL) : null;
  if (ts === null || kind === null || label === null) return null;   // sahte damga/tür UYDURULMAZ
  const detail = typeof e.detail === 'string' ? e.detail.slice(0, MAX_DETAIL) : undefined;
  return detail !== undefined ? { ts, kind, label, detail } : { ts, kind, label };
}

/**
 * Mevcut RAM izini diske yazar (debounce'lu). `immediate=true` yalnız cleanup/
 * kapanış yolunda kullanılır — pencere beklemeden yazar.
 * @returns gerçekten yazma denendi mi (teşhis/test için).
 */
export function persistDiagnosticTrail(immediate = false): boolean {
  try {
    const now = _mono();
    if (!immediate && now - _lastPersistMono < TRAIL_PERSIST_DEBOUNCE_MS) return false;
    const events = getOwnTrail()
      .slice(-MAX_PERSISTED)
      .map(_sanitizeEvent)
      .filter((e): e is TrailEvent => e !== null);
    if (events.length === 0) return false;          // boş iz diske YAZILMAZ
    _lastPersistMono = now;
    safeSetRaw(TRAIL_STORAGE_KEY, JSON.stringify(events));
    if (immediate) safeFlushKey(TRAIL_STORAGE_KEY);  // kapanışta debounce'u bekleme
    return true;
  } catch {
    return false;                                    // disk hatası izi durdurmaz
  }
}

/**
 * Önceki oturumun izini diskten yükler. RAM halkasına KARIŞTIRILMAZ — böylece
 * "bu oturumda olan" ile "geçen oturumda olan" birbirine geçmez; okuma yolu
 * (`getDiagnosticTrail`) ikisini damgaya göre harmanlar.
 * @returns yüklenen olay sayısı (0 = kayıt yok veya bozuk).
 */
export function loadPreviousDiagnosticTrail(): number {
  try {
    const raw = safeGetRaw(TRAIL_STORAGE_KEY);
    if (!raw) return 0;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return 0;
    _previousSession = parsed
      .slice(-MAX_PERSISTED)
      .map(_sanitizeEvent)
      .filter((e): e is TrailEvent => e !== null);
    return _previousSession.length;
  } catch {
    _previousSession = [];                           // bozuk kayıt → yok say (çökme YOK)
    return 0;
  }
}

/** Önceki oturum izinin kopyası (teşhis/test). */
export function getPreviousDiagnosticTrail(): TrailEvent[] {
  return [..._previousSession];
}

/* ── Okuma: birleşik kronolojik iz (tanı payload'ı) ──────────── */

/**
 * Kendi izini + crashLogger hatalarını + modal olaylarını TEK zaman çizgisinde
 * harmanlar, son MAX_OUT olayı döndürür (kronolojik).
 */
export function getDiagnosticTrail(): TrailEvent[] {
  // Önceki oturum + bu oturum tek çizgide. Damgalar Date.now olduğu için sıralama
  // doğal olarak eskiyi öne alır; MAX_OUT kırpması EN YENİLERİ tutar → geçen oturum
  // ancak bu oturum kısaysa görünür (istenen davranış: yakın geçmiş öncelikli).
  const merged: TrailEvent[] = [..._previousSession, ...getOwnTrail()];

  // Hatalar (tümü — critical dışı dahil)
  try {
    for (const e of getErrorLog()) {
      merged.push({
        ts: e.ts, kind: 'error',
        label: `[${e.severity ?? 'error'}] ${String(e.ctx).slice(0, 40)}`,
        detail: String(e.msg).slice(0, 120),
      });
    }
  } catch { /* fail-soft */ }

  // Modal/overlay olayları (uiActivityRecorder)
  try {
    for (const m of getUiActivitySnapshot().recent) {
      merged.push({
        ts: m.ts, kind: 'modal',
        label: `${m.action === 'open' ? 'modal açıldı' : 'modal kapandı'}${m.untimely ? ' ⚠ZAMANSIZ' : ''}`,
        detail: `${m.desc}${m.reasons.length ? ' [' + m.reasons.join(',') + ']' : ''}`,
      });
    }
  } catch { /* fail-soft */ }

  merged.sort((a, b) => a.ts - b.ts);
  return merged.slice(-MAX_OUT);
}

/** @internal testler için. */
export function _resetDiagnosticTrailForTest(): void {
  resetOwnTrail();
  _prevReverse = false;
  _prevDriving = false;
  _lastModeMono = Number.NEGATIVE_INFINITY;
  _prevObdSource = 'none';
  _previousSession = [];
  _lastPersistMono = Number.NEGATIVE_INFINITY;
  try { safeRemoveRaw(TRAIL_STORAGE_KEY); } catch { /* test izolasyonu fail-soft */ }
}
