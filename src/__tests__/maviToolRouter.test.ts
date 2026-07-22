/**
 * maviToolRouter.test.ts — Mavi Tool Router (Faz 1).
 *
 * Kilitlenen davranışlar:
 *  1) İzin/şalter kapalıyken araç ÇALIŞMAZ ve model araç GÖRMEZ
 *  2) ALLOWLIST: kayıtlı olmayan ad reddedilir
 *  3) Şema doğrulaması: bilinmeyen alan/yanlış tip/aralık dışı REDDEDİLİR
 *  4) Onay gerektiren araç ÇALIŞTIRILMAZ
 *  5) Yazma/ECU etkili araç ÇALIŞTIRILMAZ (Faz 1 read/navigate)
 *  6) Timeout · abort · bounded sonuç · handler throw ederse router throw ETMEZ
 *  7) Ortak sözleşme → OpenAI + Gemini şemaları AYNI tanımdan türer
 *  8) Faz 1 araçları SALT-OKUNUR (yazma/OBD komutu yok — yapısal kilit)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createToolRouter,
  DEFAULT_TOOL_TIMEOUT_MS,
  MAX_RESULT_FIELDS,
  MAX_STRING_VALUE_CHARS,
} from '../platform/ai/tools/toolRouter';
import { toGeminiFunctionDeclarations, toOpenAiTools } from '../platform/ai/tools/providerToolSchema';
import type { ToolDefinition } from '../platform/ai/tools/toolTypes';

const G = vi.hoisted(() => ({ enabled: true, consent: true }));

const readTool: ToolDefinition = {
  name: 'read_thing', description: 'Bir şey okur', effect: 'read',
  parameters: {
    mode:  { type: 'enum', description: 'mod', required: true, values: ['a', 'b'] },
    limit: { type: 'number', description: 'sınır', min: 1, max: 10 },
    note:  { type: 'string', description: 'not', maxLength: 20 },
    flag:  { type: 'boolean', description: 'bayrak' },
  },
  handler: (args) => ({ ok: true, data: { got: String(args['mode']) }, summary: 'okundu' }),
};

const router = (tools: readonly ToolDefinition[] = [readTool]) => createToolRouter({
  tools,
  enabled: () => G.enabled,
  consent: () => G.consent,
  clock:   { nowMs: () => 0 },
});

beforeEach(() => { G.enabled = true; G.consent = true; });

/* ══════════════ 1) İzin kapıları ══════════════ */

describe('izin kapıları — fail-closed', () => {
  it('şalter kapalıyken araç listesi BOŞ ve çağrı reddedilir', async () => {
    G.enabled = false;
    const r = router();
    expect(r.listTools()).toHaveLength(0);
    const out = await r.call('read_thing', { mode: 'a' });
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.error).toBe('not_permitted');
  });

  it('izin yokken de reddedilir', async () => {
    G.consent = false;
    const out = await router().call('read_thing', { mode: 'a' });
    if (!out.result.ok) expect(out.result.error).toBe('not_permitted');
    expect(router().listTools()).toHaveLength(0);
  });

  it('kapı okuması patlarsa KAPALI sayılır', async () => {
    const r = createToolRouter({
      tools: [readTool],
      enabled: () => { throw new Error('bozuk'); },
      consent: () => true,
    });
    const out = await r.call('read_thing', { mode: 'a' });
    if (!out.result.ok) expect(out.result.error).toBe('not_permitted');
  });

  it('kapı fonksiyonu VERİLMEZSE kapalıdır (varsayılan açık DEĞİL)', async () => {
    const r = createToolRouter({ tools: [readTool] });
    const out = await r.call('read_thing', { mode: 'a' });
    if (!out.result.ok) expect(out.result.error).toBe('not_permitted');
  });
});

/* ══════════════ 2) Allowlist + effect ══════════════ */

