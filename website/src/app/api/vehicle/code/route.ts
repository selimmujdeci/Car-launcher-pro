import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyApiKey, generateLinkingCode, hashApiKey } from '@/lib/crypto';

// Mock store
const mockApiKeys   = new Map<string, string>(); // vehicleId → apiKeyHash
const mockCodes     = new Map<string, { vehicleId: string; expiresAt: number; used: boolean }>();

function extractRawKey(req: NextRequest): string | null {
  const auth = req.headers.get('Authorization') ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

export async function POST(req: NextRequest) {
  const rawKey = extractRawKey(req);
  if (!rawKey) {
    return NextResponse.json({ error: 'Authorization gerekli.' }, { status: 401 });
  }

  try {
    if (!isSupabaseConfigured) {
      // ── Demo mode ──────────────────────────────────────────────
      const vehicleId = Array.from(mockApiKeys.entries()).find(
        ([, h]) => verifyApiKey(rawKey, h)
      )?.[0];
      if (!vehicleId) return NextResponse.json({ error: 'Geçersiz API anahtarı.' }, { status: 401 });

      const code      = generateLinkingCode();
      const expiresAt = Date.now() + 60_000;
      mockCodes.set(code, { vehicleId, expiresAt, used: false });
      return NextResponse.json({ code, expiresAt });
    }

    // ── Supabase mode ───────────────────────────────────────────
    // Find vehicle by api_key_hash
    const keyHash = hashApiKey(rawKey);
    const { data: vehicle } = await supabaseAdmin
      .from('vehicles')
      .select('id, api_key_hash')
      .eq('api_key_hash', keyHash)
      .maybeSingle();

    if (!vehicle || !verifyApiKey(rawKey, vehicle.api_key_hash)) {
      return NextResponse.json({ error: 'Geçersiz API anahtarı.' }, { status: 401 });
    }

    const code      = generateLinkingCode();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    const { error } = await supabaseAdmin
      .from('linking_codes')
      .insert({ vehicle_id: vehicle.id, code, expires_at: expiresAt });

    if (error) {
      console.error('vehicle/code:', error);
      return NextResponse.json({ error: 'Kod üretilemedi.' }, { status: 500 });
    }

    return NextResponse.json({ code, expiresAt: Date.parse(expiresAt) });
  } catch (err) {
    console.error('vehicle/code:', err);
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 });
  }
}

