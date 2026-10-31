China outline: DataV GeoAtlas national boundary GeoJSON, retrieved 2026-10-26.
Source: https://geo.datav.aliyun.com/areas_v3/bound/100000.json
The local copy allows the photo atlas to render without a map tile service.

Province and city centers: DataV GeoAtlas administrative boundary properties,
retrieved 2026-10-26 from 100000_full.json and each province's <adcode>_full.json
under https://geo.datav.aliyun.com/areas_v3/bound/ .
china-places.json retains only administrative codes, names, parent names and centers.
These centers locate photos tagged with a city or province; saved photo GPS remains preferred.

Province polygons: DataV GeoAtlas `100000_full.json`, retrieved 2026-10-26.
Source: https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json
`china-provinces.json` retains the original geometry for offline province tinting and point-in-polygon matching.
Only the 34 named province-level features participate in visit statistics.
City cluster labels use the nearest administrative city center within the matched province;
they are approximate geographic labels, not a city-boundary reverse geocoder.
