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
const re = /FORET|PROTECTED|PARC|PNR|RESERV|NATURA|ZNIEFF|RANDO|SENTIER|ELEVATION|CONTOUR|HYDRO|CADASTRAL/i;
for (const l of layers.filter(l => re.test(l.id + ' ' + l.title))) console.log(JSON.stringify(l));
const s = await get('https://data.geopf.fr/geocodage/search?q=Vaulx-en-Velin&limit=2');
console.log(JSON.stringify(s).slice(0, 1500));
const p = await get('https://data.geopf.fr/geocodage/search?q=Grenoble&index=address,poi&limit=3');
console.log(JSON.stringify(p).slice(0, 1500));
const c = await get('https://data.geopf.fr/geocodage/completion?text=chamonix&maximumResponses=3');
console.log(JSON.stringify(c).slice(0, 1200));
const r = await get('https://data.geopf.fr/geocodage/reverse?lon=4.8357&lat=45.7641&limit=1');
console.log(JSON.stringify(r).slice(0, 1500));
const a = await get('https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?lon=4.8357&lat=45.7641&resource=ign_rge_alti_wld&zonly=true');
console.log(JSON.stringify(a).slice(0, 500));
for (const name of ['FORETS.PUBLIQUES', 'PROTECTEDAREAS.PN', 'PROTECTEDAREAS.RN']) {
  const t = await fetch(`https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${name}&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=12&TILEROW=1462&TILECOL=2103&FORMAT=image/png`, { headers: ua });
  console.log('tile', name, t.status, t.headers.get('content-type'), t.headers.get('access-control-allow-origin'));
}
