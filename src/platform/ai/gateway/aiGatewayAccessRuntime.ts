/**
 * aiGatewayAccessRuntime.ts — AI GATEWAY KAPSAM İZNİNİ SUNUCUDAN OKUR.
 *
 * Tek işi: `get_ai_gateway_access()` RPC'sini okuyup sonucu saf kapıya
 * (`applyScopedGatewayAccess`) beslemek ve LAB'ın okuyacağı durumu tutmak.
 *
 * ── SINIRLAR ───────────────────────────────────────────────────────────
 *  · Karar ÜRETMEZ, izin YAZMAZ (yazma yalnız yönetim yüzeyinden).
 *  · Okuma başarısızsa izin VERİLMEZ (fail-closed) — sessizce açılmaz.
 *  · Timer KURMAZ: boot'ta bir kez + elle tazeleme. AI erişimi saniyede bir
 *    değişen bir şey değildir; poll ağ/pil bütçesi harcardı.
 */

import { applyScopedGatewayAccess } from './aiGatewayFlag';
import {
  deriveGatewayStatus, UNREAD_ACCESS, UNMEASURED_PROVIDER,
  type AiGatewayAccessSnapshot, type AiGatewayStatus,
  type AiProviderReadiness, type AiProviderReadinessInfo,
} from './aiGatewayAccess';

/** Sunucudan dönen satır (SQL sütun adlarıyla birebir). */
interface AccessRow {
  readonly kill_switch_on?: boolean | null;
  readonly company_granted?: boolean | null;
  readonly vehicle_grant_count?: number | null;
  readonly effective?: boolean | null;
}

let _snapshot: AiGatewayAccessSnapshot | null = null;
let _provider: AiProviderReadinessInfo = UNMEASURED_PROVIDER;
let _lastReadAt: number | null = null;

/** Yerel geliştirici kaldıracı — saf çekirdek için okunur. */
function _localOverride(): boolean {
  try {
    return typeof localStorage !== 'undefined'
      && localStorage.getItem('mavi.aiGateway.enabled') === 'true';
  } catch { return false; }
}

/**
 * Kapsam iznini sunucudan okur ve kapıya uygular.
 *
 * `rpc` dışarıdan enjekte edilir (bu modül Supabase istemcisine bağlanmaz →
 * test edilebilir ve döngüsel bağımlılık üretmez).
 */
export async function refreshGatewayAccess(
  rpc: (fn: string) => Promise<{ data: unknown; error: unknown } | null>,
  nowMs: number,
): Promise<AiGatewayAccessSnapshot | null> {
  let snap: AiGatewayAccessSnapshot | null = null;
  try {
    const res = await rpc('get_ai_gateway_access');
    if (res && !res.error) {
      const rows = Array.isArray(res.data) ? res.data : [];
      const r = rows[0] as AccessRow | undefined;
      if (r) {
        snap = Object.freeze({
          killSwitchOn:      r.kill_switch_on === true,
          companyGranted:    r.company_granted === true,
          vehicleGrantCount: typeof r.vehicle_grant_count === 'number'
            ? Math.max(0, Math.trunc(r.vehicle_grant_count)) : 0,
          effective:         r.effective === true,
        });
      } else {
        /* Oturum var ama satır yok → sunucu fail-closed davrandı.
           Bu "izin yok"tur ve OKUNMUŞ sayılır (null ile karıştırılmaz). */
        snap = UNREAD_ACCESS;
      }
    }
  } catch {
    snap = null;                       // okunamadı → izin YOK
  }

  _snapshot = snap;
  _lastReadAt = nowMs;

  // Kapıya YALNIZ sunucunun etkin kararı beslenir; yerel kaldıraç ayrı yoldan.
  applyScopedGatewayAccess(snap !== null && snap.effective);
  return snap;
}

/**
 * Sağlayıcı hazırlığını kaydeder (cihaz kararı).
 *
 * ⚠️ SECRET TAŞINMAZ: yalnız bounded durum + bounded hata sınıfı. Anahtar,
 * token, endpoint veya ham hata metni bu yola GİRMEZ.
 */
export function setProviderReadiness(
  state: AiProviderReadiness,
  opts: {
    readonly source?: AiProviderReadinessInfo['source'];
    readonly measuredAt?: number | null;
    readonly lastFailure?: AiProviderReadinessInfo['lastFailure'];
  } = {},
): void {
  _provider = Object.freeze({
    state,
    source: opts.source ?? (state === 'UNKNOWN' ? 'NOT_MEASURED' : 'CONFIG_ONLY'),
    measuredAt: opts.measuredAt ?? null,
    lastFailure: opts.lastFailure ?? 'NONE',
  });
}

/** Sağlayıcı künyesi — LAB kaynak · yaş · son hata gösterir. */
export function getProviderReadinessInfo(): AiProviderReadinessInfo {
  return _provider;
}

/** LAB ve ürün kodunun okuduğu birleşik durum — SAF türetim. */
export function getGatewayStatus(): AiGatewayStatus {
  return deriveGatewayStatus({
    snapshot: _snapshot,
    localOverride: _localOverride(),
    provider: _provider.state,
  });
}

/** Son okuma anı (epoch ms) — `null` = hiç okunmadı. */
export function getGatewayAccessReadAt(): number | null {
  return _lastReadAt;
}

/** @internal testler arası izolasyon. */
export function _resetGatewayAccessForTest(): void {
  _snapshot = null;
  _provider = UNMEASURED_PROVIDER;
  _lastReadAt = null;
  applyScopedGatewayAccess(false);
}
