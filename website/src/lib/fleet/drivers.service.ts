/**
 * drivers.service.ts — SÜRÜCÜ / ATAMA SERVİS KATMANI.
 *
 * Tüm yazma işlemleri **RPC üzerinden** gider: yetki, tenant eşleşmesi,
 * zaman aralığı geçerliliği, çakışma tespiti ve audit sunucudadır.
 * Bu katman iş kuralı UYGULAMAZ — yalnız taşır ve yanıtı daraltır.
 *
 * Dönüş `null` = OKUNAMADI (RPC yok / yetki yok / ağ hatası). Bu, "sürücü
 * yok" ile KARIŞTIRILMAZ — UI ikisini ayrı gösterir.
 */

import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import type { DriverRow, AssignmentRow } from '@/lib/fleet/driverIdentity';

/** RPC sonucu — sunucu hükmü daraltılır, uydurulmaz. */
export interface DriverRpcResult {
  readonly state: 'CREATED' | 'UPDATED' | 'UNCHANGED' | 'CONFLICTED' | 'REJECTED' | 'UNKNOWN';
  readonly reason: string | null;
  readonly driverId: string | null;
  readonly assignmentId: string | null;
  readonly revision: number | null;
}

const UNKNOWN_RESULT: DriverRpcResult = Object.freeze({
  state: 'UNKNOWN', reason: null, driverId: null, assignmentId: null, revision: null,
});

const RPC_STATES = ['CREATED', 'UPDATED', 'UNCHANGED', 'CONFLICTED', 'REJECTED'] as const;

function parseResult(raw: unknown): DriverRpcResult {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = String(o.state ?? '');
  return {
    state: (RPC_STATES as readonly string[]).includes(s)
      ? (s as DriverRpcResult['state']) : 'UNKNOWN',
    reason: typeof o.reason === 'string' && o.reason.length > 0 ? o.reason : null,
    driverId: typeof o.driverId === 'string' ? o.driverId : null,
    assignmentId: typeof o.assignmentId === 'string' ? o.assignmentId : null,
    revision: typeof o.revision === 'number' && Number.isFinite(o.revision)
      ? o.revision : null,
  };
}

/* ── Okuma ─────────────────────────────────────────────────────────────── */

export async function fetchFleetDrivers(
  includeArchived = false,
): Promise<DriverRow[] | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('list_fleet_drivers', {
      p_include_archived: includeArchived,
    });
    /* 048 uygulanmamış ortamda RPC yoktur → "okunamadı" (sahte boşluk YOK). */
    if (error) return null;
    return (data ?? []) as DriverRow[];
  } catch {
    return null;
  }
}

export async function fetchVehicleAssignments(
  vehicleId: string,
  limit = 50,
): Promise<AssignmentRow[] | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('list_vehicle_driver_assignments', {
      p_vehicle_id: vehicleId,
      p_limit: limit,
    });
    if (error) return null;
    return (data ?? []) as AssignmentRow[];
  } catch {
    return null;
  }
}

/* ── Yazma (tümü RPC) ──────────────────────────────────────────────────── */

export interface CreateDriverInput {
  readonly displayName: string;
  readonly employeeCode?: string | null;
  readonly linkedUserId?: string | null;
  readonly phone?: string | null;
  readonly licenseNumber?: string | null;
  readonly licenseClass?: string | null;
  readonly licenseExpiresAt?: string | null;
}

export async function createFleetDriver(
  input: CreateDriverInput,
): Promise<DriverRpcResult> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return UNKNOWN_RESULT;
  try {
    const { data, error } = await supabase.rpc('create_fleet_driver', {
      p_display_name: input.displayName,
      p_employee_code: input.employeeCode ?? null,
      p_linked_user_id: input.linkedUserId ?? null,
      p_phone: input.phone ?? null,
      p_license_number: input.licenseNumber ?? null,
      p_license_class: input.licenseClass ?? null,
      p_license_expires_at: input.licenseExpiresAt ?? null,
    });
    if (error) return UNKNOWN_RESULT;
    return parseResult(data);
  } catch {
    return UNKNOWN_RESULT;
  }
}

export interface UpdateDriverInput {
  readonly driverId: string;
  readonly displayName?: string | null;
  readonly employeeCode?: string | null;
  readonly phone?: string | null;
  readonly licenseNumber?: string | null;
  readonly licenseClass?: string | null;
  readonly licenseExpiresAt?: string | null;
  readonly status?: string | null;
}

export async function updateFleetDriver(
  input: UpdateDriverInput,
): Promise<DriverRpcResult> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return UNKNOWN_RESULT;
  try {
    const { data, error } = await supabase.rpc('update_fleet_driver', {
      p_driver_id: input.driverId,
      p_display_name: input.displayName ?? null,
      p_employee_code: input.employeeCode ?? null,
      p_phone: input.phone ?? null,
      p_license_number: input.licenseNumber ?? null,
      p_license_class: input.licenseClass ?? null,
      p_license_expires_at: input.licenseExpiresAt ?? null,
      p_status: input.status ?? null,
    });
    if (error) return UNKNOWN_RESULT;
    return parseResult(data);
  } catch {
    return UNKNOWN_RESULT;
  }
}

