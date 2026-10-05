/* Millikan Oil Drop Lab: the charge dot plot. Every measured charge is a dot on a line from zero
 * with a bar for the scatter Brownian motion is expected to give it, dashed lines mark the multiples
 * of the trial unit, and (for the instructor check) hollow rings mark the true charges. One series,
 * so the legend is in the HTML. Exposes window.Chart.
 */
(function (root) {
  'use strict';

  var canvas, ctx, tip, W = 0, H = 0, dpr = 1, tok = {};
  var data = { points: [], e: 1e-19, truth: false }, dots = [], hover = -1;
  var MARGIN = { left: 24, right: 24, top: 30, bottom: 44 };

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function init(c, t) {
    canvas = c;
    tip = t;
    ctx = canvas.getContext('2d');
    refresh();
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', function () { setHover(-1); });
  }

  function refresh() {
    tok = {
      surface: cssVar('--surface'), text: cssVar('--text-primary'), text2: cssVar('--text-secondary'),
      muted: cssVar('--text-muted'), grid: cssVar('--grid'), axis: cssVar('--axis'),
      dot: cssVar('--series-c'), truth: cssVar('--series-b'),
      font: parseFloat(cssVar('--chart-font')) || 12, fontSmall: parseFloat(cssVar('--chart-font-small')) || 11,
      line: parseFloat(cssVar('--chart-line')) || 2, marker: parseFloat(cssVar('--chart-marker')) || 5,
      halo: parseFloat(cssVar('--chart-halo')) || 4, family: cssVar('--font') || 'system-ui, sans-serif'
    };
  }

  function layout() {
    if (!canvas) return false;
    var r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    dpr = root.devicePixelRatio || 1;
    var w = Math.round(r.width), h = Math.round(r.height);
    if (w !== W || h !== H || canvas.width !== Math.round(w * dpr)) {
      W = w; H = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    return true;
  }

  /** points: [{ label, q (C), sd (C, expected scatter, or NaN), n (multiple at the trial unit), trueQ (C) or null }]; e: the trial unit. */
  function set(points, e, truth) {
    data = { points: points, e: e, truth: !!truth };
    draw();
  }

  function niceStep(span, target) {
    var raw = span / target, mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
    return (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * mag;
  }

  function draw() {
    if (!W && !layout()) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = tok.surface;
    ctx.fillRect(0, 0, W, H);
    var left = MARGIN.left, right = W - MARGIN.right, base = H - MARGIN.bottom, top = MARGIN.top;
    var pts = data.points, i;
    var maxQ = 0;
    for (i = 0; i < pts.length; i++) {
      maxQ = Math.max(maxQ, pts[i].q + (pts[i].sd > 0 ? pts[i].sd : 0), data.truth && pts[i].trueQ ? pts[i].trueQ : 0);
    }
    var xmax = Math.max(4, Math.ceil(maxQ / 1e-19 * 1.15));
    function X(q) { return left + (q / 1e-19) / xmax * (right - left); }

    // Axis and ticks.
    ctx.strokeStyle = tok.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, base);
    ctx.lineTo(right, base);
    ctx.stroke();
    ctx.font = tok.fontSmall + 'px ' + tok.family;
    ctx.fillStyle = tok.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var step = niceStep(xmax, Math.max(3, Math.floor((right - left) / 70)));
    for (var v = 0; v <= xmax + 1e-9; v += step) {
      var x = X(v * 1e-19);
      ctx.strokeStyle = tok.grid;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, base);
      ctx.stroke();
      ctx.strokeStyle = tok.axis;
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.lineTo(x, base + 5);
      ctx.stroke();
      ctx.fillText(String(Math.round(v * 100) / 100), x, base + 8);
    }
    ctx.font = tok.font + 'px ' + tok.family;
    ctx.fillStyle = tok.text2;
    ctx.fillText('Charge |q| (10⁻¹⁹ C)', (left + right) / 2, base + 8 + tok.fontSmall + 6);

    // Multiples of the trial unit.
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = tok.dot;
    ctx.lineWidth = tok.line;
    ctx.fillStyle = tok.text;
    ctx.textBaseline = 'bottom';
    ctx.font = '600 ' + tok.fontSmall + 'px ' + tok.family;
    for (var n = 1; n * data.e / 1e-19 <= xmax; n++) {
      var xn = X(n * data.e);
      ctx.beginPath();
      ctx.moveTo(xn, top + 4);
      ctx.lineTo(xn, base);
      ctx.stroke();
      ctx.fillText(String(n), xn, top + 2);
    }
    ctx.setLineDash([]);

    // Dots, stacked when they would overlap; true charges as hollow rings beneath them.
    var m = tok.marker, pitch = 2 * m + 3;
    var sorted = pts.map(function (p, idx) { return { p: p, idx: idx }; }).sort(function (a, b) { return a.p.q - b.p.q; });
    dots = [];
    var placed = [];
    for (i = 0; i < sorted.length; i++) {
      var p = sorted[i].p, px = X(p.q), level = 0;
      for (var j = placed.length - 1; j >= 0; j--) {
        if (Math.abs(placed[j].x - px) < 2 * m + 1) { level = Math.max(level, placed[j].level + 1); }
      }
      var py = base - m - 6 - level * pitch;
      placed.push({ x: px, level: level });
      dots.push({ x: px, y: py, p: p, idx: sorted[i].idx });
    }
    if (data.truth) {
      ctx.strokeStyle = tok.truth;
      ctx.lineWidth = tok.line;
      for (i = 0; i < dots.length; i++) {
        if (!dots[i].p.trueQ) continue;
        ctx.beginPath();
        ctx.arc(X(dots[i].p.trueQ), dots[i].y, m + 3, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
    // The expected Brownian scatter, one standard deviation each way, as a capped bar under the dot.
    ctx.strokeStyle = tok.dot;
    ctx.lineWidth = tok.line;
    for (i = 0; i < dots.length; i++) {
      var sd = dots[i].p.sd;
      if (!(sd > 0)) continue;
      var x0 = Math.max(left, X(dots[i].p.q - sd)), x1 = Math.min(right, X(dots[i].p.q + sd)), y = dots[i].y, cap = Math.max(3, m - 1);
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.moveTo(x0, y - cap);
      ctx.lineTo(x0, y + cap);
      ctx.moveTo(x1, y - cap);
      ctx.lineTo(x1, y + cap);
      ctx.stroke();
    }
    for (i = 0; i < dots.length; i++) {
      ctx.beginPath();
      ctx.arc(dots[i].x, dots[i].y, m, 0, 2 * Math.PI);
      ctx.fillStyle = tok.dot;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = i === hover ? tok.text : tok.surface;
      ctx.stroke();
    }
  }

  function setHover(idx) {
    if (idx === hover) return;
    hover = idx;
    draw();
    if (idx < 0) { tip.hidden = true; return; }
    var d = dots[idx], p = d.p;
    tip.textContent = '';
    var lines = [p.label, '|q| = ' + (p.q / 1e-19).toFixed(2) + ' × 10⁻¹⁹ C'];
    if (p.sd > 0) lines.push('± ' + (p.sd / 1e-19).toFixed(2) + ' × 10⁻¹⁹ C expected from Brownian motion');
    lines.push('Nearest multiple: ' + p.n + ' × trial unit');
    if (data.truth && p.trueQ) lines.push('True charge: ' + (p.trueQ / 1e-19).toFixed(2) + ' × 10⁻¹⁹ C');
    lines.forEach(function (t, k) {
      var div = document.createElement('div');
      div.textContent = t;
      if (k === 0) div.style.fontWeight = '600';
      tip.appendChild(div);
    });
    tip.hidden = false;
    var r = tip.getBoundingClientRect();
    var x = d.x + 14, y = d.y - r.height - 8;
    if (x + r.width > W) x = d.x - r.width - 14;
    if (y < 0) y = d.y + 14;
    tip.style.left = Math.max(0, x) + 'px';
    tip.style.top = y + 'px';
  }

  function onMove(e) {
    var r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, best = -1, bestD = 14;
    for (var i = 0; i < dots.length; i++) {
      var dd = Math.hypot(dots[i].x - x, dots[i].y - y);
      if (dd < bestD) { bestD = dd; best = i; }
    }
    setHover(best);
  }

  /** Close the tooltip; true when there was one to close. */
  function closeTip() {
    if (hover < 0) return false;
    setHover(-1);
    return true;
  }

  root.Chart = { init: init, refresh: refresh, layout: layout, set: set, draw: draw, closeTip: closeTip };
})(window);
