/**
 * Freeze — gizli alt ağacı askıya alır (react-freeze deseni, bağımlılıksız).
 *
 * Donmuşken: asla çözülmeyen bir promise fırlatılır → React alt ağacı Suspense
 * altında askıya alır. Sonuç:
 *   - Re-render tamamen durur (store/hook abonelikleri alt ağacı uyandıramaz)
 *   - Effect'ler temizlenir (interval/ticker'lar durur)
 *   - React DOM'u display:none ile gizler → boyama maliyeti de sıfırlanır
 *   - STATE KORUNUR — çözülünce kaldığı yerden devam eder, effect'ler yeniden kurulur
 *
 * Neden: K24 saha bulgusu (2026-07-03) — DrawerShell 13 ekranı kapalıyken de
 * mount tutuyor; gizli ekranların render+paint faturası her dokunuşta ödeniyordu
 * (100-220ms uzun görevler). Ayrıntı: project_caros_k24_perf hafıza notu.
 */
import { Suspense, Fragment, type ReactNode } from 'react';

// Tek paylaşılan, asla çözülmeyen promise — GC/allocation yok.
const NEVER = new Promise<void>(() => { /* bilinçli: asla resolve edilmez */ });

function Suspender({ freeze, children }: { freeze: boolean; children: ReactNode }) {
  if (freeze) throw NEVER;
  return <Fragment>{children}</Fragment>;
}

export function Freeze({ freeze, children }: { freeze: boolean; children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Suspender freeze={freeze}>{children}</Suspender>
    </Suspense>
  );
}
