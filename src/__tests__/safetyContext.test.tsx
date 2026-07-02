/**
 * safetyContext birim testleri — FAZ 4A
 *
 * YAKLAŞIM:
 *   @testing-library/react YOK; react-dom/client createRoot jsdom'da import
 *   edilemiyor (react-dom-client.development.js indexOf hatası).
 *   Bu nedenle renderToStaticMarkup (react-dom/server) tabanlı test kullanılır.
 *
 *   A) useSafetyContext provider dışında throw.
 *   B) TEK queue + TEK ticker — provider tek kez çalışır: yalnız tek bileşen
 *      renderToStaticMarkup ile render edilir; mock sayaçları 1 olduğunu doğrular.
 *   C) mute fonksiyon varlığı + çağrılabilirliği.
 *   D) İki consumer aynı context value referansını alır.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { SafetyProvider, useSafetyContext } from '../components/safety/SafetyContext';
import type { SafetyQueueOutput } from '../platform/safety/types';

// ── SafetyAlertQueue mock — instance sayımı ───────────────────────────────────

// Mock'un sayaç değişkeni modül kapsamında tutulur.
let queueInstanceCount = 0;

vi.mock('../platform/safety/SafetyAlertQueue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/safety/SafetyAlertQueue')>();

  class CountingSafetyAlertQueue extends actual.SafetyAlertQueue {
    constructor() {
      super();
      queueInstanceCount += 1;
    }
  }

  return { SafetyAlertQueue: CountingSafetyAlertQueue };
});

// ── safetyTicker mock — createSafetyTicker çağrı sayımı ──────────────────────

let tickerCallCount = 0;

vi.mock('../platform/safety/safetyTicker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/safety/safetyTicker')>();

  return {
    createSafetyTicker: (intervalMs: number, tick: () => boolean) => {
      tickerCallCount += 1;
      // Gerçek ticker davranışı korunur.
      return actual.createSafetyTicker(intervalMs, tick);
    },
  };
});

// ── Sayaçları her test öncesi sıfırla ─────────────────────────────────────────

beforeEach(() => {
  queueInstanceCount = 0;
  tickerCallCount = 0;
});

// ── Boş SafetyQueueOutput sabit ───────────────────────────────────────────────

const EMPTY_OUTPUT: SafetyQueueOutput = {
  visibleAlerts: [],
  primaryBannerAlert: null,
  voiceAnnouncementAlert: null,
  muted: [],
  suppressed: [],
};

// ── Yardımcı: context value yakalayan bileşen ─────────────────────────────────

// renderToStaticMarkup senkron çalışır; hook'un döndürdüğü değeri yakalamak
// için bileşen render edilirken side-effect ile dışa sızdırılır.
let capturedValue: ReturnType<typeof useSafetyContext> | null = null;

function ContextCaptor(): ReactElement {
  capturedValue = useSafetyContext();
  // renderToStaticMarkup saf markup döndürmeli; boş div yeterli.
  return <div data-testid="captor" />;
}

// ── Yardımcı: provider dışında context kullanan "kötü" bileşen ───────────────

function BadConsumer(): ReactElement {
  const _ctx = useSafetyContext(); // SafetyProvider olmadan → throw
  return <div>{String(_ctx)}</div>;
}

// ── A: Provider dışında throw ─────────────────────────────────────────────────

describe('useSafetyContext — provider dışında throw', () => {
  it('SafetyProvider olmadan çağrılırsa hata fırlatır', () => {
    expect(() => renderToStaticMarkup(<BadConsumer />)).toThrow(
      'useSafetyContext SafetyProvider içinde kullanılmalı',
    );
  });
});

// ── B: TEK queue (ana gereksinim) ────────────────────────────────────────────
//
// renderToStaticMarkup senkron server-side render yapar.
// Provider → useSafetyAlerts → new SafetyAlertQueue → 1 kez.
// İki ContextCaptor aynı provider içinde olsa bile hook TEK kez çağrılır
// (hook provider bileşeninde; captor'lar yalnız useContext çağırır).
//
// NOT: createSafetyTicker useEffect içinde lazy init edilir → server render'da
// useEffect çalışmaz → tickerCallCount sıfır kalır. Bu beklenen davranıştır;
// ticker testi jsdom+act gerektirdiğinden bu test ortamında atlanır.

describe('SafetyProvider — tek queue', () => {
  it('iki consumer render edildiğinde queueInstanceCount === 1 (tek queue, tek hook)', () => {
    renderToStaticMarkup(
      <SafetyProvider>
        <ContextCaptor />
        <ContextCaptor />
      </SafetyProvider>
    );

    // SafetyAlertQueue yalnız SafetyProvider içindeki useSafetyAlerts'tan new'lenmeli.
    // (Eski mimaride iki consumer → iki ayrı hook → 2 instance; şimdi 1 olmalı.)
    expect(queueInstanceCount).toBe(1);
  });

  it('ticker useEffect içinde lazy init edilir — server render\'da sıfır çağrı beklenir', () => {
    // Bu test, ticker'ın useEffect kapsamında olduğunu ve renderToStaticMarkup'ta
    // çalışmadığını (çalışmaması gerektiğini) belgelemek için tasarlanmıştır.
    // Gerçek tick davranışı safetyTick.test.ts'te doğrulanır.
    tickerCallCount = 0;

    renderToStaticMarkup(
      <SafetyProvider>
        <ContextCaptor />
      </SafetyProvider>
    );

    // useEffect server render'da çalışmaz → ticker init olmaz → 0 beklenir.
    expect(tickerCallCount).toBe(0);
  });
});

// ── C: mute fonksiyon varlığı + çağrılabilirliği ─────────────────────────────

describe('SafetyProvider — mute fonksiyonu', () => {
  it('context value içinde mute bir fonksiyondur ve throw atmaz', () => {
    capturedValue = null;

    renderToStaticMarkup(
      <SafetyProvider>
        <ContextCaptor />
      </SafetyProvider>
    );

    expect(capturedValue).not.toBeNull();
    expect(typeof capturedValue!.mute).toBe('function');

    // mute çağrısı hata fırlatmamalı (track henüz yok → no-op)
    expect(() => capturedValue!.mute('door.open.moving')).not.toThrow();
  });

  it('output boş başlamalı (store boş, aktif alert yok)', () => {
    capturedValue = null;

    renderToStaticMarkup(
      <SafetyProvider>
        <ContextCaptor />
      </SafetyProvider>
    );

    expect(capturedValue?.output).toMatchObject<Partial<SafetyQueueOutput>>({
      visibleAlerts: [],
      primaryBannerAlert: null,
      voiceAnnouncementAlert: null,
    });
  });
});

// ── D: İki consumer aynı context value referansını alır ──────────────────────

describe('SafetyProvider — aynı value referansı', () => {
  it('tek provider altındaki iki consumer aynı context value nesnesini alır', () => {
    const captured: Array<ReturnType<typeof useSafetyContext>> = [];

    function MultiCaptor({ _id }: { _id: number }): ReactElement {
      captured.push(useSafetyContext());
      return <div data-id={_id} />;
    }

    renderToStaticMarkup(
      <SafetyProvider>
        <MultiCaptor _id={1} />
        <MultiCaptor _id={2} />
      </SafetyProvider>
    );

    expect(captured.length).toBe(2);
    // useMemo ile sarıldığı için aynı render içinde aynı referans olmalı.
    expect(captured[0]).toBe(captured[1]);
  });
});

// ── E: SafetyOverlayView ile uyumluluk (saf bileşen dokunulmadı) ─────────────

describe('SafetyContext — SafetyOverlayView uyumluluğu (smoke)', () => {
  it('boş output → SafetyOverlayView null (markup boş string)', async () => {
    // SafetyOverlayView'ı doğrudan import et; context gerektirmez (saf bileşen).
    const { SafetyOverlayView } = await import('../components/safety/SafetyOverlay');

    const { renderToStaticMarkup: rts } = await import('react-dom/server');
    const html = rts(<SafetyOverlayView output={EMPTY_OUTPUT} />);
    expect(html).toBe('');
  });
});
