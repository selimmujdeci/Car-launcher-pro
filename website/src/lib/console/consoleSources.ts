/**
 * KANIT KONSOLU — okuma katmanı (#662).
 *
 * TEK OKUMA OTORİTESİ kuralı: araç listesi ve telemetri BURADAN OKUNMAZ —
 * onların sahibi `vehicleStore` / `vehicles.service`'tir ve ikinci bir kopya
 * kurmak (bkz. #632, #660) sahada sessiz ayrışma üretir. Bu dosya yalnız
 * konsolun EK okumalarını yapar: karar günlüğü, bildirimler, kayıtlar,
 * atamalar, geofence bölgeleri.
 *
 * Dönüş sözleşmesi: `null` = OKUNAMADI (yetki/şema/ağ). Bu, "kayıt yok" ile
 * KARIŞTIRILMAZ; ekran ikisini ayrı gösterir. Her getter kendi try/catch'ini
 * taşır — bir okumanın düşmesi ekranı çökertmez (fail-soft).
 */

import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';

/* ── Karar günlüğü ─────────────────────────────────────────────────────── */

export type DecisionSeverity = 'info' | 'warning' | 'critical';

export interface DecisionEvent {
  readonly id: string;
  readonly at: number;
  readonly vehicleId: string | null;
  /** Ham olay tipi — teknik ad KORUNUR (Faz A: teknik isim serbest). */
  readonly kind: string;
  readonly detail: string;
  readonly severity: DecisionSeverity;
  readonly origin: 'EVENT' | 'NOTIFICATION';
}

interface EventRow {
  id: string;
  vehicle_id: string | null;
  type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface NotificationRow {
  id: string;
  vehicle_id: string | null;
  title: string;
  message: string;
  severity: string;
  read_at: string | null;
  created_at: string;
}

function toEpoch(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeSeverity(raw: unknown): DecisionSeverity {
  if (raw === 'critical' || raw === 'error') return 'critical';
  if (raw === 'warning' || raw === 'warn') return 'warning';
  return 'info';
}

/** Olay tipinden ciddiyet — bilinmeyen tip `info` kalır, ABARTILMAZ. */
function severityForEventType(type: string): DecisionSeverity {
  const t = type.toLowerCase();
  if (t.includes('critical') || t.includes('fault') || t.includes('dtc') || t.includes('alarm')) return 'critical';
  if (t.includes('warn') || t.includes('geofence') || t.includes('speed') || t.includes('offline')) return 'warning';
  return 'info';
}

/** `metadata` içinden okunur bir özet — yoksa boş döner, uydurma cümle YOK. */
function summarizeMetadata(metadata: Record<string, unknown> | null): string {
  if (!metadata) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') continue;
    parts.push(`${key}=${String(value)}`);
    if (parts.length >= 4) break;
  }
  return parts.join(' ');
}

/**
 * Karar günlüğü — `vehicle_events` + `notifications` birleşimi, zaman sırası.
 * `null` = okunamadı.
 */
export async function fetchDecisionLog(limit = 60): Promise<DecisionEvent[] | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;

  try {
    const [events, notifications] = await Promise.all([
      supabase
        .from('vehicle_events')
        .select('id, vehicle_id, type, metadata, created_at')
        .order('created_at', { ascending: false })
        .limit(limit),
      supabase
        .from('notifications')
        .select('id, vehicle_id, title, message, severity, read_at, created_at')
        .order('created_at', { ascending: false })
        .limit(limit),
    ]);

    /* İki okumadan biri yetkisizse ÖTEKİ yine gösterilir — kısmi kanıt,
       kanıtsızlıktan iyidir; ama eksik olan ekranda BELİRTİLİR. */
    if (events.error && notifications.error) return null;

    const out: DecisionEvent[] = [];

    for (const row of ((events.data ?? []) as EventRow[])) {
      out.push({
        id: `ev:${row.id}`,
        at: toEpoch(row.created_at),
        vehicleId: row.vehicle_id,
        kind: row.type,
        detail: summarizeMetadata(row.metadata),
        severity: severityForEventType(row.type),
        origin: 'EVENT',
      });
    }

    for (const row of ((notifications.data ?? []) as NotificationRow[])) {
      out.push({
        id: `nt:${row.id}`,
        at: toEpoch(row.created_at),
        vehicleId: row.vehicle_id,
        kind: row.title,
        detail: row.message,
        severity: normalizeSeverity(row.severity),
        origin: 'NOTIFICATION',
      });
    }

    out.sort((a, b) => b.at - a.at);
    return out.slice(0, limit);
  } catch {
    return null;
  }
}

