/**
 * superadmin.ts — Enterprise Super Admin Tip Tanımları
 *
 * Privacy-First Prensibi:
 *   Super Admin bireysel kullanıcı verisini değil, sistemin toplam sağlığını yönetir.
 *   AuditLog kayıtları kişisel veri içermez — sadece actor_id ve action.
 *   IP adresleri hiçbir zaman ham olarak saklanmaz (hash kullanılır).
 */

// ── Audit Log ─────────────────────────────────────────────────────────────────

export type AuditTargetType =
  | 'policy'
  | 'flag'
  | 'rollout'
  | 'fleet'
  | 'user'
  | 'system'
  | 'health'

export type AuditSeverity = 'info' | 'warning' | 'critical'

export interface AuditLog {
  /** UUID — immutable */
  id:           string
  /** ISO 8601 timestamp */
  ts:           string
  /** Super Admin'in Supabase UUID'si */
  actor_id:     string
  /** Görüntüleme için e-posta — ham değer, PII kabul edilir */
  actor_email:  string
  /**
   * Dot-notation aksiyon adı.
   * Örnekler: 'policy.create', 'flag.toggle', 'rollout.approve', 'system.emergency_stop'
   */
  action:       string
  target_type:  AuditTargetType
  target_id:    string
  /** Değişiklik öncesi durum — null ise yeni kayıt */
  before:       unknown
  /** Değişiklik sonrası durum */
  after:        unknown
  /** Ek bağlam verisi */
  metadata:     Record<string, unknown>
  /**
   * Privacy: raw IP saklanmaz, SHA-256 hash'i saklanır.
   * Fraud/abuse analizi için yeterli, bireysel takip için yetersiz.
   */
  ip_hash:      string | null
  severity:     AuditSeverity
}

/** Yeni AuditLog kaydı için gereken minimum alan kümesi */
export type CreateAuditLogDTO = Pick<
  AuditLog,
  'action' | 'target_type' | 'target_id' | 'before' | 'after' | 'metadata' | 'severity'
>

// ── Feature Flags ─────────────────────────────────────────────────────────────

export type FlagScope = 'all' | 'fleet' | 'vehicle' | 'pilot' | 'internal'

export interface FeatureFlag {
  id:              string
  /** Kod içinde referans için — değişmez */
  key:             string
  name:            string
  description:     string
  enabled:         boolean
  /** 0–100 yüzde — kademeli açılım için */
  rollout_percent: number
  target_scope:    FlagScope
  /** Bağımlı flag key'leri — bu flag'ler kapalıysa bu flag de etkisiz */
  depends_on:      string[]
  created_at:      string
  updated_at:      string
  /** Son değiştiren Super Admin */
  updated_by:      string
}

export type CreateFeatureFlagDTO = Pick<
  FeatureFlag,
  'key' | 'name' | 'description' | 'enabled' | 'rollout_percent' | 'target_scope'
> & { depends_on?: string[] }

// ── Policy ────────────────────────────────────────────────────────────────────

export type PolicyScope    = 'global' | 'fleet' | 'vehicle' | 'user'
export type PolicyOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains'

export interface PolicyRule {
  /** İnsan okunabilir başlık */
  label:    string
  /** Değerlendirilen alan yolu — örn: 'vehicle.speed', 'driver.license_type' */
  field:    string
  operator: PolicyOperator
  value:    unknown
}

export type PolicyStatus = 'draft' | 'active' | 'archived'

export interface Policy {
  id:          string
  name:        string
  description: string
  scope:       PolicyScope
  status:      PolicyStatus
  /** Sürüm numarası — her değişiklikte artar */
  version:     number
  rules:       PolicyRule[]
  /** Fleet/vehicle scope'da hedef entity ID listesi */
  targets:     string[]
  created_at:  string
  updated_at:  string
  created_by:  string
  updated_by:  string
}

export type CreatePolicyDTO = Pick<
  Policy,
  'name' | 'description' | 'scope' | 'rules'
> & { targets?: string[] }

