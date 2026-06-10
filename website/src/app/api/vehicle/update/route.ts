import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyApiKey, hashApiKey } from '@/lib/crypto';
import type { VehicleUpdate } from '@/types/realtime';

// Rate-limit: one update per vehicle per 500ms
const lastUpdateMs = new Map<string, number>();
const THROTTLE_MS  = 500;

function extractRawKey(req: NextRequest): string | null {
  const auth = req.headers.get('Authorization') ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

export async function POST(req: NextRequest) {
  const rawKey = extractRawKey(req);
  if (!rawKey) {
    return NextResponse.json({ error: 'Authorization gerekli.' }, { status: 401 });
  }

  let vehicleId: string;

  if (!isSupabaseConfigured) {
    // Demo mode — accept any key, use vehicleId from body
    const body = (await req.json()) as Partial<VehicleUpdate> & { vehicleId?: string };
    vehicleId  = body.vehicleId ?? 'unknown';
  } else {
    // ── Supabase mode ──────────────────────────────────────────────
    const keyHash = hashApiKey(rawKey);

    const { data: vehicle, error } = await supabaseAdmin
      .from('vehicles')
      .select('id, api_key_hash')
      .eq('api_key_hash', keyHash)
      .maybeSingle();

    if (error || !vehicle || !verifyApiKey(rawKey, vehicle.api_key_hash)) {
      return NextResponse.json({ error: 'Geçersiz API anahtarı.' }, { status: 401 });
    }

    vehicleId = vehicle.id;
  }

  // Throttle per vehicle
  const now  = Date.now();
  const last = lastUpdateMs.get(vehicleId) ?? 0;
  if (now - last < THROTTLE_MS) {
    return NextResponse.json({ ok: true, throttled: true });
  }
  lastUpdateMs.set(vehicleId, now);

  const body = (await req.json().catch(() => ({}))) as Partial<VehicleUpdate>;

  const update: VehicleUpdate = {
    vehicleId,
    lat:         body.lat         ?? 0,
    lng:         body.lng         ?? 0,
    speed:       body.speed       ?? 0,
    fuel:        body.fuel        ?? 0,
    engineTemp:  body.engineTemp  ?? 0,
    rpm:         body.rpm         ?? 0,
    timestamp:   now,
  };

  if (isSupabaseConfigured) {
    // NOT: Eski `events` tablosuna insert kaldırıldı — tablo canlıda hiç var
    // olmadı (PGRST205, hata sessizce yutuluyordu) ve kalıcılaştırma zaten
    // cihazların doğrudan çağırdığı push_vehicle_event RPC'sinde
    // (vehicle_events + locations/telemetry köprüleri). Bu route yalnız
    // realtime broadcast köprüsüdür (realtimeEngine.ts `v:{vehicleId}` dinler).
    const channel  = supabaseAdmin.channel('vehicle-updates');
    const sendStatus = await channel.send({
      type:    'broadcast',
      event:   `v:${vehicleId}`,
      payload: update,
    });
    await supabaseAdmin.removeChannel(channel);

    if (sendStatus !== 'ok') {
      return NextResponse.json(
        { ok: false, error: `Realtime broadcast başarısız: ${sendStatus}` },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({ ok: true });
}
