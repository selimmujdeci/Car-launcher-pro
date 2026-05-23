import { memo, useSyncExternalStore } from 'react';
import { runtimeManager } from '../../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode } from '../../core/runtime/runtimeTypes';

/* ════════════════════════════════════════════════════════════════
   CABIN AMBIENT — Atmospheric lighting layer for the cockpit.

   Pure presentation. Zero React state. Zero render loops.
   All visible layers are pointer-events:none divs with CSS
   gradients sourced from --oem-ambient-cool / --oem-ambient-warm.

   ─ SAFE_MODE gate ─
   Uses the runtimeManager's external store via useSyncExternalStore
   so that, just like up-ambient-blobs in MainLayout, we render
   nothing in SAFE_MODE. SAFE_MODE also forces the tokens to
   transparent via oem-tokens.css — defense in depth.

   ─ GPU budget ─
   • 5 absolutely-positioned divs total.
   • No animations. Pure static gradients.
   • mix-blend-mode: screen on side glows only — same cost as
     the existing up-blob layers.
   • contain: strict on each layer → isolates from reflow chain.
   ════════════════════════════════════════════════════════════════ */

function subscribeRuntime(cb: () => void) {
  return runtimeManager.subscribe(cb);
}
function getRuntimeMode() {
  return runtimeManager.getMode();
}

export const CabinAmbient = memo(function CabinAmbient() {
  const mode = useSyncExternalStore(subscribeRuntime, getRuntimeMode, getRuntimeMode);

  if (mode === RuntimeMode.SAFE_MODE) return null;

  return (
    <div
      aria-hidden
      data-oem-cabin-ambient
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1,
        pointerEvents: 'none',
      }}
    >
      {/* 1) DASHBOARD RIM — dark band at top edge, frames the display
       *     like a real embedded automotive screen. */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0,
        height: 14,
        background:
          'linear-gradient(180deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.25) 55%, transparent 100%)',
        contain: 'strict',
      }}/>

      {/* 2) WINDSHIELD GLOW — cool sky wash from the top edge.
       *     Day mode strengthens this (token override). */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0,
        height: '38%',
        background:
          'radial-gradient(82% 100% at 50% -10%, var(--oem-ambient-cool, transparent), transparent 70%)',
        mixBlendMode: 'screen',
        contain: 'strict',
      }}/>

      {/* 3) LEFT A-PILLAR — warm trim glow. */}
      <div style={{
        position: 'absolute',
        top: 0, bottom: 0, left: 0,
        width: '14%',
        background:
          'radial-gradient(45% 80% at -10% 50%, var(--oem-ambient-warm, transparent), transparent 70%)',
        mixBlendMode: 'screen',
        contain: 'strict',
      }}/>

      {/* 4) RIGHT A-PILLAR — warm trim glow. */}
      <div style={{
        position: 'absolute',
        top: 0, bottom: 0, right: 0,
        width: '14%',
        background:
          'radial-gradient(45% 80% at 110% 50%, var(--oem-ambient-warm, transparent), transparent 70%)',
        mixBlendMode: 'screen',
        contain: 'strict',
      }}/>

      {/* 5) FLOOR WASH — warm under-dash ambient pool. */}
      <div style={{
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        height: '28%',
        background:
          'radial-gradient(60% 100% at 50% 110%, var(--oem-ambient-warm, transparent), transparent 65%)',
        mixBlendMode: 'screen',
        contain: 'strict',
      }}/>
    </div>
  );
});

export default CabinAmbient;
