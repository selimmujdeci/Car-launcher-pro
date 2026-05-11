/**
 * TestControlPanel — Geliştirici Test Paneli (DEV ONLY)
 *
 * Erişim: Sol alt köşeye 1.5 saniyelik uzun basış → panel açılır.
 * Production'da no-op: import.meta.env.DEV = false → Vite ternary'i sabitler,
 * _DevPanel ve tüm test import'ları tree-shaked edilir.
 *
 * Özellikler:
 *  • Senaryo seçici (tunnel-escape / overheat / obd-fault)
 *  • Manuel hata enjeksiyonu (Sahte OOM, Yüksek Sıcaklık)
 *  • BlackBox JSON yükleme & oynatma
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  BUILT_IN_SCENARIOS,
  startScenario,
  stopScenario,
  onScenarioState,
  getScenarioState,
} from '../../platform/test/ScenarioEngine';
import type { ScenarioState }              from '../../platform/test/ScenarioEngine';
import {
  startReplay,
  stopReplay,
  parseReplayJson,
  onReplayState,
  getReplayState,
} from '../../platform/test/ReplayService';
import type { ReplayState }                from '../../platform/test/ReplayService';
import { injectDeviceTemp }                from '../../platform/thermalWatchdog';
import { _simulateMemoryPressureForTest }  from '../../platform/memoryWatchdog';

/* ── Constants ────────────────────────────────────────────────────────────── */

const LONG_PRESS_MS = 1500;

/* ── Shared state hooks ───────────────────────────────────────────────────── */

function useScenarioState(): ScenarioState {
  return useSyncExternalStore(onScenarioState, getScenarioState, getScenarioState);
}

function useReplayState(): ReplayState {
  return useSyncExternalStore(onReplayState, getReplayState, getReplayState);
}

/* ── Senaryo Bölümü ───────────────────────────────────────────────────────── */

function ScenarioSection() {
  const state = useScenarioState();

  return (
    <section>
      <h3 className="text-xs font-bold text-yellow-400 uppercase tracking-widest mb-2">
        Senaryolar
      </h3>

      {state.running && (
        <div className="mb-2 rounded bg-yellow-900/60 px-3 py-1.5 text-xs text-yellow-200">
          ▶ {state.scenarioName} — Adım {state.currentStep}/{state.totalSteps}
          <br />
          <span className="opacity-70">{state.lastLabel}</span>
        </div>
      )}

      <div className="flex flex-col gap-1">
        {BUILT_IN_SCENARIOS.map((s) => (
          <button
            key={s.name}
            onClick={() => startScenario(s)}
            disabled={state.running}
            className="rounded bg-zinc-700 px-3 py-1.5 text-left text-xs text-white
                       hover:bg-zinc-600 disabled:opacity-40 transition-colors"
          >
            <span className="font-medium">{s.name}</span>
            <span className="ml-2 opacity-60">{s.description}</span>
          </button>
        ))}
      </div>

      {state.running && (
        <button
          onClick={stopScenario}
          className="mt-2 w-full rounded bg-red-700 px-3 py-1.5 text-xs font-bold
                     text-white hover:bg-red-600 transition-colors"
        >
          Durdur
        </button>
      )}
    </section>
  );
}

/* ── Hata Enjeksiyonu Bölümü ──────────────────────────────────────────────── */

