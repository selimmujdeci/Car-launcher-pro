import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { isSupabaseConfigured } from '@/lib/supabase';
import { hashApiKey, verifyApiKey } from '@/lib/crypto';

interface CommandBody {
  vehicleId: string;
  type:      string;
  payload?:  Record<string, unknown>;
  pinHash?:  string;
  nonce?:    string;
  ttl?:      string;
}

export async function POST(req: NextRequest) {
  const rawKey = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!rawKey) {
    return NextResponse.json({ error: 'Authorization başlığı gerekli.' }, { status: 401 });
  }

  try {
    const {
      vehicleId,
      type,
      payload  = {},
      pinHash,
      nonce,
      ttl,
    } = (await req.json()) as CommandBody;

    if (!vehicleId || !type) {
      return NextResponse.json({ error: 'vehicleId ve type zorunlu.' }, { status: 400 });
    }

    // ── Demo mode ─────────────────────────────────────────────────────────────
    if (!isSupabaseConfigured) {
      if (!rawKey.startsWith('demo-api-key-')) {
        return NextResponse.json({ error: 'Geçersiz API anahtarı.' }, { status: 401 });
      }
      return NextResponse.json({ ok: true, commandId: `demo-cmd-${Date.now()}` });
    }

    // ── Supabase mode — validate api_key via vehicle record ───────────────────
    const keyHash = hashApiKey(rawKey);
    const { data: vehicle, error: vErr } = await supabaseAdmin
      .from('vehicles')
      .select('id, api_key_hash')
      .eq('id', vehicleId)
      .maybeSingle();

    if (vErr || !vehicle) {
      return NextResponse.json({ error: 'Araç bulunamadı.' }, { status: 404 });
    }

    const vRow = vehicle as { id: string; api_key_hash: string };
    if (!verifyApiKey(rawKey, vRow.api_key_hash)) {
      return NextResponse.json({ error: 'Geçersiz API anahtarı.' }, { status: 401 });
    }

    const commandNonce = nonce ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const commandTtl   = ttl   ?? new Date(Date.now() + 5 * 60_000).toISOString();

    const { data: cmd, error: cmdErr } = await supabaseAdmin
      .from('vehicle_commands')
      .insert({
        vehicle_id:             vehicleId,
        type,
        payload,
        nonce:                  commandNonce,
        ttl:                    commandTtl,
        critical_auth_verified: !!pinHash,
        // created_by intentionally null — api_key based auth, no user session
      })
      .select('id')
      .single();

    if (cmdErr) {
      console.error('api/pwa/command insert:', cmdErr);
      return NextResponse.json({ error: cmdErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, commandId: (cmd as { id: string }).id });
  } catch (err) {
    console.error('api/pwa/command:', err);
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 });
  }
}
