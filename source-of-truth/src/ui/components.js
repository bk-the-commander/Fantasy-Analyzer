/* Source of Truth — presentation primitives.
 *
 * Plain functions that return HTML strings. No framework: the dataset is small
 * enough that re-rendering a whole view on every state change is imperceptible,
 * and it keeps the prototype dependency-free and inspectable. If this grows
 * into the real product these become React components with the same signatures.
 */
(function (SOT) {
  'use strict';

  const esc = (s) =>
    String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const attr = (s) => esc(s);

  /* ------------------------------------------------------------ formatting */

  function money(n, opts) {
    if (n === null || n === undefined) return '—';
    const abs = Math.abs(n);
    const sign = n < 0 ? '−' : (opts && opts.signed && n > 0 ? '+' : '');
    if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(abs >= 1e7 ? 1 : 2) + 'M';
    if (abs >= 1e3) return sign + '$' + Math.round(abs / 1e3) + 'k';
    return sign + '$' + Math.round(abs);
  }

  function date(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function ago(ts, now) {
    if (!ts) return 'never';
    const d = (now || Date.now()) - ts;
    const min = Math.round(d / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + ' min ago';
    const h = Math.round(min / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    const days = Math.round(h / 24);
    if (days < 30) return days + (days === 1 ? ' day ago' : ' days ago');
    return date(ts);
  }

  /** Values live in the model as raw types; this is the only place they get prose. */
  function fieldValue(key, value, resolution) {
    if (value === null || value === undefined || value === '') return '—';
    if (key === 'managerId') {
      const p = resolution && resolution.profiles[value];
      return p ? (p.get('fullName') || p.person.displayName) : String(value);
    }
    if (key === 'quota') return '$' + Number(value).toLocaleString('en-US');
    if (key === 'startDate') return date(value);
    return String(value);
  }

  /* ---------------------------------------------------------------- avatar */

  const AVATAR_HUES = [212, 258, 340, 12, 158, 40, 288, 190];
  function avatar(name, cls) {
    const initials = String(name || '?')
      .split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    let h = 0;
    for (let i = 0; i < String(name).length; i++) h = (h * 31 + String(name).charCodeAt(i)) >>> 0;
    const hue = AVATAR_HUES[h % AVATAR_HUES.length];
    return (
      '<span class="avatar ' + (cls || '') + '" aria-hidden="true" style="background:hsl(' + hue + ' 42% 44%)">' +
      esc(initials) + '</span>'
    );
  }

  /* ---------------------------------------------------------------- badges */

  const SEVERITY_CLASS = { critical: 'bad', high: 'bad', medium: 'warn', low: 'info' };
  const KIND_CLASS = { divergence: 'bad', gap: 'warn', lag: 'info', identity: 'accent' };

  function badge(text, cls, dot) {
    return '<span class="badge ' + (cls || '') + '">' + (dot ? '<i class="dot"></i>' : '') + esc(text) + '</span>';
  }

  function severityBadge(sev) {
    return badge(sev, SEVERITY_CLASS[sev] || '', true);
  }

  function kindBadge(kind) {
    const label = { divergence: 'Divergence', gap: 'Gap', lag: 'Lag', identity: 'Identity' }[kind] || kind;
    return badge(label, KIND_CLASS[kind] || '');
  }

  function systemTag(systemId, opts) {
    const s = SOT.model.SYSTEM_BY_ID[systemId];
    if (!s) return '';
    return (
      '<span class="systag"><i class="sysdot" style="background:' + s.color + '"></i>' +
      esc(opts && opts.short ? s.name.split(' ')[0] : s.name) + '</span>'
    );
  }

  function systemLink(systemId, nativeId) {
    const s = SOT.model.SYSTEM_BY_ID[systemId];
    if (!s) return '';
    const href = s.deepLink.replace('{id}', encodeURIComponent(nativeId));
    return (
      '<a class="btn sm" href="' + attr(href) + '" target="_blank" rel="noopener noreferrer">Open ' +
      esc(s.name) + ' ↗</a>'
    );
  }

  /* ------------------------------------------------------------------ misc */

  function ring(pct, size) {
    const s = size || 62;
    const r = s / 2 - 5;
    const c = 2 * Math.PI * r;
    const on = (Math.max(0, Math.min(100, pct)) / 100) * c;
    const colour = pct >= 90 ? 'var(--ok)' : pct >= 70 ? 'var(--warn)' : 'var(--bad)';
    return (
      '<div class="ring" style="width:' + s + 'px;height:' + s + 'px">' +
      '<svg width="' + s + '" height="' + s + '" viewBox="0 0 ' + s + ' ' + s + '">' +
      '<circle cx="' + s / 2 + '" cy="' + s / 2 + '" r="' + r + '" fill="none" stroke="var(--surface-3)" stroke-width="6"/>' +
      '<circle cx="' + s / 2 + '" cy="' + s / 2 + '" r="' + r + '" fill="none" stroke="' + colour +
      '" stroke-width="6" stroke-linecap="round" stroke-dasharray="' + on.toFixed(1) + ' ' + c.toFixed(1) + '"/>' +
      '</svg><span class="val" style="color:' + colour + '">' + Math.round(pct) + '</span></div>'
    );
  }

  function stat(k, v, d, cls) {
    return (
      '<div class="card stat ' + (cls || '') + '"><div class="k">' + esc(k) + '</div>' +
      '<div class="v">' + (typeof v === 'string' ? v : esc(String(v))) + '</div>' +
      (d ? '<div class="d">' + d + '</div>' : '') + '</div>'
    );
  }

  function personLine(profile, opts) {
    const sub = (opts && opts.sub) || [profile.get('jobTitle'), profile.get('team')].filter(Boolean).join(' · ');
    return (
      '<span class="person-line">' + avatar(profile.get('fullName') || profile.person.displayName, 'sm') +
      '<span style="min-width:0"><span class="pl-name">' + esc(profile.get('fullName') || profile.person.displayName) +
      '</span><br><span class="pl-sub">' + esc(sub) + '</span></span></span>'
    );
  }

  function personCard(profile, resolution) {
    const p = profile.person;
    const name = profile.get('fullName') || p.displayName;
    const open = profile.conflicts.filter((c) => c.actionable).length;
    const mgrId = profile.get('managerId');
    const mgr = mgrId && resolution.profiles[mgrId];
    const terminated = profile.get('employmentStatus') !== 'Active';
    return (
      '<button class="pcard" data-goto="#/person/' + attr(p.id) + '">' +
      '<span class="top">' + avatar(name) +
      '<span style="min-width:0"><span class="nm">' + esc(name) + '</span><br>' +
      '<span class="ti">' + esc(profile.get('jobTitle') || '—') + '</span></span></span>' +
      '<span class="meta">' +
      (terminated ? badge('Terminated', 'bad') : '') +
      (profile.get('territory') ? badge(profile.get('territory'), 'plain') : '') +
      '<span class="m">' + (mgr ? 'Reports to ' + esc(mgr.get('fullName') || mgr.person.displayName) : 'No manager') + '</span>' +
      '<span style="margin-left:auto">' +
      (open ? badge(open + (open === 1 ? ' issue' : ' issues'), 'bad') : badge(profile.alignment + '% aligned', 'ok')) +
      '</span></span></button>'
    );
  }

  function empty(title, sub) {
    return '<div class="empty"><div class="big">✓</div><div style="font-weight:600;color:var(--text-2)">' + esc(title) + '</div>' +
      (sub ? '<div style="margin-top:5px">' + esc(sub) + '</div>' : '') + '</div>';
  }

  function tabs(items, current, action) {
    return (
      '<div class="tabs">' +
      items.map((t) =>
        '<button class="' + (t.id === current ? 'on' : '') + '" data-action="' + attr(action) + '" data-tab="' + attr(t.id) + '">' +
        esc(t.label) + (t.count !== undefined ? ' <span style="opacity:.6">' + t.count + '</span>' : '') + '</button>'
      ).join('') + '</div>'
    );
  }

  SOT.ui = Object.assign(SOT.ui || {}, {
    esc, attr, money, date, ago, fieldValue, avatar, badge, severityBadge, kindBadge,
    systemTag, systemLink, ring, stat, personLine, personCard, empty, tabs,
    SEVERITY_CLASS, KIND_CLASS,
  });
})(window.SOT || (window.SOT = {}));
