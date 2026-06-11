/**
 * voiceDiag.test.ts — P0 Voice Diagnostics sözleşmesi
 *
 * Kapsam:
 *  1. Sanitize       — transcript metni YAPISAL olarak sızamaz; string clamp;
 *                      sabit payload şeması (whitelist dışı anahtar yok)
 *  2. Rate limit     — stage başına 60sn/5 (fırtına koruması), pencere sıfırlama
 *  3. Offline queue  — taşıyıcı reddi yutulur (asistanı düşürmez), payload
 *                      pushVehicleEvent('voice_diag', …) ile kuyruğa gider
 *  4. Payload        — stage/durationMs/appVersion/bootId zorunlu alanları;
 *                      durationMs voice_start'tan monotonic
 *  5. Admin filtre   — INCIDENT_TYPES + getRemoteIncidents sorgusu voice_diag
 *  6. Migration 022  — sunucu guard/retention/indeks sözleşmesi (statik)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const M = vi.hoisted(() => ({
  pushed: [] as Array<{ type: string; payload: Record<string, unknown> }>,
  pushImpl: null as (() => Promise<unknown>) | null,
}));

vi.mock('../platform/vehicleIdentityService', () => ({
  pushVehicleEvent: (type: string, payload: Record<string, unknown>) => {
    M.pushed.push({ type, payload });
    return M.pushImpl ? M.pushImpl() : Promise.resolve('evt-id');
  },
}));
vi.mock('../platform/remoteLogService', () => ({
  getRemoteLogSession: () => ({ bootId: 'boot1234', appVersion: '1.0.0-test' }),
}));

import {
  reportVoiceDiag,
  VOICE_DIAG_STAGES,
  VOICE_DIAG_MAX_PER_STAGE,
  VOICE_DIAG_WINDOW_MS,
  _resetVoiceDiagForTest,
  type VoiceDiagStage,
} from '../platform/voiceDiagService';

const ALLOWED_KEYS = new Set([
  'stage', 'durationMs', 'appVersion', 'bootId',
  'transcriptLength', 'intent', 'command', 'provider', 'errorCode',
]);

let nowSpy: ReturnType<typeof vi.spyOn>;
let _t = 0;

function setNow(ms: number): void { _t = ms; }

beforeEach(() => {
  _resetVoiceDiagForTest();
  M.pushed = [];
  M.pushImpl = null;
  _t = 1_000;
  nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => _t);
});

afterEach(() => {
  nowSpy.mockRestore();
  _resetVoiceDiagForTest();
});

/* ── 1. Sanitize ─────────────────────────────────────────────── */

describe('sanitize — transcript metni sızamaz', () => {
  it('transcript alanı API dışından zorlansa bile payload\'a GİRMEZ', async () => {
    await reportVoiceDiag('voice_transcript', {
      transcriptLength: 12,
      transcript: 'eve git çok gizli adres',  // şema dışı — düşmeli
      lat: 41.01, msg: 'serbest metin',        // şema dışı — düşmeli
    } as never);

    expect(M.pushed).toHaveLength(1);
    const p = M.pushed[0].payload;
    expect(p).not.toHaveProperty('transcript');
    expect(p).not.toHaveProperty('lat');
    expect(p).not.toHaveProperty('msg');
    expect(p['transcriptLength']).toBe(12);
  });

  it('payload anahtarları sabit whitelist\'in alt kümesi', async () => {
    await reportVoiceDiag('voice_intent', {
      transcriptLength: 8, intent: 'play_music', command: 'x',
      provider: 'gemini', errorCode: 'E1',
    });
    for (const key of Object.keys(M.pushed[0].payload)) {
      expect(ALLOWED_KEYS.has(key), `beklenmeyen anahtar: ${key}`).toBe(true);
    }
  });

  it('string alanlar 64 karaktere kırpılır', async () => {
    await reportVoiceDiag('voice_intent', { intent: 'x'.repeat(200) });
    expect((M.pushed[0].payload['intent'] as string).length).toBe(64);
  });

  it('geçersiz transcriptLength (negatif/NaN) yazılmaz; ondalık floor\'lanır', async () => {
    await reportVoiceDiag('voice_transcript', { transcriptLength: -5 });
    expect(M.pushed[0].payload).not.toHaveProperty('transcriptLength');
    await reportVoiceDiag('voice_transcript', { transcriptLength: 12.9 });
    expect(M.pushed[1].payload['transcriptLength']).toBe(12);
  });

  it('geçersiz stage (runtime) gönderilmez', async () => {
    const ok = await reportVoiceDiag('voice_hacked' as VoiceDiagStage);
    expect(ok).toBe(false);
    expect(M.pushed).toHaveLength(0);
  });
});

