/* Millikan Oil Drop Lab: page chrome common to every analyticalchem page, begun as a trimmed copy of the
 * Op Amp Lab page script. The theme button (auto → light → dark, stored per project), presentation
 * mode (Present button, Alt + Shift + P, ?present=1, Escape, leaving fullscreen), a coalesced layout
 * callback on resize, number formatting and subscripts. Exposes window.Page.
 */
(function (root) {
  'use strict';

  var NB = ' ';      // non-breaking space before units
  var MINUS = '−';   // true minus sign
  var DASH = '—';    // em dash for a value that does not exist

  var opts = {}, themeKey = 'theme';
  var themes = ['auto', 'light', 'dark'];
  var els = {};

  function $(id) { return document.getElementById(id); }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /** Fixed decimals, locale grouping, true minus sign, and no "−0.00". */
  function fmt(v, d) {
    if (!isFinite(v)) return DASH;
    var s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
    if (v < 0 && Number(Math.abs(v).toFixed(d)) !== 0) s = MINUS + s;
    return s;
  }

  /**
   * Set an element's text from a string with simple subscripts, 'CH_3' or 'C_{10}H_{8}', built as
   * text nodes and <sub> elements (never innerHTML).
   */
  function setRich(el, str) {
    str = String(str);
    if (el._rich === str) return;
    el._rich = str;
    // Built off the page and swapped in at once, so a status region changes in one step.
    var frag = document.createDocumentFragment(), re = /_\{([^}]*)\}|_(.)/g, last = 0, m;
    while ((m = re.exec(str))) {
      if (m.index > last) frag.appendChild(document.createTextNode(str.slice(last, m.index)));
      var sub = document.createElement('sub');
      sub.textContent = m[1] !== undefined ? m[1] : m[2];
      frag.appendChild(sub);
      last = re.lastIndex;
    }
    if (last < str.length) frag.appendChild(document.createTextNode(str.slice(last)));
    el.textContent = '';
    el.appendChild(frag);
  }

  /** The same string with the subscripts written inline, for labels and titles. */
  function plainText(str) {
    return String(str).replace(/_\{([^}]*)\}|_(.)/g, function (a, g1, g2) { return g1 !== undefined ? g1 : g2; });
  }

  function prefersReducedMotion() {
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function param(name) {
    try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; }
  }

  // --- theme -----------------------------------------------------------------

  function refresh() { if (opts.refresh) opts.refresh(); }
  function layout() { if (opts.layout) opts.layout(); }

  function applyTheme(name) {
    if (name === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = name;
    els.theme.textContent = 'Theme: ' + name;
    try { localStorage.setItem(themeKey, name); } catch (e) { /* storage unavailable */ }
    refresh();
  }

  // --- presentation mode -------------------------------------------------------

  function isPresent() { return document.documentElement.hasAttribute('data-present'); }

  function setPresent(on) {
    document.documentElement.toggleAttribute('data-present', on);
    els.present.setAttribute('aria-pressed', String(on));
    els.presentStatus.textContent = on ? 'Presentation mode on. Press Escape to exit.' : 'Presentation mode off.';
    refresh();    // drawing code re-reads the --chart-* tokens and the presentation palette
    layout();     // visuals re-measure their new heights
    if (on && document.fullscreenEnabled && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(function () { /* refused: the mode still applies */ });
    } else if (!on && document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () { /* already left */ });
    }
  }

  // --- layout ------------------------------------------------------------------

  var layoutQueued = false;
  function queueLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(function () {
      layoutQueued = false;
      layout();
    });
  }

  /**
   * o = { themeKey, refresh(), layout(), escape() → true if it used the key }
   */
  function init(o) {
    opts = o || {};
    themeKey = opts.themeKey || 'theme';
    els.theme = $('theme');
    els.present = $('present');
    els.presentStatus = $('present-status');

    // The saved theme was applied by the inline script in <head>; show it on the button.
    els.theme.textContent = 'Theme: ' + (document.documentElement.dataset.theme || 'auto');
    els.theme.addEventListener('click', function () {
      var cur = document.documentElement.dataset.theme || 'auto';
      applyTheme(themes[(themes.indexOf(cur) + 1) % themes.length]);
    });

    els.present.addEventListener('click', function () { setPresent(!isPresent()); });

    document.addEventListener('keydown', function (e) {
      if (e.altKey && e.shiftKey && e.code === 'KeyP') {
        e.preventDefault();
        setPresent(!isPresent());
        return;
      }
      if (e.key === 'Escape') {
        // An open tooltip takes the first Escape; the next one leaves presentation mode.
        if (opts.escape && opts.escape()) return;
        if (isPresent()) setPresent(false);
      }
    });

    document.addEventListener('fullscreenchange', function () {
      if (!document.fullscreenElement && isPresent()) setPresent(false);
    });

    if (root.matchMedia) {
      var dark = root.matchMedia('(prefers-color-scheme: dark)');
      if (dark.addEventListener) dark.addEventListener('change', refresh);
    }

    var main = document.querySelector('main');
    if ('ResizeObserver' in root && main) new ResizeObserver(queueLayout).observe(main);
    else root.addEventListener('resize', queueLayout);
  }

  /** Call once the page has drawn, so ?present=1 opens ready to present. */
  function start() {
    if (param('present') === '1') setPresent(true);
  }

  root.Page = {
    NB: NB, MINUS: MINUS, DASH: DASH,
    init: init, start: start,
    cssVar: cssVar, fmt: fmt, setRich: setRich, plainText: plainText,
    param: param, prefersReducedMotion: prefersReducedMotion,
    isPresent: isPresent, setPresent: setPresent, queueLayout: queueLayout
  };
})(window);
