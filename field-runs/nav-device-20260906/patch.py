from pathlib import Path
root=Path('C:/Temp/caros-nav-device-20260906')
evidence=Path('C:/Users/selim/Desktop/caros pro/field-runs/nav-device-20260906/baseline-files')
files=['src/platform/mapStyleBuilders.ts','src/platform/map/MapLayerManager.ts','src/platform/map/MapCore.ts','src/components/map/FullMapView.tsx','src/components/map/MiniMapWidget.tsx']
for rel in files:
 p=evidence/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes((root/rel).read_bytes())
def edit(rel,fn):
 p=root/rel;s=p.read_text(encoding='utf-8');p.write_text(fn(s),encoding='utf-8',newline='\n')
def builder(s):
 start=s.index('export function buildVectorStyle('); a=s.index('    layers: [',start);b=s.index('\n    ],\n  };',a)
 layers=s[a+len('    layers: '):b+len('\n    ]')]
 s=s[:a]+'    layers: buildVectorLayers(night),'+s[b+len('\n    ],'):]
 pos=s.index('\n/* ═',start)
 s=s[:pos]+'''\n/** İlk stil ve canlı tema aynı katman tanımlarını kullanır; kaynak seçimi yapmaz. */
export function buildVectorLayers(night: boolean): LayerSpecification[] {
  const P = night ? NIGHT_PALETTE : DAY_PALETTE;
  const includeLabels = true;
  return '''+layers+''';
}
'''+s[pos:]
 # yalnız ilk fonksiyondaki artık kullanılmayan palet
 a=s.index('  const P = night ? NIGHT_PALETTE : DAY_PALETTE;',start);s=s[:a]+s[a:].replace('  const P = night ? NIGHT_PALETTE : DAY_PALETTE;\n','',1)
 return s
edit(files[0],builder)
def layer(s):
 s=s.replace('  NAV_SUPPRESS_LAYERS,','  buildVectorLayers,\n  NAV_SUPPRESS_LAYERS,',1)
 s=s.replace('  setMarkerTheme(night);\n  const map =','  night = getMapNight(); // Tünel örtüsü dahil etkin kanonik değer.\n  setMarkerTheme(night);\n  const map =',1)
 a=s.index('    // NOT: Vektör (offline .pbf)');b=s.index('\n  } catch',a)
 s=s[:a]+'''    if (map.getSource('omv')) {
      // Yalnız semantik tema farkları: kaynak/rota/kamera yeniden kurulmaz.
      const target = buildVectorLayers(night);
      const other = buildVectorLayers(!night);
      for (let i = 0; i < target.length; i++) {
        const layer = target[i];
        if (!map.getLayer(layer.id)) continue;
        const previous = other[i];
        for (const section of ['paint', 'layout'] as const) {
          const values = layer[section] as Record<string, unknown> | undefined;
          const opposite = previous[section] as Record<string, unknown> | undefined;
          for (const [prop, value] of Object.entries(values ?? {})) {
            if (JSON.stringify(value) === JSON.stringify(opposite?.[prop])) continue;
            if (section === 'paint') map.setPaintProperty(layer.id, prop, value);
            else map.setLayoutProperty(layer.id, prop, value);
          }
        }
      }
      _moodApplied.delete(map);
      updateMapMood(map, useHazardStore.getState().globalRiskScore);
    }'''+s[b:]
 # mood dedup per instance + layer generation + theme
 s=s.replace('export function updateMapMood(map:', '''const _moodApplied = new WeakMap<MapLibreMap, {
  layer: unknown; night: boolean; score: number; safety: string; at: number;
}>();

export function updateMapMood(map:''',1)
 s=s.replace('  if (nowMs - M.lastMoodMs < MOOD_THROTTLE_MS) return;','''  const applied = _moodApplied.get(map);
  const layer = map.getLayer('background');
  const night = getMapNight();
  const sameStyle = applied?.layer === layer && applied?.night === night;
  if (sameStyle && nowMs - applied.at < MOOD_THROTTLE_MS) return;''',1)
 s=s.replace('  if (Math.abs(riskScore - M.lastMoodScore) < MOOD_HYSTERESIS\n    && safetyState === M.lastMoodSafetyState) return;','''  if (sameStyle && Math.abs(riskScore - applied.score) < MOOD_HYSTERESIS
    && safetyState === applied.safety) return;
  _moodApplied.set(map, { layer, night, score: riskScore, safety: safetyState, at: nowMs });''',1)
 return s