/* ── 2. Rate limit (fırtına koruması) ────────────────────────── */

describe('fırtına koruması — stage başına 60sn/5', () => {
  it('aynı stage 6. çağrıda düşer; farklı stage etkilenmez', async () => {
    for (let i = 0; i < 6; i++) {
      await reportVoiceDiag('voice_error', { errorCode: `E${i}` });
    }
    expect(M.pushed).toHaveLength(VOICE_DIAG_MAX_PER_STAGE); // 5

    const ok = await reportVoiceDiag('voice_success'); // farklı stage → bağımsız pencere
    expect(ok).toBe(true);
    expect(M.pushed).toHaveLength(VOICE_DIAG_MAX_PER_STAGE + 1);
  });

  it('60sn pencere dolunca aynı stage yeniden gönderilir', async () => {
    for (let i = 0; i < 5; i++) await reportVoiceDiag('voice_error');
    expect(await reportVoiceDiag('voice_error')).toBe(false); // tavan

    setNow(1_000 + VOICE_DIAG_WINDOW_MS + 1); // pencere sıfırlandı
    expect(await reportVoiceDiag('voice_error')).toBe(true);
    expect(M.pushed).toHaveLength(6);
  });
});

/* ── 3. Offline queue / taşıyıcı ─────────────────────────────── */

describe('taşıyıcı — at-least-once kuyruk hattı', () => {
  it('event pushVehicleEvent(voice_diag, …) ile kuyruğa verilir', async () => {
    await reportVoiceDiag('voice_start');
    expect(M.pushed[0].type).toBe('voice_diag');
  });

  it('taşıyıcı reddi (çevrimdışı/enqueue hatası) yutulur — asla throw yok', async () => {
    M.pushImpl = () => Promise.reject(new Error('offline'));
    const ok = await reportVoiceDiag('voice_start');
    expect(ok).toBe(false); // kontrollü false; exception sızmadı
  });
});

/* ── 4. Payload doğrulama ────────────────────────────────────── */

describe('payload — zorunlu alanlar + monotonic süre', () => {
  it('stage/durationMs/appVersion/bootId her event\'te var', async () => {
    await reportVoiceDiag('voice_listening');
    const p = M.pushed[0].payload;
    expect(p['stage']).toBe('voice_listening');
    expect(typeof p['durationMs']).toBe('number');
    expect(p['appVersion']).toBe('1.0.0-test');
    expect(p['bootId']).toBe('boot1234');
  });

  it('durationMs voice_start\'tan itibaren monotonic ölçülür', async () => {
    setNow(2_000);
    await reportVoiceDiag('voice_start');
    expect(M.pushed[0].payload['durationMs']).toBe(0);

    setNow(4_500);
    await reportVoiceDiag('voice_transcript', { transcriptLength: 9 });
    expect(M.pushed[1].payload['durationMs']).toBe(2_500);

    setNow(5_250);
    await reportVoiceDiag('voice_success');
    expect(M.pushed[2].payload['durationMs']).toBe(3_250);
  });

  it('11 aşamanın tamamı geçerli', async () => {
    // 11.: 'voice_route' — smalltalk/komut hat ayrımı tanısı (P0 2026-06-11)
    expect(VOICE_DIAG_STAGES).toHaveLength(11);
    for (const stage of VOICE_DIAG_STAGES) {
      _resetVoiceDiagForTest();
      expect(await reportVoiceDiag(stage)).toBe(true);
    }
  });
});

