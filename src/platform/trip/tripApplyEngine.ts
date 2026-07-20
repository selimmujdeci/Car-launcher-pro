/**
 * tripApplyEngine — MAVI 4.0 · TRIP AI · ATOMİK GÖREV MAVI4-TRIP-5
 *
 * TRIP-4 yalnız preview ÜRETTİ. Bu katman, kullanıcı AÇIK onay verdiğinde preview'i
 * GÜVENLİ şekilde aktif rotaya uygular ve her adımı geri alınabilir tutar:
 *   beginPreview → applyPreview → (resumeOriginal | rollback) · cancelPreview.
 *
 * SÖZLEŞME:
 *   • Store YALNIZ bu katmanda güncellenir — enjekte edilen RouteStoreAdapter üzerinden.
 *     (useRouteStore routingService içinde private; production adapter'ı yan-etkili wiring
 *     katmanında bağlanır — bu PR hiçbir mevcut dosyayı değiştirmez.)
 *   • TRIP-4 Preview Engine SAF kalır — bu modül onu import eder, DEĞİŞTİRMEZ.
 *   • Apply yalnız EXPLICIT kullanıcı onayıyla çalışır. Voice TEK BAŞINA rota değiştiremez.
 *   • AiSafetyGate KORUNUR: rota-apply bir ECU eylemi DEĞİLDİR (gate'in kapsamı ecu_write/
 *     coding/actuator…); bu katman hiçbir araç kapsamı talep etmez, dolayısıyla gate'i baypas
 *     edecek bir yol açmaz. Navigasyon-güvenlik kararı enjekte edilen `safetyCheck` ile fail-closed.
 *   • Yeni routing algoritması YOK · UI YOK · Voice entegrasyonu YOK · Diagnostic YOK.
 *
 * Preview geçersiz/bayat → Apply REDDEDİLİR. Snapshot immutable (deep-frozen) — apply öncesi
 * orijinal rota kayıt altına alınır; resume/rollback onu birebir geri yükler.
 */

import type { TripPreview } from './tripPreviewEngine';

/* ── Store sözleşmesi (DI) ───────────────────────────────────────────────── */

export interface ActiveRoute {
  geometry:   [number, number][]; // [lon, lat][]
  distanceM:  number;
  durationS:  number;
  etaEpochMs: number;             // aktif varış tahmini
  /** Taşınan opak alanlar (steps/serverUsed… — bu katman içeriğini yorumlamaz). */
  meta?:      Readonly<Record<string, unknown>>;
}

export interface RouteStoreAdapter {
  getActiveRoute(): ActiveRoute | null;
  setActiveRoute(route: ActiveRoute): void;
}

/* ── Onay & güvenlik ─────────────────────────────────────────────────────── */

export interface ApplyConfirmation {
  /** Kullanıcının AÇIK onayı. false → Apply reddedilir. */
  confirmed: boolean;
  /** Onay kaynağı. 'voice' TEK BAŞINA rota değiştiremez → reddedilir. */
  source?: 'user' | 'voice' | string;
}

export interface TripApplyDeps {
  store: RouteStoreAdapter;
  /** Test/enjekte edilebilir saat. Varsayılan Date.now. */
  now?: () => number;
  /** Preview azami yaşı (ms). Bu süreyi aşan preview bayat sayılır. Varsayılan 120 sn. */
  maxPreviewAgeMs?: number;
  /**
   * Navigasyon-güvenlik kapısı (fail-closed). Sürüş/bilişsel duruma göre apply'ı vetolar.
   * Verilmezse izinli kabul edilir. AiSafetyGate (ECU) burada DEĞİL — o ayrı ve dokunulmaz.
   */
  safetyCheck?: () => { allowed: boolean; reason?: string };
}

/* ── Snapshot (immutable) ────────────────────────────────────────────────── */

export interface RouteSnapshot {
  readonly route:     ActiveRoute; // deep-frozen kopya
  readonly takenAt:   number;
  readonly signature: string;
}

/* ── Sonuç kodları ───────────────────────────────────────────────────────── */

export type BeginResultCode = 'PREVIEW_READY' | 'INVALID_PREVIEW' | 'NO_ACTIVE_ROUTE';
export interface BeginResult { code: BeginResultCode; previewId?: string; }

export type ApplyResultCode =
  | 'APPLIED'
  | 'NO_PENDING_PREVIEW'
  | 'ALREADY_APPLIED'
  | 'INVALID_PREVIEW'
  | 'EXPIRED'
  | 'NOT_CONFIRMED'
  | 'VOICE_NOT_ALLOWED'
  | 'SAFETY_BLOCKED'
  | 'NO_ACTIVE_ROUTE';
