/* Millikan Oil Drop Lab: the view through the eyepiece, on a canvas. A dark field, a reticle with long
 * lines every 0.5 mm and ticks every 0.1 mm, and the drops as the points of light they scatter from
 * the lamp, sharp in the focal plane and blurred away from it. Exposes window.Eyepiece.
 */
(function (root) {
  'use strict';

  var C = root.Model.C, FOV = root.Sim.FOV_RADIUS;
  var LINE = 0.5e-3, TICK = 0.1e-3;

  var canvas, ctx, W = 0, H = 0, dpr = 1, tok = {}, geo = { cx: 0, cy: 0, R: 0, k: 0 };

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function rgba(hex, a) {
    var m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return hex;
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a.toFixed(3) + ')';
  }

  function init(el) {
    canvas = el;
    ctx = canvas.getContext('2d');
    refresh();
  }

  /** Re-read the tokens after a theme or presentation change. */
  function refresh() {
    tok = {
      field: cssVar('--eye-field'), rim: cssVar('--eye-rim'), reticle: cssVar('--eye-reticle'),
      text: cssVar('--eye-text'), drop: cssVar('--eye-drop'), track: cssVar('--track'), spark: cssVar('--eye-spark'),
      surface: cssVar('--surface'), muted: cssVar('--text-muted'),
      font: parseFloat(cssVar('--chart-font')) || 12,
      fontSmall: parseFloat(cssVar('--chart-font-small')) || 11,
      line: parseFloat(cssVar('--chart-line')) || 2,
      family: cssVar('--font') || 'system-ui, sans-serif'
    };
  }

  /** Size the backing store to the canvas's CSS box; true when it has a size. */
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
    geo.cx = W / 2;
    geo.cy = H / 2;
    geo.R = 0.46 * Math.min(W, H);
    geo.k = geo.R / FOV;          // px per metre
    return true;
  }

  function line(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function draw(sim, trackedId) {
    if (!W && !layout()) return;
    var cx = geo.cx, cy = geo.cy, R = geo.R, k = geo.k, mm = k * 1e-3, i, y, x, half;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);       // transparent outside the rim, so the view can fly in from the lens

    // The eyepiece rim, then the dark field.
    ctx.beginPath();
    ctx.arc(cx, cy, R + 14, 0, 2 * Math.PI);
    ctx.fillStyle = tok.rim;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = tok.muted;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, 2 * Math.PI);
    ctx.fillStyle = tok.field;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, 2 * Math.PI);
    ctx.clip();

    // Reticle: 0.1 mm ticks along both centre lines, 0.5 mm lines across the field.
    ctx.strokeStyle = tok.reticle;
    ctx.lineWidth = 1;
    for (i = -14; i <= 14; i++) {
      if (i % 5 === 0) continue;
      y = cy - i * TICK * k;
      line(cx - 0.16 * mm, y, cx + 0.16 * mm, y);
      x = cx + i * TICK * k;
      line(x, cy - 0.16 * mm, x, cy + 0.16 * mm);
    }
    ctx.lineWidth = 1.5;
    for (i = -2; i <= 2; i++) {
      y = cy - i * LINE * k;
      half = Math.sqrt(Math.max(0, R * R - (y - cy) * (y - cy)));
      line(cx - half, y, cx + half, y);
    }
    line(cx, cy - R, cx, cy + R);
    ctx.font = tok.fontSmall + 'px ' + tok.family;
    ctx.fillStyle = tok.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    for (i = -2; i <= 2; i++) {
      y = cy - i * LINE * k;
      half = Math.sqrt(Math.max(0, R * R - (y - cy) * (y - cy)));
      var label = i === 0 ? '0' : (i > 0 ? '+' : '−') + (Math.abs(i) * 0.5).toFixed(1);
      if (i === 2) label += ' mm';
      ctx.fillText(label, cx - half + 8, y - 3);
    }

    // Drops: a glow whose size grows and whose brightness fades with distance from the focal plane.
    var drops = sim.drops;
    for (i = 0; i < drops.length; i++) {
      var d = drops[i];
      if (!sim.inView(d)) continue;
      var px = cx + d.x * k, py = cy - (d.y - C.d / 2) * k;
      var blur = Math.abs(d.z - sim.focus) / 1e-3 * 9;         // px per mm of defocus
      var core = 1.8 + d.r / 1e-6 * 1.5;
      var a = 1 / (1 + blur * blur / 9);
      var rad = core + blur + 2;
      var g = ctx.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, rgba(tok.drop, a));
      g.addColorStop(Math.min(0.9, core / rad), rgba(tok.drop, a * 0.6));
      g.addColorStop(1, rgba(tok.drop, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, 2 * Math.PI);
      ctx.fill();
      // A ring spreads and fades from a drop that has just captured an ion.
      var age = sim.time - d.changed;
      if (age >= 0 && age < 0.9) {
        var f = age / 0.9;
        ctx.beginPath();
        ctx.arc(px, py, 7 + 18 * f, 0, 2 * Math.PI);
        ctx.lineWidth = tok.line;
        ctx.strokeStyle = rgba(tok.spark, 1 - f);
        ctx.stroke();
      }
      if (d.id === trackedId) {
        ctx.beginPath();
        ctx.arc(px, py, 12, 0, 2 * Math.PI);
        ctx.lineWidth = tok.line * 2;
        ctx.strokeStyle = tok.track;
        ctx.stroke();
        ctx.font = tok.font + 'px ' + tok.family;
        ctx.fillStyle = tok.text;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('tracked', px + 17, py);
      }
    }
    ctx.restore();
  }

  /** A pointer position to field coordinates (m: x across, y up from the centre), or null outside the field. */
  function pointToField(clientX, clientY) {
    var r = canvas.getBoundingClientRect();
    var px = clientX - r.left, py = clientY - r.top;
    var dx = px - geo.cx, dy = py - geo.cy;
    if (dx * dx + dy * dy > geo.R * geo.R) return null;
    return { x: dx / geo.k, y: -dy / geo.k };
  }

  root.Eyepiece = { init: init, refresh: refresh, layout: layout, draw: draw, pointToField: pointToField };
})(window);