edit(files[1],layer)
edit(files[2],lambda s:s.replace('  _applyRouteGeometry, ensureRoadShieldImages,','  applyMapDayNight, _applyRouteGeometry, ensureRoadShieldImages,',1).replace("    map.on('style.load', () => {","    map.on('style.load', () => {\n      applyMapDayNight(getMapNight(), map);",1))
def full(s):
 a=s.index('    const map = mapRef.current;\n    if (',s.index('    applyMapDayNight(mapNight,'));b=s.index('\n  }, [mapNight, mapStatus, navStatus]);',a)
 s=s[:a]+"    if (mapStatus === 'READY') setStyleKey((k) => k + 1);"+s[b:]
 s=s.replace('const _onInteractStart = useCallback(() => {','const _onInteractStart = useCallback((e: { originalEvent?: unknown }) => {\n    if (!e.originalEvent) return;',1)
 s=s.replace('const _onInteractEnd = useCallback(() => {','const _onInteractEnd = useCallback((e: { originalEvent?: unknown }) => {\n    if (!e.originalEvent) return;',1)
 s=s.replace('const onPanStart = () => notifyUserPanStart();','const onPanStart = (e: { originalEvent?: unknown }) => { if (e.originalEvent) notifyUserPanStart(); };',1)
 s=s.replace('const onPanEnd   = () => notifyUserPanEnd(applyRecenter);','const onPanEnd = (e: { originalEvent?: unknown }) => { if (e.originalEvent) notifyUserPanEnd(applyRecenter); };',1)
 # aynı requestFollow ardından ikinci kamera komutu
 a=s.index('  // Sürüş modu açılınca');b=s.index('  // WebGL kontrolü',a)
 s=s[:a]+'''  // Sürüş girişinin tek komut yolu requestFollow'dur.
  useEffect(() => {
    if (drivingMode) requestFollow('NAV_START');
  }, [drivingMode, requestFollow]);

'''+s[b:]
 a=s.index('  // ACTIVE/REROUTING:');b=s.index('  // D: Detect fetch failure',a)
 s=s[:a]+'''  // Reroute yeni kamera girişi değildir; yalnız sürüş modunu garantile.
  useEffect(() => {
    if (navStatus === NavStatus.ACTIVE || navStatus === NavStatus.REROUTING) setDrivingMode(true);
  }, [navStatus]);

'''+s[b:]
 a=s.index('    requestFollow(\'NAV_START\');',s.index('  const handleNavStart'));b=s.index('\n  }, [requestFollow]);',a)
 s=s[:a]+s[b:].replace('  }, [requestFollow]);','  }, []);',1)
 # restyle callback yalnız katman kurar, kamera başlangıcını tekrarlamaz
 a=s.index('        if (drivingModeRef.current) {',s.index('  function _doStyleSwitch'));b=s.index('        map._fullMapInitialized = true;',a)
 s=s[:a]+'''        // Stil yüklemesi kamera komutu değildir; pan/follow kadrajı korunur.
'''+s[b:]
 # zoom düğmeleri kullanıcı olayını MapLibre eventData'ya taşır
 s=s.replace('const handleZoomIn = () => mapRef.current?.zoomIn();','const handleZoomIn = () => mapRef.current?.zoomIn({}, { originalEvent: true });')
 s=s.replace('const handleZoomOut = () => mapRef.current?.zoomOut();','const handleZoomOut = () => mapRef.current?.zoomOut({}, { originalEvent: true });')
 return s
edit(files[3],full)
def mini(s):
 s=s.replace('const onStart = () => notifyUserPanStart();','const onStart = (e: { originalEvent?: unknown }) => { if (e.originalEvent) notifyUserPanStart(); };')
 s=s.replace('const onEnd   = () => notifyUserPanEnd(recenterOnVehicle);','const onEnd = (e: { originalEvent?: unknown }) => { if (e.originalEvent) notifyUserPanEnd(recenterOnVehicle); };')
 return s
edit(files[4],mini)