export interface ApplyResult { code: ApplyResultCode; applied: boolean; reason?: string; }

export type RestoreResultCode = 'RESUMED' | 'ROLLED_BACK' | 'NOTHING_TO_RESTORE';
export interface RestoreResult { code: RestoreResultCode; restored: boolean; }

export type CancelResultCode = 'CANCELLED' | 'NOTHING_TO_CANCEL';
export interface CancelResult { code: CancelResultCode; }

/* ── Saf yardımcılar ─────────────────────────────────────────────────────── */

function isApplicablePreview(p: TripPreview | null | undefined): p is TripPreview {
  return !!p
    && p.isValid === true
    && p.errorCategory === 'NONE'
    && Array.isArray(p.previewRoute) && p.previewRoute.length >= 2
    && Number.isFinite(p.previewDistance) && Number.isFinite(p.previewDuration)
    && Number.isFinite(p.previewETA);
}

function routeSignature(r: ActiveRoute): string {
  const g = r.geometry;
  const n = g.length;
  const f = g[0]; const l = g[n - 1];
  return `${n}:${f[0]},${f[1]}:${l[0]},${l[1]}:${r.distanceM}:${r.durationS}`;
}

/** Derin kopya — geometri noktaları dahil yeni referanslar. */
function cloneRoute(r: ActiveRoute): ActiveRoute {
  return {
    geometry:   r.geometry.map(p => [p[0], p[1]] as [number, number]),
    distanceM:  r.distanceM,
    durationS:  r.durationS,
    etaEpochMs: r.etaEpochMs,
    meta:       r.meta ? { ...r.meta } : undefined,
  };
}

/** Derin dondur — snapshot'ın apply sonrası mutasyona karşı korunması. */
function deepFreezeRoute(r: ActiveRoute): ActiveRoute {
  for (const p of r.geometry) Object.freeze(p);
  Object.freeze(r.geometry);
  if (r.meta) Object.freeze(r.meta);
  return Object.freeze(r);
}

interface PendingPreview {
  readonly id:            string;
  readonly preview:       TripPreview;
  readonly baseSignature: string;      // preview'in türetildiği aktif rota imzası
  readonly snapshot:      RouteSnapshot;
  readonly createdAt:     number;
}

/* ── Motor ───────────────────────────────────────────────────────────────── */

export class TripApplyEngine {
  private readonly _store: RouteStoreAdapter;
  private readonly _now: () => number;
  private readonly _maxAgeMs: number;
  private readonly _safetyCheck?: () => { allowed: boolean; reason?: string };

  private _pending: PendingPreview | null = null;
  private _applied = false;
  private _appliedSnapshot: RouteSnapshot | null = null;
  private _seq = 0;

  constructor(deps: TripApplyDeps) {
    this._store = deps.store;
    this._now = deps.now ?? (() => Date.now());
    this._maxAgeMs = Number.isFinite(deps.maxPreviewAgeMs) ? (deps.maxPreviewAgeMs as number) : 120_000;
    this._safetyCheck = deps.safetyCheck;
  }

  get isApplied(): boolean { return this._applied; }
  get hasPending(): boolean { return this._pending !== null; }

  /**
   * Preview oturumunu başlatır: aktif rotayı immutable snapshot'lar, imzasını sabitler.
   * Store'u DEĞİŞTİRMEZ — yalnız hazırlık.
   */
  beginPreview(preview: TripPreview): BeginResult {
    if (!isApplicablePreview(preview)) return { code: 'INVALID_PREVIEW' };

    const active = this._store.getActiveRoute();
    if (!active || !Array.isArray(active.geometry) || active.geometry.length < 2) {
      return { code: 'NO_ACTIVE_ROUTE' };
    }

    const snapRoute = deepFreezeRoute(cloneRoute(active));
    const snapshot: RouteSnapshot = Object.freeze({
      route:     snapRoute,
      takenAt:   this._now(),
      signature: routeSignature(snapRoute),
    });

    const id = `pv_${++this._seq}`;
    this._pending = {
      id,
      preview,
      baseSignature: snapshot.signature,
      snapshot,
      createdAt: this._now(),
    };
    return { code: 'PREVIEW_READY', previewId: id };
  }

