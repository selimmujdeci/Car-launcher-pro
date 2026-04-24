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
    // 1. Persist event to DB
    await supabaseAdmin.from('events').insert({
      vehicle_id:  vehicleId,
      lat:         update.lat,
      lng:         update.lng,
      speed:       update.speed,
      fuel:        update.fuel,
      engine_temp: update.engineTemp,
      rpm:         update.rpm,
    });

    // 2. Broadcast via Supabase Realtime so web panel receives instantly
    const channel = supabaseAdmin.channel('vehicle-updates');
    await channel.send({
      type:    'broadcast',
      event:   `v:${vehicleId}`,
      payload: update,
    });
  }

  return NextResponse.json({ ok: true });
}