export interface CreateAssignmentInput {
  readonly vehicleId: string;
  readonly driverId: string;
  /** ISO; verilmezse sunucu `now()` kullanır. */
  readonly startsAt?: string | null;
  readonly endsAt?: string | null;
  readonly assignmentType?: string | null;
  readonly note?: string | null;
  /** Vardiya devri: mevcut açık atamayı atomik olarak kapat. */
  readonly endExisting?: boolean;
}

export async function createVehicleDriverAssignment(
  input: CreateAssignmentInput,
): Promise<DriverRpcResult> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return UNKNOWN_RESULT;
  try {
    const { data, error } = await supabase.rpc('create_vehicle_driver_assignment', {
      p_vehicle_id: input.vehicleId,
      p_driver_id: input.driverId,
      p_starts_at: input.startsAt ?? null,
      p_ends_at: input.endsAt ?? null,
      p_assignment_type: input.assignmentType ?? 'PRIMARY',
      p_note: input.note ?? null,
      p_end_existing: input.endExisting === true,
    });
    if (error) return UNKNOWN_RESULT;
    return parseResult(data);
  } catch {
    return UNKNOWN_RESULT;
  }
}

export async function endVehicleDriverAssignment(
  assignmentId: string,
  opts: { endsAt?: string | null; cancel?: boolean } = {},
): Promise<DriverRpcResult> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return UNKNOWN_RESULT;
  try {
    const { data, error } = await supabase.rpc('end_vehicle_driver_assignment', {
      p_assignment_id: assignmentId,
      p_ends_at: opts.endsAt ?? null,
      p_cancel: opts.cancel === true,
    });
    if (error) return UNKNOWN_RESULT;
    return parseResult(data);
  } catch {
    return UNKNOWN_RESULT;
  }
}

/**
 * Trip'e elle sürücü ata / düzelt.
 *
 * Trip metrikleri, `trip_key` ve trip revizyonu DEĞİŞMEZ; yalnız
 * attribution revizyonu artar ve önceki sonuç revizyon geçmişinde korunur.
 */
export async function manuallyAssignTripDriver(
  vehicleId: string,
  tripKey: string,
  driverId: string,
  reason?: string | null,
): Promise<DriverRpcResult> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return UNKNOWN_RESULT;
  try {
    const { data, error } = await supabase.rpc('manually_assign_trip_driver', {
      p_vehicle_id: vehicleId,
      p_trip_key: tripKey,
      p_driver_id: driverId,
      p_reason: reason ?? null,
    });
    if (error) return UNKNOWN_RESULT;
    return parseResult(data);
  } catch {
    return UNKNOWN_RESULT;
  }
}

/* ── Hata gerekçelerini kullanıcı diline çevir ─────────────────────────── */

/**
 * Sunucu gerekçesini kullanıcıya gösterilebilir metne çevirir.
 *
 * Teknik sızıntı YOK: `rpc`, `sql`, `null`, tablo/kolon adı geçmez.
 */
export function driverRpcReasonLabel(result: DriverRpcResult): string | null {
  if (result.state === 'CREATED' || result.state === 'UPDATED'
      || result.state === 'UNCHANGED') return null;
  switch (result.reason) {
    case 'NOT_AUTHORIZED':        return 'Bu işlem için yetkiniz yok.';
    case 'NAME_REQUIRED':         return 'Sürücü adı gerekli.';
    case 'NAME_TOO_LONG':         return 'Sürücü adı çok uzun.';
    case 'CROSS_TENANT_USER':     return 'Seçilen kullanıcı bu şirkete ait değil.';
    case 'USER_ALREADY_LINKED':   return 'Bu kullanıcı zaten başka bir sürücü kaydına bağlı.';
    case 'CROSS_TENANT':          return 'Bu kayıt başka bir şirkete ait.';
    case 'DRIVER_NOT_FOUND':      return 'Sürücü bulunamadı.';
    case 'DRIVER_NOT_IN_COMPANY': return 'Sürücü bu şirkete ait değil.';
    case 'DRIVER_NOT_ACTIVE':     return 'Sürücü aktif değil; önce aktifleştirin.';
    case 'VEHICLE_NOT_IN_COMPANY':return 'Araç bu şirkete ait değil.';
    case 'INVALID_RANGE':         return 'Bitiş tarihi başlangıçtan önce olamaz.';
    case 'INVALID_TYPE':          return 'Geçersiz atama türü.';
    case 'INVALID_STATUS':        return 'Geçersiz durum.';
    case 'ASSIGNMENT_NOT_FOUND':  return 'Atama bulunamadı.';
    case 'ALREADY_CLOSED':        return 'Bu atama zaten kapatılmış.';
    case 'TRIP_NOT_FOUND':        return 'Yolculuk bulunamadı.';
    case 'VEHICLE_OVERLAP':
      return 'Bu araçta aynı zaman aralığında başka bir sürücü atanmış.';
    case 'DRIVER_OVERLAP':
      return 'Bu sürücü aynı zaman aralığında başka bir araca atanmış.';
    default:
      return 'İşlem tamamlanamadı.';
  }
}