  /**
   * Preview'i aktif rotaya uygular — YALNIZ açık kullanıcı onayıyla, fail-closed.
   * Reddetme sırası: bekleyen yok → zaten uygulandı → onay → voice → güvenlik → geçerlilik →
   * güncellik(bayat/imza). Ancak geçerli+onaylı+güncel ise store güncellenir.
   */
  applyPreview(previewId: string, confirmation: ApplyConfirmation): ApplyResult {
    // Zaten uygulanmış bir preview varken yeni apply yok — önce resume/rollback gerekir.
    if (this._applied) return { code: 'ALREADY_APPLIED', applied: true };
    const pending = this._pending;
    if (!pending || pending.id !== previewId) return { code: 'NO_PENDING_PREVIEW', applied: false };

    // Açık kullanıcı onayı zorunlu; voice tek başına yasak.
    if (!confirmation || confirmation.confirmed !== true) return { code: 'NOT_CONFIRMED', applied: false };
    if (confirmation.source === 'voice') {
      return { code: 'VOICE_NOT_ALLOWED', applied: false, reason: 'voice_cannot_apply_alone' };
    }

    // Navigasyon-güvenlik kapısı (fail-closed).
    if (this._safetyCheck) {
      const sd = this._safetyCheck();
      if (!sd || sd.allowed !== true) {
        return { code: 'SAFETY_BLOCKED', applied: false, reason: sd?.reason ?? 'safety_denied' };
      }
    }

    // Preview hâlâ geçerli mi (savunma; begin sonrası dışarıdan bozulmuş olabilir).
    if (!isApplicablePreview(pending.preview)) return { code: 'INVALID_PREVIEW', applied: false };

    // Güncellik: yaş + aktif rotanın imzası değişmemiş olmalı (race/reroute koruması).
    if (this._now() - pending.createdAt > this._maxAgeMs) {
      this._pending = null;
      return { code: 'EXPIRED', applied: false, reason: 'age_exceeded' };
    }
    const active = this._store.getActiveRoute();
    if (!active || active.geometry.length < 2) return { code: 'NO_ACTIVE_ROUTE', applied: false };
    if (routeSignature(active) !== pending.baseSignature) {
      this._pending = null;
      return { code: 'EXPIRED', applied: false, reason: 'active_route_changed' };
    }

    // Uygula: preview → aktif rota. Snapshot rollback/resume için saklanır.
    const p = pending.preview;
    const nextRoute: ActiveRoute = {
      geometry:   (p.previewRoute as [number, number][]).map(pt => [pt[0], pt[1]] as [number, number]),
      distanceM:  p.previewDistance,
      durationS:  p.previewDuration,
      etaEpochMs: p.previewETA,
      meta:       { source: 'trip_preview_apply' },
    };
    this._store.setActiveRoute(nextRoute);
    this._applied = true;
    this._appliedSnapshot = pending.snapshot;
    this._pending = null;
    return { code: 'APPLIED', applied: true };
  }

  /** Kullanıcı orijinal rotaya DÖNMEK istedi (kasıtlı seçim). Snapshot'ı geri yükler. */
  resumeOriginal(): RestoreResult {
    return this._restore('RESUMED');
  }

  /** Hata/güvenlik kurtarması: uygulanan preview'i GERİ AL. Snapshot'ı geri yükler. */
  rollback(): RestoreResult {
    return this._restore('ROLLED_BACK');
  }

  /** Apply ÖNCESİ bekleyen preview'i iptal eder. Uygulandıysa rollback/resume gerekir. */
  cancelPreview(previewId?: string): CancelResult {
    if (!this._pending) return { code: 'NOTHING_TO_CANCEL' };
    if (previewId !== undefined && this._pending.id !== previewId) return { code: 'NOTHING_TO_CANCEL' };
    this._pending = null;
    return { code: 'CANCELLED' };
  }

  private _restore(code: 'RESUMED' | 'ROLLED_BACK'): RestoreResult {
    if (!this._applied || !this._appliedSnapshot) return { code: 'NOTHING_TO_RESTORE', restored: false };
    // Store'a mutable KOPYA verilir — donmuş snapshot korunur.
    this._store.setActiveRoute(cloneRoute(this._appliedSnapshot.route));
    this._applied = false;
    this._appliedSnapshot = null;
    this._pending = null;
    return { code, restored: true };
  }
}

/** Fabrika — DI ile örnek üretir. Import yan etkisizdir. */
export function createTripApplyEngine(deps: TripApplyDeps): TripApplyEngine {
  return new TripApplyEngine(deps);
}
