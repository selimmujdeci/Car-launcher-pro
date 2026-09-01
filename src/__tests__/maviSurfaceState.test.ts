/**
 * maviSurfaceState.test.ts — **MAVİ F11 KİLİTLERİ (UI durum mimarisi v2).**
 *
 * F11'in sözleşmesini kilitler:
 *  · kullanıcıya görünen durum TEK kanonik modelden türer (11 bounded durum),
 *  · **UI bir OTORİTE DEĞİLDİR** — eylem yürütmez, gerçek üretmez,
 *  · **"düşünüyor/bakıyor" gibi iç akıl yürütme göstergesi GERİ GELEMEZ** (F2/I7),
 *  · sürüşte yüzey KOMPAKTtır ve navigasyon/müzik ekranı KAPANMAZ,
 *  · iş yükü yüzeyi daraltır ama capability KAPATMAZ (F8),
 *  · **wake-word ayarı Yol Arkadaşı presence'ından BAĞIMSIZDIR** (F1 borcu),
 *  · wake ayarı HER ZAMAN erişilebilir (gizli durum YOK),
 *  · `ACCEPTED` "tamamlandı" gibi GÖSTERİLMEZ (F7),
 *  · bayat proaktif/erteleme yüzeyde gösterilmez (F8/F9),
 *  · DEGRADED ayakta kalan yeteneği söyler, "AI çalışmıyor" demez,
 *  · onay/süren iş sırasında pencere otomatik KAPANMAZ,
 *  · F0–F10 invaryantları BOZULMAZ.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MAVI_DEGRADED_LABEL,
  MAVI_FORBIDDEN_LABEL_STEMS,
  MAVI_OBSERVATION_LABEL,
  MAVI_SURFACE_LABEL,
  MAVI_TOUCH_PX_COMPACT,
  deriveMaviSurface,
  deriveSurfaceMode,
  getMaviSurfaceDiagnostics,
  noteFullScreenBlocked,
  noteMaviSurface,
  observationCountsAsDone,
  surfaceShouldAutoClose,
  _resetMaviSurfaceForTest,
  type MaviSurfaceInputs,
} from '../platform/assistant/maviSurfaceState';
import {
  companionStatusFromSurface, deriveCompanionStatus,
} from '../platform/livingThemeState';
import { voiceOverlayShouldAutoClose } from '../components/modals/VoiceAssistant';
import { buildMaviSections } from '../platform/devtools/maviConsoleModel';
import type { MaviRawSnapshot } from '../platform/devtools/maviConsoleModel';

const src = (rel: string): string => readFileSync(join(process.cwd(), 'src', rel), 'utf8');
const codeOf = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const MODEL = 'platform/assistant/maviSurfaceState.ts';
const HOOK = 'hooks/useMaviSurface.ts';
const OVERLAY = 'components/modals/VoiceAssistant.tsx';
const WAKE = 'platform/wakeWordService.ts';
const SETTINGS = 'components/settings/SettingsPage.tsx';

/** Kanıtsız taban girdi — testler yalnız ilgilendikleri alanı ezer. */
const inp = (p: Partial<MaviSurfaceInputs> = {}): MaviSurfaceInputs => ({
  voiceStatus: 'idle',
  followUp: false,
  hasError: false,
  wakeArmed: false,
  workload: 'UNKNOWN',
  motionState: 'unknown',
  pendingConfirmation: false,
  actionInFlight: false,
  proactiveInFlight: false,
  deferredPending: false,
  degraded: 'NONE',
  ...p,
});

beforeEach(() => { _resetMaviSurfaceForTest(); });

