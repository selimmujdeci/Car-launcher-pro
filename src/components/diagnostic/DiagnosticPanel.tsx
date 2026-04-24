import { memo, useEffect } from 'react';
import { useDiagnosticStore, startDiagnostics } from '../../platform/diagnostic/diagnosticStore';
import { useDebugStore } from '../../platform/debug';
import { CarDiagram } from './CarDiagram';
import { DtcList }    from './DtcList';
import { ErrorDetail } from './ErrorDetail';
import type { ZoneStatus } from '../../platform/diagnostic/diagnosticStore';

function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? 'bg-green-400' : 'bg-gray-600'}`}/>
      <span className="text-gray-500 text-[10px] font-mono">{label}:</span>
      <span className={`text-[10px] font-mono ${ok ? 'text-green-400' : 'text-gray-500'}`}>{value}</span>
    </div>
  );
}

export const DiagnosticPanel = memo(function DiagnosticPanel() {
  const dtcCodes     = useDiagnosticStore((s) => s.dtcCodes);
  const isReading    = useDiagnosticStore((s) => s.isReading);
  const lastReadAt   = useDiagnosticStore((s) => s.lastReadAt);
  const selectedCode = useDiagnosticStore((s) => s.selectedCode);
  const obdConnected = useDiagnosticStore((s) => s.obdConnected);
  const zones        = useDiagnosticStore((s) => s.zones);
  const selectCode   = useDiagnosticStore((s) => s.selectCode);
  const triggerRead  = useDiagnosticStore((s) => s.triggerRead);

  // CAN door open from debug store (fallback when OBD has no door data)
  const canDoorOpen = useDebugStore((s) => s.canExtras.doorOpen ?? false);

  // Sync CAN door state into diagnostic store
  useEffect(() => {
    useDiagnosticStore.getState()._updateCanDoor(canDoorOpen);
  }, [canDoorOpen]);

  // Start OBD + DTC subscriptions while panel is mounted
  useEffect(() => startDiagnostics(), []);

  // Click on a car zone → filter DTC list to that system
  function handleZoneClick(zone: keyof ZoneStatus) {
    // Map zone → relevant DTC code prefix or system
    const zoneMap: Partial<Record<keyof ZoneStatus, (code: string) => boolean>> = {
      engine:       (c) => c.startsWith('P') && parseInt(c.slice(1)) < 700,
      transmission: (c) => c.startsWith('P') && parseInt(c.slice(1)) >= 700,
      network:      (c) => c.startsWith('U'),
      brakes:       (c) => c.startsWith('C'),
    };
    const filter = zoneMap[zone];
    if (!filter) return;
    const match = dtcCodes.find((dtc) => filter(dtc.code));
    if (match) selectCode(match.code);
  }

  const activeFaults = dtcCodes.length;
  const critCount    = dtcCodes.filter((c) => c.severity === 'critical').length;

  return (
    <div className="relative flex flex-col h-full gap-3 overflow-hidden">
      {/* Summary bar */}
      <div className="flex items-center gap-4 px-1 shrink-0">
        <StatusRow label="OBD" value={obdConnected ? 'bağlı' : 'bağlı değil'} ok={obdConnected}/>
        <StatusRow
          label="Hata"
          value={activeFaults === 0 ? 'yok' : `${activeFaults} aktif${critCount > 0 ? ` (${critCount} kritik)` : ''}`}
          ok={activeFaults === 0}
        />
      </div>

      {/* Main content: diagram + list */}
      <div className="flex flex-1 gap-3 overflow-hidden min-h-0">
        {/* Left: Car diagram */}
        <div className="shrink-0 flex flex-col items-center justify-start pt-2"
          style={{ width: 160 }}>
          <CarDiagram zones={zones} onZoneClick={handleZoneClick}/>

          {/* Legend */}
          <div className="mt-2 flex flex-col gap-1 w-full px-2">
            {[
              { color: 'bg-red-500',    label: 'Kritik hata' },
              { color: 'bg-orange-500', label: 'Uyarı' },
              { color: 'bg-orange-400', label: 'Kapı/bagaj açık' },
              { color: 'bg-yellow-500', label: 'TPMS düşük' },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-sm shrink-0 ${color}`}/>
                <span className="text-gray-600 text-[9px] font-mono">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: DTC list */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <DtcList
            codes={dtcCodes}
            selectedCode={selectedCode}
            isReading={isReading}
            lastReadAt={lastReadAt}
            obdConnected={obdConnected}
            onSelect={selectCode}
            onRead={triggerRead}
          />
        </div>
      </div>

      {/* Error detail slide-up panel */}
      {selectedCode && (
        <ErrorDetail
          code={selectedCode}
          codes={dtcCodes}
          onClose={() => selectCode(null)}
        />
      )}
    </div>
  );
});
