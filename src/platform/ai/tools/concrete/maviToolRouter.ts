/**
 * maviToolRouter — Tool Router'ın GERÇEK bağlaması (composition root).
 *
 * Kapılar canlı bayrak/izne bağlanır; allowlist Faz 1 araç kümesidir.
 * Tembel tekil: modül import edildiğinde yan etki YOK.
 */

import { createToolRouter, type ToolRouter } from '../toolRouter';
import { MAVI_TOOLS } from './maviTools';
import { getMaviToolsConsent, isMaviToolsEnabled } from '../../gateway/aiGatewayFlag';

/** Monotonik saat — clock-jump güvenli. */
const clock = { nowMs: (): number => (typeof performance !== 'undefined' ? performance.now() : 0) };

let _router: ToolRouter | null = null;

export function getMaviToolRouter(): ToolRouter {
  if (_router) return _router;
  _router = createToolRouter({
    tools:   MAVI_TOOLS,
    enabled: () => isMaviToolsEnabled(),
    consent: () => getMaviToolsConsent() === 'tools',
    clock,
  });
  return _router;
}

/** @internal — testler arası izolasyon. */
export function _resetMaviToolRouterForTest(): void {
  _router = null;
}
