import { memo, useState, useEffect } from 'react';
import { useSystemStore } from '../../store/useSystemStore';
import { usePermission } from '../../platform/roleSystem';
import { closeRearCamera } from '../../platform/cameraService';
import { RearViewCamera } from './RearViewCamera';
import { isNative } from '../../platform/bridge';

/**
 * ReverseOverlay — "dumb" bileşen (web modu).
 * İş mantığı yoktur; yalnızca useSystemStore.isReverseActive okur.
 *
 * Native modda ReversePriorityOverlay (z-9999, cameraService native frames) devralır.
 * Bu bileşen yalnızca web/geliştirme modunda çalışır; getUserMedia stream'i yönetir.
 */
export const ReverseOverlay = memo(function ReverseOverlay() {
  // Native modda ReversePriorityOverlay Camera2 API ile kamerayı yönetir;
  // getUserMedia (web kamerası) çakışması ve kaynak israfı önlenir.
  // isNative derleme zamanında sabit — iç bileşen ayrımı Rules of Hooks'u sağlar.
  if (isNative) return null;
  return <_WebReverseOverlay />;
});

function _WebReverseOverlay() {
  const isReverseActive = useSystemStore((s) => s.isReverseActive);
  const canSeeCamera    = usePermission('reverseCamera');
  const [dismissed, setDismissed] = useState(false);

  // Vites çıkınca dismiss bayrağını sıfırla — bir sonraki geri vitese hazır
  useEffect(() => {
    if (!isReverseActive) setDismissed(false);
  }, [isReverseActive]);

  if (!isReverseActive || !canSeeCamera || dismissed) return null;

  return (
    <RearViewCamera
      onClose={() => {
        setDismissed(true);
        closeRearCamera();
      }}
    />
  );
}