describe('allowlist ve yan etki kapısı', () => {
  it('kayıtlı olmayan araç REDDEDİLİR', async () => {
    const out = await router().call('rm_rf', {});
    if (!out.result.ok) expect(out.result.error).toBe('unknown_tool');
  });

  it('geçersiz adlı tanım kayıt defterine ALINMAZ', async () => {
    const bad: ToolDefinition = { ...readTool, name: 'Bad Name!' };
    const out = await router([bad]).call('Bad Name!', { mode: 'a' });
    if (!out.result.ok) expect(out.result.error).toBe('unknown_tool');
  });

  it('YAZMA etkili araç ÇALIŞTIRILMAZ ve listelenmez', async () => {
    const writeTool: ToolDefinition = { ...readTool, name: 'write_thing', effect: 'write' };
    const r = router([writeTool]);
    expect(r.listTools()).toHaveLength(0);
    const out = await r.call('write_thing', { mode: 'a' });
    if (!out.result.ok) expect(out.result.error).toBe('not_permitted');
  });

  it('ARAÇ KOMUTU etkili araç ÇALIŞTIRILMAZ', async () => {
    const cmd: ToolDefinition = { ...readTool, name: 'clear_dtc', effect: 'vehicle_command' };
    const out = await router([cmd]).call('clear_dtc', { mode: 'a' });
    if (!out.result.ok) expect(out.result.error).toBe('not_permitted');
  });

  it('ONAY gerektiren araç ÇALIŞTIRILMAZ ve listelenmez', async () => {
    const confirm: ToolDefinition = { ...readTool, name: 'needs_ok', requiresConfirmation: true };
    const r = router([confirm]);
    expect(r.listTools()).toHaveLength(0);
    const out = await r.call('needs_ok', { mode: 'a' });
    if (!out.result.ok) expect(out.result.error).toBe('requires_confirmation');
  });
});

/* ══════════════ 3) Şema doğrulaması ══════════════ */

describe('şema doğrulaması', () => {
  it('geçerli argümanlar kabul edilir', async () => {
    const out = await router().call('read_thing', { mode: 'a', limit: 5, note: 'kısa', flag: true });
    expect(out.result.ok).toBe(true);
  });

  it('BİLİNMEYEN alan REDDEDİLİR', async () => {
    const out = await router().call('read_thing', { mode: 'a', evil: 'x' });
    if (!out.result.ok) expect(out.result.error).toBe('invalid_arguments');
  });

  it('zorunlu alan eksikse REDDEDİLİR', async () => {
    const out = await router().call('read_thing', {});
    if (!out.result.ok) expect(out.result.error).toBe('invalid_arguments');
  });

  it('enum ALLOWLIST dışı değer REDDEDİLİR', async () => {
    const out = await router().call('read_thing', { mode: 'zzz' });
    if (!out.result.ok) expect(out.result.error).toBe('invalid_arguments');
  });

  it('yanlış tip REDDEDİLİR', async () => {
    for (const bad of [{ mode: 1 }, { mode: 'a', limit: 'x' }, { mode: 'a', flag: 'true' }]) {
      const out = await router().call('read_thing', bad);
      if (!out.result.ok) expect(out.result.error).toBe('invalid_arguments');
    }
  });

  it('sayı aralık dışı ve NaN REDDEDİLİR', async () => {
    for (const bad of [{ mode: 'a', limit: 0 }, { mode: 'a', limit: 99 }, { mode: 'a', limit: Number.NaN }]) {
      const out = await router().call('read_thing', bad);
      if (!out.result.ok) expect(out.result.error).toBe('invalid_arguments');
    }
  });

  it('çok uzun string REDDEDİLİR', async () => {
    const out = await router().call('read_thing', { mode: 'a', note: 'x'.repeat(50) });
    if (!out.result.ok) expect(out.result.error).toBe('invalid_arguments');
  });

  it('dizi/primitive argüman gövdesi REDDEDİLİR', async () => {
    for (const bad of [[1, 2], 'string', 42]) {
      const out = await router().call('read_thing', bad);
      if (!out.result.ok) expect(out.result.error).toBe('invalid_arguments');
    }
  });
});

/* ══════════════ 4) Yürütme güvenliği ══════════════ */

