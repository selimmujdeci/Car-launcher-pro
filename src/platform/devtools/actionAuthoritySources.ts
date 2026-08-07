/**
 * actionAuthoritySources.ts — Eylem Otoritesi ekranının TEK okuma noktası (MAVI-M4-LAB).
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · YALNIZ SENKRON getter. `await` YOK.
 *  · Araca, OBD'ye, köprüye, native'e, ağa HİÇBİR istek atılmaz.
 *  · Hiçbir action YÜRÜTÜLMEZ; kapı DEĞERLENDİRİLMEZ (`evaluateVehicleAction`
 *    BURADAN ÇAĞRILMAZ — çağrılsaydı gözlem, gözlediği sayaçları kirletirdi).
 *  · Bekleyen onay ONAYLANMAZ / İPTAL EDİLMEZ (`consumePendingAction` ve
 *    `clearPendingAction` bu modüle import bile EDİLMEZ).
 *  · Abonelik, timer, listener AÇILMAZ.
 *  · Her kaynak AYRI try/catch — biri patlarsa diğerleri okunur, alan KAYNAK YOK olur.
 *
 * ── GİZLİLİK (YAPISAL) ──────────────────────────────────────────────────────
 *  Okunan iki API de PII'siz sözleşmelerdir:
 *   · `getActionAuthorityDiagnostics()` → yalnız enum intent · sabit actionId ·
 *     makine-okur status/reason · zaman damgası.
 *   · `getPendingActionDiagnostics()`   → yalnız bayrak · actionId · süre.
 *  Ham kullanıcı komutu · kişi adı · telefon numarası · sağlayıcı cevabı · konum ·
 *  VIN bu katmandan GEÇEMEZ; dışarı çıkan tipte böyle bir alan YOKTUR.
 *  Bekleyen onayın `intent.payload`ı (kişi adı + ham metin taşır) bu modüle
 *  HİÇ ULAŞMAZ — otorite katmanı onu zaten bayrak ve kimliğe indirger.
 */

import {
  VEHICLE_ACTIONS, getActionAuthorityDiagnostics, MAX_ACTION_DECISIONS,
} from '../action/maviActionAuthority';
import { getPendingActionDiagnostics } from '../action/pendingActionConfirmation';
import type { IntentType } from '../intentEngine';
import type { AaRawSnapshot, AaActionRaw, AaDecisionRaw } from './actionAuthorityModel';

function _safe<T>(fn: () => T): T | null {
  try {
    const v = fn();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

/** Tanımlayıcı sınıfı dize. Boş → null (sahte "" basılmaz). */
function _ident(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Duvar-saati damgası; 0/negatif/NaN → null ("şimdi" UYDURULMAZ). */
function _wallTs(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

function _num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Tüm kaynakların TEK seferlik senkron okuması.
 *
 * `actions`/`decisions`: `null` = KAYNAK OKUNAMADI · `[]` = GERÇEKTEN BOŞ.
 * Bu ayrım korunur — boş liste "sağlıklı/sıfır" diye sunulmaz.
 */
export function readActionAuthoritySnapshot(): AaRawSnapshot {
  const readAt = Date.now();

  const diag    = _safe(() => getActionAuthorityDiagnostics());
  const pending = _safe(() => getPendingActionDiagnostics(readAt));

  /* ── Defter (registry) ─────────────────────────────────────────────────
     Sabit tanım — okunamazsa null (boş liste ile karıştırılmaz). */
  let actions: AaActionRaw[] | null = null;
  const registry = _safe(() => VEHICLE_ACTIONS);
  if (registry) {
    actions = [];
    for (const [intent, def] of Object.entries(registry)) {
      if (!def) continue;
      actions.push({
        intent:               intent as IntentType,
        actionId:             def.actionId,
        risk:                 def.risk,
        requiresConfirmation: def.requiresConfirmation === true,
        capability:           _ident(def.capability),
        vehicleScope:         _ident(def.vehicleScope),
        motionPolicy:         def.motionPolicy,
      });
    }
    // Sıra DETERMİNİSTİK: risk (yüksek→düşük), sonra actionId. Object.entries
    // sırasına güvenilmez; ekran her açılışta aynı listeyi göstermelidir.
    const RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
    actions.sort((a, b) =>
      (RANK[a.risk] ?? 9) - (RANK[b.risk] ?? 9) || a.actionId.localeCompare(b.actionId));
  }

  /* ── Son kapı kararları (EN YENİ → EN ESKİ, otorite halkasından) ─────── */
  let decisions: AaDecisionRaw[] | null = null;
  if (diag && Array.isArray(diag.decisions)) {
    decisions = [];
    for (const d of diag.decisions) {
      if (!d) continue;
      decisions.push({
        intent:   _ident(d.intent),
        actionId: _ident(d.actionId),
        status:   _ident(d.status),
        reason:   _ident(d.reason),
        atMs:     _wallTs(d.atMs),
      });
    }
  }

  return {
    readAt,
    actions,
    decisions,
    capacity: diag ? _num(diag.capacity) : MAX_ACTION_DECISIONS,
    counters: diag ? {
      evaluated:            _num(diag.counters.evaluated),
      allowed:              _num(diag.counters.allowed),
      denied:               _num(diag.counters.denied),
      confirmationRequired: _num(diag.counters.confirmationRequired),
      unsupported:          _num(diag.counters.unsupported),
      failed:               _num(diag.counters.failed),
    } : null,
    countersSaturated: diag?.countersSaturated === true,
    /* GİZLİLİK: yalnız VAR/YOK + sabit kimlik + süre. Kişi adı / ham komut YOK. */
    pending: pending ? {
      pending:     pending.pending === true,
      actionId:    _ident(pending.actionId),
      ageMs:       typeof pending.ageMs === 'number' && Number.isFinite(pending.ageMs) ? pending.ageMs : null,
      expiresInMs: typeof pending.expiresInMs === 'number' && Number.isFinite(pending.expiresInMs)
        ? pending.expiresInMs : null,
    } : null,
  };
}
