/**
 * errorLedger.ts — Diagnostics V2 · PR-2: ESKİ/YENİ HATA AYRIMI.
 *
 * PROBLEM (2026-07-14 saha testinde BİREBİR kanıtlandı): `lastErrors` KALICI bir
 * ring buffer — önceki boot'ların hataları (örn. 7 saat önceki OBD:Reconnect
 * timeout / HealthMonitor GPS) mevcut raporu KİRLETİYOR. Mühendis "yeni regresyon"
 * sanıp eski, çözülmüş hatayı kovalıyor.
 *
 * ÇÖZÜM: ham hata listesini dedup + toplulaştır → her imza için
 * {firstSeen, lastSeen, occurrence, bootId, sessionId, activeNow}. Sınır:
 * bu oturumun başlangıç zamanı (sessionStartMs). ts < sessionStartMs → ÖNCEKİ
 * oturum (activeNow:false); ts >= sessionStartMs → BU oturum (activeNow:true).
 *
 * KURALLAR (CLAUDE.md):
 *  - Saf/fail-soft: bozuk/eksik eleman ELENİR, sahte giriş üretilmez. Motor patlamaz.
 *  - PII yok: yalnız ctx + NORMALİZE mesaj (rakam/hex/uuid → '#') taşınır; ham
 *    mesaj temsili olarak kısaltılır (koordinat/VIN/token remoteLogService maskesinden
 *    ayrıca geçer — bu modül yalnız gruplar).
 *  - Bounded: en fazla MAX_ENTRIES grup (lastSeen'e göre en yeni önce).
 *  - Zero-trust saat: ts wall-clock (persist edilen tek zaman) — saat sıçraması
 *    sınırı kaydırabilir; bu yüzden activeNow "kesin kanıt" değil "güçlü sinyal".
 *  - DECOUPLED: hiçbir platform modülü import ETMEZ; girdi şeklini bilir (döngü yok).
 */

/* ── Girdi/çıktı şekli — decoupled ─────────────────────────────── */

/** Ham hata kaydı (lastErrors / lastCritical elemanı) — zero-trust: her alan opsiyonel. */
export interface RawErrorLike {
  ts?: number;
  ctx?: string;
  msg?: string;
  severity?: string;
}

export interface ErrorLedgerEntry {
  /** Bağlam etiketi (örn. "OBD:Reconnect"). */
  ctx: string;
  /** Temsili ham mesaj (en son görülen) — kısaltılmış. */
  message: string;
  /** Dedup imzası: ctx + normalize mesaj (rakam/hex/uuid → '#'). */
  signature: string;
  severity: string;
  /** İlk/son görülme (wall-clock ms). */
  firstSeen: number;
  lastSeen: number;
  /** Bu imzanın toplam görülme sayısı. */
  occurrence: number;
  /** Bu oturumda görüldüyse mevcut bootId, aksi halde null (önceki oturum). */
  bootId: string | null;
  /** Oturum kimliği (bu uygulamada bootId ile aynı kavram). */
  sessionId: string | null;
  /** Bu oturumda (lastSeen >= sessionStartMs) görüldü mü → YENİ regresyon adayı. */
  activeNow: boolean;
}

export interface ErrorLedgerSnapshot {
  /** lastSeen'e göre AZALAN (en yeni önce), bounded. */
  entries: ErrorLedgerEntry[];
  /** Toplam ayrı imza sayısı (bounded öncesi). */
  total: number;
  /** activeNow (bu oturum) imza sayısı. */
  activeNowCount: number;
  /** Bu oturumda görülen imza sayısı (= activeNowCount; okunabilirlik için ayrı). */
  currentBootCount: number;
  /** Yalnız önceki oturum(lar)da görülen imza sayısı. */
  previousBootCount: number;
}

export interface ErrorLedgerContext {
  /** Snapshot anı (Date.now). */
  nowMs: number;
  /** Bu oturumun (app boot) başlangıç zamanı — eski/yeni sınırı. */
  sessionStartMs: number;
  /** Mevcut oturum kimliği (BOOT_ID). */
  bootId: string;
}

