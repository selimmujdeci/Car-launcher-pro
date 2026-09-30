/**
 * abortControllerPolyfill — `AbortController`/`AbortSignal` olmayan WebView'da
 * asgari eşdeğeri kurar. `main.tsx`'in İLK import'udur: modül değerlendirilirken
 * kurulur, böylece sonraki her modül (SystemBoot, maplibre) onu hazır bulur.
 *
 * ÖLÇÜLEN KUSUR (2026-09-30, build + Chromium, `AbortController` silinerek):
 * `SystemBoot.start()` ilk satırlarında `new AbortController()` çağırıyor →
 * "Bootstrap Rejection: ReferenceError: AbortController is not defined" →
 * arka plan servislerinin HİÇBİRİ başlamıyor; maplibre de stil yüklerken aynı
 * hatayla düşüyor ("MiniMap init failed"). `AbortController` Chrome 66'da geldi;
 * core-js onu kapsamaz. Hedef kitle Chrome 52+ (vite.config `legacy.targets`,
 * kütük #1595) — yani bu tarayıcılarda uygulama açılışta ölüyordu.
 *
 * KAPSAM: yalnız EKSİKSE kurulur (Chrome 66+ yerleşik olanı kullanır, davranış
 * değişmez). Eski `fetch` `signal`i tanımaz ve yok sayar — istek yine çalışır,
 * yalnız iptal edilemez; `abortCompat.signalWithTimeout` ile aynı fail-soft ilke.
 */

type Listener = (ev: { type: string; target: unknown }) => void;

export function installAbortControllerPolyfill(g: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): boolean {
  if (typeof g.AbortController === 'function') return false;

  class AbortSignalShim {
    aborted = false;
    reason: unknown = undefined;
    onabort: Listener | null = null;
    private _ls: Listener[] = [];
    addEventListener(type: string, fn: Listener): void {
      if (type === 'abort' && typeof fn === 'function' && this._ls.indexOf(fn) < 0) this._ls.push(fn);
    }
    removeEventListener(type: string, fn: Listener): void {
      if (type === 'abort') this._ls = this._ls.filter((l) => l !== fn);
    }
    dispatchEvent(ev: { type: string }): boolean {
      if (ev.type !== 'abort') return true;
      const e = { type: 'abort', target: this };
      if (this.onabort) { try { this.onabort(e); } catch { /* dinleyici hatası sinyali bozmaz */ } }
      for (const l of this._ls.slice()) { try { l(e); } catch { /* aynı */ } }
      return true;
    }
    throwIfAborted(): void {
      if (this.aborted) throw this.reason;
    }
  }

  class AbortControllerShim {
    readonly signal = new AbortSignalShim();
    abort(reason?: unknown): void {
      const s = this.signal;
      if (s.aborted) return;
      s.aborted = true;
      s.reason = reason !== undefined ? reason : abortError();
      s.dispatchEvent({ type: 'abort' });
    }
  }

  g.AbortSignal = AbortSignalShim;
  g.AbortController = AbortControllerShim;
  return true;
}

function abortError(): Error {
  const e = new Error('signal is aborted without reason');
  e.name = 'AbortError';
  return e;
}

installAbortControllerPolyfill();