describe('yürütme güvenliği', () => {
  it('iptal edilmiş istekte araç ÇALIŞMAZ', async () => {
    let ran = false;
    const t: ToolDefinition = { ...readTool, handler: () => { ran = true; return { ok: true, data: {}, summary: '' }; } };
    const ctrl = new AbortController();
    ctrl.abort();
    const out = await router([t]).call('read_thing', { mode: 'a' }, { signal: ctrl.signal });
    expect(ran).toBe(false);
    if (!out.result.ok) expect(out.result.error).toBe('aborted');
  });

  it('TIMEOUT: takılan araç zaman aşımına uğrar', async () => {
    const slow: ToolDefinition = { ...readTool, handler: () => new Promise(() => { /* asla dönmez */ }) };
    const out = await router([slow]).call('read_thing', { mode: 'a' }, { timeoutMs: 20 });
    if (!out.result.ok) expect(out.result.error).toBe('timeout');
  });

  it('handler THROW ederse router throw ETMEZ', async () => {
    const boom: ToolDefinition = { ...readTool, handler: () => { throw new Error('patladı'); } };
    const out = await router([boom]).call('read_thing', { mode: 'a' });
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.error).toBe('failed');
  });

  it('şekilsiz sonuç REDDEDİLİR', async () => {
    const bad: ToolDefinition = { ...readTool, handler: () => ({ nonsense: true } as never) };
    const out = await router([bad]).call('read_thing', { mode: 'a' });
    if (!out.result.ok) expect(out.result.error).toBe('failed');
  });

  it('sonuç BOUNDED: alan sayısı, metin uzunluğu, NaN/nesne elenir', async () => {
    const fat: ToolDefinition = {
      ...readTool,
      handler: () => {
        const data: Record<string, unknown> = { long: 'x'.repeat(500), bad: Number.NaN, obj: { a: 1 } };
        for (let i = 0; i < 40; i++) data[`f${i}`] = i;
        return { ok: true, data: data as never, summary: 'y'.repeat(1000) };
      },
    };
    const out = await router([fat]).call('read_thing', { mode: 'a' });
    expect(out.result.ok).toBe(true);
    if (out.result.ok) {
      expect(Object.keys(out.result.data).length).toBeLessThanOrEqual(MAX_RESULT_FIELDS);
      expect(out.result.summary.length).toBeLessThanOrEqual(240);
      const values = Object.values(out.result.data);
      expect(values.every((v) => typeof v !== 'object')).toBe(true);
      expect(values.some((v) => typeof v === 'number' && Number.isNaN(v))).toBe(false);
      for (const v of values) if (typeof v === 'string') expect(v.length).toBeLessThanOrEqual(MAX_STRING_VALUE_CHARS);
    }
  });

  it('varsayılan timeout makul ve telemetri güvenli metadata taşır', async () => {
    expect(DEFAULT_TOOL_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
    const out = await router().call('read_thing', { mode: 'a' });
    expect(Object.keys(out.telemetry).sort()).toEqual(
      ['durationMs', 'effect', 'ok', 'resultFields', 'toolName'].sort(),
    );
    expect(JSON.stringify(out.telemetry)).not.toContain('okundu');   // sonuç metni YOK
  });
});

/* ══════════════ 5) Ortak sağlayıcı sözleşmesi ══════════════ */

describe('ortak tool sözleşmesi — OpenAI + Gemini', () => {
  it('iki sağlayıcı AYNI tanımdan türetilir', () => {
    const openai = toOpenAiTools([readTool]) as Array<{ function: { name: string; parameters: Record<string, unknown> } }>;
    const gemini = toGeminiFunctionDeclarations([readTool]) as Array<{ name: string; parameters: Record<string, unknown> }>;

    expect(openai[0]!.function.name).toBe('read_thing');
    expect(gemini[0]!.name).toBe('read_thing');
    expect(openai[0]!.function.parameters).toEqual(gemini[0]!.parameters);   // TEK şema
  });

  it('enum ALLOWLIST ve zorunluluk şemaya taşınır; ek alan yasaklanır', () => {
    const schema = (toOpenAiTools([readTool])[0] as { function: { parameters: {
      properties: Record<string, { type: string; enum?: string[] }>;
      required: string[]; additionalProperties: boolean;
    } } }).function.parameters;

    expect(schema.properties['mode']!.enum).toEqual(['a', 'b']);
    expect(schema.required).toEqual(['mode']);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties['limit']!.type).toBe('number');
    expect(schema.properties['flag']!.type).toBe('boolean');
  });

  it('çevirici SAF: girdi mutasyona uğramaz', () => {
    const snapshot = JSON.stringify(readTool.parameters);
    toOpenAiTools([readTool]);
    toGeminiFunctionDeclarations([readTool]);
    expect(JSON.stringify(readTool.parameters)).toBe(snapshot);
  });
});

