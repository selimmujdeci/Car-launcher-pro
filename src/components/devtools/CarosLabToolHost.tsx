/**
 * CarosLabToolHost — araç id'sini EKRANA çözer (tek çözüm noktası, type-safe).
 *
 * PARALEL ROUTER YOK: `CarosLabToolId` union'ı `carosLabScreenMap` üzerinden doğrudan
 * bileşene eşlenir. Yalnız AKTİF araç mount edilir → kapalı araçlar hiç yüklenmez.
 * PLACEHOLDER araçlar `ToolInfoScreen`e düşer (servis başlatmaz); DISABLED araçlar
 * buraya HİÇ gelmez (navigasyon reducer'ı aktifleştirmez).
 */

import { memo, Suspense } from 'react';
import { ToolInfoScreen } from './screens/ToolInfoScreen';
import { renderAvailableTool } from './carosLabScreenMap';
import type { CarosLabTool } from '../../platform/devtools/carosLabCatalog';

export const CarosLabToolHost = memo(function CarosLabToolHost({ tool }: { tool: CarosLabTool }) {
  if (tool.status !== 'AVAILABLE') {
    return <ToolInfoScreen tool={tool} />;
  }

  const screen = renderAvailableTool(tool.id);
  if (!screen) {
    // Katalog AVAILABLE diyor ama ekran eşlemesi yok → sahte "çalışıyor" göstermeyiz.
    return <ToolInfoScreen tool={tool} />;
  }

  return (
    <Suspense fallback={<div className="p-3 font-mono text-[11px] text-white/40">yükleniyor…</div>}>
      {screen}
    </Suspense>
  );
});