/* ── Sabitler ──────────────────────────────────────────────────── */

const MAX_ENTRIES = 24;
const MSG_MAX = 120;

/* ── Normalizasyon ─────────────────────────────────────────────── */

/**
 * Mesajı dedup için normalize eder: değişken parçaları ('36s', '0x1A', uuid)
 * '#' ile sabitler ki "No heartbeat for 36s" ve "...15s" TEK imzada birleşsin.
 * PII (koordinat/VIN/token) de burada rakamlaştıkça körelir — ama asıl maske
 * remoteLogService._deepSanitize'da; bu yalnız gruplama.
 */
function normalizeMsg(msg: string): string {
  return msg
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '#uuid')
    .replace(/0x[0-9a-fA-F]+/g, '0x#')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MSG_MAX);
}

/* ── Motor ─────────────────────────────────────────────────────── */

interface Accum {
  ctx: string;
  message: string;
  signature: string;
  severity: string;
  firstSeen: number;
  lastSeen: number;
  occurrence: number;
}

/**
 * Ham hata listesini eski/yeni-ayrımlı deftere dönüştürür. Saf + fail-soft:
 * geçersiz (obje olmayan / ts sayı olmayan) eleman ATLANIR. sessionStartMs
 * sınırı activeNow'u belirler. Bounded (MAX_ENTRIES).
 */
export function buildErrorLedger(
  errors: readonly RawErrorLike[] | null | undefined,
  context: ErrorLedgerContext,
): ErrorLedgerSnapshot {
  const groups = new Map<string, Accum>();

  if (Array.isArray(errors)) {
    for (const e of errors) {
      if (!e || typeof e !== 'object') continue;
      const ts = typeof e.ts === 'number' && isFinite(e.ts) ? e.ts : NaN;
      if (Number.isNaN(ts)) continue;                 // zamansız kayıt → atla (sahte giriş yok)
      const ctx = typeof e.ctx === 'string' && e.ctx ? e.ctx : '?';
      const rawMsg = typeof e.msg === 'string' ? e.msg : '';
      const severity = typeof e.severity === 'string' && e.severity ? e.severity : 'error';
      const signature = ctx + '|' + normalizeMsg(rawMsg);

      const prev = groups.get(signature);
      if (!prev) {
        groups.set(signature, {
          ctx, message: rawMsg.slice(0, MSG_MAX), signature, severity,
          firstSeen: ts, lastSeen: ts, occurrence: 1,
        });
      } else {
        prev.occurrence++;
        if (ts < prev.firstSeen) prev.firstSeen = ts;
        if (ts >= prev.lastSeen) {                    // en yeni örnek temsil eder
          prev.lastSeen = ts;
          prev.message = rawMsg.slice(0, MSG_MAX);
          prev.severity = severity;
        }
      }
    }
  }

  const { sessionStartMs, bootId } = context;
  let activeNowCount = 0;
  let previousBootCount = 0;

  const entries: ErrorLedgerEntry[] = Array.from(groups.values()).map((g) => {
    const activeNow = g.lastSeen >= sessionStartMs;   // bu oturumda görüldü mü
    if (activeNow) activeNowCount++; else previousBootCount++;
    return {
      ctx: g.ctx,
      message: g.message,
      signature: g.signature,
      severity: g.severity,
      firstSeen: g.firstSeen,
      lastSeen: g.lastSeen,
      occurrence: g.occurrence,
      bootId: activeNow ? bootId : null,
      sessionId: activeNow ? bootId : null,
      activeNow,
    };
  });

  // En yeni önce (mühendis önce güncel/aktif olanı görsün).
  entries.sort((a, b) => b.lastSeen - a.lastSeen);

  return {
    entries: entries.slice(0, MAX_ENTRIES),
    total: entries.length,
    activeNowCount,
    currentBootCount: activeNowCount,
    previousBootCount,
  };
}
