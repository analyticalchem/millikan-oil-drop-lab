/* Millikan Oil Drop Lab: how the page is arranged. Shows the apparatus page or the results page
   (#instrument, #results, so Back and Forward work), switches the one-screen arrangement on when the window
   is large enough, decides whether the Key sits beside the view, runs the Settings drop-down and the results
   tabs (WAI-ARIA tabs pattern, automatic activation), and lays the chart out again when its space changes.
   Both pages are one document: the simulation, the recording and the analysis keep running whichever page
   is shown (style guide 4.1, 7.18 to 7.20). Loaded after main.js, which has built the page by then. */
(function (root) {
  'use strict';

  var html = document.documentElement;
  function $(id) { return document.getElementById(id); }

  // --- one screen ---

  function presenting() { return html.hasAttribute('data-present'); }
  // One screen needs the window to be large enough, and the view to come out at least MIN_W by MIN_H px,
  // below which its labels and the magnified inset would crowd. If a window passes the first test but
  // fails the second (larger text settings, say), the page stacks and stays stacked until the window grows.
  var MIN_W = 520, MIN_H = 240, tooSmall = null;
  function fits() {
    var w = root.innerWidth, h = root.innerHeight, p = presenting();
    if (tooSmall && tooSmall.p === p && w <= tooSmall.w && h <= tooSmall.h) return false;
    return p ? w >= 1280 && h >= 720 : w >= 1100 && h >= 680;
  }
  function oneScreen() { return html.classList.contains('one-screen'); }

  // The 3D view fills its box whatever shape the box has (the camera reframes the model), so the only
  // choice is where the Key goes: beside the view when the card is much wider than it is tall, which
  // gives the view more height, under it otherwise.
  var fitBox = document.querySelector('.drawing-fit'), card = document.querySelector('.instrument-card');
  var key = document.querySelector('.drawing-key'), keyBelow = 0;
  function fitDrawing() {
    if (!oneScreen() || !fitBox.clientWidth) { card.classList.remove('key-beside'); return; }
    var beside = card.classList.contains('key-beside');
    if (!beside) keyBelow = key.offsetHeight + 6;
    var keyW = 15 * parseFloat(getComputedStyle(html).fontSize) + 16;
    var W = fitBox.clientWidth + (beside ? keyW : 0), H = fitBox.clientHeight + (beside ? 0 : keyBelow);
    var want = W >= 1180 && W / Math.max(1, H - keyBelow) > 2.1;
    if (want !== beside) card.classList.toggle('key-beside', want);
    if (fitBox.clientWidth < MIN_W || fitBox.clientHeight < MIN_H) queueCheck();
  }

  // A view too small for its labels is measured again after a pause, twice, a second apart, each time in
  // a drawn frame; only if it is too small both times does the page stack. A reading taken while the page
  // is still settling (as it loads, or mid-resize) never decides it.
  var checkTimer = 0, smallCount = 0;
  function queueCheck() {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(function () { requestAnimationFrame(checkSize); }, smallCount ? 1000 : 500);
  }
  function checkSize() {
    if (!oneScreen() || !fitBox.clientWidth || (fitBox.clientWidth >= MIN_W && fitBox.clientHeight >= MIN_H)) { smallCount = 0; return; }
    if (++smallCount < 2) { queueCheck(); return; }
    smallCount = 0;
    tooSmall = { p: presenting(), w: root.innerWidth, h: root.innerHeight };
    html.classList.remove('one-screen');
    card.classList.remove('key-beside');
    root.Page.queueLayout();
  }

  html.classList.toggle('one-screen', fits());
  function update() {
    var on = fits();
    if (on !== oneScreen()) html.classList.toggle('one-screen', on);
    fitDrawing();
    root.Page.queueLayout();
  }
  root.addEventListener('resize', update);
  new MutationObserver(update).observe(html, { attributes: true, attributeFilter: ['data-present'] });

  // --- the Settings drop-down ---

  var settings = $('settings');
  // Escape closes it first (before presentation mode) and focus goes back to its button, except when that Escape
  // is abandoning an edit in a typing box: the box inside it (the plate voltage) keeps its Escape, and the
  // next one closes the panel. A click or tap anywhere outside it closes it, as a drop-down does.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !settings.open) return;
    var box = e.target.classList && e.target.classList.contains('num');
    if (box && (!settings.contains(e.target) || e.target._editing)) return;
    e.stopPropagation();
    e.preventDefault();
    settings.open = false;
    settings.querySelector('summary').focus();
  }, true);
  document.addEventListener('pointerdown', function (e) {
    if (settings.open && !settings.contains(e.target)) settings.open = false;
  });

  // --- tabs ---

  var tabs = [].slice.call(document.querySelectorAll('[role="tab"]'));
  function selectedTab() { return document.querySelector('[role="tab"][aria-selected="true"]'); }

  function chartLayout() { root.Chart.layout(); root.Chart.draw(); }

  function select(tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (focus) tab.focus();
    // The chart has no size while its tab is hidden, so it is laid out when the tab opens.
    if (tab.id === 'tab-ana') chartLayout();
    root.Page.queueLayout();
  }

  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { select(t, false); });
    t.addEventListener('keydown', function (e) {
      var j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = tabs.length - 1;
      if (j === null) return;
      e.preventDefault();
      select(tabs[j], true);
    });
  });

  // --- the two pages ---

  var pages = { instrument: $('page-instrument'), results: $('page-results') };
  var navs = { instrument: $('nav-instrument'), results: $('nav-results') };
  var baseTitle = document.title, current = null;

  function pageFromHash() { return location.hash === '#results' ? 'results' : 'instrument'; }

  /** Show one page. Focus goes to the start of the page that opens (the open tab on the results page, the
      first toolbar control on the apparatus page), so keyboard and screen-reader users land where it begins. */
  function show(name, focus) {
    if (name === current) return;
    current = name;
    Object.keys(pages).forEach(function (k) {
      pages[k].hidden = k !== name;
      if (k === name) navs[k].setAttribute('aria-current', 'page');
      else navs[k].removeAttribute('aria-current');
    });
    document.title = name === 'results' ? 'Results · ' + baseTitle : baseTitle;
    root.scrollTo(0, 0);
    if (name === 'results') {
      if (selectedTab().id === 'tab-ana') chartLayout();
      if (focus) selectedTab().focus();
    } else if (focus) {
      $('field-on').focus();
    }
    fitDrawing();
    root.Page.queueLayout();
  }

  // The links change the address; the page follows it, so Back and Forward move between the pages too.
  root.addEventListener('hashchange', function () { show(pageFromHash(), true); });
  show(pageFromHash(), false);

  // The page re-measures when <main> changes size; the chart's own box changes size too (a page or a tab
  // opens, a table opens under it), so watch it as well.
  if ('ResizeObserver' in root) {
    var ro = new ResizeObserver(update);
    ro.observe(html);
    document.querySelectorAll('.chart-visual, .drawing-fit').forEach(function (el) { ro.observe(el); });
  }

  root.Layout = { oneScreen: oneScreen, show: show, select: select };
})(window);
