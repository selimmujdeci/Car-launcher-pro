import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { isSupabaseConfigured } from '@/lib/supabase';
import { verifyApiKey } from '@/lib/crypto';

export interface DtcCode {
  code:     string;
  severity: 'critical' | 'warning' | 'info';
  system:   string;
  desc:     string;
  /** Hangi OBD modundan geldi (araç tarafı doldurur; eski kayıtlarda yok). */
  status?:  'stored' | 'pending' | 'permanent';
}

export interface DtcResult {
  dtcs:      DtcCode[];
  voltage?:  number;
  readAt:    string;
  status:    'completed' | 'pending' | 'failed';
  /**
   * true → araçta en az bir tarama modu okunamadı. BOŞ LİSTE "arıza yok"
   * ANLAMINA GELMEZ; UI bunu "temiz" diye sunamaz (fail-closed).
   */
  partial?:  boolean;
  /** false → araç Mode 0A'yı hiç desteklemiyor ("kalıcı kod yok" ile aynı şey değil). */
  permanentSupported?: boolean;
  /** Komut başarısızsa aracın bildirdiği GERÇEK gerekçe (uydurulmaz). */
  errorReason?: string;
  /** true → gerçek araç okuması DEĞİL, demo verisi. UI bunu görünür işaretler. */
  demo?:     boolean;
}

// Demo DTC codes for offline/demo mode
const DEMO_DTCS: DtcCode[] = [
  { code: 'P0420', severity: 'warning',  system: 'Egzoz',       desc: 'Katalitik Dönüştürücü Verimliliği Düşük (B1)' },
  { code: 'P0171', severity: 'warning',  system: 'Yakıt',       desc: 'Yakıt Karışımı Zayıf (B1) — Hava fazlası' },
  { code: 'P0562', severity: 'critical', system: 'Elektrik',    desc: 'Sistem Voltajı Düşük — Akü veya şarj sistemi' },
];

export async function GET(req: NextRequest) {
  const rawKey    = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const commandId = req.nextUrl.searchParams.get('commandId');
  const vehicleId = req.nextUrl.searchParams.get('vehicleId');

  if (!rawKey || !commandId || !vehicleId) {
    return NextResponse.json({ error: 'Authorization, commandId ve vehicleId zorunlu.' }, { status: 400 });
  }

  // ── Demo mode ──────────────────────────────────────────────────────────────
  if (!isSupabaseConfigured) {
    if (!rawKey.startsWith('demo-api-key-')) {
      return NextResponse.json({ error: 'Geçersiz API anahtarı.' }, { status: 401 });
    }
    await new Promise((r) => setTimeout(r, 800)); // simulate latency
    const result: DtcResult = {
      dtcs:    commandId.includes('clear') ? [] : DEMO_DTCS,
      voltage: 12.4,
      readAt:  new Date().toISOString(),
      status:  'completed',
      // Bu veri hiçbir araçtan OKUNMADI. İşaretlenmezse ürün ekranında gerçek
      // teşhis gibi görünür (P0420/P0171/P0562 uydurma kodlardır).
      demo:    true,
    };
    return NextResponse.json(result);
  }

  // ── Supabase mode ──────────────────────────────────────────────────────────
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

  const { data: cmd, error: cmdErr } = await supabaseAdmin
    .from('vehicle_commands')
    .select('id, status, result, error_reason, created_at')
    .eq('id', commandId)
    .eq('vehicle_id', vehicleId)
    .maybeSingle();

  if (cmdErr || !cmd) {
    return NextResponse.json({ error: 'Komut bulunamadı.' }, { status: 404 });
  }

  const row = cmd as {
    id: string; status: string;
    result?: Record<string, unknown> | null;
    error_reason?: string | null;
    created_at: string;
  };

  if (row.status !== 'completed') {
    // Araç reddetti/başaramadıysa GERÇEK gerekçe taşınır — boş liste sessizce
    // "arıza yok" diye okunamasın diye `partial: true` ile fail-closed işaretlenir.
    const terminal = ['failed', 'rejected', 'expired'].includes(row.status);
    return NextResponse.json({
      status:      row.status,
      dtcs:        [],
      readAt:      row.created_at,
      partial:     terminal,
      errorReason: row.error_reason ?? undefined,
    });
  }

  const result: DtcResult = {
    dtcs:    (row.result?.dtcs as DtcCode[]) ?? [],
    voltage: row.result?.voltage as number | undefined,
    readAt:  (row.result?.readAt as string | undefined) ?? row.created_at,
    status:  'completed',
    // Araç tarafının dürüstlük bayrakları — düşürülürse "kısmi tarama" bilgisi
    // kaybolur ve boş liste "temiz" gibi görünür.
    partial:            row.result?.partial === true,
    permanentSupported: row.result?.permanentSupported as boolean | undefined,
  };

  return NextResponse.json(result);
}
