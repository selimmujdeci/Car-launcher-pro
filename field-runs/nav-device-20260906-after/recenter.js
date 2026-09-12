(() => { const i = document.querySelector('.lucide-crosshair'); if (!i) return { error: 'no recenter button' };
 const before = window.__navFollow ? __navFollow() : null; i.closest('button').click();
 return { before, after: window.__navFollow ? __navFollow() : null }; })()
