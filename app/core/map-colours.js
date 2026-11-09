// @ts-check
// The colours of the maps' own marks, written once: a plant's ring and a lieu's square, by its abundance — on the map
// (gf-map.js: Leaflet's markers, drawn as SVG text, where no CSS variable reaches), in its legend (gf-map-panel.js, the
// panel ▦) and before each lieu of the Carte's list (gf-map-page.js). The same in both themes: they are drawn over the
// map's photos and plans. Here, not in gf-map.js: it imports the panel (gf-map-panel.js), which would import it back.
// Out of the app's start: the maps load it.

/** A plant's ring and a lieu's square on the maps, by its abundance (place-model.js Abundance). */
export const PIN_COLORS = { rare: '#fb7185', moyen: '#fbbf24', abondant: '#38bdf8' };
