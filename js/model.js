/* Millikan Oil Drop Lab: the physics (pure functions, no DOM). Exposes window.Model.
 *
 * A drop of radius r in air reaches its terminal velocity in microseconds, so its velocity is
 * always the one at which drag balances the other forces. Drag follows Stokes' law with the
 * Cunningham slip correction, drops this small being not much larger than the mean free path
 * of the air molecules:  F = 6 π η r v / (1 + b / (p r)).
 *
 * Up is positive throughout. The field between the plates is E = V / d; with s = +1 the top
 * plate is positive (E points down), with s = −1 it is negative, and with s = 0 the plates are
 * shorted. The force on a charge q is then F = −s q V / d.
 */
(function (root) {
  'use strict';

  var C = {
    g: 9.80,                 // m/s²
    rhoOil: 886,             // kg/m³, the mineral oil used with the apparatus
    rhoAir: 1.20,            // kg/m³, at room temperature and one atmosphere
    b: 8.20e-3,              // Pa·m, the constant in the Cunningham slip correction
    p: 1.013e5,              // Pa, barometric pressure
    d: 14.9174e-3,           // m, plate separation: Millikan's 1913 condenser, 14.9174 mm
    T: 295.15,               // K, air temperature between the plates (22.0 °C)
    kB: 1.380649e-23,        // J/K
    e: 1.602176634e-19       // C, the accepted elementary charge, used only for the comparison
  };

  /** Viscosity of air at temperature T (K), Pa·s, by Sutherland's formula: 1.82 × 10⁻⁵ at 22 °C. */
  function viscosity(T) {
    return 1.458e-6 * Math.pow(T, 1.5) / (T + 110.4);
  }

  /** Cunningham slip factor for a drop of radius r (m). */
  function slip(r) {
    return 1 + C.b / (C.p * r);
  }

  /** Mass of a drop less the air it displaces, kg. */
  function mass(r) {
    return 4 / 3 * Math.PI * r * r * r * (C.rhoOil - C.rhoAir);
  }

  /** Drag per unit velocity, N·s/m, so that F = k v. */
  function drag(r) {
    return 6 * Math.PI * viscosity(C.T) * r / slip(r);
  }

  /** Terminal fall speed with the field off, m/s (positive). */
  function fallSpeed(r) {
    return mass(r) * C.g / drag(r);
  }

  /** Terminal velocity (up positive) of a drop of radius r and charge q with polarity s and voltage V. */
  function velocity(r, q, s, V) {
    var up = -s * q * V / C.d;
    return (up - mass(r) * C.g) / drag(r);
  }

  /** Diffusion coefficient, m²/s: Brownian motion is the visible jitter of a small drop. */
  function diffusion(r) {
    return C.kB * C.T / drag(r);
  }

  // ---------- from measurements to a charge ----------

  /**
   * Radius from the measured fall speed vf (m/s). Balancing weight against corrected Stokes drag
   * gives r² + (b/p) r − 9 η vf / (2 g ρ) = 0, whose positive root this is.
   */
  function radiusFromFall(vf) {
    var h = C.b / (2 * C.p), eta = viscosity(C.T), rho = C.rhoOil - C.rhoAir;
    return Math.sqrt(h * h + 9 * eta * vf / (2 * C.g * rho)) - h;
  }

  /**
   * The charge, in coulombs and with its sign, from a fall speed vf (field off, m/s, positive),
   * a velocity vy with the field on (m/s, up positive; negative when the drop still falls),
   * the polarity s (±1) and the voltage V. With drag k = m g / vf, the field-on balance
   * −s q V / d = m g + k vy gives q = −s m g (1 + vy / vf) d / V.
   */
  function charge(vf, vy, s, V) {
    if (!(vf > 0) || !(V > 0) || !s) return NaN;
    var r = radiusFromFall(vf);
    return -s * mass(r) * C.g * (1 + vy / vf) * C.d / V;
  }

  // ---------- finding the unit ----------

  /**
   * How well the magnitudes qs (C) fit integer multiples of a unit e: the multiple assigned to
   * each, and the root-mean-square and largest deviation from the nearest multiple, in units of e.
   */
  function fit(qs, e) {
    var ss = 0, mx = 0, ns = [];
    qs.forEach(function (q) {
      var x = q / e, n = Math.max(1, Math.round(x)), dev = Math.abs(x - n);
      ss += dev * dev;
      if (dev > mx) mx = dev;
      ns.push(n);
    });
    return { e: e, ns: ns, rms: qs.length ? Math.sqrt(ss / qs.length) : NaN, max: mx };
  }

  /**
   * The largest unit that fits the measured charges about as well as any unit does. The RMS
   * deviation from whole multiples is scanned over units from 0.6 to 4 × 10⁻¹⁹ C; a unit qualifies
   * when it is a local minimum within 2.5 times the best RMS found (never tighter than 0.07 of a
   * unit, never looser than 0.2), and the largest qualifying unit wins, refined by least squares
   * once the multiples are assigned. Returns null when nothing qualifies.
   */
  function bestUnit(qs) {
    if (!qs.length) return null;
    var lo = 0.6e-19, hi = 4.0e-19, step = 0.002e-19, grid = [], minRms = Infinity, i;
    for (var e = lo; e <= hi + step / 2; e += step) {
      var g = fit(qs, e);
      grid.push(g);
      if (g.rms < minRms) minRms = g.rms;
    }
    var tol = Math.min(0.2, Math.max(0.07, 2.5 * minRms));
    var found = null;
    for (i = grid.length - 1; i >= 0; i--) {
      var cur = grid[i], left = grid[i - 1], right = grid[i + 1];
      var localMin = (!left || cur.rms <= left.rms) && (!right || cur.rms <= right.rms);
      if (localMin && cur.rms <= tol) { found = cur; break; }
    }
    if (!found) return null;
    // Least squares through the origin with the assigned multiples: e = Σ n q / Σ n².
    var num = 0, den = 0;
    qs.forEach(function (q, i) { num += found.ns[i] * q; den += found.ns[i] * found.ns[i]; });
    var refined = fit(qs, num / den);
    var distinct = {};
    refined.ns.forEach(function (n) { distinct[n] = true; });
    refined.distinct = Object.keys(distinct).length;
    return refined;
  }

  root.Model = {
    C: C,
    viscosity: viscosity, slip: slip, mass: mass, drag: drag,
    fallSpeed: fallSpeed, velocity: velocity, diffusion: diffusion,
    radiusFromFall: radiusFromFall, charge: charge,
    fit: fit, bestUnit: bestUnit
  };
})(window);
