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

/* ── 6. Sunucu sözleşmesi — NEREYE TAŞINDI (kütük #588) ──────────
 *
 * Buradaki blok migration 022'nin SQL METNİNİ okuyup `voice_diag`ın üç sunucu
 * bekçisinde (rate limit · retention · kısmi indeks) yer aldığını doğruluyordu.
 * #583'ün baseline squash'ı 022'yi `supabase/migrations_archive/`'e taşıyınca
 * bu dosya YÜKLEME ANINDA düşüyordu — yani buradaki her şey ölüydü.
 *
 * İddia SİLİNMEDİ, TAŞINDI: `prodBaselineSecurityGuards.test.ts` içindeki
 * "voice_diag üç bekçinin de kapsamında" kilidi aynı üç şeyi artık üretimin
 * gerçeğine (`00000000000000_prod_baseline.sql`) soruyor — migration'ın
 * niyetine değil. Yukarıdaki bloklar (istemci akışı, admin filtre sözleşmesi)
 * bu dosyada kalır; onların sunucuda karşılığı yoktur.
 */