/* ══════════════ 6) Faz 1 araç kümesi — yapısal kilitler ══════════════ */

describe('Faz 1 araçları SALT-OKUNUR', () => {
  const code = (p: string): string => readFileSync(p, 'utf8')
    .replace(new RegExp('/\\*[\\s\\S]*?\\*/', 'g'), ' ')
    .replace(new RegExp('(^|[^:])//.*$', 'gm'), '$1');

  it('yalnız read/navigate etkili araçlar tanımlı', async () => {
    const { MAVI_TOOLS } = await import('../platform/ai/tools/concrete/maviTools');
    expect(MAVI_TOOLS).toHaveLength(4);
    for (const t of MAVI_TOOLS) {
      expect(['read', 'navigate']).toContain(t.effect);
      expect(t.requiresConfirmation).not.toBe(true);
      expect(t.name).toMatch(/^[a-z0-9_]{1,40}$/);
    }
  });

  it('araçlar YAZMA/OBD komutu/DTC temizleme ÇAĞIRMAZ', () => {
    const src = code('src/platform/ai/tools/concrete/maviTools.ts');
    for (const forbidden of ['sendCommand', 'clearDTC', 'clearDtc', 'startOBD', 'setSetting',
                             'updateSettings', 'addFact', 'writeFile', 'localStorage']) {
      expect(src, `araç '${forbidden}' çağırıyor`).not.toContain(forbidden);
    }
  });

  it('araçlar yeni polling/abonelik OLUŞTURMAZ', () => {
    const src = code('src/platform/ai/tools/concrete/maviTools.ts');
    expect(src).not.toMatch(/setInterval|setTimeout|subscribe\(/);
  });

  it('ekran aracı KANONİK ALLOWLIST kullanır (fuzzy değil)', () => {
    const src = code('src/platform/ai/tools/concrete/maviTools.ts');
    expect(src).toMatch(/getScreenById/);
    expect(src, 'serbest metinden ekran çözümü tool yüzeyine açılmış').not.toMatch(/resolveScreen/);
    expect(src).toMatch(/screenIds\(\)/);
  });

  it('araç modülleri LOGLAMAZ', () => {
    for (const f of ['toolRouter.ts', 'providerToolSchema.ts', 'concrete/maviTools.ts']) {
      const src = code(`src/platform/ai/tools/${f}`);
      expect(src, f).not.toMatch(/console\./);
      expect(src, f).not.toMatch(/logInfo|logError|telemetry\./i);
    }
  });

  it('supportsTools YALNIZ tool yolu GERÇEKTEN uygulanmış sağlayıcıda true', () => {
    // Faz 2'de OpenRouter'ın tool gönderimi + tool_calls ayrıştırması UYGULANDI
    // → yeteneği bildirmek artık DOĞRU. Uygulanmayan sağlayıcı (Gemini) hâlâ
    // false olmalı; aksi hâlde SAHTE yetenek ilan edilmiş olur.
    const adapter = code('src/platform/ai/orchestrator/capabilityAdapter.ts');
    const table = adapter.slice(adapter.indexOf('CAPABILITY_HINTS'), adapter.indexOf('ProviderRegistryEntry'));
    const geminiBlock = table.slice(table.indexOf('gemini:'));
    expect(geminiBlock, 'Gemini tool yolu yokken supportsTools:true bildirmiş').toMatch(/supportsTools:\s*false/);

    // Kanıt: OpenRouter provider'ı tools gönderiyor VE tool_calls ayrıştırıyor.
    const provider = code('src/platform/ai/gateway/providers/openRouterProvider.ts');
    expect(provider, 'supportsTools:true iddiası için tools gönderimi yok').toMatch(/body\['tools'\]/);
    expect(provider, 'supportsTools:true iddiası için tool_calls ayrıştırması yok').toMatch(/readToolCalls/);

    // Gemini provider'ı tool GÖNDERMİYOR olmalı (iddia ile kod tutarlı).
    const gemini = code('src/platform/ai/gateway/providers/geminiProvider.ts');
    expect(gemini).not.toMatch(/functionDeclarations|body\['tools'\]/);
  });
});
