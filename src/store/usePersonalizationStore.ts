/**
 * @deprecated — Yeni sistem useEditStore kullanıyor.
 * Bu dosya eski import'lar için uyumluluk shimi.
 */
export {
  useEditStore as usePersonalizationStore,
  EDITABLE_REGISTRY as WIDGET_META,
  type ElementStyle as WidgetPersonalization,
} from './useEditStore';

export { COLOR_PRESETS as WIDGET_COLOR_PRESETS, getContrastColor as getContrastTextColor } from '../platform/editStyleEngine';

export type WidgetId = 'speedometer' | 'map';
