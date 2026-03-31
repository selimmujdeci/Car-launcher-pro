/**
 * Dock → Ana Ekran sürükleme global durumu.
 * Kalıcı değil — oturum içi, uygulama yeniden başlatılınca sıfırlanır.
 */
import { create } from 'zustand';

export interface DragCardSource {
  type: 'app' | 'tool';
  id: string;
  label: string;
  icon: string;
  color?: string;
}

interface DragStore {
  dragging: boolean;
  source: DragCardSource | null;
  ghostX: number;
  ghostY: number;
  overDropZone: boolean;
  startDrag: (source: DragCardSource, x: number, y: number) => void;
  moveDrag: (x: number, y: number, overZone: boolean) => void;
  endDrag: () => void;
}

export const useDragStore = create<DragStore>((set) => ({
  dragging: false,
  source: null,
  ghostX: 0,
  ghostY: 0,
  overDropZone: false,
  startDrag: (source, x, y) =>
    set({ dragging: true, source, ghostX: x, ghostY: y, overDropZone: false }),
  moveDrag: (x, y, overZone) =>
    set({ ghostX: x, ghostY: y, overDropZone: overZone }),
  endDrag: () =>
    set({ dragging: false, source: null, overDropZone: false }),
}));
