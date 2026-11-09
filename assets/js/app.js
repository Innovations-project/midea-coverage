/* ===========================================================================
   Midea Coverage — dashboard logic
   ---------------------------------------------------------------------------
   No build step, no framework. Loads:
     data/dataset.js  → window.JBDES_DATA  (shop + dealer records)
     data/ph-map.js   → window.PH_MAP      (province shapes, generated)
     assets/js/config.js → window.APP_CONFIG

   Sections
     1. constants & helpers      6. shop list
     2. data normalisation       7. master data
     3. filtering & statistics   8. report
     4. dashboard (KPIs, map)    9. import / export
     5. province summary        10. auth, routing, boot
   =========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 1. constants & helpers
   * ------------------------------------------------------------------ */
  var CFG = window.APP_CONFIG || {};
  var RAW_DATA = window.JBDES_DATA || { records: [], meta: {}, provinceRegion: {} };
  var GEO = window.PH_MAP || { provinces: [], viewBox: '0 0 460 772' };
  var ORIGINAL_RAW = JSON.parse(JSON.stringify(RAW_DATA.records || []));

  var REGIONS = {
    'NCR':  'National Capital Region',
    'CAR':  'Cordillera Administrative Region',
    'I':    'Ilocos Region',
    'II':   'Cagayan Valley',
    'III':  'Central Luzon',
    'IV-A': 'CALABARZON',
    'IV-B': 'MIMAROPA',
    'V':    'Bicol Region',
    'VI':   'Western Visayas',
    'VII':  'Central Visayas',
    'VIII': 'Eastern Visayas',
    'IX':   'Zamboanga Peninsula',
    'X':    'Northern Mindanao',
    'XI':   'Davao Region',
    'XII':  'SOCCSKSARGEN',
    'XIII': 'Caraga',
    'BARMM':'Bangsamoro',
    'NIR':  'Negros Island Region'
  };

  var REGION_CODES = {
    '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '4A': 'IV-A', '4B': 'IV-B',
    'MIMAROPA': 'IV-B', '5': 'V', '6': 'VI', '7': 'VII', '8': 'VIII', '9': 'IX',
    '10': 'X', '11': 'XI', '12': 'XII', '13': 'XIII', 'CAR': 'CAR', 'NCR': 'NCR',
    'BARMM': 'BARMM', 'ARMM': 'BARMM', 'NIR': 'NIR'
  };

  var PROVINCE_ALIASES = {
    'ORIENTAL MONDORO': 'ORIENTAL MINDORO',
    'ORIENTAL MINDORO ': 'ORIENTAL MINDORO',
    'METROPOLITAN MANILA': 'METRO MANILA',
    'TAWITAWI': 'TAWI-TAWI',
    'TAWI TAWI': 'TAWI-TAWI',
    'COMPOSTELA VALLEY': 'DAVAO DE ORO',
    'NORTH COTABATO': 'COTABATO',
    'MAGUINDANAO': 'MAGUINDANAO DEL SUR'
  };

  var LEVEL_ALIASES = {
    'PROSHOP': 'ProShop',
    'PRO SHOP': 'ProShop',
    'HVACSS': 'HVACSS',
    'HVAC SOLUTION': 'HVACSS',
    'HVAC SOLUTIONS': 'HVACSS',
    'HVAC SOLUTION SHOP': 'HVACSS'
  };

  var MAP_BUCKETS = [
    { label: 'No shops', fill: '#e9eef6', test: function (n) { return n === 0; } },
    { label: '1 – 2',    fill: '#cfe1fa', test: function (n) { return n >= 1 && n <= 2; } },
    { label: '3 – 5',    fill: '#93bdf3', test: function (n) { return n >= 3 && n <= 5; } },
    { label: '6 – 10',   fill: '#4a8ae8', test: function (n) { return n >= 6 && n <= 10; } },
    { label: '11+',      fill: '#1a56ac', test: function (n) { return n >= 11; } }
  ];

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function num(value) { return Number(value || 0).toLocaleString('en-US'); }
  function pct(part, whole) {
    if (!whole) return '0%';
    var p = (part / whole) * 100;
    return (p >= 10 || p === 0 ? Math.round(p) : Math.round(p * 10) / 10) + '%';
  }
  function clean(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }

  function titleCase(key) {
    return String(key || '')
      .toLowerCase()
      .replace(/(^|[\s\-'])([a-z])/g, function (_, pre, ch) { return pre + ch.toUpperCase(); })
      .replace(/\bDel\b/g, 'del').replace(/\bDe\b/g, 'de').replace(/\bNg\b/g, 'ng');
  }

  function canonRegion(value) {
    var s = clean(value).toUpperCase().replace(/^REGION\s+/, '').replace(/\s+/g, '');
    if (!s) return '';
    if (REGION_CODES[s]) return REGION_CODES[s];
    if (REGIONS[s]) return s;
    return '';
  }

  function canonProvince(value) {
    var s = clean(value).toUpperCase()
      .replace(/\s*\([^)]*\)\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) return '';
    return PROVINCE_ALIASES[s] || s;
  }

  function regionLabel(code) { return code ? code + ' · ' + (REGIONS[code] || code) : '—'; }

  /* Province → region, seeded from the workbook and completed for provinces
     that the reference list did not cover (Negros Island Region, Siquijor). */
  var PROVINCE_REGION = (function () {
    var map = {};
    Object.keys(RAW_DATA.provinceRegion || {}).forEach(function (key) {
      var province = canonProvince(key);
      var region = canonRegion(RAW_DATA.provinceRegion[key]);
      if (province && region) map[province] = region;
    });
    map['NEGROS OCCIDENTAL'] = map['NEGROS OCCIDENTAL'] || 'NIR';
    map['NEGROS ORIENTAL'] = map['NEGROS ORIENTAL'] || 'NIR';
    map['SIQUIJOR'] = map['SIQUIJOR'] || 'NIR';
    return map;
  })();

  function regionFor(province, rawRegion) {
    var direct = canonRegion(rawRegion);
    if (direct) return direct;
    return PROVINCE_REGION[province] || '';
  }

  function normaliseLevel(value) {
    var raw = clean(value);
    if (!raw) return 'Unclassified';
    var collapsed = raw.toUpperCase().replace(/\s*\(([^)]*)\)\s*/, '$1').trim();
    if (LEVEL_ALIASES[collapsed]) return LEVEL_ALIASES[collapsed];
    var inner = /\(([^)]+)\)/.exec(raw);
    if (inner) return clean(inner[1]);
    return raw;
  }

  function isShopLevel(level) { return level === 'ProShop' || level === 'HVACSS'; }

  /* a status of "`" or "." is a data-entry artefact, not a real state */
  function cleanStatus(value) {
    var s = clean(value);
    return /[a-z0-9]/i.test(s) ? s : '';
  }

  function statusTag(status) {
    var s = cleanStatus(status);
    if (!s) return '<span class="tag muted">—</span>';
    var cls = /^activated$/i.test(s) ? 'ok' : (/change|pending|hold/i.test(s) ? 'warn' : 'muted');
    return '<span class="tag ' + cls + '">' + esc(s) + '</span>';
  }

  function typeTag(level) {
    return level === 'ProShop'
      ? '<span class="tag pro">ProShop</span>'
      : '<span class="tag hvac">HVACSS</span>';
  }

  function sortBy(list, key, dir) {
    var factor = dir === 'desc' ? -1 : 1;
    return list.slice().sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (typeof av === 'number' || typeof bv === 'number') {
        return ((av || 0) - (bv || 0)) * factor;
      }
      return String(av || '').localeCompare(String(bv || ''), 'en') * factor;
    });
  }

  /* ------------------------------------------------------------------ *
   * 2. data normalisation
   * ------------------------------------------------------------------ */

  /* Maps a spreadsheet row (2-D array + header list) onto the dataset schema. */
  var IMPORT_FIELDS = [
    ['id',       ['installer id', 'id', 'record id']],
    ['name',     ['installer name', 'shop name', 'dealer name', 'name']],
    ['code',     ['proshop/hvacss id code', 'code', 'installer code']],
    ['level',    ['level #2', 'proshop/hvacss level', 'level']],
    ['region',   ['region', 'region #2', 'installer region']],
    ['province', ['province', 'proshop province']],
    ['city',     ['city or town', 'proshop city', 'city']],
    ['address',  ['proshop complete address', 'address']],
    ['year',     ['year opened', 'year']],
    ['category', ['category']],
    ['listing',  ['listing']],
    ['status',   ['status']],
    ['approved', ['approved time', 'approved']],
    ['applied',  ['application time', 'applied']],
    ['phone',    ['phone number', 'phone']],
    ['email',    ['email']]
  ];

  function normaliseRow(row, index) {
    var level = normaliseLevel(row.level);
    var province = canonProvince(row.province);
    var year = parseInt(row.year, 10);
    return {
      id: clean(row.id) || 'ROW-' + (index + 1),
      name: clean(row.name),
      code: clean(row.code),
      level: level,
      region: regionFor(province, row.region),
      province: province,
      city: clean(row.city).toUpperCase(),
      address: clean(row.address),
      year: isNaN(year) ? null : year,
      category: clean(row.category),
      listing: clean(row.listing),
      status: cleanStatus(row.status),
      approved: clean(row.approved),
      applied: clean(row.applied),
      phone: clean(row.phone),
      email: clean(row.email),
      isShop: isShopLevel(level)
    };
  }

  var state = {
    records: [],          // every normalised record
    shops: [],            // ProShop + HVACSS only
    sourceRows: null,     // raw rows when data was imported in this session
    imported: false,
    filters: { region: '', province: '', type: '', year: '', q: '' },
    provinceSort: { key: 'total', dir: 'desc' },
    provinceQuery: '',
    shop: { q: '', type: '', region: '', sort: 'name|asc' },
    master: { q: '', level: '', sort: 'id|asc' },
    page: { shop: 1, master: 1 }
  };

  function rebuild(rows) {
    state.records = rows.map(normaliseRow);
    state.shops = state.records.filter(function (r) { return r.isShop; });
    state.otherCount = state.records.length - state.shops.length;
    state.typoCount = state.records.filter(function (r, i) {
      return canonProvince(rows[i].province) !== clean(rows[i].province).toUpperCase();
    }).length;
  }

  /* ------------------------------------------------------------------ *
   * 3. filtering & statistics
   * ------------------------------------------------------------------ */
  function matchesFilters(shop, skip) {
    var f = state.filters;
    if (f.region && shop.region !== f.region) return false;
    if (skip !== 'province' && f.province && shop.province !== f.province) return false;
    if (f.type && shop.level !== f.type) return false;
    if (f.year && String(shop.year) !== String(f.year)) return false;
    if (f.q) {
      var needle = f.q.toLowerCase();
      var hay = (shop.name + ' ' + shop.city + ' ' + shop.province + ' ' + shop.code + ' ' +
        shop.address + ' ' + shop.region).toLowerCase();
      if (hay.indexOf(needle) === -1) return false;
    }
    return true;
  }

  function filteredShops(skip) {
    return state.shops.filter(function (s) { return matchesFilters(s, skip); });
  }

  function stats(shops) {
    var provinces = {}, regions = {}, cities = {}, levels = { ProShop: 0, HVACSS: 0 };
    var activated = 0, latestYear = 0, byYear = {};
    shops.forEach(function (s) {
      if (s.province) provinces[s.province] = (provinces[s.province] || 0) + 1;
      if (s.region) regions[s.region] = (regions[s.region] || 0) + 1;
      if (s.city) cities[s.province + '|' + s.city] = 1;
      levels[s.level] = (levels[s.level] || 0) + 1;
      if (/^activated$/i.test(s.status)) activated++;
      if (s.year) {
        byYear[s.year] = (byYear[s.year] || 0) + 1;
        if (s.year > latestYear) latestYear = s.year;
      }
    });
    return {
      total: shops.length,
      pro: levels.ProShop || 0,
      hvac: levels.HVACSS || 0,
      provinces: Object.keys(provinces).length,
      regions: Object.keys(regions).length,
      cities: Object.keys(cities).length,
      activated: activated,
      latestYear: latestYear,
      newInLatest: latestYear ? (byYear[latestYear] || 0) : 0,
      byYear: byYear,
      byProvince: provinces,
      byRegion: regions
    };
  }

  function provinceRows(shops) {
    var map = {};
    shops.forEach(function (s) {
      if (!s.province) return;
      var row = map[s.province] || (map[s.province] = {
        province: s.province, name: titleCase(s.province),
        region: s.region || PROVINCE_REGION[s.province] || '',
        ps: 0, hs: 0, total: 0, cities: {}, newest: 0
      });
      if (s.level === 'ProShop') row.ps++; else row.hs++;
      row.total++;
      if (s.city) row.cities[s.city] = 1;
      if (s.year > row.newest) row.newest = s.year;
    });
    return Object.keys(map).map(function (key) {
      var row = map[key];
      row.cities = Object.keys(row.cities).length;
      return row;
    });
  }

  function regionRows(shops) {
    var map = {};
    shops.forEach(function (s) {
      var key = s.region || 'Unassigned';
      var row = map[key] || (map[key] = { region: key, ps: 0, hs: 0, total: 0, provinces: {} });
      if (s.level === 'ProShop') row.ps++; else row.hs++;
      row.total++;
      if (s.province) row.provinces[s.province] = 1;
    });
    return Object.keys(map).map(function (key) {
      var row = map[key];
      row.provinces = Object.keys(row.provinces).length;
      return row;
    }).sort(function (a, b) { return b.total - a.total; });
  }

  /* ------------------------------------------------------------------ *
   * 4. dashboard rendering
   * ------------------------------------------------------------------ */
  var el = {};

  function renderKpis(shops) {
    var s = stats(shops);
    var geoCount = (GEO.provinces || []).length || 81;
    var cards = [
      { label: 'Total locations', value: num(s.total), sub: 'ProShop + HVAC Solution sites', icon: '⌂' },
      { label: CFG.labels && CFG.labels.proShop || 'ProShop', value: num(s.pro), sub: pct(s.pro, s.total) + ' of the network', icon: '▤' },
      { label: 'HVACSS', value: num(s.hvac), sub: pct(s.hvac, s.total) + ' of the network', icon: '❄' },
      { label: 'Provinces', value: num(s.provinces), sub: 'of ' + geoCount + ' on the map', icon: '▦' },
      { label: 'Regions', value: num(s.regions), sub: 'with an active site', icon: '◍' },
      { label: 'New shops · ' + (s.latestYear || '—'), value: num(s.newInLatest), sub: 'latest year opened', icon: '＋', highlight: true }
    ];
    el.kpis.innerHTML = cards.map(function (c) {
      return '<article class="kpi' + (c.highlight ? ' is-highlight' : '') + '">' +
        '<div class="kpi-icon" aria-hidden="true">' + c.icon + '</div>' +
        '<div><div class="kpi-label">' + esc(c.label) + '</div>' +
        '<div class="kpi-value">' + esc(c.value) + '</div>' +
        '<div class="kpi-sub">' + esc(c.sub) + '</div></div></article>';
    }).join('');
  }

  function buildMapPaths() {
    var svg = el.map;
    svg.setAttribute('viewBox', GEO.viewBox || '0 0 460 772');
    svg.innerHTML = (GEO.provinces || []).map(function (p) {
      return '<path class="province" data-key="' + esc(p.key) + '" d="' + p.d + '" ' +
        'tabindex="0" role="button" aria-label="' + esc(titleCase(p.key)) + '"></path>';
    }).join('');
  }

  function renderMap(shops) {
    var rows = provinceRows(shops);
    var counts = {};
    rows.forEach(function (r) { counts[r.province] = r.total; });
    var selected = state.filters.province;
    var regionFilter = state.filters.region;

    $$('.province', el.map).forEach(function (path) {
      var key = path.getAttribute('data-key');
      var count = counts[key] || 0;
      var bucket = MAP_BUCKETS[MAP_BUCKETS.length - 1];
      for (var i = 0; i < MAP_BUCKETS.length; i++) {
        if (MAP_BUCKETS[i].test(count)) { bucket = MAP_BUCKETS[i]; break; }
      }
      path.setAttribute('fill', bucket.fill);
      path.classList.toggle('is-selected', key === selected);
      var region = PROVINCE_REGION[key];
      path.classList.toggle('is-dim', !!(regionFilter && region && region !== regionFilter));
      path.setAttribute('aria-label', titleCase(key) + ': ' + count + ' shop' + (count === 1 ? '' : 's'));
    });

    /* legend counts every province on the map, not just the ones with shops */
    var mapKeys = (GEO.provinces || []).map(function (p) { return p.key; });
    var bucketCounts = MAP_BUCKETS.map(function (b) {
      return mapKeys.filter(function (key) { return b.test(counts[key] || 0); }).length;
    });
    el.mapLegend.innerHTML = MAP_BUCKETS.map(function (b, i) {
      return '<div class="legend-row"><span class="swatch" style="background:' + b.fill + '"></span>' +
        '<span>' + esc(b.label) + '</span><b>' + bucketCounts[i] + '</b></div>';
    }).join('') +
      '<div class="legend-row" style="margin-top:4px;color:#8b9db1;font-size:11px">' +
      'Provinces shaded by number of shops</div>';

    /* selection panel */
    var sel = selected ? provinceRows(shops.filter(function (s) { return s.province === selected; }))[0] : null;
    if (selected && sel) {
      el.mapSelection.innerHTML =
        '<span class="sel-name">' + esc(sel.name) + '</span>' +
        '<span class="sel-meta">' + esc(regionLabel(sel.region)) + '</span>' +
        '<div class="sel-split"><span>ProShop<b>' + num(sel.ps) + '</b></span>' +
        '<span>HVACSS<b>' + num(sel.hs) + '</b></span>' +
        '<span>Cities<b>' + num(sel.cities) + '</b></span></div>';
    } else if (selected) {
      el.mapSelection.innerHTML =
        '<span class="sel-name">' + esc(titleCase(selected)) + '</span>' +
        '<span class="sel-meta">No shop in the current filters</span>' +
        '<div class="sel-split"><span>Shops<b>0</b></span></div>';
    } else {
      el.mapSelection.innerHTML =
        '<strong>Click a province</strong> on the map to drill into its sites. ' +
        '<strong>' + num(rows.length) + '</strong> of <strong>' +
        num((GEO.provinces || []).length) + '</strong> provinces currently have a shop.';
    }

    /* busiest provinces */
    var top = sortBy(rows, 'total', 'desc').slice(0, 6);
    el.mapTop.innerHTML = top.map(function (r) {
      return '<li><button type="button" data-province="' + esc(r.province) + '">' +
        esc(r.name) + '</button><b>' + r.total + '</b></li>';
    }).join('') || '<li>No provinces in this selection</li>';

    /* one-line summary */
    var s = stats(shops);
    var label = selected ? titleCase(selected) + ' — ' + num(s.total) + ' shop' + (s.total === 1 ? '' : 's') : 'All provinces';
    el.mapSummary.innerHTML = '<strong>' + esc(label) + '</strong> · ' +
      num(s.provinces) + ' provinces · ' + num(s.regions) + ' regions · ' +
      num(s.cities) + ' cities';

    el.mapReadyLabel.textContent = 'Map ready';
    el.mapReadyLabel.parentNode.classList.add('is-ready');
  }

  function renderBars(shops) {
    var rows = regionRows(shops).slice(0, 12);
    if (!rows.length) {
      el.regionBars.innerHTML = '<div class="empty"><b>No regions to show</b>Adjust or clear the filters.</div>';
      return;
    }
    var max = Math.max.apply(null, rows.map(function (r) { return r.total; })) || 1;
    el.regionBars.innerHTML = rows.map(function (r) {
      var proW = (r.ps / max) * 100;
      var hvacW = (r.hs / max) * 100;
      return '<div class="bar-row" title="' + esc(regionLabel(r.region)) + ' — ' + r.total + ' shops">' +
        '<span class="bar-label">' + esc(r.region || 'Unassigned') + ' · ' + esc(REGIONS[r.region] || 'Unassigned') + '</span>' +
        '<span class="bar-track">' +
        '<span class="bar-fill pro" style="width:' + proW.toFixed(2) + '%"></span>' +
        '<span class="bar-fill hvac" style="width:' + hvacW.toFixed(2) + '%"></span>' +
        '</span>' +
        '<span class="bar-value">' + r.total + '</span></div>';
    }).join('');
  }

  function renderCoverage(shops) {
    var s = stats(shops);
    var geoCount = (GEO.provinces || []).length || 81;
    var items = [
      ['Provinces covered', s.provinces, 'of ' + geoCount],
      ['Cities covered', s.cities, ''],
      ['Regions covered', s.regions, 'of ' + Object.keys(REGIONS).length],
      ['Activated', s.activated, 'of ' + s.total]
    ];
    el.coverageGrid.innerHTML = items.map(function (item) {
      return '<div class="coverage-item"><span>' + esc(item[0]) + '</span>' +
        '<b>' + num(item[1]) + '</b><small>' + esc(item[2]) + '</small></div>';
    }).join('');

    var meta = RAW_DATA.meta || {};
    var notes = [];
    notes.push('Showing <b>' + num(state.shops.length) + '</b> shop locations drawn from ' +
      '<b>' + num(state.records.length) + '</b> master records' +
      (state.otherCount ? '; the other <b>' + num(state.otherCount) + '</b> rows are dealer levels outside the shop programme and are listed in Master data.' : '.'));
    if (state.typoCount) {
      notes.push('<b>' + num(state.typoCount) + '</b> record' + (state.typoCount === 1 ? ' has a' : 's have') +
        ' misspelled province that was matched to the correct province (e.g. “ORIENTAL MONDORO” → Oriental Mindoro).');
    }
    if (meta.source) notes.push('Source: ' + esc(meta.source) + (meta.generated ? ' · loaded ' + esc(meta.generated) : ''));
    el.dataNote.innerHTML = notes.join(' ');
  }

  function renderProvinceTable(shops) {
    var rows = sortBy(provinceRows(shops), state.provinceSort.key, state.provinceSort.dir);
    if (state.provinceQuery) {
      var q = state.provinceQuery.toLowerCase();
      rows = rows.filter(function (r) {
        return (r.name + ' ' + r.region).toLowerCase().indexOf(q) !== -1;
      });
    }
    var total = rows.reduce(function (sum, r) { return sum + r.total; }, 0);
    el.provinceRows.innerHTML = rows.length ? rows.map(function (r) {
      return '<tr class="is-clickable" data-province="' + esc(r.province) + '">' +
        '<td class="name">' + esc(r.name) + '</td>' +
        '<td>' + esc(r.region || '—') + '</td>' +
        '<td class="num">' + num(r.ps) + '</td>' +
        '<td class="num">' + num(r.hs) + '</td>' +
        '<td class="num"><b>' + num(r.total) + '</b></td>' +
        '<td class="num">' + num(r.cities) + '</td>' +
        '<td class="num">' + (r.newest || '—') + '</td></tr>';
    }).join('') : '<tr><td colspan="7"><div class="empty"><b>No provinces match</b>Try another search or clear the filters.</div></td></tr>';

    el.provinceSummarySub.textContent = rows.length + ' provinces · ' + num(total) + ' shops';
    el.provinceFoot.innerHTML = '<span>' + esc(state.filters.province ? 'Filtered to ' + titleCase(state.filters.province) : 'All provinces in the current selection') + '</span>' +
      '<span>Sorted by ' + esc(state.provinceSort.key) + ' · ' + esc(state.provinceSort.dir === 'desc' ? 'descending' : 'ascending') + '</span>';
  }

  function renderDashboard() {
    var shops = filteredShops();
    renderKpis(shops);
    renderMap(shops);
    renderBars(shops);
    renderCoverage(shops);
    renderProvinceTable(shops);
    renderStatusLine(shops);
  }

  function renderStatusLine(shops) {
    var meta = RAW_DATA.meta || {};
    var stamp = meta.generated ? 'Workbook ' + meta.generated : 'Workbook data';
    var filtering = state.filters.region || state.filters.province || state.filters.type ||
      state.filters.year || state.filters.q;
    el.dataStatus.textContent = num(shops.length) + ' of ' + num(state.shops.length) + ' locations' +
      (filtering ? ' (filtered)' : '') + ' · ' + stamp;
    el.asideTotal.textContent = num(state.shops.length);
    el.asideStamp.textContent = stamp;
    el.footerNote.textContent = 'Midea ProShop & HVAC Solution coverage dashboard · ' +
      num(state.records.length) + ' master records · built ' + new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /* ------------------------------------------------------------------ *
   * 5. filter controls
   * ------------------------------------------------------------------ */
  function fillSelect(select, options, selected, placeholder) {
    if (!select) return;
    var html = placeholder ? '<option value="">' + esc(placeholder) + '</option>' : '';
    html += options.map(function (opt) {
      return '<option value="' + esc(opt.value) + '"' + (String(opt.value) === String(selected) ? ' selected' : '') + '>' + esc(opt.label) + '</option>';
    }).join('');
    select.innerHTML = html;
  }

  function uniqueOptions(values, labeller) {
    var seen = {}, out = [];
    values.forEach(function (v) {
      if (!v || seen[v]) return;
      seen[v] = 1;
      out.push({ value: v, label: labeller ? labeller(v) : v });
    });
    return out;
  }

  function refreshFilterOptions() {
    var regions = uniqueOptions(state.shops.map(function (s) { return s.region; }))
      .sort(function (a, b) {
        var order = Object.keys(REGIONS);
        return order.indexOf(a.value) - order.indexOf(b.value);
      })
      .map(function (o) { return { value: o.value, label: regionLabel(o.value) }; });

    var provincePool = state.filters.region
      ? state.shops.filter(function (s) { return s.region === state.filters.region; })
      : state.shops;
    var provinces = uniqueOptions(provincePool.map(function (s) { return s.province; }))
      .map(function (o) { return { value: o.value, label: titleCase(o.value) }; })
      .sort(function (a, b) { return a.label.localeCompare(b.label, 'en'); });

    var years = uniqueOptions(state.shops.map(function (s) { return s.year ? String(s.year) : ''; }))
      .sort(function (a, b) { return Number(a.value) - Number(b.value); });

    fillSelect(el.fRegion, regions, state.filters.region, 'All regions');
    fillSelect(el.fProvince, provinces, state.filters.province, 'All provinces');
    fillSelect(el.fYear, years, state.filters.year, 'All years');
    fillSelect(el.shopRegion, regions, state.shop.region, 'All regions');

    var levels = uniqueOptions(state.records.map(function (r) { return r.level; }))
      .sort(function (a, b) { return a.value.localeCompare(b.value, 'en'); });
    fillSelect(el.masterLevel, levels, state.master.level, 'All levels');
  }

  function setFilter(key, value) {
    state.filters[key] = value;
    if (key === 'region') {
      /* keep a province that belongs to the new region, otherwise reset */
      if (state.filters.province && state.filters.region) {
        var match = state.shops.some(function (s) {
          return s.province === state.filters.province && s.region === state.filters.region;
        });
        if (!match) state.filters.province = '';
      }
      refreshFilterOptions();
    }
    if (key === 'province') {
      /* a province may be selected from the map that has no option yet */
      if (value && !Array.prototype.some.call(el.fProvince.options, function (opt) { return opt.value === value; })) {
        var option = document.createElement('option');
        option.value = value;
        option.textContent = titleCase(value);
        el.fProvince.appendChild(option);
      }
      el.fProvince.value = value || '';
    }
    state.page.shop = 1;
    renderDashboard();
  }

  function clearFilters() {
    state.filters = { region: '', province: '', type: '', year: '', q: '' };
    el.fRegion.value = '';
    el.fProvince.value = '';
    el.fType.value = '';
    el.fYear.value = '';
    el.fSearch.value = '';
    renderDashboard();
    renderShopList();
  }

  /* ------------------------------------------------------------------ *
   * 6. shop list
   * ------------------------------------------------------------------ */
  function renderShopList() {
    var q = state.shop.q.toLowerCase();
    var rows = state.shops.filter(function (s) {
      if (state.shop.type && s.level !== state.shop.type) return false;
      if (state.shop.region && s.region !== state.shop.region) return false;
      if (!q) return true;
      return (s.name + ' ' + s.code + ' ' + s.city + ' ' + s.province + ' ' + s.region + ' ' + s.address)
        .toLowerCase().indexOf(q) !== -1;
    });

    var parts = state.shop.sort.split('|');
    rows = sortBy(rows, parts[0], parts[1]);

    var size = (CFG.tables && CFG.tables.shopPageSize) || 25;
    var pages = Math.max(1, Math.ceil(rows.length / size));
    if (state.page.shop > pages) state.page.shop = pages;
    var start = (state.page.shop - 1) * size;
    var pageRows = rows.slice(start, start + size);

    el.shopCount.textContent = num(rows.length) + ' shop' + (rows.length === 1 ? '' : 's');
    el.shopRows.innerHTML = pageRows.length ? pageRows.map(function (s) {
      return '<tr class="is-clickable" data-record="' + esc(s.id) + '" tabindex="0">' +
        '<td class="name">' + esc(s.name) + '</td>' +
        '<td><code>' + esc(s.code || '—') + '</code></td>' +
        '<td>' + typeTag(s.level) + '</td>' +
        '<td>' + esc(s.region || '—') + '</td>' +
        '<td>' + esc(titleCase(s.province)) + '</td>' +
        '<td>' + esc(titleCase(s.city)) + '</td>' +
        '<td class="num">' + (s.year || '—') + '</td>' +
        '<td>' + statusTag(s.status) + '</td></tr>';
    }).join('') : '<tr><td colspan="8"><div class="empty"><b>No shops match</b>Try clearing the search or the type filter.</div></td></tr>';

    el.shopPager.innerHTML = pagerHtml('shop', state.page.shop, pages, start + 1, Math.min(start + size, rows.length), rows.length);
  }

  function pagerHtml(kind, page, pages, from, to, total) {
    return '<span>Showing ' + num(from) + '–' + num(to) + ' of ' + num(total) + '</span>' +
      '<div><button type="button" data-pager="' + kind + '" data-page="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>Prev</button>' +
      '<span>Page ' + page + ' / ' + pages + '</span>' +
      '<button type="button" data-pager="' + kind + '" data-page="' + (page + 1) + '"' + (page >= pages ? ' disabled' : '') + '>Next</button></div>';
  }

  /* ------------------------------------------------------------------ *
   * 7. master data
   * ------------------------------------------------------------------ */
  function renderMaster() {
    var q = state.master.q.toLowerCase();
    var rows = state.records.filter(function (r) {
      if (state.master.level && r.level !== state.master.level) return false;
      if (!q) return true;
      return (r.id + ' ' + r.name + ' ' + r.code + ' ' + r.city + ' ' + r.province + ' ' + r.address + ' ' + r.level)
        .toLowerCase().indexOf(q) !== -1;
    });
    var parts = state.master.sort.split('|');
    rows = sortBy(rows, parts[0], parts[1]);

    var size = (CFG.tables && CFG.tables.masterPageSize) || 50;
    var pages = Math.max(1, Math.ceil(rows.length / size));
    if (state.page.master > pages) state.page.master = pages;
    var start = (state.page.master - 1) * size;
    var pageRows = rows.slice(start, start + size);

    el.masterCount.textContent = num(rows.length) + ' record' + (rows.length === 1 ? '' : 's');
    el.masterSub.textContent = num(state.records.length) + ' in the workbook · ' +
      num(state.shops.length) + ' shop locations';
    el.masterRows.innerHTML = pageRows.length ? pageRows.map(function (r) {
      return '<tr class="is-clickable" data-record="' + esc(r.id) + '" tabindex="0">' +
        '<td><code>' + esc(r.id) + '</code></td>' +
        '<td class="name">' + esc(r.name || '—') + '</td>' +
        '<td>' + (r.isShop ? typeTag(r.level) : '<span class="tag muted">' + esc(r.level) + '</span>') + '</td>' +
        '<td>' + esc(r.code || '—') + '</td>' +
        '<td>' + esc(r.region || '—') + '</td>' +
        '<td>' + esc(r.province ? titleCase(r.province) : '—') + '</td>' +
        '<td>' + esc(r.city ? titleCase(r.city) : '—') + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + (r.year || '—') + '</td>' +
        '<td>' + statusTag(r.status) + '</td></tr>';
    }).join('') : '<tr><td colspan="10"><div class="empty"><b>No records match</b>Try a different search.</div></td></tr>';

    el.masterPager.innerHTML = pagerHtml('master', state.page.master, pages, start + 1, Math.min(start + size, rows.length), rows.length);
  }

  function openDetail(id) {
    var record = null;
    for (var i = 0; i < state.records.length; i++) {
      if (state.records[i].id === id) { record = state.records[i]; break; }
    }
    if (!record) return;
    var rows = [
      ['Installer ID', record.id],
      ['Installer code', record.code || '—'],
      ['Level', record.level],
      ['Region', record.region ? regionLabel(record.region) : '—'],
      ['Province', record.province ? titleCase(record.province) : '—'],
      ['City / town', record.city ? titleCase(record.city) : '—'],
      ['Year opened', record.year || '—'],
      ['Category', record.category || '—'],
      ['Listing', record.listing || '—'],
      ['Status', record.status || '—'],
      ['Phone', record.phone || '—'],
      ['Email', record.email || '—'],
      ['Applied', record.applied || '—'],
      ['Approved', record.approved || '—']
    ];
    el.detailBody.innerHTML =
      '<div class="detail-type">' + (record.isShop ? typeTag(record.level) : '<span class="tag muted">' + esc(record.level) + '</span>') + '</div>' +
      '<h3 class="detail-title" id="detailTitle">' + esc(record.name || 'Unnamed record') + '</h3>' +
      '<div class="detail-code">' + esc(record.code || record.id) + '</div>' +
      '<div class="detail-grid">' +
      rows.map(function (row) {
        return '<div><span>' + esc(row[0]) + '</span><b>' + esc(row[1]) + '</b></div>';
      }).join('') +
      '<div class="detail-wide"><span>Address</span><b>' + esc(record.address || '—') + '</b></div>' +
      '</div>';
    el.detailModal.hidden = false;
    el.detailClose.focus();
  }

  function closeDetail() { el.detailModal.hidden = true; }

  /* ------------------------------------------------------------------ *
   * 8. report
   * ------------------------------------------------------------------ */
  function renderReport() {
    var s = stats(state.shops);
    var provinces = sortBy(provinceRows(state.shops), 'total', 'desc');
    var regions = regionRows(state.shops);
    var years = Object.keys(s.byYear).sort();
    var meta = RAW_DATA.meta || {};

    el.reportBody.innerHTML =
      '<h2>Midea ProShop and HVAC Solution Shop Monitoring System</h2>' +
      '<div class="report-meta">Coverage report · generated ' +
      esc(new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })) +
      ' · source: ' + esc(meta.source || 'master workbook') + '</div>' +

      '<div class="report-kpis">' +
      [['Locations', s.total], ['ProShop', s.pro], ['HVACSS', s.hvac],
        ['Provinces', s.provinces], ['Cities', s.cities], ['Regions', s.regions]]
        .map(function (k) { return '<div class="report-kpi"><span>' + esc(k[0]) + '</span><b>' + num(k[1]) + '</b></div>'; })
        .join('') + '</div>' +

      '<h3>Coverage by region</h3>' +
      '<table class="report-table"><thead><tr><th>Region</th><th>Name</th>' +
      '<th class="num">Provinces</th><th class="num">ProShop</th><th class="num">HVACSS</th><th class="num">Total</th></tr></thead><tbody>' +
      regions.map(function (r) {
        return '<tr><td><b>' + esc(r.region) + '</b></td><td>' + esc(REGIONS[r.region] || '—') + '</td>' +
          '<td class="num">' + r.provinces + '</td><td class="num">' + r.ps + '</td>' +
          '<td class="num">' + r.hs + '</td><td class="num"><b>' + r.total + '</b></td></tr>';
      }).join('') +
      '</tbody></table>' +

      '<div class="report-cols" style="margin-top:22px">' +
      '<div><h3 style="margin-top:0">Top provinces</h3><table class="report-table"><thead><tr>' +
      '<th>Province</th><th>Region</th><th class="num">ProShop</th><th class="num">HVACSS</th><th class="num">Total</th>' +
      '</tr></thead><tbody>' +
      provinces.slice(0, 15).map(function (r) {
        return '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.region || '—') + '</td>' +
          '<td class="num">' + r.ps + '</td><td class="num">' + r.hs + '</td>' +
          '<td class="num"><b>' + r.total + '</b></td></tr>';
      }).join('') +
      '</tbody></table></div>' +

      '<div><h3 style="margin-top:0">Sites by year opened</h3><table class="report-table"><thead><tr>' +
      '<th>Year</th><th class="num">Sites</th><th class="num">Share</th></tr></thead><tbody>' +
      years.map(function (y) {
        return '<tr><td>' + esc(y) + '</td><td class="num">' + num(s.byYear[y]) + '</td>' +
          '<td class="num">' + pct(s.byYear[y], s.total) + '</td></tr>';
      }).join('') +
      '</tbody></table>' +
      '<h3>Status</h3><table class="report-table"><tbody>' +
      (function () {
        var byStatus = {};
        state.shops.forEach(function (shop) {
          var key = shop.status || 'Not stated';
          byStatus[key] = (byStatus[key] || 0) + 1;
        });
        return Object.keys(byStatus).sort().map(function (key) {
          return '<tr><td>' + esc(key) + '</td><td class="num"><b>' + num(byStatus[key]) + '</b></td></tr>';
        }).join('');
      })() +
      '</tbody></table></div></div>' +

      '<div class="report-note">Prepared from ' + num(state.records.length) + ' master records; ' +
      num(state.shops.length) + ' of them are ProShop or HVAC Solution sites, the remaining ' +
      num(state.otherCount) + ' are other dealer levels. ' +
      (state.typoCount ? num(state.typoCount) + ' record(s) had a province name corrected while loading. ' : '') +
      'Provinces covered: ' + num(s.provinces) + ' of ' + num((GEO.provinces || []).length) +
      '. Figures reflect the workbook at load time.</div>';
  }

  /* ------------------------------------------------------------------ *
   * 9. import / export
   * ------------------------------------------------------------------ */
  function download(filename, content, type) {
    var blob = new Blob([content], { type: type || 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function toCsv(rows) {
    var cols = ['id', 'name', 'code', 'level', 'region', 'province', 'city', 'address', 'year', 'category', 'listing', 'status', 'phone', 'email'];
    var esc4 = function (v) {
      var s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return cols.join(',') + '\n' + rows.map(function (r) {
      return cols.map(function (c) { return esc4(r[c]); }).join(',');
    }).join('\n');
  }

  /* Exports whatever the operator is looking at: the shop list's own filters
     when that view is open, otherwise the dashboard's current selection. */
  function exportShops() {
    var shops;
    if ($('#view-shops').classList.contains('is-active')) {
      var q = state.shop.q.toLowerCase();
      shops = state.shops.filter(function (s) {
        if (state.shop.type && s.level !== state.shop.type) return false;
        if (state.shop.region && s.region !== state.shop.region) return false;
        if (!q) return true;
        return (s.name + ' ' + s.code + ' ' + s.city + ' ' + s.province + ' ' + s.region + ' ' + s.address)
          .toLowerCase().indexOf(q) !== -1;
      });
    } else {
      shops = filteredShops();
    }
    var parts = state.shop.sort.split('|');
    if ($('#view-shops').classList.contains('is-active')) shops = sortBy(shops, parts[0], parts[1]);
    download('midea-shops-' + new Date().toISOString().slice(0, 10) + '.csv', toCsv(shops));
    toast('Exported <b>' + num(shops.length) + '</b> shop locations.');
  }

  function exportMaster() {
    download('midea-master-data-' + new Date().toISOString().slice(0, 10) + '.csv',
      toCsv(state.records));
    toast('Exported all <b>' + num(state.records.length) + '</b> master records.');
  }

  function exportDataset() {
    var payload = {
      meta: {
        source: (RAW_DATA.meta && RAW_DATA.meta.source) || 'Imported workbook',
        sheet: 'MasterData',
        generated: new Date().toISOString().slice(0, 19).replace('T', ' '),
        totalRows: state.records.length,
        duplicateIds: 0,
        locations: state.shops.length
      },
      provinceRegion: RAW_DATA.provinceRegion || {},
      records: state.records.map(function (r) {
        return {
          id: r.id, name: r.name, code: r.code, level: r.level, region: r.region,
          province: r.province, city: r.city, address: r.address, year: r.year,
          approved: r.approved, applied: r.applied, phone: r.phone, email: r.email,
          category: r.category, listing: r.listing, status: r.status
        };
      })
    };
    download('dataset.js', 'window.JBDES_DATA=' + JSON.stringify(payload) + ';\n', 'text/javascript;charset=utf-8');
    toast('Downloaded <b>dataset.js</b> — replace <code>data/dataset.js</code> with it to make these figures permanent.');
  }

  /* Parse CSV text into a 2-D array (handles quotes, escaped quotes, CRLF). */
  function parseCsv(text) {
    var rows = [], row = [], field = '', inQuotes = false, i = 0;
    text = String(text).replace(/^\uFEFF/, '');
    while (i < text.length) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ',') { row.push(field); field = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += ch; i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function isHeaderRow(row) {
    var joined = row.join(' ').toLowerCase();
    return /installer id|installer name|shop name|dealer name/.test(joined);
  }

  function rowsToObjects(matrix) {
    var headerIndex = 0;
    for (var i = 0; i < Math.min(matrix.length, 12); i++) {
      if (isHeaderRow(matrix[i])) { headerIndex = i; break; }
    }
    var headers = matrix[headerIndex].map(function (h, i) {
      var key = clean(h).toLowerCase();
      return key || ('column ' + (i + 1));
    });
    /* spreadsheet exports repeat header names (e.g. two "Level" columns) */
    var seen = {}, deduped = headers.map(function (h) {
      seen[h] = (seen[h] || 0) + 1;
      return seen[h] > 1 ? h + ' #' + seen[h] : h;
    });

    return matrix.slice(headerIndex + 1).filter(function (row) {
      return row.some(function (cell) { return clean(cell) !== ''; });
    }).map(function (row) {
      var obj = {};
      deduped.forEach(function (header, i) { obj[header] = row[i] == null ? '' : row[i]; });
      return obj;
    });
  }

  function mapImportedRows(objects) {
    var keys = Object.keys(objects[0] || {});
    var mapping = {};
    IMPORT_FIELDS.forEach(function (field) {
      var name = field[0];
      var candidates = field[1];
      for (var c = 0; c < candidates.length; c++) {
        var found = keys.filter(function (key) {
          return key === candidates[c] || key.indexOf(candidates[c] + ' #') === 0;
        })[0];
        if (found) { mapping[name] = found; break; }
      }
    });
    if (!mapping.name) return null;

    return objects.map(function (obj, index) {
      var out = {};
      Object.keys(mapping).forEach(function (field) { out[field] = obj[mapping[field]]; });
      out.id = clean(out.id) || 'ROW-' + (index + 1);
      return out;
    });
  }

  function loadSheetJs() {
    return new Promise(function (resolve, reject) {
      if (window.XLSX) return resolve(window.XLSX);
      var script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      script.onload = function () { window.XLSX ? resolve(window.XLSX) : reject(new Error('unavailable')); };
      script.onerror = function () { reject(new Error('offline')); };
      document.head.appendChild(script);
    });
  }

  function applyImportedRows(objects, sourceName) {
    var mapped = mapImportedRows(objects);
    if (!mapped || !mapped.length) {
      toast('That file has no recognisable shop rows. Expected columns such as “Installer name” and “Installer ID”.', true);
      return;
    }
    rebuild(mapped);
    state.sourceRows = mapped;
    state.imported = true;
    state.page.shop = 1;
    state.page.master = 1;
    state.filters = { region: '', province: '', type: '', year: '', q: '' };
    state.shop = { q: '', type: '', region: '', sort: 'name|asc' };
    state.master = { q: '', level: '', sort: 'id|asc' };
    ['fRegion', 'fProvince', 'fType', 'fYear', 'fSearch', 'shopSearch', 'shopType', 'shopRegion', 'masterSearch', 'masterLevel']
      .forEach(function (id) { if (el[id]) el[id].value = ''; });

    refreshFilterOptions();
    renderAll();
    el.restoreData.hidden = false;
    toast('Loaded <b>' + num(state.records.length) + '</b> records from “' + esc(sourceName) + '” — ' +
      num(state.shops.length) + ' shop locations. <button type="button" data-action="download-dataset">Save dataset.js</button>');
  }

  function handleFile(file) {
    if (!file) return;
    var name = file.name || 'workbook';
    if (/\.csv$/i.test(name)) {
      var reader = new FileReader();
      reader.onload = function () {
        try { applyImportedRows(rowsToObjects(parseCsv(String(reader.result))), name); }
        catch (error) { toast('Could not read that CSV: ' + error.message, true); }
      };
      reader.readAsText(file);
      return;
    }
    if (/\.(xlsx|xlsm|xls)$/i.test(name)) {
      toast('Reading <b>' + esc(name) + '</b>…');
      loadSheetJs().then(function (XLSX) {
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var wb = XLSX.read(new Uint8Array(reader.result), { type: 'array' });
            var sheetName = wb.SheetNames.indexOf('MasterData') !== -1 ? 'MasterData' : wb.SheetNames[0];
            var matrix = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' });
            applyImportedRows(rowsToObjects(matrix), name + ' · ' + sheetName);
          } catch (error) {
            toast('Could not read that workbook: ' + error.message, true);
          }
        };
        reader.readAsArrayBuffer(file);
      }).catch(function () {
        toast('Excel import needs a one-time internet connection to load the spreadsheet reader. ' +
          'Save the sheet as CSV and import that instead.', true);
      });
      return;
    }
    toast('Unsupported file type. Use .xlsx, .xlsm or .csv.', true);
  }

  function restoreOriginal() {
    rebuild(JSON.parse(JSON.stringify(ORIGINAL_RAW)));
    state.sourceRows = null;
    state.imported = false;
    state.page.shop = 1;
    state.page.master = 1;
    refreshFilterOptions();
    renderAll();
    el.restoreData.hidden = true;
    toast('Restored the workbook data shipped with the site.');
  }

  /* ------------------------------------------------------------------ *
   * 10. auth, routing, boot
   * ------------------------------------------------------------------ */
  var SESSION_KEY = 'midea.session';

  function readSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
    catch (error) { return null; }
  }
  function writeSession(session) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (error) { /* ignore */ }
  }
  function dropSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (error) { /* ignore */ }
  }

  function authConfigured() {
    var auth = CFG.auth || {};
    return !!(auth.required && auth.supabaseUrl && auth.supabaseAnonKey);
  }

  function showApp(identity) {
    el.authGate.hidden = true;
    el.app.hidden = false;
    el.signedInAs.textContent = identity;
    el.signOut.hidden = !authConfigured();
    renderAll();
  }

  function showGate(message) {
    el.app.hidden = true;
    el.authGate.hidden = false;
    if (message) setAuthMessage(message, false);
    setTimeout(function () { el.loginEmail.focus(); }, 60);
  }

  function setAuthMessage(text, ok) {
    el.authMessage.textContent = text || '';
    el.authMessage.classList.toggle('is-ok', !!ok);
  }

  function verifySession(session) {
    var auth = CFG.auth;
    return fetch(auth.supabaseUrl.replace(/\/$/, '') + '/auth/v1/user', {
      headers: { apikey: auth.supabaseAnonKey, Authorization: 'Bearer ' + session.access_token }
    }).then(function (res) {
      if (!res.ok) throw new Error('session expired');
      return res.json();
    }).then(function (user) {
      return (user && user.email) || session.email || 'Signed in';
    });
  }

  function signIn(email, password) {
    var auth = CFG.auth;
    return fetch(auth.supabaseUrl.replace(/\/$/, '') + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: auth.supabaseAnonKey },
      body: JSON.stringify({ email: email, password: password })
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) throw new Error(body && (body.error_description || body.msg) || 'Sign in failed');
        return body;
      });
    }).then(function (body) {
      writeSession({
        access_token: body.access_token,
        email: (body.user && body.user.email) || email,
        expires_at: Date.now() + ((body.expires_in || 3600) * 1000)
      });
      showApp((body.user && body.user.email) || email);
    });
  }

  function bootAuth() {
    if (!authConfigured()) {
      showApp('Local session · no sign-in required');
      return;
    }
    var session = readSession();
    if (!session || !session.access_token || (session.expires_at && session.expires_at < Date.now())) {
      dropSession();
      showGate('');
      return;
    }
    verifySession(session)
      .then(function (identity) { showApp(identity); })
      .catch(function () {
        dropSession();
        showGate('Your session expired — please sign in again.');
      });
  }

  function showView(name) {
    $$('.view').forEach(function (view) {
      view.classList.toggle('is-active', view.id === 'view-' + name);
    });
    $$('.nav button').forEach(function (button) {
      var active = button.getAttribute('data-view') === name;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (name === 'report') renderReport();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  var toastTimer = null;
  function toast(html, isError) {
    el.toast.innerHTML = html;
    el.toast.classList.toggle('is-error', !!isError);
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, isError ? 7000 : 5200);
  }

  function renderAll() {
    renderDashboard();
    renderShopList();
    renderMaster();
    if ($('#view-report').classList.contains('is-active')) renderReport();
  }

  /* ------------------------------ wiring ------------------------------ */
  function cacheElements() {
    ['app', 'authGate', 'loginForm', 'loginEmail', 'loginPassword', 'loginButton', 'authMessage',
      'signedInAs', 'signOut', 'dataStatus', 'asideTotal', 'asideStamp', 'footerNote',
      'kpis', 'map', 'mapTip', 'mapLegend', 'mapSelection', 'mapTop', 'mapSummary',
      'mapReadyLabel', 'regionBars', 'coverageGrid', 'dataNote',
      'provinceRows', 'provinceSummarySub', 'provinceFoot', 'provinceFilter',
      'fRegion', 'fProvince', 'fType', 'fYear', 'fSearch', 'clearFilters', 'refresh',
      'shopSearch', 'shopType', 'shopRegion', 'shopSort', 'shopRows', 'shopPager', 'shopCount',
      'masterSearch', 'masterLevel', 'masterSort', 'masterRows', 'masterPager', 'masterCount', 'masterSub',
      'restoreData', 'reportBody', 'printReport', 'exportDataset',
      'importExcel', 'excelFile',
      'toast', 'detailModal', 'detailBody', 'detailClose'
    ].forEach(function (key) {
      var node = key === 'map' ? $('#provinceMap')
        : key === 'toast' ? $('#toast')
        : key === 'detailModal' ? $('#detailModal')
        : $('#' + key);
      if (node) el[key] = node;
    });
    el.mapReadyLabel = $('#mapReadyLabel');
  }

  function bindEvents() {
    /* navigation */
    $$('.nav button').forEach(function (button) {
      button.addEventListener('click', function () { showView(button.getAttribute('data-view')); });
    });

    /* filters */
    el.fRegion.addEventListener('change', function () { setFilter('region', this.value); });
    el.fProvince.addEventListener('change', function () { setFilter('province', this.value); });
    el.fType.addEventListener('change', function () { setFilter('type', this.value); });
    el.fYear.addEventListener('change', function () { setFilter('year', this.value); });
    el.fSearch.addEventListener('input', debounce(function () { setFilter('q', el.fSearch.value.trim()); }, 180));
    el.clearFilters.addEventListener('click', clearFilters);
    el.refresh.addEventListener('click', function () {
      renderAll();
      toast('View refreshed.');
    });
    el.provinceFilter.addEventListener('input', debounce(function () {
      state.provinceQuery = el.provinceFilter.value.trim();
      renderProvinceTable(filteredShops());
    }, 140));

    /* province summary sorting */
    $$('#provinceTable th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        var numeric = ['ps', 'hs', 'total', 'cities', 'newest'].indexOf(key) !== -1;
        var dir;
        if (state.provinceSort.key === key) {
          dir = state.provinceSort.dir === 'desc' ? 'asc' : 'desc';
        } else {
          dir = numeric ? 'desc' : 'asc';
        }
        state.provinceSort = { key: key, dir: dir };
        $$('#provinceTable th[data-sort]').forEach(function (node) { node.removeAttribute('aria-sort'); });
        th.setAttribute('aria-sort', dir === 'desc' ? 'descending' : 'ascending');
        renderProvinceTable(filteredShops());
      });
    });

    /* map interactions */
    el.map.addEventListener('click', function (event) {
      var path = event.target.closest('.province');
      if (path) toggleProvince(path.getAttribute('data-key'));
    });
    el.map.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var path = event.target.closest('.province');
      if (!path) return;
      event.preventDefault();
      toggleProvince(path.getAttribute('data-key'));
    });
    el.map.addEventListener('mousemove', showMapTip);
    el.map.addEventListener('mouseleave', function () { el.mapTip.hidden = true; });
    $('#clearProvince').addEventListener('click', function () {
      if (!state.filters.province) return;
      setFilter('province', '');
    });

    /* province drill-down from side list and summary table */
    document.addEventListener('click', function (event) {
      var trigger = event.target.closest('[data-province]');
      if (trigger) { toggleProvince(trigger.getAttribute('data-province')); return; }
      var row = event.target.closest('tr[data-record]');
      if (row) { openDetail(row.getAttribute('data-record')); return; }
      var pager = event.target.closest('[data-pager]');
      if (pager && !pager.disabled) {
        var kind = pager.getAttribute('data-pager');
        state.page[kind] = parseInt(pager.getAttribute('data-page'), 10) || 1;
        if (kind === 'shop') renderShopList(); else renderMaster();
        return;
      }
      var action = event.target.closest('[data-action]');
      if (action && action.getAttribute('data-action') === 'download-dataset') {
        exportDataset();
        el.toast.hidden = true;
      }
    });

    /* shop + master controls */
    el.shopSearch.addEventListener('input', debounce(function () {
      state.shop.q = el.shopSearch.value.trim();
      state.page.shop = 1;
      renderShopList();
    }, 150));
    el.shopType.addEventListener('change', function () {
      state.shop.type = this.value; state.page.shop = 1; renderShopList();
    });
    el.shopRegion.addEventListener('change', function () {
      state.shop.region = this.value; state.page.shop = 1; renderShopList();
    });
    el.shopSort.addEventListener('change', function () {
      state.shop.sort = this.value; state.page.shop = 1; renderShopList();
    });
    el.masterSearch.addEventListener('input', debounce(function () {
      state.master.q = el.masterSearch.value.trim();
      state.page.master = 1;
      renderMaster();
    }, 150));
    el.masterLevel.addEventListener('change', function () {
      state.master.level = this.value; state.page.master = 1; renderMaster();
    });
    el.masterSort.addEventListener('change', function () {
      state.master.sort = this.value; state.page.master = 1; renderMaster();
    });

    /* toolbar actions */
    el.importExcel.addEventListener('click', function () { el.excelFile.click(); });
    el.excelFile.addEventListener('change', function () {
      handleFile(this.files && this.files[0]);
      this.value = '';
    });
    el.exportDataset.addEventListener('click', exportDataset);
    el.restoreData.addEventListener('click', restoreOriginal);
    el.printReport.addEventListener('click', function () { window.print(); });

    /* modal */
    el.detailClose.addEventListener('click', closeDetail);
    el.detailModal.addEventListener('click', function (event) {
      if (event.target === el.detailModal) closeDetail();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !el.detailModal.hidden) closeDetail();
      if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('tr[data-record]')) {
        event.preventDefault();
        openDetail(event.target.getAttribute('data-record'));
      }
    });

    /* auth */
    if (authConfigured()) {
      el.loginForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var email = el.loginEmail.value.trim();
        var password = el.loginPassword.value;
        if (!email || !password) {
          setAuthMessage('Enter your email and password.', false);
          return;
        }
        el.loginButton.disabled = true;
        setAuthMessage('Signing in…', true);
        signIn(email, password)
          .catch(function (error) {
            setAuthMessage(error.message || 'Sign in failed. Check your credentials.', false);
          })
          .then(function () { el.loginButton.disabled = false; });
      });
      el.signOut.addEventListener('click', function () {
        dropSession();
        window.location.reload();
      });
    }
  }

  function toggleProvince(key) {
    if (!key) return;
    setFilter('province', state.filters.province === key ? '' : key);
    var select = el.fProvince;
    if (select) select.value = state.filters.province || '';
  }

  function showMapTip(event) {
    var path = event.target.closest('.province');
    if (!path) { el.mapTip.hidden = true; return; }
    var key = path.getAttribute('data-key');
    var rows = provinceRows(filteredShops()).filter(function (r) { return r.province === key; })[0];
    var region = PROVINCE_REGION[key];
    el.mapTip.innerHTML = '<b>' + esc(titleCase(key)) + '</b>' +
      '<span>' + (rows ? rows.total + ' shop' + (rows.total === 1 ? '' : 's') +
        ' · ' + rows.ps + ' ProShop · ' + rows.hs + ' HVACSS' : 'No shops in this selection') +
      (region ? '<br>' + esc(regionLabel(region)) : '') + '</span>';
    var stage = el.map.parentNode.getBoundingClientRect();
    el.mapTip.style.left = (event.clientX - stage.left) + 'px';
    el.mapTip.style.top = (event.clientY - stage.top) + 'px';
    el.mapTip.hidden = false;
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments, context = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(context, args); }, wait);
    };
  }

  function boot() {
    cacheElements();
    if (!el.app) return;

    var rows = ORIGINAL_RAW.map(function (row) {
      var copy = {};
      Object.keys(row).forEach(function (key) { copy[key] = row[key]; });
      return copy;
    });
    rebuild(rows);

    buildMapPaths();
    refreshFilterOptions();
    bindEvents();
    bootAuth();

    if (window.matchMedia && window.matchMedia('(max-width: 820px)').matches) {
      $$('.top-actions button').forEach(function (button) {
        button.setAttribute('aria-label', button.textContent.trim());
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