/* ══════════════════════════════════════════════════════════════════════════
 * A — SAFLIK ve OTORİTE SINIRI
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F11 · A · UI bir otorite değildir', () => {
  it('1. model SAFTIR: I/O · timer · `Date.now` · store · React YOK', () => {
    const code = codeOf(src(MODEL));
    for (const forbidden of [
      'Date.now', 'setTimeout', 'setInterval', 'performance.now',
      'localStorage', 'useStore', 'react', 'fetch(',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('2. yüzey katmanı EYLEM YÜRÜTMEZ ve GERÇEK ÜRETMEZ', () => {
    for (const f of [MODEL, HOOK]) {
      const code = codeOf(src(f));
      for (const forbidden of [
        'dispatchIntent', 'executeIntent', 'startNavigation', 'speakAssistant',
        'speakMaviAnswer', 'rememberExplicit', 'evaluateProactiveProposals',
        'setPendingAction', 'updateSettings',
      ]) {
        expect(code, `${f}:${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('3. kanonik otoriteler yüzeyi OKUMAZ (tek yönlü bağımlılık)', () => {
    for (const f of [
      'platform/action/maviActionAuthority.ts',
      'platform/assistant/assistantSafetyKernel.ts',
      'platform/assistant/maviWorkload.ts',
      'platform/assistant/maviMemory.ts',
      'platform/capability/fabric/capabilityFabric.ts',
    ]) {
      expect(codeOf(src(f)), f).not.toContain('maviSurfaceState');
    }
  });

  it('4. hook YENİ abonelik/timer AÇMAZ (mevcut kaynakları okur)', () => {
    const code = codeOf(src(HOOK));
    expect(code).not.toContain('setInterval');
    expect(code).not.toContain('setTimeout');
    expect(code).toContain('useVoiceState');
    expect(code).toContain('useWakeWordState');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B — "THINKING" GÖSTERİLMEZ (F2 / I7)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F11 · B · iç akıl yürütme gösterilmez', () => {
  it('5. **HİÇBİR durum etiketi yasak sözcük İÇERMEZ**', () => {
    for (const [state, label] of Object.entries(MAVI_SURFACE_LABEL)) {
      const low = label.toLocaleLowerCase('tr');
      for (const stem of MAVI_FORBIDDEN_LABEL_STEMS) {
        expect(low.includes(stem), `${state} → "${label}" (${stem})`).toBe(false);
      }
    }
  });

  it('6. yetenek kaybı rozetleri de yasak sözcük İÇERMEZ', () => {
    for (const label of Object.values(MAVI_DEGRADED_LABEL)) {
      const low = label.toLocaleLowerCase('tr');
      for (const stem of MAVI_FORBIDDEN_LABEL_STEMS) {
        expect(low.includes(stem), `"${label}" (${stem})`).toBe(false);
      }
    }
  });

  it('7. **"AI düşünüyor" ÜRETİM YÜZEYİNDEN KALDIRILDI ve geri gelemez**', () => {
    /* Ölçülen kusur: `VoiceAssistant.tsx` tam ekran yüzeyde `processing`
       durumunda modelin iç işleyişini anlatan bir cümle basıyordu. Kilit RAW
       kaynağı tarar: yorum içinde bile o metnin yeniden belirmesi bir
       regresyon işaretidir. */
    const overlay = src(OVERLAY);
    expect(overlay).not.toContain('AI düşünüyor');
    expect(overlay).not.toContain('İşleniyor…');
  });

  it('8. `UNDERSTANDING` nötr bir ALINDI bildirimidir', () => {
    const v = deriveMaviSurface(inp({ voiceStatus: 'processing' }));
    expect(v.state).toBe('UNDERSTANDING');
    expect(v.label).toBe(MAVI_SURFACE_LABEL.UNDERSTANDING);
    expect(v.label.length).toBeGreaterThan(0);
    /* Model düşüncesi, aşama adı ya da plan içeriği TAŞIMAZ. */
    expect(Object.keys(v)).not.toContain('plan');
    expect(Object.keys(v)).not.toContain('stage');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C — DURUM ÖNCELİĞİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F11 · C · 11 durum ve öncelik', () => {
  it('9. hata her şeyi EZER (dürüst hata gizlenmez)', () => {
    expect(deriveMaviSurface(inp({
      hasError: true, voiceStatus: 'listening', pendingConfirmation: true,
    })).state).toBe('ERROR');
  });

  it('10. onay dinlemeden ÖNCE gelir (kullanıcı onayı örtülemez)', () => {
    expect(deriveMaviSurface(inp({
      pendingConfirmation: true, voiceStatus: 'listening',
    })).state).toBe('CONFIRMATION');
  });

  it('11. canlı tur durumları doğru eşlenir', () => {
    expect(deriveMaviSurface(inp({ voiceStatus: 'listening' })).state).toBe('LISTENING');
    expect(deriveMaviSurface(inp({ voiceStatus: 'processing' })).state).toBe('UNDERSTANDING');
    expect(deriveMaviSurface(inp({ voiceStatus: 'success' })).state).toBe('SPEAKING');
  });

  it('12. ACTION · PROACTIVE · DEFERRED · DEGRADED · AMBIENT · IDLE sırası', () => {
    expect(deriveMaviSurface(inp({ actionInFlight: true })).state).toBe('ACTION');
    expect(deriveMaviSurface(inp({ proactiveInFlight: true })).state).toBe('PROACTIVE');
    expect(deriveMaviSurface(inp({ deferredPending: true })).state).toBe('DEFERRED');
    expect(deriveMaviSurface(inp({ degraded: 'OFFLINE' })).state).toBe('DEGRADED');
    expect(deriveMaviSurface(inp({ wakeArmed: true })).state).toBe('AMBIENT');
    expect(deriveMaviSurface(inp()).state).toBe('IDLE');
  });

  it('13. **DEFERRED ≠ COMPLETED** ve bayat erteleme gösterilmez', () => {
    const v = deriveMaviSurface(inp({ deferredPending: true }));
    expect(v.state).toBe('DEFERRED');
    expect(v.label.toLocaleLowerCase('tr')).not.toContain('tamam');
    /* Bayatlık kararı `maviWorkload` otoritesindedir: erteleme süresi dolmuşsa
       çağıran `false` geçer → yüzey onu ASLA gösteremez. */
    expect(deriveMaviSurface(inp({ deferredPending: false })).state).not.toBe('DEFERRED');
    /* Yüzey katmanı bayatlığı KENDİ hesaplamaz (ikinci otorite yasağı). */
    expect(codeOf(src(MODEL))).not.toContain('expiresAt');
  });

  it('14. bayat PROAKTİF gösterilmez (F9 otoritesi karar verir)', () => {
    expect(deriveMaviSurface(inp({ proactiveInFlight: false })).state).not.toBe('PROACTIVE');
    /* Yüzey proaktif kararı YENİDEN üretmez — yalnız uçuşta olup olmadığını okur. */
    const hook = codeOf(src(HOOK));
    expect(hook).toContain('isProactiveDeliveryInFlight');
    expect(hook).not.toContain('decideProactive');
  });

  it('15. `degraded` DİK eksendir — dinleme sırasında da taşınır', () => {
    const v = deriveMaviSurface(inp({ voiceStatus: 'listening', degraded: 'OFFLINE' }));
    expect(v.state).toBe('LISTENING');
    expect(v.degraded).toBe('OFFLINE');
    expect(v.degradedLabel.length).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D — SÜRÜŞ / PARK YÜZEYİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F11 · D · compact / expanded', () => {
  it('16. **YÜKSEK İŞ YÜKÜ KOMPAKT YÜZEY ÜRETİR ama capability KAPATMAZ**', () => {
    const v = deriveMaviSurface(inp({ workload: 'HIGH', motionState: 'stopped' }));
    expect(v.mode).toBe('COMPACT');
    expect(v.allowsFullScreen).toBe(false);
    /* Yüzey hiçbir yeteneği kapatmaz: durum yine tam olarak türetilir. */
    expect(deriveMaviSurface(inp({ workload: 'CRITICAL', voiceStatus: 'listening' })).state)
      .toBe('LISTENING');
    /* Model capability KAYITLARINA hiç dokunmaz (yalnız F7 gözlem TİPİNİ okur —
       o da "ACCEPTED tamamlandı değildir" dürüstlüğü içindir). */
    const code = codeOf(src(MODEL));
    for (const forbidden of ['capabilityRegistry', 'capabilityFabric', 'isCapabilityAvailable',
      'evaluateCapability', 'capabilityPlan']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('17. hareket BİLİNMİYORSA kompakt seçilir (fail-safe)', () => {
    expect(deriveSurfaceMode('LOW', 'unknown')).toBe('COMPACT');
    expect(deriveSurfaceMode('LOW', 'moving')).toBe('COMPACT');
    expect(deriveSurfaceMode('LOW', 'stopped')).toBe('EXPANDED');
  });

  it('18. **TAM EKRAN YALNIZ PARKTA** — navigasyon/müzik kapanmaz', () => {
    expect(deriveMaviSurface(inp({ motionState: 'moving' })).allowsFullScreen).toBe(false);
    expect(deriveMaviSurface(inp({ motionState: 'unknown' })).allowsFullScreen).toBe(false);
    expect(deriveMaviSurface(inp({ motionState: 'stopped', workload: 'LOW' })).allowsFullScreen)
      .toBe(true);
  });

  it('19. üretim overlay\'i tam ekranı KİPE bağlar (kaynak kilidi)', () => {
    const code = codeOf(src(OVERLAY));
    expect(code).toContain('allowsFullScreen');
    expect(code).toContain('noteFullScreenBlocked');
    /* Koşulsuz tam ekran kaplama artık YOK. */
    expect(code).not.toContain("'fixed inset-0 z-[70] flex flex-col items-center justify-center px-4'\n      onClick");
  });

  it('20. sürüşte dokunma hedefi BÜYÜR (OEM ergonomi)', () => {
    const drive = deriveMaviSurface(inp({ motionState: 'moving' }));
    const parked = deriveMaviSurface(inp({ motionState: 'stopped', workload: 'LOW' }));
    expect(drive.minTouchPx).toBe(MAVI_TOUCH_PX_COMPACT);
    expect(drive.minTouchPx).toBeGreaterThan(parked.minTouchPx);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * E — WAKE-WORD / PRESENCE BAĞIMSIZLIĞI (F1 borcu)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F11 · E · wake-word presence\'tan bağımsızdır', () => {
  it('21. **`companionEnabled && companionWakeWordEnabled` BAĞI KALDIRILDI**', () => {
    const code = codeOf(src(WAKE));
    /* Eski bağın herhangi bir biçimi geri gelirse bu kilit düşer. */
    expect(code).not.toMatch(/companionEnabled[\s?\S]{0,40}&&[\s?\S]{0,40}companionWakeWordEnabled/);
    expect(code).not.toContain('s.companionEnabled');
    expect(code).toContain('s.companionWakeWordEnabled');
  });

  it('22. **Yol Arkadaşı OFF + Wake ON → wake ÇALIŞIR** (kaynak kilidi)', () => {
    const code = codeOf(src(WAKE));
    /* Wake kararı YALNIZ wake ayarından türetilir. */
    expect(code).toMatch(/const companionWake = s\.companionWakeWordEnabled \?\? false;/);
  });

  it('23. **wake ayarı HER ZAMAN ERİŞİLEBİLİR** — gizli durum YOK', () => {
    const page = src(SETTINGS);
    const wakeToggle = page.indexOf('label="Sesle Uyandırma"');
    expect(wakeToggle).toBeGreaterThan(-1);
    /* Wake toggle, companion presence koşullu bloğunun DIŞINDA olmalı: presence
       bloğu wake toggle'dan ÖNCE kapanır. Kapanış işaretçisi araya girmelidir. */
    const presenceGate = page.indexOf('{(settings.companionEnabled ?? false) && (');
    const gateClose = page.indexOf('MAVI-F11 · SESLE UYANDIRMA');
    expect(presenceGate).toBeGreaterThan(-1);
    expect(gateClose).toBeGreaterThan(presenceGate);
    expect(wakeToggle).toBeGreaterThan(gateClose);
  });

  it('24. wake anahtarı presence değişiminde GEREKSİZ yeniden kurulmaz', () => {
    const code = codeOf(src(WAKE));
    const keyFn = code.slice(code.indexOf('function _wakeKey'), code.indexOf('function _applyWakeFromSettings'));
    expect(keyFn).not.toContain('companionEnabled');
    expect(keyFn).toContain('companionWakeWordEnabled');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * F — ONAY / GÖZLEM DÜRÜSTLÜĞÜ (F5 / F6 / F7)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F11 · F · onay ve gözlem dürüstlüğü', () => {
  it('25. **`ACCEPTED` "tamamlandı" GİBİ GÖSTERİLMEZ**', () => {
    expect(observationCountsAsDone('ACCEPTED')).toBe(false);
    expect(observationCountsAsDone('EXECUTED')).toBe(false);
    expect(observationCountsAsDone('OBSERVED')).toBe(true);
    const label = MAVI_OBSERVATION_LABEL.ACCEPTED.toLocaleLowerCase('tr');
    expect(label).not.toContain('tamam');
    expect(label).toContain('doğrulanmadı');
  });

  it('26. her gözlem seviyesi AYRI ve dürüst etiketlenir', () => {
    const labels = Object.values(MAVI_OBSERVATION_LABEL);
    expect(new Set(labels).size).toBe(labels.length);   // hiçbiri birleştirilmemiş
    expect(MAVI_OBSERVATION_LABEL.FAILED.toLocaleLowerCase('tr')).toContain('başarısız');
    expect(MAVI_OBSERVATION_LABEL.OBSERVED.toLocaleLowerCase('tr')).toContain('doğruland');
  });

  it('27. **ONAY BEKLERKEN pencere OTOMATİK KAPANMAZ**', () => {
    expect(surfaceShouldAutoClose(deriveMaviSurface(inp({ pendingConfirmation: true }))))
      .toBe(false);
    expect(surfaceShouldAutoClose(deriveMaviSurface(inp({ actionInFlight: true }))))
      .toBe(false);
  });

  it('28. mevcut `followUp` kilidi AYNEN korunur (dar hâl)', () => {
    /* F11 kilidi GENİŞLETTİ, DEĞİŞTİRMEDİ: eski sözleşme hâlâ geçerli. */
    expect(voiceOverlayShouldAutoClose(true)).toBe(false);
    expect(voiceOverlayShouldAutoClose(false)).toBe(true);
    expect(surfaceShouldAutoClose(deriveMaviSurface(inp({ followUp: true })))).toBe(false);
    expect(surfaceShouldAutoClose(deriveMaviSurface(inp({ followUp: false })))).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * G — DEGRADED DÜRÜSTLÜĞÜ
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F11 · G · degraded yalan söylemez', () => {
  it('29. **"AI çalışmıyor" gibi GENELLEME YOK** — ayakta kalan söylenir', () => {
    for (const [cls, label] of Object.entries(MAVI_DEGRADED_LABEL)) {
      if (cls === 'NONE') { expect(label).toBe(''); continue; }
      const low = label.toLocaleLowerCase('tr');
      expect(low, cls).not.toContain('ai çalışmıyor');
      expect(low, cls).not.toContain('asistan kapalı');
      expect(low, cls).not.toContain('çalışmıyor');
    }
  });

  it('30. ağ ve bulut kaybı AYRI sınıflardır (tek "hata"ya indirgenmez)', () => {
    expect(MAVI_DEGRADED_LABEL.OFFLINE).not.toBe(MAVI_DEGRADED_LABEL.CLOUD_UNAVAILABLE);
    expect(MAVI_DEGRADED_LABEL.OFFLINE.toLocaleLowerCase('tr')).toContain('yerel komutlar');
    expect(MAVI_DEGRADED_LABEL.CLOUD_UNAVAILABLE.toLocaleLowerCase('tr')).toContain('yerel komutlar');
  });

  it('31. degraded capability KAPATMAZ — durum türetmesi etkilenmez', () => {
    const v = deriveMaviSurface(inp({ voiceStatus: 'listening', degraded: 'CLOUD_UNAVAILABLE' }));
    expect(v.state).toBe('LISTENING');
    expect(v.visible).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * H — TEK KAYNAK (tema ekseni) + LAB
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F11 · H · tek kaynak ve gözlem yüzeyi', () => {
  it('32. tema ekseni kanonik durumdan DARALTILIR (paralel gerçek YOK)', () => {
    expect(companionStatusFromSurface('LISTENING')).toBe('listening');
    expect(companionStatusFromSurface('UNDERSTANDING')).toBe('processing');
    expect(companionStatusFromSurface('SPEAKING')).toBe('speaking');
    expect(companionStatusFromSurface('PROACTIVE')).toBe('speaking');
    expect(companionStatusFromSurface('IDLE')).toBe('idle');
    /* Eski davranış BİREBİR korunur (görsel regresyon yok). */
    expect(deriveCompanionStatus('listening')).toBe('listening');
    expect(deriveCompanionStatus('processing')).toBe('processing');
    expect(deriveCompanionStatus('success')).toBe('speaking');
    expect(deriveCompanionStatus('error')).toBe('idle');
    expect(deriveCompanionStatus('throttled')).toBe('idle');
  });

  it('33. `livingThemeState` eşlemeyi ELLE yazmaz (tek kaynağa bağlı)', () => {
    const code = codeOf(src('platform/livingThemeState.ts'));
    expect(code).toContain('deriveMaviSurface');
    expect(code).toContain('companionStatusFromSurface');
  });

  it('34. YENİ LAB EKRANI AÇILMADI — Mavi Konsolu I bölümüyle genişletildi', () => {
    const base: MaviRawSnapshot = {
      readAt: 1, voice: null, diag: null, aiHealth: null, quota: null,
      proactive: null, speech: null, turn: null, workload: null,
      proactivePolicy: null, surface: null,
    };
    const ids = buildMaviSections(base).map((s) => s.id);
    expect(ids).toContain('surface');
    expect(codeOf(src('platform/devtools/carosLabCatalog.ts'))).not.toContain("'mavi-surface'");
  });

  it('35. LAB satırı METİN TAŞIMAZ ve ölçüm yokken UNAVAILABLE der', () => {
    const diag = getMaviSurfaceDiagnostics();
    for (const banned of ['label', 'text', 'transcript', 'answer', 'prompt']) {
      expect(Object.keys(diag), banned).not.toContain(banned);
    }
    const section = buildMaviSections({
      readAt: 1, voice: null, diag: null, aiHealth: null, quota: null,
      proactive: null, speech: null, turn: null, workload: null,
      proactivePolicy: null,
      surface: {
        transitions: 0, lastState: null, lastReason: null, lastMode: null,
        lastDegraded: 'NONE', states: {}, fullScreenBlocked: 0,
        wakeWordEnabled: false, companionPresence: false,
      },
    }).find((s) => s.id === 'surface');
    expect(section?.fields.find((f) => f.id === 'suRoot')?.klass).toBe('UNAVAILABLE');
  });

  it('36. defter geçişleri sayar; aynı durum tekrarı SAYILMAZ', () => {
    noteMaviSurface(deriveMaviSurface(inp({ voiceStatus: 'listening' })));
    noteMaviSurface(deriveMaviSurface(inp({ voiceStatus: 'listening' })));
    noteMaviSurface(deriveMaviSurface(inp({ voiceStatus: 'processing' })));
    const d = getMaviSurfaceDiagnostics();
    expect(d.transitions).toBe(2);
    expect(d.lastState).toBe('UNDERSTANDING');
    expect(d.states.LISTENING).toBe(1);
  });

  it('37. engellenen tam ekran sayacı çalışır (navigasyon koruması ölçülür)', () => {
    noteFullScreenBlocked();
    noteFullScreenBlocked();
    expect(getMaviSurfaceDiagnostics().fullScreenBlocked).toBe(2);
  });

  it('38. bozuk/eksik girdi ÇÖKERTMEZ (fail-soft)', () => {
    expect(() => deriveMaviSurface(null)).not.toThrow();
    expect(deriveMaviSurface(null).state).toBe('IDLE');
    expect(() => noteMaviSurface(null)).not.toThrow();
    expect(surfaceShouldAutoClose(null)).toBe(true);
  });
});
