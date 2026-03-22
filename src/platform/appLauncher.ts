/**
 * Launch service — single public API for all app launches.
 * All routing logic lives in bridge.ts (demo vs. native).
 */
import { bridge } from './bridge';
import type { AppItem, NavOptionKey, MusicOptionKey } from '../data/apps';

export function openApp(app: AppItem): void              { bridge.launchApp(app); }
export function openNavigation(key: NavOptionKey): void  { bridge.launchNavigation(key); }
export function openMusic(key: MusicOptionKey): void     { bridge.launchMusic(key); }
export function openSystemSettings(): void               { bridge.launchSystemSettings(); }
export function openBluetoothSettings(): void            { bridge.launchBluetoothSettings(); }