/* ── Bildirim merkezi ──────────────────────────────────────────────────── */

export interface AlertItem {
  readonly id: string;
  readonly at: number;
  readonly vehicleId: string | null;
  readonly title: string;
  readonly message: string;
  readonly severity: DecisionSeverity;
  readonly read: boolean;
}

export async function fetchAlerts(limit = 100): Promise<AlertItem[] | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('id, vehicle_id, title, message, severity, read_at, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return null;
    return ((data ?? []) as NotificationRow[]).map((row) => ({
      id: row.id,
      at: toEpoch(row.created_at),
      vehicleId: row.vehicle_id,
      title: row.title,
      message: row.message,
      severity: normalizeSeverity(row.severity),
      read: row.read_at !== null,
    }));
  } catch {
    return null;
  }
}

/** Okundu işaretle. `false` = yazılamadı (sessiz başarı YOK). */
export async function markAlertRead(id: string): Promise<boolean> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return false;
  try {
    const { data, error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .select('id');
    /* PostgREST 200 ≠ satır etkilendi — RLS engellediyse boş döner. */
    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/* ── Kayıtlar: yakıt ve servis (filo geneli) ───────────────────────────── */

export interface FuelLogRow {
  readonly id: string;
  readonly vehicleId: string;
  readonly filledOn: string;
  readonly liters: number | null;
  readonly pricePerL: number | null;
  readonly odometerKm: number | null;
}

export interface ServiceRow {
  readonly id: string;
  readonly vehicleId: string;
  readonly servicedOn: string;
  readonly kind: string | null;
  readonly cost: number | null;
  readonly odometerKm: number | null;
  readonly nextDueOn: string | null;
  readonly note: string | null;
}

export async function fetchFuelLogs(limit = 500): Promise<FuelLogRow[] | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('vehicle_fuel_logs')
      .select('*')
      .order('filled_on', { ascending: false })
      .limit(limit);
    if (error) return null;
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id ?? ''),
      vehicleId: String(row.vehicle_id ?? ''),
      filledOn: String(row.filled_on ?? ''),
      liters: numOrNull(row.liters),
      pricePerL: numOrNull(row.price_per_liter ?? row.price_per_l),
      odometerKm: numOrNull(row.odometer_km),
    }));
  } catch {
    return null;
  }
}

export async function fetchServiceRecords(limit = 500): Promise<ServiceRow[] | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('vehicle_service_records')
      .select('*')
      .order('serviced_on', { ascending: false })
      .limit(limit);
    if (error) return null;
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id ?? ''),
      vehicleId: String(row.vehicle_id ?? ''),
      servicedOn: String(row.serviced_on ?? ''),
      kind: strOrNull(row.service_type ?? row.kind ?? row.title),
      cost: numOrNull(row.cost),
      odometerKm: numOrNull(row.odometer_km),
      nextDueOn: strOrNull(row.next_due_on ?? row.next_service_on),
      note: strOrNull(row.note ?? row.notes),
    }));
  } catch {
    return null;
  }
}

/* ── Araç zaman çizelgesi ──────────────────────────────────────────────── */

