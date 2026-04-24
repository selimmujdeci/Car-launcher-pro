import { memo, useRef } from 'react';
import { useVehicleStore } from '../../platform/vehicleDataLayer';
import { usePermission } from '../../platform/roleSystem';
import { closeRearCamera } from '../../platform/cameraService';
import { RearViewCamera } from './RearViewCamera';

export const ReverseOverlay = memo(function ReverseOverlay() {
  const reverse    = useVehicleStore((s) => s.reverse);
  const canSeeCamera = usePermission('reverseCamera');
  const dismissedRef = useRef(false);

  if (!reverse || !canSeeCamera) {
    dismissedRef.current = false;
    return null;
  }

  if (dismissedRef.current) return null;

  return (
    <RearViewCamera
      onClose={() => {
        dismissedRef.current = true;
        closeRearCamera();
      }}
    />
  );
});
