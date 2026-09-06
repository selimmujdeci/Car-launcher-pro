(() => ({ follow: window.__navFollow ? __navFollow() : null,
  camera: (() => { const m = __MAP_STORE__.getState().mapInstance; return { zoom:+m.getZoom().toFixed(3), pitch:+m.getPitch().toFixed(2), bearing:+m.getBearing().toFixed(2) }; })() }))()