export async function fetchVehicleEvents(
  vehicleId: string,
  limit = 80,
): Promise<DecisionEvent[] | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('vehicle_events')
      .select('id, vehicle_id, type, metadata, created_at')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return null;
    return ((data ?? []) as EventRow[]).map((row) => ({
      id: `ev:${row.id}`,
      at: toEpoch(row.created_at),
      vehicleId: row.vehicle_id,
      kind: row.type,
      detail: summarizeMetadata(row.metadata),
      severity: severityForEventType(row.type),
      origin: 'EVENT' as const,
    }));
  } catch {
    return null;
  }
}

/* ── Yardımcılar ───────────────────────────────────────────────────────── */

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/* ── DTC / arıza kodu şeridi ───────────────────────────────────────────── */

export interface DtcCode {
  readonly code: string;
  readonly description: string | null;
}

export type DtcReading =
  | { kind: 'UNREADABLE' }
  | { kind: 'NEVER_SCANNED' }
  | { kind: 'SCANNED'; at: number; codes: DtcCode[]; partial: boolean };

/**
 * Aracın son DTC taraması — `vehicle_commands` sonucundan okunur.
 *
 * ÜÇ AYRI DURUM ASLA BİRLEŞTİRİLMEZ:
 *   UNREADABLE    — sorgu düştü / yetki yok  → "okunamadı"
 *   NEVER_SCANNED — hiç tarama yapılmamış    → "tarama yok"
 *   SCANNED + []  — tarandı, kod çıkmadı     → "arıza kodu yok" (tek yeşil hüküm)
 * `partial` işaretli sonuçta boş liste "arıza yok" SAYILMAZ.
 */
export async function fetchLatestDtc(vehicleId: string): Promise<DtcReading> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return { kind: 'UNREADABLE' };
  try {
    const { data, error } = await supabase
      .from('vehicle_commands')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false })
      .limit(25);
    if (error) return { kind: 'UNREADABLE' };

    const rows = (data ?? []) as Record<string, unknown>[];
    const scan = rows.find((row) => {
      const type = String(row.type ?? '').toLowerCase();
      return type.includes('dtc') || type.includes('diag');
    });
    if (!scan) return { kind: 'NEVER_SCANNED' };

    const status = String(scan.status ?? '');
    const result = (scan.result ?? null) as Record<string, unknown> | null;
    const at = toEpoch(String(scan.updated_at ?? scan.created_at ?? ''));

    /* Komut tamamlanmadıysa sonuç YOKTUR — boş liste "arıza yok" demek değildir. */
    if (status !== 'completed' || !result) {
      return { kind: 'SCANNED', at, codes: [], partial: true };
    }

    const rawCodes = Array.isArray(result.dtcs) ? result.dtcs : [];
    const codes: DtcCode[] = rawCodes.map((entry) => {
      if (typeof entry === 'string') return { code: entry, description: null };
      const obj = entry as Record<string, unknown>;
      return {
        code: String(obj.code ?? obj.dtc ?? '—'),
        description: strOrNull(obj.description ?? obj.desc ?? obj.meaning),
      };
    });
    return { kind: 'SCANNED', at, codes, partial: result.partial === true };
  } catch {
    return { kind: 'UNREADABLE' };
  }
}

/* ── Sürücü atamaları ──────────────────────────────────────────────────── */

export interface AssignmentRow {
  readonly id: string;
  readonly vehicleId: string;
  readonly driverName: string | null;
  readonly startedAt: number;
  readonly endedAt: number | null;
}

export async function fetchAssignments(vehicleId?: string): Promise<AssignmentRow[] | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('list_vehicle_driver_assignments', {
      p_vehicle_id: vehicleId ?? null,
    });
    if (error) return null;
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id ?? row.assignment_id ?? ''),
      vehicleId: String(row.vehicle_id ?? ''),
      driverName: strOrNull(row.driver_name ?? row.full_name),
      startedAt: toEpoch(String(row.started_at ?? row.created_at ?? '')),
      endedAt: row.ended_at ? toEpoch(String(row.ended_at)) : null,
    }));
  } catch {
    return null;
  }
}
