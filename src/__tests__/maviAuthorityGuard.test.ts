/**
 * maviAuthorityGuard.test.ts — MAVİ M1 · TEK OTORİTE SINIRI (mimari kilit).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * M1 denetimi (2026-07-28) Mavi'nin gerçek karar zincirini koddan çıkardı. Bu dosya
 * o denetimde DOĞRULANAN sınırları, "umarız korunur" bir yorum olmaktan çıkarıp CI'da
 * kırılan bir KİLİDE dönüştürür. DAVRANIŞ DEĞİŞTİRMEZ — yalnız bugünkü sınırı ölçer.
 *
 * KİLİTLENEN SINIRLAR:
 *  1. Ham LLM çıktısı YIKICI araç eylemi ÜRETEMEZ — beyin intent allowlist'i
 *     (BRAIN_INTENTS) DTC silme / kapı kilidi / canlı stil enjeksiyonu İÇERMEZ.
 *  2. Sağlayıcı JSON'u tanınmayan intent taşıyorsa köprü `null` döner (uydurma yok).
 *  3. Güven eşiği altındaki semantik sonuç eyleme DÖNÜŞMEZ.
 *  4. Eylem güvenliği FAIL-CLOSED: bilinmeyen eylem · kapısız araç kapsamı → DENY;
 *     yüksek risk onaysız → CONFIRM (sessiz ALLOW yok).
 *  5. AiSafetyGate anayasal yasakları yapılandırmayla AÇILAMAZ (ecu_write/coding/
 *     adaptation/actuator) ve varsayılan salt-okunurdur.
 *  6. LLM tool yolu yalnız 'read'|'navigate' etkisine izin verir — 'write' ve
 *     'vehicle_command' router seviyesinde kapalıdır.
 *  7. AI sağlayıcı/orkestratör/tool katmanı araç KONTROL servislerini import EDEMEZ
 *     (ham model katmanından doğrudan yan etki yolu açılamaz).
 *  8. TTS tek otorite: `ttsService` DIŞINDA doğrudan konuşan dosyalar SABİT bir
 *     borç listesidir — yeni bypass eklenemez (mevcut 2 istisna belgelenmiştir).
 *
 * TASARIM: kaynak taramaları TAM METİN eşleşmesine bağlanmaz (yorum/biçim serbest);
 * yalnız sözleşme desenleri aranır.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { fromAIResponse, fromSemanticResult } from '../platform/intentEngine';
import { createPilotActionRegistry } from '../platform/maviCore/actionRegistry';
import { evaluateActionIdSafety } from '../platform/maviCore/actionSafety';
import { createAiSafetyGate, HARD_FORBIDDEN_SCOPES } from '../platform/aiCore/safetyGate';
import type { AiSafetyGate } from '../platform/aiCore/safetyGate';
import type { SemanticResult } from '../platform/ai/semanticAiService';

const SRC = join(process.cwd(), 'src');
const read = (...seg: string[]): string => readFileSync(join(process.cwd(), ...seg), 'utf8');

/** src altındaki tüm .ts/.tsx dosyalarını (testler hariç) toplar. */
function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      collectSources(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const ALL_SOURCES = collectSources(SRC);
const rel = (abs: string): string => relative(SRC, abs).split(sep).join('/');

/* ══════════════════════════════════════════════════════════════════════════
 * 1 — Ham LLM çıktısı yıkıcı araç eylemi üretemez
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI M1 · LLM eylem yetkisi sınırı', () => {
  /** companionChatProvider içindeki BRAIN_INTENTS literalini metinden çıkarır. */
  function readBrainIntents(): string[] {
    const src = read('src', 'platform', 'companion', 'companionChatProvider.ts');
    const start = src.indexOf('const BRAIN_INTENTS');
    expect(start, 'BRAIN_INTENTS allowlist bulunamadı — beyin intent kapısı kaldırılmış olabilir').toBeGreaterThan(-1);
    const end = src.indexOf(']);', start);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    return [...block.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  }

  it('beyin allowlist\'i YIKICI/geri-alınamaz araç eylemleri İÇERMEZ', () => {
    const intents = new Set(readBrainIntents());
    const forbidden = [
      'CLEAR_DTC_CODES',      // ECU kayıt silme
      'HARDWARE_LOCK', 'HARDWARE_UNLOCK',
      'HARDWARE_HORN', 'HARDWARE_FLASH',
      'HARDWARE_ALARM_ON', 'HARDWARE_ALARM_OFF',
      'SET_STYLE',            // serbest CSS değişkeni enjeksiyonu
    ];
    for (const intent of forbidden) {
      expect(intents.has(intent), `${intent} ham LLM çıktısıyla tetiklenemez olmalı`).toBe(false);
    }
  });

  it('beyin allowlist\'i BOŞ değildir (kapı yanlışlıkla her şeyi kapatmamalı)', () => {
    expect(readBrainIntents().length).toBeGreaterThan(5);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2/3 — Sağlayıcı çıktısı → intent köprüsü fail-closed
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI M1 · sağlayıcı çıktısı → intent köprüsü', () => {
  it('tanınmayan intent → null (model intent UYDURAMAZ)', () => {
    expect(fromAIResponse({ intent: 'ECU_WRITE', payload: {} }, 'ham metin')).toBeNull();
    expect(fromAIResponse({ intent: 'DROP_TABLE', payload: {} }, 'ham metin')).toBeNull();
  });

  it('bozuk/eksik gövde → null (throw YOK)', () => {
    expect(fromAIResponse(null, 'x')).toBeNull();
    expect(fromAIResponse('OPEN_MUSIC', 'x')).toBeNull();
    expect(fromAIResponse({}, 'x')).toBeNull();
  });

  it('tanınan intent → AppIntent üretir (kapı meşru komutu boğmaz)', () => {
    const intent = fromAIResponse({ intent: 'OPEN_MUSIC', payload: {} }, 'müzik aç');
    expect(intent?.type).toBe('OPEN_MUSIC');
  });

  it('güven eşiği (0.45) altındaki semantik sonuç eyleme DÖNÜŞMEZ', () => {
    const low = { intent: 'OPEN_MUSIC', confidence: 0.44, feedback: '', source: 'direct_ai' } as unknown as SemanticResult;
    expect(fromSemanticResult(low, 'müzik aç')).toBeNull();
  });

  it('UNKNOWN semantik sonuç eyleme DÖNÜŞMEZ', () => {
    const unknown = { intent: 'UNKNOWN', confidence: 0.99, feedback: '', source: 'direct_ai' } as unknown as SemanticResult;
    expect(fromSemanticResult(unknown, 'zzz')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4/5 — Eylem güvenliği + AiSafetyGate fail-closed
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI M1 · eylem güvenliği fail-closed', () => {
  it('bilinmeyen eylem kimliği → DENY', () => {
    const d = evaluateActionIdSafety(createPilotActionRegistry(), createAiSafetyGate(), 'ecu.write.raw');
    expect(d.outcome).toBe('deny');
    expect(d.reason).toBe('unknown_action');
  });

  it('araç kapsamlı eylem + kapı YOK → DENY (kapısız araç eylemi imkânsız)', () => {
    const brokenGate = {} as unknown as AiSafetyGate;
    const d = evaluateActionIdSafety(createPilotActionRegistry(), brokenGate, 'vehicle.health.read');
    expect(d.outcome).toBe('deny');
    expect(d.reason).toBe('vehicle_gate_unavailable');
  });

  it('yüksek riskli eylem onaysız ALLOW olmaz → CONFIRM', () => {
    const d = evaluateActionIdSafety(createPilotActionRegistry(), createAiSafetyGate(), 'phone.call.start');
    expect(d.outcome).toBe('confirm');
  });

  it('AiSafetyGate varsayılanı SALT-OKUNUR ve anayasal yasaklar yapılandırmayla açılamaz', () => {
    expect(createAiSafetyGate().isReadOnly).toBe(true);
    const forced = createAiSafetyGate({ allowedScopes: ['read', 'ecu_write', 'coding', 'adaptation', 'actuator'] });
    for (const scope of HARD_FORBIDDEN_SCOPES) {
      expect(forced.isScopeAllowed(scope), `${scope} hiçbir yapılandırmayla açılamaz`).toBe(false);
      expect(forced.evaluate({ agentId: 'mavi', scope, description: 'guard' }).allowed).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 — LLM tool yolu etki sınırı
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI M1 · LLM tool etki sınırı', () => {
  it('tool router yalnız read/navigate etkisine izin verir', () => {
    const src = read('src', 'platform', 'ai', 'tools', 'toolRouter.ts');
    const m = src.match(/ALLOWED_EFFECTS\s*=\s*new Set\(\[([^\]]*)\]\)/);
    expect(m, 'ALLOWED_EFFECTS allowlist bulunamadı').not.toBeNull();
    const effects = [...(m as RegExpMatchArray)[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(effects).toEqual(['navigate', 'read']);
  });

  it('tool tanımlarında araç komutu / yazma etkisi KAYITLI DEĞİL', () => {
    const src = read('src', 'platform', 'ai', 'tools', 'concrete', 'maviTools.ts');
    expect(src).not.toMatch(/effect:\s*'vehicle_command'/);
    expect(src).not.toMatch(/effect:\s*'write'/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7 — AI model katmanı ↛ araç kontrol servisi
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI M1 · AI model katmanı import sınırı', () => {
  /** Ham model/karar katmanı — yan etki yolu buradan AÇILAMAZ. */
  const RAW_AI_DIRS = ['platform/ai/gateway/', 'platform/ai/orchestrator/', 'platform/ai/tools/', 'platform/ai/planner/'];
  /** Doğrudan yan etki üreten kontrol servisleri. */
  const CONTROL_MODULES = [
    'commandExecutor', 'intentEngine', 'appLauncher', 'navigationService',
    'mediaService', 'obdBluetoothService', 'nativeCommandBridge', 'remoteCommandService',
  ];

  it('gateway/orchestrator/tools/planner araç kontrol servisi import ETMEZ', () => {
    const offenders: string[] = [];
    for (const file of ALL_SOURCES) {
      const r = rel(file);
      if (!RAW_AI_DIRS.some((d) => r.startsWith(d))) continue;
      const src = readFileSync(file, 'utf8');
      for (const mod of CONTROL_MODULES) {
        // `import ... from '.../<mod>'` ve dinamik `import('.../<mod>')` — tip-only import serbest.
        const re = new RegExp(`(?<!import type )from '[^']*/${mod}'|import\\('[^']*/${mod}'\\)`);
        if (re.test(src)) offenders.push(`${r} → ${mod}`);
      }
    }
    expect(offenders, 'ham AI katmanı araç kontrol servisini doğrudan çağıramaz').toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8 — TTS tek otorite (borç kilidi)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI M1 · TTS tek otorite', () => {
  /**
   * BİLİNEN BORÇ: `ttsService`'i atlayarak doğrudan konuşan dosyalar → dedupe ·
   * `__SAFETY_LOCK__` · ducking · cancel korumaları UYGULANMAZ.
   *
   * Liste KİLİTTİR: yeni bypass eklenemez, borç kapandıkça KISALIR.
   * · M1 (2026-07-28): 2 dosya.
   * · M6 (2026-07-28): `useVoiceCommandHandler._speakAndToast` bypass'ı KALDIRILDI
   *   → tek TTS otoritesine (`speakMaviAnswer` → `ttsService`) bağlandı.
   * KALAN: `notificationService` (Mavi komut hattı DIŞINDA — bildirim okuma;
   * ayrı borç olarak açık, bkz. M6 raporu).
   */
  const KNOWN_TTS_BYPASS = [
    'platform/notificationService.ts',   // window.speechSynthesis.speak
  ].sort();

  it('ttsService dışında doğrudan konuşan dosyalar SABİT borç listesidir', () => {
    const offenders: string[] = [];
    for (const file of ALL_SOURCES) {
      const r = rel(file);
      if (r === 'platform/ttsService.ts') continue;             // tek meşru otorite
      const src = readFileSync(file, 'utf8');
      if (/CarLauncher\.speak(Segments)?\(/.test(src) || /speechSynthesis\.speak\(/.test(src)) {
        offenders.push(r);
      }
    }
    expect(offenders.sort()).toEqual(KNOWN_TTS_BYPASS);
  });
});