function FaultSection() {
  const [tempActive, setTempActive] = useState(false);

  const fakeHighTemp = useCallback(() => {
    setTempActive(true);
    injectDeviceTemp(90);
    setTimeout(() => {
      injectDeviceTemp(38);
      setTempActive(false);
    }, 10_000);
  }, []);

  const fakeOOM = useCallback(() => {
    _simulateMemoryPressureForTest('CRITICAL');
  }, []);

  return (
    <section>
      <h3 className="text-xs font-bold text-yellow-400 uppercase tracking-widest mb-2">
        Manuel Hata Enjeksiyonu
      </h3>
      <div className="flex gap-2">
        <button
          onClick={fakeHighTemp}
          disabled={tempActive}
          className="flex-1 rounded bg-orange-700 px-3 py-1.5 text-xs font-bold
                     text-white hover:bg-orange-600 disabled:opacity-40 transition-colors"
        >
          {tempActive ? '90°C aktif…' : 'Yüksek Sıcaklık'}
        </button>
        <button
          onClick={fakeOOM}
          className="flex-1 rounded bg-rose-800 px-3 py-1.5 text-xs font-bold
                     text-white hover:bg-rose-700 transition-colors"
        >
          Sahte OOM
        </button>
      </div>
    </section>
  );
}

/* ── BlackBox Oynatıcı Bölümü ─────────────────────────────────────────────── */

function ReplaySection() {
  const state     = useReplayState();
  const inputRef  = useRef<HTMLInputElement>(null);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text    = ev.target?.result as string;
      const samples = parseReplayJson(text);
      if (samples.length === 0) {
        // eslint-disable-next-line no-alert
        alert('[ReplayService] Geçerli BlackBox örneği bulunamadı.');
        return;
      }
      startReplay(samples);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const progress = state.totalFrames > 0
    ? Math.round((state.currentIndex / state.totalFrames) * 100)
    : 0;

  return (
    <section>
      <h3 className="text-xs font-bold text-yellow-400 uppercase tracking-widest mb-2">
        BlackBox Oynatıcı
      </h3>

      {state.playing ? (
        <>
          <div className="mb-1 h-1.5 w-full rounded-full bg-zinc-700">
            <div
              className="h-full rounded-full bg-green-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mb-2 text-xs text-zinc-400">
            {state.currentIndex} / {state.totalFrames} frame
          </p>
          <button
            onClick={stopReplay}
            className="w-full rounded bg-red-700 px-3 py-1.5 text-xs font-bold
                       text-white hover:bg-red-600 transition-colors"
          >
            Oynatmayı Durdur
          </button>
        </>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={onFileChange}
          />
          <button
            onClick={() => inputRef.current?.click()}
            className="w-full rounded bg-zinc-700 px-3 py-1.5 text-xs text-white
                       hover:bg-zinc-600 transition-colors"
          >
            JSON Yükle & Oynat
          </button>
        </>
      )}
    </section>
  );
}

/* ── Panel Overlay ────────────────────────────────────────────────────────── */

function Panel({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-start p-4"
    >
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div
        className="relative z-10 w-80 rounded-xl border border-zinc-700 bg-zinc-900
                   shadow-2xl flex flex-col gap-4 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-white">Dev Test Paneli</span>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <ScenarioSection />
        <div className="border-t border-zinc-700" />
        <FaultSection />
        <div className="border-t border-zinc-700" />
        <ReplaySection />
      </div>
    </div>
  );
}

/* ── Trigger + Dev wrapper ────────────────────────────────────────────────── */

function _DevPanel() {
  const [open, setOpen]   = useState(false);
  const timerRef          = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(() => {
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setOpen(true);
    }, LONG_PRESS_MS);
  }, []);

  useEffect(() => cancelTimer, [cancelTimer]);

  return (
    <>
      {/* Görünmez uzun basış alanı — sol alt köşe 48×48 px */}
      <div
        className="fixed bottom-0 left-0 z-[9990] h-12 w-12 select-none"
        onPointerDown={onPointerDown}
        onPointerUp={cancelTimer}
        onPointerLeave={cancelTimer}
        aria-hidden="true"
      />
      {open && <Panel onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Dışarıya açılan bileşen — production'da null döner (import.meta.env.DEV = false).
 * Vite bu ternary'i sabitler; _DevPanel ve test import'ları tree-shaked edilir.
 */
export default function TestControlPanel() {
  return import.meta.env.DEV ? <_DevPanel /> : null;
}
