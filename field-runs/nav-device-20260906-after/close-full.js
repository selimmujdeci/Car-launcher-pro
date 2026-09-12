(() => { const b = document.querySelector('[aria-label="Haritayı kapat"]'); if (!b) return { error: 'no close button' }; b.click(); return 'closed'; })()