// ── Rollout ───────────────────────────────────────────────────────────────────

export type RolloutStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'rolling'
  | 'paused'
  | 'complete'
  | 'reverted'

export type RolloutStageTarget = 'internal' | 'pilot' | 'beta' | 'production'
export type RolloutStageStatus = 'pending' | 'active' | 'complete' | 'failed'

export interface RolloutStage {
  order:     number
  target:    RolloutStageTarget
  /** Hedef aracın/filonun yüzde kaçına dağıtılacak */
  percent:   number
  status:    RolloutStageStatus
  started_at:   string | null
  completed_at: string | null
  /** Otomatik ilerleme eşiği: hata oranı bu değerin altında olmalı */
  error_threshold_pct: number
}

export interface RolloutPlan {
  id:          string
  name:        string
  /** Semantik versiyon — örn: '2.4.1' */
  version:     string
  description: string
  status:      RolloutStatus
  stages:      RolloutStage[]
  created_at:  string
  created_by:  string
  approved_by: string | null
  approved_at: string | null
  /** Rollback tetiklenirse başvurulacak önceki versiyon */
  rollback_to: string | null
}

// ── System Health ─────────────────────────────────────────────────────────────

export type HealthStatus = 'healthy' | 'degraded' | 'critical' | 'unknown'

export interface ServiceHealth {
  service:     string
  status:      HealthStatus
  last_check:  string
  latency_ms:  number | null
  message:     string | null
  /** Son 24 saatte oluşan hata sayısı */
  error_count: number
}

export interface SystemHealthSnapshot {
  ts:       string
  overall:  HealthStatus
  services: ServiceHealth[]
  /** Aktif incident ID listesi */
  incidents: string[]
}

// ── Runtime Policy ────────────────────────────────────────────────────────────

export type RuntimePolicyCategory = 'thermal' | 'sync' | 'watchdog'

export interface RuntimePolicy {
  id:          string
  /** Noktalı-notasyon anahtar — örn: 'thermal.l1_temp_c' */
  key:         string
  name:        string
  category:    RuntimePolicyCategory
  value:       number
  /** İzin verilen minimum değer */
  min:         number
  /** İzin verilen maksimum değer */
  max:         number
  /** Birim etiketi — '°C', 'ms', 'adet' */
  unit:        string
  description: string
  updated_at:  string
  updated_by:  string | null
}

// ── Fleet Overview ────────────────────────────────────────────────────────────

export interface FleetStats {
  total_vehicles:  number
  active_count:    number
  offline_count:   number
  maintenance_count: number
  /** Ortalama araç yaşı (yıl) */
  avg_age_years:   number
  /** Son 7 gündeki toplam km */
  weekly_km:       number
  /** Privacy: bireysel veri değil, toplam istatistikler */
  top_alert_types: Array<{ type: string; count: number }>
}

// ── Audit Action Builder ──────────────────────────────────────────────────────

/**
 * Herhangi bir state değiştiren fonksiyon, aksiyonunu bu yapıda raporlamalıdır.
 * Şu an no-op'tur; Supabase audit table entegrasyonu eklendiğinde otomatik aktif olur.
 *
 * Kullanım:
 *   await auditAction({ action: 'policy.create', target_type: 'policy', ... })
 */
export async function auditAction(dto: CreateAuditLogDTO & { actor_id: string }): Promise<void> {
  try {
    const { supabase } = await import('../lib/supabaseClient')
    await supabase.from('audit_logs').insert({
      actor_id:   dto.actor_id,
      action:     dto.action,
      target:     `${dto.target_type}:${dto.target_id}`,
      before_val: dto.before   ?? null,
      after_val:  dto.after    ?? null,
      severity:   dto.severity,
    })
  } catch {
    // Audit yazma başarısız olsa bile asıl işlemi engellemez
  }
  if (import.meta.env.DEV) {
    console.info(
      `[AuditLog] ${dto.actor_id} → ${dto.action} [${dto.target_type}:${dto.target_id}]`,
      { severity: dto.severity },
    )
  }
}