/* ── 5. Admin filtre (kaynak sözleşmesi) ─────────────────────── */

describe('admin — Incident Center voice_diag filtresi', () => {
  const svcSrc = readFileSync(
    join(process.cwd(), 'src', 'admin', 'services', 'superadmin.service.ts'), 'utf-8');
  const centerSrc = readFileSync(
    join(process.cwd(), 'src', 'admin', 'pages', 'superadmin', 'IncidentCenter.tsx'), 'utf-8');
  const vehiclesSrc = readFileSync(
    join(process.cwd(), 'src', 'admin', 'pages', 'Vehicles.tsx'), 'utf-8');

  it('INCIDENT_TYPES voice_diag içerir → filtre dropdown\'ı otomatik üretir', () => {
    expect(svcSrc).toMatch(/INCIDENT_TYPES = \[.*'voice_diag'.*\] as const/);
    // IncidentCenter filtresi diziden map'leniyor (sabit liste değil)
    expect(centerSrc).toContain('INCIDENT_TYPES.map');
    expect(centerSrc).toMatch(/voice_diag:\s*\{/); // TYPE_STYLE girdisi (derleyici de zorlar)
  });

  it('araç detayı: VoiceDiagPanel son 50 kaydı type=voice_diag ile çeker', () => {
    const panelSrc = readFileSync(
      join(process.cwd(), 'src', 'admin', 'components', 'vehicles', 'VoiceDiagPanel.tsx'), 'utf-8');
    expect(panelSrc).toMatch(/type:\s*'voice_diag'/);
    expect(panelSrc).toMatch(/limit:\s*LIMIT/);
    expect(panelSrc).toMatch(/const LIMIT = 50/);
    expect(vehiclesSrc).toContain('VoiceDiagPanel');
  });
});

/* ── 6. Migration 022 sözleşmesi (statik) ────────────────────── */

describe('migration 022 — sunucu guard/retention/indeks', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase', 'migrations', '20260610000022_voice_diag_log_type.sql'), 'utf-8');

  it('voice_diag üç bekçide de var: rate limit + retention + indeks', () => {
    // push_vehicle_event c_log_types
    expect(sql).toMatch(/c_log_types\s+constant text\[\]\s+:= ARRAY\[.*'voice_diag'\]/);
    // retention DELETE listesi
    expect(sql).toMatch(/DELETE FROM public\.vehicle_events\s+WHERE type IN \(.*'voice_diag'\)/);
    // kısmi indeks WHERE listesi
    expect(sql).toMatch(/CREATE INDEX idx_vehicle_events_log_rate[\s\S]*WHERE type IN \(.*'voice_diag'\)/);
  });

  it('RPC imzası ve GRANT disiplini korunur (020 ile aynı)', () => {
    expect(sql).toMatch(/p_api_key text,\s*p_type\s+text,\s*p_payload jsonb DEFAULT '\{\}'\s*\) RETURNS uuid/);
    expect(sql).toContain("GRANT  EXECUTE ON FUNCTION public.push_vehicle_event(text, text, jsonb) TO anon, authenticated;");
    expect(sql).toContain('GRANT  EXECUTE ON FUNCTION public.cleanup_vehicle_log_events() TO service_role;');
    expect(sql).not.toContain('DROP FUNCTION'); // imza aynı → GRANT'lar korunur
    expect(sql).not.toContain('service_role key'); // cihaz yolu anon kalır
  });

  it('verification DO bloğu kendi kendini doğruluyor', () => {
    expect(sql).toMatch(/pg_get_functiondef[\s\S]*voice_diag/);
    expect(sql).toMatch(/RAISE EXCEPTION 'voice_diag:/);
  });
});
