/**
 * Release Checklist — dev-only reference, never imported by the app.
 * Run through each group before every release build.
 *
 * Usage: review manually; zero runtime impact.
 */

export interface CheckItem {
  id: string;
  label: string;
  how: string;
}

export interface CheckGroup {
  group: string;
  items: CheckItem[];
}

export const RELEASE_CHECKLIST: CheckGroup[] = [
  {
    group: 'Home',
    items: [
      { id: 'home-clock',    label: 'Clock updates every second',                          how: 'Watch home screen for 3s'                           },
      { id: 'home-date',     label: 'Date / weekday correct (Turkish locale)',              how: 'Compare with system date'                            },
      { id: 'home-status',   label: 'All 3 device-status chips visible without overflow',  how: 'Test at ~1024px wide and narrow viewports'           },
      { id: 'home-nav',      label: 'NavCard CTA button launches nav app',                 how: 'Tap "Haritayı Aç"'                                   },
      { id: 'home-music',    label: 'MusicCard shows track info, controls respond',        how: 'Tap play / pause / next / prev'                      },
      { id: 'home-favs',     label: 'FavApps renders or shows empty-state guidance',       how: 'Clear favorites, reload'                             },
      { id: 'home-recent',   label: 'RecentApps hidden when empty, visible after launch',  how: 'Launch an app, return home'                          },
    ],
  },
  {
    group: 'Apps',
    items: [
      { id: 'apps-grid',   label: 'All apps shown in selected column count',         how: 'Change grid cols in Settings, verify in Apps'   },
      { id: 'apps-launch', label: 'Tapping app opens it or routes internally',       how: 'Tap Settings → verify internal navigation'      },
      { id: 'apps-star',   label: 'Star toggles favorite; change reflected on Home', how: 'Star/unstar, switch to Home'                    },
      { id: 'apps-anim',   label: 'Cards animate in with stagger on page enter',     how: 'Navigate to Apps, observe slide-up'             },
    ],
  },
  {
    group: 'Settings',
    items: [
      { id: 'settings-theme',   label: 'Theme toggle changes background immediately',   how: 'Switch dark ↔ OLED'                        },
      { id: 'settings-grid',    label: 'Grid column change reflects in Apps',           how: 'Change to 5 columns, open Apps'             },
      { id: 'settings-24h',     label: '24-hour toggle changes clock format on Home',   how: 'Toggle, return to Home'                    },
      { id: 'settings-seconds', label: 'Show-seconds toggle adds seconds to clock',     how: 'Enable, verify on Home'                    },
      { id: 'settings-nav',     label: 'Default nav selection persists after reload',   how: 'Change to Waze, hard reload'               },
      { id: 'settings-music',   label: 'Default music updates MusicCard',              how: 'Change to YouTube Music'                   },
      { id: 'settings-persist', label: 'All settings survive page reload',             how: 'Set all values, hard reload, re-verify'    },
    ],
  },
  {
    group: 'Favorites',
    items: [
      { id: 'fav-add',      label: 'Adding favorite updates HomeScreen immediately', how: 'Star an app, go to Home'             },
      { id: 'fav-remove',   label: 'Removing favorite removes from HomeScreen',      how: 'Unstar an app, go to Home'           },
      { id: 'fav-persist',  label: 'Favorites survive page reload',                  how: 'Add favorites, hard reload'          },
      { id: 'fav-empty',    label: 'Empty state shows guidance message',             how: 'Remove all favorites'                },
      { id: 'fav-overflow', label: 'Max 3 rows shown without layout overflow',       how: 'Add 10+ favorites with 3 columns'   },
    ],
  },
  {
    group: 'Recent',
    items: [
      { id: 'recent-add',    label: 'Launching an app adds it to recents',        how: 'Launch app, return home'             },
      { id: 'recent-dedup',  label: 'Launching same app moves it to top',         how: 'Launch same app twice'               },
      { id: 'recent-max',    label: 'Max 6 recents shown',                        how: 'Launch 8 different apps'             },
      { id: 'recent-hidden', label: 'Section hidden when list is empty',          how: 'Clear localStorage, reload'          },
    ],
  },
  {
    group: 'Launch actions',
    items: [
      { id: 'launch-native',   label: 'Native: apps open via Android Intent',                how: 'Real device — tap any app'                          },
      { id: 'launch-web',      label: 'Web: apps open via window.open(url)',                 how: 'Browser — tap app with url field'                   },
      { id: 'launch-internal', label: 'Settings app routes to internal page, not Android',  how: 'Tap Settings in grid — verify in-app nav'           },
      { id: 'launch-return',   label: 'After launch from Apps, launcher returns to Home',   how: 'Launch from Apps page, check active page'           },
      { id: 'launch-fallback', label: 'Missing package falls back to Play Store',           how: 'Real device — uninstall an app, tap it'             },
    ],
  },
  {
    group: 'Media card',
    items: [
      { id: 'media-cycle',    label: 'Demo tracks cycle on next/prev (wraps)',             how: 'Tap next 3+ times'                         },
      { id: 'media-progress', label: 'Progress bar matches positionSec / durationSec',    how: 'Compare bar width to time labels'          },
      { id: 'media-time',     label: 'fmtTime handles 0, valid, and large values',        how: 'Observe "0:00" and "3:20" display'         },
      { id: 'media-launch',   label: 'Tapping album art opens default music app',         how: 'Tap album art area'                        },
      { id: 'media-truncate', label: 'Long track / artist names truncate safely',         how: 'Observe MusicCard text — no overflow'      },
    ],
  },
  {
    group: 'Device status',
    items: [
      { id: 'status-demo',     label: 'Web demo shows BT + Wi-Fi + battery populated',       how: 'Open browser, check Home chips'                     },
      { id: 'status-chips',    label: 'All 3 chips visible without overflow at narrow width', how: 'Resize window to ~800px'                            },
      { id: 'status-battery',  label: 'Battery icon changes at ≤20% and ≥80% thresholds',    how: 'Call updateDeviceStatus in DevTools console'        },
      { id: 'status-charging', label: 'Charging icon overrides battery-level icon',           how: 'Set charging: true with battery: 5'                 },
      { id: 'status-inactive', label: 'Disconnected states show "Kapalı" gracefully',         how: 'Set btConnected: false in DEMO_STATUS temporarily'  },
    ],
  },
  {
    group: 'Theme / grid settings',
    items: [
      { id: 'theme-dark',  label: 'Dark: sidebar #0b1424, main #060d1a',            how: 'Visual check with DevTools color picker'          },
      { id: 'theme-oled',  label: 'OLED: all panels and cards go fully black',      how: 'Toggle OLED, inspect every panel and card'       },
      { id: 'theme-cards', label: 'OLED CSS selector overrides card backgrounds',   how: 'Check [data-theme="oled"] in index.css'           },
      { id: 'grid-3',      label: '3-column grid renders and fills space correctly', how: 'Set 3, open Apps'                                },
      { id: 'grid-5',      label: '5-column grid renders compact without overflow', how: 'Set 5, open Apps'                                },
    ],
  },
  {
    group: 'Native fallback logic',
    items: [
      { id: 'native-detect',     label: 'isNativePlatform() selects nativeBridge on device',  how: 'Build APK, verify plugin calls in logcat'     },
      { id: 'native-plugin',     label: 'CarLauncherPlugin registered in MainActivity',        how: 'Check registerPlugin call in Java'             },
      { id: 'native-status',     label: 'getDeviceStatus() returns real data on device',       how: 'Real device — verify Home chips update'        },
      { id: 'native-boot',       label: 'App auto-starts after device reboot',                 how: 'Reboot device, wait 5s'                        },
      { id: 'native-back',       label: 'Back button does not close the launcher',             how: 'Press back on device repeatedly'               },
      { id: 'native-fullscreen', label: 'Status bar and nav bar hidden (immersive mode)',      how: 'Visual check on real device'                   },
      { id: 'native-wakelock',   label: 'Screen stays on while launcher is active',            how: 'Idle device for 1 min, verify no sleep'        },
    ],
  },
];
