/* Millikan Oil Drop Lab: the drops in the chamber (no DOM). Exposes window.Sim.
 *
 * Positions are in metres: x across the field of view (positive to the right as seen through the
 * scope), y up from the bottom plate, z toward the observer, with the scope focused on z = 0.
 * A squeeze of the bulb sprays drops from the nozzle into the space above the top plate, and the
 * puff of air sweeps them across to the hole in the plate and down through it into the gap, where
 * the stream dies away and each drop settles to its terminal velocity. Each drop has a radius, a
 * charge (n elementary charges, negative for excess electrons) and a position; every step moves it
 * at its terminal velocity plus the Brownian jitter of a particle its size, and, while the ionization
 * source is on, lets a drop in the gap capture an air ion now and then.
 */
(function (root) {
  'use strict';

  var M = root.Model, C = M.C;

  var FOV_RADIUS = 1.5e-3;         // m, radius of the field seen through the scope
  var HOLE_R = 0.4e-3;             // m, radius of the hole in the top plate
  var NOZZLE = { x: -7.5e-3, y: C.d + 3.1e-3, spread: 7e-3 };   // where the atomizer's nozzle delivers the mist
  var PUFF_V = 2.2e-3;             // m/s, the air from the bulb carries the mist down through the hole
  var SWEEP_TAU = 0.5;             // s, how quickly the stream funnels the drops toward the hole (a few miss it)
  var SWEEP_MAX = 14e-3;           // m/s, fastest sideways sweep
  var PUFF_TAU = 1.0;              // s, how quickly the stream dies away below the hole
  var MAX_DROPS = 120;
  var ION_RATE_ON = 0.45;          // captures per second per drop with the source on
  var ION_RATE_OFF = 0;            // with it shielded, a drop's charge never changes
  var CHARGE_WEIGHTS = [           // how many elementary charges a freshly sprayed drop carries
    [1, 3], [2, 4], [3, 4], [4, 3], [5, 2.5], [6, 2], [7, 1.2], [8, 1], [9, 0.6], [10, 0.6], [12, 0.4], [15, 0.3]
  ];

  function gauss() {
    var u = 1 - Math.random(), v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function pickCharge() {
    var total = 0, i;
    for (i = 0; i < CHARGE_WEIGHTS.length; i++) total += CHARGE_WEIGHTS[i][1];
    var x = Math.random() * total;
    for (i = 0; i < CHARGE_WEIGHTS.length; i++) {
      x -= CHARGE_WEIGHTS[i][1];
      if (x <= 0) break;
    }
    var n = CHARGE_WEIGHTS[Math.min(i, CHARGE_WEIGHTS.length - 1)][0];
    return Math.random() < 0.75 ? -n : n;      // friction in the atomizer leaves most drops negative
  }

  function create() {
    var S = {
      time: 0,               // simulated seconds
      drops: [],
      nextId: 1,
      V: 600,                // plate voltage, V
      s: 0,                  // polarity: +1 top plate positive (bottom negative), 0 plates shorted
      source: false,         // ionization source exposed
      focus: 0,              // m, the plane the scope is focused on (z)
      sprayAt: -Infinity,    // time of the last squeeze, for the mist animation
      changes: 0             // charge changes so far (for the readout)
    };

    function newDrop() {
      var r = 0.62e-6 * Math.exp(0.28 * gauss());
      r = Math.min(1.3e-6, Math.max(0.35e-6, r));
      return {
        id: S.nextId++,
        r: r,
        n: pickCharge(),
        x: NOZZLE.x + Math.random() * NOZZLE.spread,
        y: NOZZLE.y + (Math.random() - 0.5) * 1.2e-3,
        z: gauss() * 0.4e-3,
        born: S.time,
        changed: -Infinity,
        above: true,           // still in the space above the top plate
        air: null              // the dying puff of air below the hole: { vx, vy, at }
      };
    }

    /** Squeeze the atomizer bulb: a burst of mist from the nozzle above the top plate. */
    function spray() {
      var count = 14 + Math.floor(Math.random() * 9);
      for (var i = 0; i < count; i++) S.drops.push(newDrop());
      S.sprayAt = S.time;
      trim();
    }

    /** Keep the population bounded: drop the oldest drops that are out of view first. */
    function trim() {
      if (S.drops.length <= MAX_DROPS) return;
      var out = S.drops.filter(function (d) { return !inView(d); });
      while (S.drops.length > MAX_DROPS && out.length) {
        var victim = out.shift();
        S.drops.splice(S.drops.indexOf(victim), 1);
      }
      while (S.drops.length > MAX_DROPS) S.drops.shift();
    }

    function changeCharge(d) {
      var dn = (Math.random() < 0.8 ? 1 : 2) * (Math.random() < 0.5 ? -1 : 1);
      d.n += dn;
      d.changed = S.time;
      S.changes++;
    }

    function inView(d) {
      if (d.above) return false;
      var dy = d.y - C.d / 2;
      return d.x * d.x + dy * dy < FOV_RADIUS * FOV_RADIUS;
    }

    /** True once a drop in the gap has shed the puff of air that carried it through the hole. */
    function settled(d) { return !d.above && !d.air; }

    /** Advance the drops by dt simulated seconds. */
    function step(dt) {
      if (!(dt > 0)) return;
      S.time += dt;
      var rate = S.source ? ION_RATE_ON : ION_RATE_OFF, pChange = 1 - Math.exp(-rate * dt);
      var wind = 3e-6 * Math.sin(S.time / 40);      // a slow convection current, m/s
      for (var i = S.drops.length - 1; i >= 0; i--) {
        var d = S.drops[i];
        var sig = Math.sqrt(2 * M.diffusion(d.r) * dt);
        if (d.above) {
          // Above the top plate the puff of air sweeps the drop toward the hole and down through it.
          var sweep = Math.max(-SWEEP_MAX, Math.min(SWEEP_MAX, -d.x / SWEEP_TAU));
          d.x += sweep * dt + sig * gauss();
          d.y -= (PUFF_V + M.fallSpeed(d.r)) * dt;
          d.z += sig * gauss();
          if (d.y <= C.d) {
            if (Math.abs(d.x) < HOLE_R) {
              d.above = false;    // through the hole: the stream spreads out and dies away in the gap
              // The stream carries it to about the top of the field of view (0.3 mm short to 0.9 mm past), however wide the gap.
              d.air = { vx: gauss() * 1.4e-3, vy: -(C.d / 2 - FOV_RADIUS - 0.3e-3 + Math.random() * 1.2e-3) / PUFF_TAU, at: S.time };
            } else {
              S.drops.splice(i, 1);   // landed on the top plate
            }
          }
          continue;
        }
        if (Math.random() < pChange) changeCharge(d);
        var v = M.velocity(d.r, d.n * C.e, S.s, S.V), ax = 0, ay = 0;
        if (d.air) {
          var left = Math.exp(-(S.time - d.air.at) / PUFF_TAU);
          ax = d.air.vx * left;
          ay = d.air.vy * left;
          if (left < 0.01) d.air = null;
        }
        d.y += (v + ay) * dt + sig * gauss();
        d.x += (wind + ax) * dt + sig * gauss();
        d.z += sig * gauss();
        if (d.y <= 0 || d.y >= C.d || Math.abs(d.x) > 5e-3) S.drops.splice(i, 1);
      }
    }

    function byId(id) {
      for (var i = 0; i < S.drops.length; i++) if (S.drops[i].id === id) return S.drops[i];
      return null;
    }

    function inViewDrops() {
      return S.drops.filter(inView).sort(function (a, b) { return a.x - b.x; });
    }

    /** How many drops are between the plates, and how many are still above the top plate. */
    function counts() {
      var gap = 0, above = 0;
      S.drops.forEach(function (d) { if (d.above) above++; else gap++; });
      return { gap: gap, above: above };
    }

    /** The drop in view nearest a point (m, field coordinates: x across, y up from the centre). */
    function nearest(x, yc, within) {
      var best = null, bestD = within === undefined ? Infinity : within;
      S.drops.forEach(function (d) {
        if (!inView(d)) return;
        var dx = d.x - x, dy = (d.y - C.d / 2) - yc, dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < bestD) { bestD = dist; best = d; }
      });
      return best;
    }

    /** Terminal velocity of a drop now, m/s, up positive. */
    function velocityOf(d) {
      return M.velocity(d.r, d.n * C.e, S.s, S.V);
    }

    function clear() {
      S.drops = [];
    }

    S.spray = spray;
    S.step = step;
    S.byId = byId;
    S.inView = inView;
    S.settled = settled;
    S.inViewDrops = inViewDrops;
    S.counts = counts;
    S.nearest = nearest;
    S.velocityOf = velocityOf;
    S.clear = clear;
    return S;
  }

  root.Sim = { create: create, FOV_RADIUS: FOV_RADIUS, HOLE_R: HOLE_R };
})(window);
