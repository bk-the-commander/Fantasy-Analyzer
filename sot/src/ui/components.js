/* SOT — presentation primitives.
 *
 * Plain functions returning HTML strings. No framework: the dataset is small
 * enough that re-rendering the whole view on any change is imperceptible, and
 * it keeps the prototype dependency-free. In a production build these become
 * components with the same signatures.
 */
(function (SOT) {
  'use strict';

  const esc = (s) =>
    String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const at = esc;

  /* --------------------------------------------------------------- format */

  const DATEY = /(^|[a-z])(At|Date|Expiry|ExpiresOn|expiresOn|dob|CurrentTo)$|^dob$|^admitAt$|^eventDate$/;

  function date(ts) {
    if (!ts && ts !== 0) return '—';
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function dateTime(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function ago(ts, now) {
    if (!ts) return 'never';
    const d = (now || Date.now()) - ts;
    if (d < 0) return 'in ' + ago(now - (ts - now), now);
    const m = Math.round(d / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    const hh = Math.round(m / 60);
    if (hh < 24) return hh + (hh === 1 ? ' hour ago' : ' hours ago');
    const dd = Math.round(hh / 24);
    if (dd < 45) return dd + (dd === 1 ? ' day ago' : ' days ago');
    return date(ts);
  }

  /** Field values are stored raw; prose happens here and nowhere else. */
  function value(key, v) {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'number' && Math.abs(v) > 1e10 && DATEY.test(key)) return date(v);
    if (key === 'lengthOfDays') return v + (v === 1 ? ' day' : ' days');
    if (key === 'beds' || key === 'licensedBeds' || key === 'authorizedStrength') return String(v);
    return String(v);
  }

  function statValue(s) {
    if (s.value === null || s.value === undefined) return '—';
    switch (s.fmt) {
      case 'pct': return s.value + '%';
      case 'days': return s.value + (s.value === 1 ? ' day' : ' days');
      case 'daysAgo': return s.value + 'd';
      case 'years': return s.value + ' yr';
      case 'ratio': return s.value + '×';
      case 'money': {
        const v = Math.abs(s.value);
        if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'bn';
        if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'm';
        if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
        return '$' + Math.round(v);
      }
      case 'miles': return Math.round(s.value).toLocaleString('en-US') + ' mi';
      case 'hours': return s.value + ' h';
      case 'date': return date(s.value);
      default: return typeof s.value === 'number' ? s.value.toLocaleString('en-US') : String(s.value);
    }
  }

  /* -------------------------------------------------------------- visuals */

  function initials(name) {
    return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  }

  /** People get initials, everything else gets its type glyph. */
  function avatar(profile, pack, cls) {
    const t = pack.typeById[profile.type];
    const person = t.kind === 'person';
    return '<span class="av ' + (person ? '' : 'sq ') + (cls || '') + '" aria-hidden="true">' +
      (person ? esc(initials(profile.name)) : esc(t.glyph)) + '</span>';
  }

  function tag(text, cls) { return '<span class="tag ' + (cls || '') + '">' + esc(text) + '</span>'; }
  function severityTag(sev) { return '<span class="tag ' + sev + '"><i class="dot"></i>' + esc(sev) + '</span>'; }
  function kindTag(kind) {
    const label = { divergence: 'Divergence', gap: 'Gap', lag: 'Lag', identity: 'Identity' }[kind] || kind;
    const cls = { divergence: 'critical', gap: 'medium', lag: 'low', identity: 'line' }[kind] || '';
    return '<span class="tag ' + cls + '">' + esc(label) + '</span>';
  }
  function systemTag(pack, id) {
    const s = pack.systemById[id];
    if (!s) return '';
    return '<span class="systag"><i class="sysdot"></i>' + esc(s.name) + '</span>';
  }
  function systemLink(pack, id, nativeId) {
    const s = pack.systemById[id];
    if (!s) return '';
    return '<a class="btn sm" href="' + at(s.deepLink.replace('{id}', encodeURIComponent(nativeId))) +
      '" target="_blank" rel="noopener noreferrer">' + esc(s.name) + ' ↗</a>';
  }

  function ring(pct, size) {
    const s = size || 54;
    const r = s / 2 - 4;
    const c = 2 * Math.PI * r;
    const on = (Math.max(0, Math.min(100, pct)) / 100) * c;
    const colour = pct >= 95 ? 'var(--ok)' : pct >= 80 ? 'var(--sev-medium)' : 'var(--sev-critical)';
    return '<div class="ring" style="width:' + s + 'px;height:' + s + 'px">' +
      '<svg width="' + s + '" height="' + s + '" viewBox="0 0 ' + s + ' ' + s + '" style="transform:rotate(-90deg)">' +
      '<circle cx="' + s / 2 + '" cy="' + s / 2 + '" r="' + r + '" fill="none" stroke="var(--surface-3)" stroke-width="4"/>' +
      '<circle cx="' + s / 2 + '" cy="' + s / 2 + '" r="' + r + '" fill="none" stroke="' + colour +
      '" stroke-width="4" stroke-linecap="round" stroke-dasharray="' + on.toFixed(1) + ' ' + c.toFixed(1) + '"/></svg>' +
      '<span class="v" style="color:' + colour + '">' + Math.round(pct) + '</span></div>';
  }

  function stat(k, v, h, cls) {
    return '<div class="card stat ' + (cls || '') + '"><div class="k">' + esc(k) + '</div>' +
      '<div class="v">' + (typeof v === 'string' && v.indexOf('<') === 0 ? v : esc(String(v))) + '</div>' +
      (h ? '<div class="h">' + esc(h) + '</div>' : '') + '</div>';
  }

  function statTile(s) {
    return '<div class="card stat"><div class="k">' + esc(s.label) + '</div>' +
      '<div class="v">' + esc(statValue(s)) + '</div>' +
      '<div class="h">' + esc(s.hint || '') + '</div></div>';
  }

  function entityLine(profile, pack, sub) {
    const t = pack.typeById[profile.type];
    const subtitle = sub !== undefined ? sub : (t.subtitle || []).map((k) => profile.get(k)).filter(Boolean).join(' · ');
    return '<span class="eline">' + avatar(profile, pack, 'sm') +
      '<span style="min-width:0"><span class="n">' + esc(profile.name) + '</span>' +
      (subtitle ? '<br><span class="s">' + esc(subtitle) + '</span>' : '') + '</span></span>';
  }

  function entityCard(profile, pack, extra) {
    const t = pack.typeById[profile.type];
    const sub = (t.subtitle || []).map((k) => profile.get(k)).filter(Boolean).join(' · ');
    const open = profile.conflicts.filter((c) => c.actionable).length;
    return '<button class="ecard" data-go="#/e/' + at(profile.entity.id) + '">' +
      '<span class="top">' + avatar(profile, pack) +
      '<span style="min-width:0"><span class="nm">' + esc(profile.name) + '</span><br>' +
      '<span class="ti">' + esc(sub || t.label) + '</span></span></span>' +
      '<span class="meta">' + (extra || '') +
      '<span style="margin-left:auto">' +
      (open ? '<span class="tag critical">' + open + ' open</span>' : '<span class="tag ok">' + profile.alignment + '%</span>') +
      '</span></span></button>';
  }

  function tabs(items, current, action) {
    return '<div class="tabs">' + items.map((t) =>
      '<button class="' + (t.id === current ? 'on' : '') + '" data-act="' + at(action) + '" data-tab="' + at(t.id) + '">' +
      esc(t.label) + (t.count !== undefined && t.count !== null ? '<span class="c">' + t.count + '</span>' : '') +
      '</button>').join('') + '</div>';
  }

  function empty(text) { return '<div class="empty">' + esc(text) + '</div>'; }

  const MARK =
    '<svg class="mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">' +
    '<g stroke="currentColor" stroke-width="2.2" stroke-linecap="round">' +
    '<path d="M3 6.5C12 6.5 12.5 16 20 16" opacity=".34"/>' +
    '<path d="M3 16H20" opacity=".62"/>' +
    '<path d="M3 25.5C12 25.5 12.5 16 20 16" opacity=".34"/></g>' +
    '<circle cx="23.4" cy="16" r="4.6" fill="currentColor"/></svg>';

  function wordmark(cls) {
    return '<span class="wordmark">' + MARK.replace('class="mark"', 'class="mark ' + (cls || '') + '"') +
      '<span><span class="wm-name">SOT</span><span class="wm-sub">Source of Truth</span></span></span>';
  }

  SOT.ui = {
    esc, at, date, dateTime, ago, value, statValue, initials, avatar, tag, severityTag, kindTag,
    systemTag, systemLink, ring, stat, statTile, entityLine, entityCard, tabs, empty, wordmark, MARK,
  };
})(window.SOT || (window.SOT = {}));
