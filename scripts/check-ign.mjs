// Temporary: checks IGN Géoplateforme layer identifiers and API response shapes (run in CI).
const ua = { 'user-agent': 'GeoFlora check (github.com/yannouche-dev/flora)' };
const get = async (url, type = 'json') => {
  const r = await fetch(url, { headers: ua });
  console.log('\n###', r.status, url);
  return type === 'json' ? r.json() : r.text();
};
const caps = await get('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&VERSION=1.0.0', 'text');
const layers = [...caps.matchAll(/<Layer>([\s\S]*?)<\/Layer>/g)].map(m => {
  const b = m[1];
  const id = /<ows:Identifier>([^<]+)<\/ows:Identifier>/.exec(b)?.[1];
  const title = /<ows:Title>([^<]+)<\/ows:Title>/.exec(b)?.[1];
  const formats = [...b.matchAll(/<Format>([^<]+)<\/Format>/g)].map(x => x[1]).join(',');
  const sets = [...b.matchAll(/<TileMatrixSet>([^<]+)<\/TileMatrixSet>/g)].map(x => x[1]).join(',');
  const styles = [...b.matchAll(/<Style[^>]*>\s*<ows:Title>[^<]*<\/ows:Title>\s*<ows:Abstract>[^<]*<\/ows:Abstract>\s*<ows:Keywords>[\s\S]*?<\/ows:Keywords>\s*<ows:Identifier>([^<]+)/g)].map(x => x[1]);
  const styleIds = [...b.matchAll(/<Style[\s\S]*?<ows:Identifier>([^<]+)<\/ows:Identifier>/g)].map(x => x[1]).join(',');
  const limits = [...b.matchAll(/<TileMatrix>([^<]+)<\/TileMatrix>/g)].map(x => x[1]);
  return { id, title, formats, sets, styleIds, zooms: limits.length ? limits[0] + '-' + limits[limits.length - 1] : '' };
});
console.log('total layers', layers.length);
for (const l of layers.filter(l => /^Patrinat|PROTECTED|PARC NATIONAL|RESERVE|NATURA|ZPS|SIC|APB|BIOTOPE/i.test(l.id + ' ' + l.title))) console.log(JSON.stringify(l));
const tile = async (layer, style, set, z, x, y) => {
  const t = await fetch(`https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=${encodeURIComponent(style)}&TILEMATRIXSET=${set}&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=image/png`, { headers: ua });
  const body = t.ok ? '' : (await t.text()).slice(0, 200);
  console.log('tile', layer, style, set, z, t.status, t.headers.get('content-type'), t.headers.get('content-length'), body);
};
// z14 tile over the Chartreuse / Vercors area and Fontainebleau
for (const [layer, style] of [['FORETS.PUBLIQUES', 'FORETS PUBLIQUES ONF'], ['Patrinat_PNR', 'normal'], ['ELEVATION.CONTOUR.LINE', 'normal']]) {
  await tile(layer, style, 'PM', 14, 8441, 5852);
  await tile(layer, style, 'PM', 12, 2110, 1463);
}
for (const l of layers.filter(l => /^Patrinat/.test(l.id))) await tile(l.id, l.styleIds.split(',')[0], 'PM', 12, 2110, 1463);
