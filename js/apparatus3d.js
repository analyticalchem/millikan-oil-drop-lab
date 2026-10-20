/* Millikan Oil Drop Lab: the cutaway view, a three.js model of Millikan's oil drop apparatus (after the
 * original at Caltech) with a quarter of the chamber cut away, shown in the <three-d-stage> viewer.
 *
 * The chamber is modelled at about true size: a cast-iron cylinder on a flanged base, a bolted lid with
 * a ribbed cone and a neck on top, flanged window ports at the level of the plates, an air cock, the
 * leads to the plates, the atomizer on its pillar, the viewing scope on its stand, the arc lamp and a
 * plate voltage supply. Inside, the two brass plates and the glass spacer are set the model's plate gap
 * apart (14.92 mm, from the physics constants). Drops are far too small to see at that scale, so a magnified view of the gap is drawn in the top
 * right corner from a second camera, and the drops there are hundreds of times life size.
 *
 * The parts that the 2D drawing let you work with the pointer work the same way here: the bulb sprays,
 * the knife switch turns the field on and off, Raise and Lower change the voltage (hold to repeat),
 * the lever on the α source exposes or shields it, the eyepiece looks in, and a click near a drop in
 * either view tracks it. Exposes window.Apparatus with the interface main.js used for the drawing.
 */
(function (root) {
  'use strict';

  var C = root.Model.C;
  var HOLE_R = root.Sim.HOLE_R, FOV_R = root.Sim.FOV_RADIUS;
  var DEG = Math.PI / 180, TAU = Math.PI * 2;

  // Metres, y up from the bench. φ is measured round the chamber's axis from +z (toward the first view) toward +x.
  var Y_FLOOR = 0.045, RP = 0.105, PT = 0.006;
  var Y_BPB = 0.060, Y_BPT = Y_BPB + PT, Y_TPB = Y_BPT + C.d, Y_TPT = Y_TPB + PT, YC = (Y_BPT + Y_TPB) / 2;
  var S0 = 1e-3;                                   // the last mm above the top plate is stretched to carry a drop through the hole
  var CUT_A = 15 * DEG, CUT_B = 105 * DEG;          // the wedge that is cut away
  var KEEP0 = CUT_B, KEEP_LEN = TAU - (CUT_B - CUT_A);
  var PHI = { scope: -45 * DEG, src: -2 * DEG, lamp: 122 * DEG, leadTop: 140 * DEG, leadBot: 153 * DEG, valve: -118 * DEG, atom: -80 * DEG, inset: 60 * DEG };
  // The simulation's axes: z toward the observer along the scope, x to the observer's right.
  var EZ = { x: Math.sin(PHI.scope), z: Math.cos(PHI.scope) };
  var EX = { x: EZ.z, z: -EZ.x };
  var SUP = { x: 0.312, z: -0.352, rot: 46 * DEG };  // the supply on the bench, no nearer the viewer than the chamber
  var V_MAX = 1200;                                  // V, full scale of the supply
  var MIST_N = 24, MIST_T = 1.6, SPARK_T = 0.9, STREAK_N = 26;
  var L_FULL = 1, L_CUT = 2;                        // layers: the intact chamber, and the cut one
  var DROP_R = 0.22e-3, RING_PX = 9;

  // Each view names what must stay in frame: fitW and fitH are the half-width and half-height (m, at the
  // target) the camera backs off far enough to show, so the model fills a view of any shape.
  var VIEWS = {
    all: { phi: 46 * DEG, elev: 21 * DEG, fitW: 0.53, fitH: 0.27, target: [0.09, 0.15, -0.06], fov: 36 },
    chamber: { phi: 58 * DEG, elev: 27 * DEG, fitW: 0.364, fitH: 0.20, target: [0.0, 0.14, 0.0], fov: 36 }
  };
  var viewName = 'all', moved = false, lastAspect = 0;   // which view the camera is at, and whether the user has moved it since

  var T = null, stage = null, renderer, scene, camera, controls, insetCam, tmpCam;
  var m = {}, model, fullGroup, dyn, parts = {}, pickables = [], lensPos, lensDir;
  var handlers = {}, last = null, ready = false, cutOn = true, labelsOn = true, offscreen = false;
  var dropGeo, dropMat, dropMeshes = [], ringMesh, sparkGeo, sparkMeshes = [], mistGeo, mistMeshes = [], mistSeeds = [];
  var fieldGroup, streakGroup, streaks = [], gapVol, mistFrom, mistTo;
  var anim = null, home = null, inEye = false, squeezeAt = -1e9, pressed = null;
  var target = { blade: 65 * DEG, needle: 0, knob: 0, lever: -35 * DEG, focus: 0 }, now = { blade: 65 * DEG, needle: 0, knob: 0, lever: -35 * DEG, focus: 0 };
  var counter = { canvas: null, tex: null, shown: null }, labels = [], ov = {}, insetBox = { x: 0, y: 0, w: 0, h: 0 };
  var hover = null, down = null, holdDelay = null, holdTimer = null, hoverQueued = false, lastPointer = null;
  var V1, V2, V3, roomLights = [];

  function $(id) { return document.getElementById(id); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function mix(a, b, k) { return a + (b - a) * k; }

  // ---------- building blocks ----------

  function std(name, o) { var mt = new T.MeshStandardMaterial(o); mt.name = name; return mt; }
  function mesh(name, geo, mat, parent) { var o = new T.Mesh(geo, mat); o.name = name; if (parent) parent.add(o); return o; }
  function group(name, parent) { var g = new T.Group(); g.name = name; if (parent) parent.add(g); return g; }
  function pol(r, phi, y) { return new T.Vector3(r * Math.sin(phi), y, r * Math.cos(phi)); }
  function inWedge(phi) { var a = ((phi % TAU) + TAU) % TAU; return a > CUT_A && a < CUT_B; }

  /** A group turned to face outward at φ: its local +z points away from the axis. */
  function radial(name, phi, y, parent) { var g = group(name, parent); g.rotation.y = phi; g.position.y = y; return g; }

  /** A cylinder along local z from z0 to z1. */
  function tubeZ(r, z0, z1, segs, r1) {
    var g = new T.CylinderGeometry(r1 === undefined ? r : r1, r, Math.abs(z1 - z0), segs || 32);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, (z0 + z1) / 2);
    return g;
  }

  function box(name, w, h, d, mat, parent, x, y, z) {
    var b = mesh(name, new T.BoxGeometry(w, h, d), mat, parent);
    b.position.set(x || 0, y || 0, z || 0);
    return b;
  }

  /** A knurled knob: a cylinder whose edge is ridged, along y. */
  function knurled(r, h, n) {
    var g = new T.CylinderGeometry(r, r, h, n * 2, 1), p = g.attributes.position;
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), z = p.getZ(i), rr = Math.hypot(x, z);
      if (rr > r * 0.6) {
        var k = Math.round(Math.atan2(x, z) / (Math.PI / n));
        if (Math.abs(k) % 2) { p.setX(i, x * 0.9); p.setZ(i, z * 0.9); }
      }
    }
    g.computeVertexNormals();
    return g;
  }
  function knurledZ(r, h, n) { var g = knurled(r, h, n); g.rotateX(Math.PI / 2); return g; }

  function hexBolt(name, parent, r, h, mat) {
    var b = mesh(name, new T.CylinderGeometry(r, r, h, 6), mat || m.steel, parent);
    return b;
  }

  /** Profile points for a lathe, each corner doubled so the edges stay sharp; [r, y, true] is a smooth point. */
  function lathePts(list) {
    var out = [];
    list.concat([list[0]]).forEach(function (p) {
      var v = new T.Vector2(p[0], p[1]);
      out.push(v);
      if (!p[2]) out.push(v.clone());
    });
    return out;
  }

  /**
   * A part turned about the chamber's axis from a closed (r, y) profile. With a section material it is
   * cut: three quarters of it on the cut layer with flat section faces on the two cut planes, and the
   * whole part on the intact layer (kept out of the exported model).
   */
  function revolve(name, list, mat, cutMat, parent, segs) {
    segs = segs || 96;
    var g = group(name, parent), pts = lathePts(list);
    if (!cutMat) { mesh(name, new T.LatheGeometry(pts, segs), mat, g); return g; }
    var body = mesh(name, new T.LatheGeometry(pts, Math.ceil(segs * KEEP_LEN / TAU), KEEP0, KEEP_LEN), mat, g);
    body.layers.set(L_CUT);
    var sg = new T.ShapeGeometry(new T.Shape(list.map(function (p) { return new T.Vector2(p[0], p[1]); })));
    [KEEP0, KEEP0 + KEEP_LEN].forEach(function (phi, i) {
      var cap = mesh(name + '-section-' + (i + 1), sg, cutMat, g);
      cap.rotation.y = phi - Math.PI / 2;
      cap.layers.set(L_CUT);
    });
    var whole = mesh(name + '-whole', new T.LatheGeometry(pts, segs), mat, fullGroup);
    whole.layers.set(L_FULL);
    return g;
  }

  /** Small fittings round the chamber (bolts, holes, ribs): those in the cut wedge belong to the intact chamber only. */
  function fitting(phi, build) {
    if (!inWedge(phi)) return build(model);
    var o = build(fullGroup);
    o.traverse(function (c) { c.layers.set(L_FULL); });
    return o;
  }

  function canvasTex(w, h, draw) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    var tex = new T.CanvasTexture(cv);
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = 4;
    return { canvas: cv, tex: tex };
  }

  // ---------- materials ----------

  function makeMaterials() {
    var DS = T.DoubleSide;
    m = {
      iron: std('cast-iron', { color: 0x5d5952, roughness: 0.82, metalness: 0.3 }),
      ironCut: std('cast-iron-section', { color: 0xb3b1aa, roughness: 0.36, metalness: 0.4, side: DS }),
      brass: std('brass', { color: 0xc9a24b, roughness: 0.3, metalness: 0.4 }),
      brassCut: std('brass-section', { color: 0xe6ca7c, roughness: 0.26, metalness: 0.4, side: DS }),
      glass: std('glass', { color: 0xd6eaf0, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.3, depthWrite: false }),
      glassCut: std('glass-section', { color: 0xc2dde5, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false, side: DS }),
      ebonite: std('ebonite', { color: 0x1f1e1d, roughness: 0.45, metalness: 0.05 }),
      steel: std('steel', { color: 0xb5b8bb, roughness: 0.32, metalness: 0.4 }),
      dark: std('blackened-brass', { color: 0x202123, roughness: 0.42, metalness: 0.3 }),
      alu: std('aluminium', { color: 0xc7cacc, roughness: 0.42, metalness: 0.35 }),
      wood: std('oak', { color: 0xbf8f5d, roughness: 0.72 }),
      bulb: std('rubber-bulb', { color: 0xdcd0b4, roughness: 0.7 }),
      rubber: std('rubber-black', { color: 0x1b1b1b, roughness: 0.85 }),
      lens: std('lens', { color: 0x0c1822, roughness: 0.05, metalness: 0.3 }),
      bakelite: std('bakelite', { color: 0x1c1a18, roughness: 0.38 }),
      mahogany: std('mahogany', { color: 0x5e2f1f, roughness: 0.55 }),
      red: std('red-insulation', { color: 0xb3261e, roughness: 0.55 }),
      black: std('black-insulation', { color: 0x1d1d1d, roughness: 0.6 }),
      bore: std('bore', { color: 0x0b0b0b, roughness: 0.9 }),
      slate: std('slate', { color: 0x2d3034, roughness: 0.6 }),
      ivory: std('ivory', { color: 0xe9e2cf, roughness: 0.5 }),
      lampWin: std('lamp-window', { color: 0x7a3b10, emissive: 0xff9a3c, emissiveIntensity: 1.5, roughness: 0.2 }),
      pilot: std('pilot-lamp', { color: 0x6b1210, emissive: 0xff2a1a, emissiveIntensity: 0, roughness: 0.25 })
    };
  }

  // ---------- the chamber ----------

  function buildChamber() {
    var g = group('chamber', model), i;
    revolve('chamber-body', [[0, 0.022], [0.150, 0.022], [0.155, 0.027], [0.155, 0.037], [0.151, 0.041], [0.143, 0.041], [0.143, 0.101],
      [0.139, 0.105], [0.132, 0.105], [0.132, 0.258], [0.138, 0.262], [0.138, 0.290], [0.122, 0.290], [0.122, Y_FLOOR], [0, Y_FLOOR]], m.iron, m.ironCut, g, 128);
    revolve('lid', [[0.104, 0.290], [0.146, 0.290], [0.146, 0.312], [0.030, 0.338], [0.023, 0.338], [0.023, 0.351], [0.019, 0.351], [0.019, 0.366],
      [0.008, 0.366], [0.008, 0.326], [0.104, 0.301]], m.iron, m.ironCut, g, 128);

    // Bolts round the lid flange and the base flange, holes round the collar and the window band, ribs on the cone.
    for (i = 0; i < 18; i++) {
      (function (phi) {
        fitting(phi, function (par) {
          var b = hexBolt('lid-bolt', par, 0.0062, 0.008);
          b.position.copy(pol(0.136, phi, 0.316));
          return b;
        });
      })((i + 0.5) * 20 * DEG);
    }
    for (i = 0; i < 16; i++) {
      (function (phi) {
        fitting(phi, function (par) {
          var b = hexBolt('base-bolt', par, 0.0055, 0.006);
          b.position.copy(pol(0.1475, phi, 0.044));
          return b;
        });
      })((i + 0.5) * 22.5 * DEG);
    }
    var holeGeo = tubeZ(0.0024, -0.001, 0.0012, 12);
    for (i = 0; i < 30; i++) {
      (function (phi) {
        if (Math.abs(phi - PHI.atom) < 9 * DEG) return;
        fitting(phi, function (par) {
          var h = radial('collar-hole', phi, 0.276, par);
          mesh('collar-hole', holeGeo, m.bore, h).position.z = 0.138;
          return h;
        });
      })(i * 12 * DEG - 180 * DEG);
    }
    var ports = [PHI.scope, PHI.src, PHI.lamp, PHI.leadBot];
    for (i = 0; i < 24; i++) {
      (function (phi) {
        for (var k = 0; k < ports.length; k++) {
          var dphi = Math.abs(((phi - ports[k]) % TAU + TAU + Math.PI) % TAU - Math.PI);
          if (dphi < 16 * DEG) return;
        }
        fitting(phi, function (par) {
          var h = radial('band-hole', phi, 0.052, par);
          mesh('band-hole', holeGeo, m.bore, h).position.z = 0.143;
          return h;
        });
      })(i * 15 * DEG);
    }
    var slope = Math.atan2(0.026, 0.116), ribLen = Math.hypot(0.116, 0.026);
    for (i = 0; i < 8; i++) {
      (function (phi) {
        fitting(phi, function (par) {
          var r = radial('lid-rib', phi, 0, par);
          var rib = box('lid-rib', 0.006, 0.010, ribLen, m.iron, r, 0, 0.325 + 0.004, 0.088);
          rib.rotation.x = slope;
          return r;
        });
      })((i * 45 + 22.5) * DEG);
    }

    // The condenser: bottom plate on ebonite posts, the glass spacer, and the top plate with its pinhole.
    [5, 125, 245].forEach(function (a, k) {
      var post = mesh('insulator-post-' + (k + 1), new T.CylinderGeometry(0.008, 0.009, Y_BPB - Y_FLOOR, 24), m.ebonite, g);
      post.position.copy(pol(0.08, a * DEG, (Y_FLOOR + Y_BPB) / 2));
    });
    revolve('bottom-plate', [[0, Y_BPB], [RP - 0.001, Y_BPB], [RP, Y_BPB + 0.001], [RP, Y_BPT], [0, Y_BPT]], m.brass, m.brassCut, g, 128);
    revolve('spacer-ring', [[RP - 0.006, Y_BPT + 0.0002], [RP - 0.0003, Y_BPT + 0.0002], [RP - 0.0003, Y_TPB - 0.0002], [RP - 0.006, Y_TPB - 0.0002]], m.glass, m.glassCut, g, 128);
    revolve('top-plate', [[HOLE_R, Y_TPB], [RP, Y_TPB], [RP, Y_TPT - 0.001], [RP - 0.001, Y_TPT], [HOLE_R + 0.0016, Y_TPT], [HOLE_R, Y_TPT - 0.0016]], m.brass, m.brassCut, g, 128);
  }

  /** A flanged window port on the window band, at plate height. */
  function windowPort(name, phi, y) {
    var g = radial(name, phi, y, model), i;
    mesh(name + '-neck', tubeZ(0.021, 0.139, 0.158, 40), m.iron, g);
    mesh(name + '-flange', tubeZ(0.034, 0.158, 0.170, 48), m.iron, g);
    for (i = 0; i < 6; i++) {
      var a = (i + 0.5) * TAU / 6, b = hexBolt(name + '-bolt', g, 0.0034, 0.004);
      b.rotation.x = Math.PI / 2;
      b.position.set(0.026 * Math.cos(a), 0.026 * Math.sin(a), 0.172);
    }
    mesh(name + '-window', tubeZ(0.0135, 0.1700, 0.1706, 32), m.bore, g);
    var ring = mesh(name + '-ring', new T.TorusGeometry(0.0148, 0.0018, 10, 40), m.brass, g);
    ring.position.z = 0.1708;
    return g;
  }

  function buildScope() {
    windowPort('scope-port', PHI.scope, YC);
    var g = radial('viewing-scope', PHI.scope, YC, model);
    mesh('scope-objective', tubeZ(0.0112, 0.168, 0.205, 40), m.dark, g);
    mesh('scope-tube', tubeZ(0.0132, 0.205, 0.292, 48), m.dark, g);
    mesh('scope-collar', tubeZ(0.0149, 0.236, 0.245, 48), m.brass, g);
    mesh('scope-end-ring', tubeZ(0.0146, 0.286, 0.292, 48), m.brass, g);
    box('scope-prism-housing', 0.027, 0.027, 0.027, m.dark, g, 0, 0, 0.3055);

    // The diagonal eyepiece, turned up at 45° (click it to look in).
    var eye = group('eyepiece', g);
    eye.position.set(0, 0.002, 0.3055);
    eye.rotation.x = 45 * DEG;
    eye.userData.part = 'eye';
    revolve('eyepiece-barrel', [[0, 0.011], [0.0094, 0.011], [0.0094, 0.040], [0, 0.040]], m.dark, null, eye, 40);
    revolve('eyepiece-ring', [[0.0094, 0.022], [0.0106, 0.022], [0.0106, 0.028], [0.0094, 0.028]], m.brass, null, eye, 40);
    revolve('eyecup', [[0.0080, 0.036], [0.0119, 0.036], [0.0119, 0.0495, true], [0.0108, 0.0515, true], [0.0094, 0.0512, true], [0.0080, 0.049]], m.rubber, null, eye, 40);
    var lens = mesh('eyepiece-lens', new T.CircleGeometry(0.0080, 40), m.lens, eye);
    lens.rotation.x = -Math.PI / 2;
    lens.position.y = 0.0478;

    // The stand: aluminium blocks with a V-block on top and a knurled knob on the side.
    var st = radial('scope-stand', PHI.scope, 0, model);
    box('stand-base', 0.078, 0.018, 0.058, m.alu, st, 0, 0.009, 0.252);
    box('stand-riser', 0.032, 0.026, 0.040, m.alu, st, 0, 0.031, 0.252);
    box('stand-v-block', 0.036, YC - 0.0132 - 0.044, 0.030, m.alu, st, 0, (YC - 0.0132 + 0.044) / 2, 0.252);
    var knob = mesh('stand-knob', knurled(0.0125, 0.009, 18), m.alu, st);
    knob.rotation.z = Math.PI / 2;
    knob.position.set(0.0215, 0.031, 0.252);
    parts.focusKnob = knob;
    mesh('stand-knob-boss', new T.CylinderGeometry(0.004, 0.004, 0.006, 16), m.steel, st).position.set(0.0165, 0.031, 0.252);
    st.children[st.children.length - 1].rotation.z = Math.PI / 2;
  }

  function buildSource() {
    windowPort('source-port', PHI.src, YC);
    var g = radial('alpha-source', PHI.src, YC, model);
    g.userData.part = 'source';
    mesh('source-holder', tubeZ(0.0108, 0.170, 0.197, 36), m.brass, g);
    mesh('source-cap', knurledZ(0.0128, 0.010, 22), m.brass, g).position.z = 0.202;
    var piv = group('source-pivot', g);
    piv.position.set(0.0112, 0, 0.186);
    var pin = mesh('source-lever-pin', new T.CylinderGeometry(0.0035, 0.0035, 0.008, 16), m.steel, piv);
    pin.rotation.z = Math.PI / 2;
    var arm = group('source-lever', piv);
    box('source-lever-bar', 0.034, 0.0045, 0.003, m.steel, arm, 0.017, 0, 0.003);
    mesh('source-lever-knob', new T.SphereGeometry(0.0058, 20, 14), m.ebonite, arm).position.set(0.035, 0, 0.003);
    parts.srcLever = arm;
    parts.srcCap = g.children[1];
  }

  function buildLamp() {
    windowPort('lamp-port', PHI.lamp, YC);
    var g = radial('arc-lamp', PHI.lamp, YC, model);
    mesh('lamp-lens-tube', tubeZ(0.016, 0.170, 0.215, 40), m.dark, g);
    mesh('lamp-lens-ring', tubeZ(0.0192, 0.200, 0.208, 40), m.brass, g);
    var hz = 0.254, hy = 0.012;
    box('lamp-house', 0.074, 0.086, 0.078, m.dark, g, 0, hy, hz);
    box('lamp-house-top', 0.080, 0.005, 0.084, m.dark, g, 0, hy + 0.0455, hz);
    mesh('lamp-chimney', new T.CylinderGeometry(0.015, 0.017, 0.046, 32), m.dark, g).position.set(0, hy + 0.071, hz);
    mesh('lamp-chimney-neck', new T.CylinderGeometry(0.008, 0.008, 0.008, 20), m.dark, g).position.set(0, hy + 0.098, hz);
    mesh('lamp-chimney-cap', new T.CylinderGeometry(0.024, 0.024, 0.004, 32), m.dark, g).position.set(0, hy + 0.104, hz);
    box('lamp-window-1', 0.002, 0.024, 0.030, m.lampWin, g, 0.0375, hy + 0.006, hz);
    box('lamp-window-2', 0.002, 0.024, 0.030, m.lampWin, g, -0.0375, hy + 0.006, hz);
    [-1, 1].forEach(function (s, k) {
      var kn = mesh('lamp-feed-knob-' + (k + 1), knurledZ(0.0085, 0.010, 14), m.ebonite, g);
      kn.position.set(s * 0.018, hy + 0.022, hz + 0.044);
      mesh('lamp-feed-rod-' + (k + 1), tubeZ(0.0025, hz + 0.039, hz + 0.040 + 0.002, 12), m.steel, g).position.set(s * 0.018, hy + 0.022, 0);
    });
    var st = radial('lamp-stand', PHI.lamp, 0, model);
    mesh('lamp-stand-foot', new T.CylinderGeometry(0.034, 0.036, 0.008, 40), m.iron, st).position.set(0, 0.004, hz);
    var rodH = YC + hy - 0.043 - 0.008;
    mesh('lamp-stand-rod', new T.CylinderGeometry(0.0065, 0.0065, rodH, 20), m.steel, st).position.set(0, 0.008 + rodH / 2, hz);
  }

  function buildFittings() {
    // Lead to the top plate: a stub and an aluminium terminal box; lead to the bottom plate: a stub and a round connector.
    var a = radial('lead-top', PHI.leadTop, 0.175, model);
    mesh('lead-top-stub', tubeZ(0.012, 0.128, 0.176, 32), m.iron, a);
    box('lead-top-box', 0.052, 0.062, 0.046, m.alu, a, 0, 0, 0.199);
    box('lead-top-box-lid', 0.054, 0.064, 0.003, m.alu, a, 0, 0, 0.2235);
    mesh('lead-top-gland', new T.CylinderGeometry(0.0055, 0.0065, 0.010, 20), m.steel, a).position.set(0, -0.036, 0.199);
    var b = radial('lead-bottom', PHI.leadBot, 0.052, model);
    mesh('lead-bottom-stub', tubeZ(0.010, 0.140, 0.172, 28), m.iron, b);
    mesh('lead-bottom-connector', knurledZ(0.0125, 0.022, 16), m.steel, b).position.z = 0.183;
    mesh('lead-bottom-tail', tubeZ(0.006, 0.194, 0.204, 20), m.rubber, b);

    // The air cock on the left of the chamber.
    var v = radial('air-cock', PHI.valve, 0.175, model);
    mesh('air-cock-stub', tubeZ(0.009, 0.128, 0.160, 28), m.iron, v);
    mesh('air-cock-body', new T.SphereGeometry(0.013, 28, 20), m.steel, v).position.z = 0.168;
    mesh('air-cock-spout', tubeZ(0.0065, 0.176, 0.196, 24), m.steel, v);
    mesh('air-cock-spout-end', tubeZ(0.0085, 0.196, 0.201, 24), m.steel, v);
    mesh('air-cock-plug', new T.CylinderGeometry(0.0052, 0.0052, 0.014, 18), m.steel, v).position.set(0, 0.016, 0.168);
    var lever = box('air-cock-lever', 0.006, 0.050, 0.004, m.steel, v, 0.0, 0.0, 0.168);
    lever.geometry.translate(0, -0.022, 0);
    lever.position.set(0.0, 0.024, 0.168);
    lever.rotation.z = 150 * DEG;

    // A wooden board under the chamber.
    mesh('base-board', new T.CylinderGeometry(0.19, 0.19, 0.022, 96), m.wood, model).position.y = 0.011;
  }

  function buildAtomizer() {
    var pg = radial('atomizer-port', PHI.atom, 0.276, model);
    mesh('atomizer-port-boss', tubeZ(0.010, 0.136, 0.148, 32), m.iron, pg);
    mesh('atomizer-port-disc', tubeZ(0.019, 0.148, 0.155, 40), m.steel, pg);
    mesh('atomizer-port-gland', tubeZ(0.007, 0.155, 0.162, 24), m.brass, pg);
    var foot = pol(0.27, -68 * DEG, 0);
    var pil = group('atomizer-pillar', model);
    pil.position.set(foot.x, 0, foot.z);
    mesh('pillar-foot', new T.CylinderGeometry(0.032, 0.036, 0.010, 40), m.iron, pil).position.y = 0.005;
    mesh('pillar-column', new T.CylinderGeometry(0.0125, 0.0125, 0.228, 32), m.steel, pil).position.y = 0.124;
    mesh('pillar-clamp', new T.CylinderGeometry(0.0168, 0.0168, 0.022, 32), m.steel, pil).position.y = 0.247;
    mesh('pillar-screw', tubeZ(0.0032, 0.015, 0.026, 12), m.steel, pil).position.y = 0.247;

    var portPt = pol(0.160, PHI.atom, 0.276), bodyPt = new T.Vector3(foot.x, 0.268, foot.z);
    var dir = portPt.clone().sub(bodyPt), len = dir.length();
    dir.normalize();
    var a = group('atomizer', model);
    a.position.copy(bodyPt);
    a.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), dir);
    mesh('atomizer-body', tubeZ(0.0095, -0.022, 0.022, 32), m.brass, a);
    mesh('atomizer-body-cap', tubeZ(0.0105, 0.016, 0.022, 32), m.brass, a);
    mesh('atomizer-nozzle', tubeZ(0.0022, 0.022, len, 16), m.brass, a);
    mesh('atomizer-neck', tubeZ(0.0055, -0.036, -0.022, 24), m.brass, a);
    var bg = group('atomizer-bulb', a);
    bg.position.z = -0.064;
    bg.userData.part = 'bulb';
    var bulb = mesh('atomizer-bulb', new T.SphereGeometry(0.024, 48, 32), m.bulb, bg);
    bulb.scale.set(1, 1, 1.34);
    mesh('atomizer-bulb-neck', tubeZ(0.0062, 0.026, 0.036, 20, 0.0085), m.bulb, bg);
    parts.bulb = bulb;
    // The mist leaves the inner end of the port and drifts down to the space above the top plate.
    mistFrom = pol(0.12, PHI.atom, 0.276);
  }

  // ---------- the supply ----------

  var PANEL_W = 0.192, PANEL_H = 0.120, PANEL_Y = 0.064, PZ = 0.0702;

  function panelTexture() {
    var W = 1536, H = 960;
    function X(x) { return (x + PANEL_W / 2) / PANEL_W * W; }
    function Y(y) { return (PANEL_Y + PANEL_H / 2 - y) / PANEL_H * H; }
    return canvasTex(W, H, function (c) {
      c.fillStyle = '#1b1917';
      c.fillRect(0, 0, W, H);
      c.strokeStyle = '#3a3631';
      c.lineWidth = 6;
      c.strokeRect(14, 14, W - 28, H - 28);
      c.fillStyle = '#ddcfa6';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = '700 40px Georgia, "Times New Roman", serif';
      c.fillText('PLATE VOLTAGE', X(0.016), Y(0.1175));
      c.font = '600 30px Georgia, "Times New Roman", serif';
      c.textAlign = 'left';
      c.fillText('▲ RAISE', X(0.0115), Y(0.096));
      c.fillText('▼ LOWER', X(0.0115), Y(0.070));
      c.textAlign = 'center';
      c.fillText('ADJUST', X(0.002), Y(0.0135));
      c.fillText('ON', X(0.058), Y(0.1185));
      c.fillText('OFF', X(0.0855), Y(0.044));
      c.fillText('+', X(-0.081), Y(0.026));
      c.fillText('−', X(-0.063), Y(0.026));
      c.font = '600 22px Georgia, "Times New Roman", serif';
      c.fillText('TO PLATES', X(-0.072), Y(0.0075));
      c.fillText('PLATES', X(0.058), Y(0.0205));
    });
  }

  function dialTexture() {
    return canvasTex(512, 512, function (c) {
      c.fillStyle = '#efe8d6';
      c.beginPath(); c.arc(256, 256, 256, 0, TAU); c.fill();
      var px = 256, py = 344, R = 226, i;
      c.strokeStyle = '#1c1a17';
      c.fillStyle = '#1c1a17';
      c.lineWidth = 4;
      c.beginPath(); c.arc(px, py, R, -Math.PI / 2 - 50 * DEG, -Math.PI / 2 + 50 * DEG); c.stroke();
      for (i = 0; i <= 60; i++) {
        var a = (-50 + 100 * i / 60) * DEG, long = i % 10 === 0, mid = i % 5 === 0;
        var r0 = R, r1 = R + (long ? 26 : mid ? 18 : 11);
        c.lineWidth = long ? 4 : 2.5;
        c.beginPath();
        c.moveTo(px + r0 * Math.sin(a), py - r0 * Math.cos(a));
        c.lineTo(px + r1 * Math.sin(a), py - r1 * Math.cos(a));
        c.stroke();
        if (long) {
          c.font = '600 30px Georgia, "Times New Roman", serif';
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText(String(i * V_MAX / 60), px + (R - 30) * Math.sin(a), py - (R - 30) * Math.cos(a));
        }
      }
      c.font = 'italic 600 34px Georgia, "Times New Roman", serif';
      c.fillText('VOLTS', 256, 300);
      c.font = '600 20px Georgia, "Times New Roman", serif';
      c.fillText('D.C.', 256, 336);
    });
  }

  function drawCounter(v) {
    var c = counter.canvas.getContext('2d'), W = counter.canvas.width, H = counter.canvas.height;
    c.fillStyle = '#0b0a09';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#f3ead2';
    c.font = '700 118px "Courier New", ui-monospace, monospace';
    c.textAlign = 'right';
    c.textBaseline = 'middle';
    c.fillText(String(v), 360, H / 2 + 6);
    c.fillStyle = '#ddcfa6';
    c.font = '700 92px Georgia, "Times New Roman", serif';
    c.textAlign = 'left';
    c.fillText('V', 388, H / 2 + 6);
    counter.tex.needsUpdate = true;
  }

  function buildSupply() {
    var g = group('plate-voltage-supply', model);
    g.position.set(SUP.x, 0, SUP.z);
    g.rotation.y = SUP.rot;
    box('supply-case', 0.200, 0.128, 0.140, m.mahogany, g, 0, 0.064, 0);
    box('supply-lid', 0.208, 0.006, 0.148, m.mahogany, g, 0, 0.131, 0);
    box('supply-plinth', 0.208, 0.006, 0.148, m.mahogany, g, 0, 0.003, 0);
    var pm = std('supply-panel', { map: panelTexture().tex, roughness: 0.42 });
    mesh('supply-panel', new T.PlaneGeometry(PANEL_W, PANEL_H), pm, g).position.set(0, PANEL_Y, PZ);

    // Voltmeter: bezel, dial, needle.
    var mtr = group('voltmeter', g);
    mtr.position.set(-0.050, 0.083, PZ);
    mesh('voltmeter-back', tubeZ(0.034, 0, 0.0045, 48), m.bakelite, mtr);
    var dial = mesh('voltmeter-dial', new T.CircleGeometry(0.029, 48), std('voltmeter-dial', { map: dialTexture().tex, roughness: 0.5 }), mtr);
    dial.position.z = 0.0047;
    var bez = mesh('voltmeter-bezel', new T.TorusGeometry(0.0312, 0.0028, 12, 56), m.bakelite, mtr);
    bez.position.z = 0.0052;
    var ng = group('voltmeter-needle', mtr);
    ng.position.set(0, -0.0102, 0.0056);
    var nd = box('voltmeter-needle', 0.0009, 0.0285, 0.0005, std('needle', { color: 0x14110e, roughness: 0.5 }), ng, 0, 0.0142, 0);
    mesh('voltmeter-pivot', tubeZ(0.0022, 0, 0.0012, 16), m.brass, ng);
    parts.needle = ng;
    void nd;

    // The counter under the meter.
    box('counter-bezel', 0.056, 0.019, 0.004, m.bakelite, g, -0.050, 0.035, PZ + 0.002);
    counter = canvasTex(512, 150, function () {});
    counter.shown = null;
    var cm = new T.MeshBasicMaterial({ map: counter.tex });
    cm.name = 'counter';
    mesh('counter-window', new T.PlaneGeometry(0.048, 0.014), cm, g).position.set(-0.050, 0.035, PZ + 0.0041);
    drawCounter(600);

    // Raise and Lower buttons (hold to repeat).
    [['up', 0.096], ['down', 0.070]].forEach(function (b) {
      var bg = group('button-' + (b[0] === 'up' ? 'raise' : 'lower'), g);
      bg.position.set(0.002, b[1], PZ);
      bg.userData.part = b[0];
      mesh(bg.name + '-bezel', tubeZ(0.0086, 0, 0.003, 32), m.steel, bg);
      var cap = mesh(bg.name + '-cap', tubeZ(0.0062, 0.002, 0.008, 32), m.bakelite, bg);
      parts[b[0] + 'Cap'] = cap;
    });

    // The voltage knob, which turns with the voltage.
    var kg = group('voltage-knob', g);
    kg.position.set(0.002, 0.034, PZ);
    mesh('voltage-knob-skirt', tubeZ(0.0165, 0, 0.003, 48), m.bakelite, kg);
    mesh('voltage-knob-grip', knurledZ(0.0128, 0.013, 20), m.bakelite, kg).position.z = 0.0095;
    box('voltage-knob-pointer', 0.0016, 0.010, 0.0008, m.ivory, kg, 0, 0.0075, 0.0162);
    parts.knob = kg;

    // The knife switch: closed (up into the jaws) puts the voltage across the plates, open shorts them.
    var sw = group('knife-switch', g);
    sw.position.set(0.058, 0, PZ);
    sw.userData.part = 'field';
    box('knife-switch-base', 0.036, 0.090, 0.008, m.slate, sw, 0, 0.070, 0.004);
    [-1, 1].forEach(function (s, k) {
      box('knife-switch-jaw-' + (k + 1), 0.0024, 0.016, 0.014, m.brass, sw, s * 0.0028, 0.101, 0.015);
      box('knife-switch-hinge-' + (k + 1), 0.0024, 0.012, 0.014, m.brass, sw, s * 0.0028, 0.036, 0.015);
    });
    mesh('knife-switch-hinge-pin', new T.CylinderGeometry(0.0016, 0.0016, 0.010, 12), m.steel, sw).position.set(0, 0.036, 0.016);
    sw.children[sw.children.length - 1].rotation.z = Math.PI / 2;
    var blade = group('knife-switch-blade', sw);
    blade.position.set(0, 0.036, 0.016);
    box('knife-switch-blade', 0.0030, 0.072, 0.010, m.brass, blade, 0, 0.034, 0);
    mesh('knife-switch-handle', tubeZ(0.0048, 0.004, 0.026, 20), m.ebonite, blade).position.y = 0.068;
    mesh('knife-switch-handle-knob', new T.SphereGeometry(0.0062, 18, 12), m.ebonite, blade).position.set(0, 0.068, 0.027);
    parts.blade = blade;
    var pilot = mesh('pilot-lamp', new T.SphereGeometry(0.0042, 18, 12), m.pilot, g);
    pilot.position.set(0.084, 0.108, PZ + 0.002);
    mesh('pilot-lamp-bezel', new T.TorusGeometry(0.0046, 0.0012, 8, 24), m.brass, g).position.set(0.084, 0.108, PZ + 0.002);

    // Binding posts for the leads.
    var posts = {};
    [['pos', -0.081, m.red], ['neg', -0.063, m.black]].forEach(function (p) {
      var pg = group('binding-post-' + p[0], g);
      pg.position.set(p[1], 0.016, PZ);
      mesh(pg.name + '-nut', tubeZ(0.0062, 0, 0.004, 6), m.brass, pg);
      mesh(pg.name + '-stem', tubeZ(0.0032, 0.004, 0.014, 16), m.brass, pg);
      mesh(pg.name + '-cap', knurledZ(0.0056, 0.008, 12), p[2], pg).position.z = 0.016;
      posts[p[0]] = pg;
    });
    g.updateMatrixWorld(true);
    parts.posts = posts;
    parts.supply = g;
  }

  function cable(name, ptsArr, mat, r) {
    var curve = new T.CatmullRomCurve3(ptsArr.map(function (p) { return p.isVector3 ? p : new T.Vector3(p[0], p[1], p[2]); }), false, 'centripetal');
    return mesh(name, new T.TubeGeometry(curve, 160, r || 0.0024, 10, false), mat, model);
  }

  /**
   * The leads run down from the terminal box and the connector on the right of the chamber, out along the
   * bench clear of the board and the lamp's stand, round the left side of the supply (the black one inside
   * the red) and up into banana plugs in the fronts of the binding posts, the red one passing over the black.
   */
  function buildLeads() {
    model.updateMatrixWorld(true);
    var sup = parts.supply, BENCH = 0.0026;
    function S(x, y, z) { return sup.localToWorld(new T.Vector3(x, y, z)); }
    [['pos', m.red], ['neg', m.black]].forEach(function (p) {
      mesh('banana-plug-' + p[0], tubeZ(0.0038, 0.020, 0.034, 16, 0.0033), p[1], parts.posts[p[0]]);
    });
    var tip = PZ + 0.034;
    cable('lead-to-top-plate', [pol(0.199, PHI.leadTop, 0.134), pol(0.203, PHI.leadTop, 0.10), pol(0.212, PHI.leadTop + 1 * DEG, 0.03),
      pol(0.235, PHI.leadTop + 2 * DEG, BENCH), S(-0.172, BENCH, -0.017), S(-0.150, BENCH, 0.120), S(-0.090, BENCH, 0.140),
      S(-0.081, 0.010, 0.124), S(-0.081, 0.016, tip)], m.red);
    cable('lead-to-bottom-plate', [pol(0.204, PHI.leadBot, 0.052), pol(0.214, PHI.leadBot, 0.035), pol(0.232, PHI.leadBot - 1 * DEG, BENCH),
      S(-0.143, BENCH, -0.074), S(-0.125, BENCH, 0.095), S(-0.075, BENCH, 0.114), S(-0.063, 0.009, 0.112), S(-0.063, 0.016, tip)], m.black);
    // Inside the chamber: the + lead down to the top plate and the − lead to the bottom plate.
    cable('inner-lead-top-plate', [pol(0.122, PHI.leadTop, 0.175), pol(0.114, PHI.leadTop, 0.15), pol(0.108, PHI.leadTop - 2 * DEG, 0.105),
      pol(0.1, PHI.leadTop - 3 * DEG, Y_TPT + 0.004), pol(0.094, PHI.leadTop - 3 * DEG, Y_TPT + 0.0016)], m.red, 0.0015);
    box('top-plate-lug', 0.008, 0.0012, 0.006, m.brass, model).position.copy(pol(0.092, PHI.leadTop - 3 * DEG, Y_TPT + 0.0006));
    cable('inner-lead-bottom-plate', [pol(0.122, PHI.leadBot, 0.052), pol(0.114, PHI.leadBot, 0.054), pol(0.108, PHI.leadBot + 1 * DEG, Y_BPB + 0.003),
      pol(0.1055, PHI.leadBot + 1 * DEG, Y_BPB + 0.003)], m.black, 0.0015);
  }

  // ---------- what moves: drops, rings, mist, field, alpha tracks, the beam ----------

  function buildLive() {
    dyn = group('live', null);
    dropGeo = new T.SphereGeometry(1, 16, 12);
    dropMat = new T.MeshStandardMaterial({ color: 0xd9581f, emissive: 0xff7a2e, emissiveIntensity: 0.95, roughness: 0.4 });
    ringMesh = new T.Mesh(new T.TorusGeometry(1, 0.11, 8, 48), new T.MeshBasicMaterial({ color: 0x3d8ae8, depthTest: false, transparent: true }));
    ringMesh.renderOrder = 20;
    ringMesh.visible = false;
    dyn.add(ringMesh);
    sparkGeo = new T.TorusGeometry(1, 0.07, 8, 40);
    mistGeo = new T.SphereGeometry(1, 10, 8);
    for (var i = 0; i < MIST_N; i++) {
      var mm = new T.Mesh(mistGeo, new T.MeshBasicMaterial({ color: 0xf1cfa6, transparent: true, opacity: 0, depthWrite: false }));
      mm.visible = false;
      dyn.add(mm);
      mistMeshes.push(mm);
      mistSeeds.push({ delay: Math.random() * 0.4, jx: (Math.random() - 0.5) * 0.012, jy: (Math.random() - 0.5) * 0.003, jz: (Math.random() - 0.5) * 0.012,
        bow: (Math.random() - 0.5) * 0.03, r: 0.0009 + Math.random() * 0.0008 });
    }
    mistTo = simToWorld(-3.5e-3, C.d + 3.1e-3, 0, new T.Vector3());

    // The lamp's beam across the gap.
    var L = new T.Vector3(-Math.sin(PHI.lamp), 0, -Math.cos(PHI.lamp));
    [[0.0024, 0.06], [0.0012, 0.10]].forEach(function (b) {
      var beam = new T.Mesh(new T.CylinderGeometry(b[0] * 1.15, b[0], 2 * (RP - 0.006), 32, 1, true),
        new T.MeshBasicMaterial({ color: 0xffd58a, transparent: true, opacity: b[1], blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
      beam.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), L);
      beam.position.set(0, YC, 0);
      dyn.add(beam);
    });
    var spot = new T.SpotLight(0xffe2b0, 1.6, 0.5, 0.05, 0.6, 0);
    spot.position.copy(pol(0.17, PHI.lamp, YC));
    spot.target.position.set(0, YC, 0);
    dyn.add(spot);
    dyn.add(spot.target);

    // Field arrows (shown while the plates are charged), beside the field of view in the magnified view.
    fieldGroup = group('field', dyn);
    var right = new T.Vector3(Math.cos(PHI.inset), 0, -Math.sin(PHI.inset));
    var am = new T.MeshBasicMaterial({ color: 0x3a86e0 });
    var aTop = Y_TPB - 0.0008, aTip = Y_BPT + 0.0008, aHead = 0.0018;
    [-0.0125, -0.0078, 0.0078, 0.0125].forEach(function (s) {
      var p = right.clone().multiplyScalar(s);
      var shaft = new T.Mesh(new T.CylinderGeometry(0.00022, 0.00022, aTop - aTip - aHead, 12), am);
      shaft.position.set(p.x, (aTop + aTip + aHead) / 2, p.z);
      var head = new T.Mesh(new T.ConeGeometry(0.00066, aHead, 16), am);
      head.rotation.x = Math.PI;
      head.position.set(p.x, aTip + aHead / 2, p.z);
      fieldGroup.add(shaft, head);
    });
    fieldGroup.visible = false;
    parts.eAnchor = right.clone().multiplyScalar(0.0125).setY(YC + 0.0005);

    // Alpha particles from the source window, while it is exposed.
    streakGroup = group('alpha', dyn);
    var sm = new T.MeshBasicMaterial({ color: 0xece6ff, transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false });
    var sg = new T.CylinderGeometry(0.00011, 0.00011, 0.0032, 6);
    var origin = pol(RP - 0.007, PHI.src, YC);
    for (var k = 0; k < STREAK_N; k++) {
      var yaw = PHI.src + Math.PI + (Math.random() - 0.5) * 30 * DEG, pitch = (Math.random() - 0.5) * 0.05;
      var d = new T.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      var s = new T.Mesh(sg, sm);
      s.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d);
      streakGroup.add(s);
      streaks.push({ mesh: s, dir: d, len: 0.075 + Math.random() * 0.03, speed: 0.12 + Math.random() * 0.08, phase: Math.random(), origin: origin });
    }
    streakGroup.visible = false;

    // The 3 mm field of view, a dashed circle across the scope's line of sight.
    var fp = [];
    for (var j = 0; j <= 64; j++) {
      var t = j / 64 * TAU;
      fp.push(new T.Vector3(FOV_R * Math.cos(t) * EX.x, YC + FOV_R * Math.sin(t), FOV_R * Math.cos(t) * EX.z));
    }
    var fov = new T.Line(new T.BufferGeometry().setFromPoints(fp), new T.LineDashedMaterial({ color: 0xa8a69d, dashSize: 0.00022, gapSize: 0.00016 }));
    fov.computeLineDistances();
    dyn.add(fov);

    // The space between the plates, for telling a click there from one elsewhere.
    gapVol = new T.Mesh(new T.CylinderGeometry(RP - 0.006, RP - 0.006, C.d, 48), new T.MeshBasicMaterial());
    gapVol.position.y = YC;
    gapVol.visible = false;
    dyn.add(gapVol);
  }

  /** A position in the simulation (m: x across the view, y up from the bottom plate, z toward the observer) in the world. */
  function simToWorld(sx, sy, sz, out) {
    var y;
    if (sy <= C.d) y = Y_BPT + sy;
    else {
      var u = sy - C.d;
      y = u < S0 ? Y_TPB + u * (S0 + PT) / S0 : Y_TPT + u;
    }
    return out.set(sx * EX.x + sz * EZ.x, y, sx * EX.z + sz * EZ.z);
  }

  /** Where to draw a drop: above the top plate it is funnelled into the pinhole, and a drop just through it eases out to its true depth. */
  function dropPos(d, sim, out) {
    var sz = d.z, zc = clamp(d.z, -0.3e-3, 0.3e-3);
    if (d.above) {
      var u = d.y - C.d;
      sz = mix(zc, sz, clamp(u / S0, 0, 1));
      simToWorld(d.x, d.y, sz, out);
      if (u < S0 && Math.abs(d.x) > HOLE_R * 1.2) out.y = Math.max(out.y, Y_TPT + DROP_R);
      return out;
    }
    if (d.air) sz = mix(zc, sz, clamp((sim.time - d.air.at) / 1.2, 0, 1));
    return simToWorld(d.x, d.y, sz, out);
  }

  // ---------- labels ----------

  function addLabel(key, text, at, view, dx, dy) {
    var el = document.createElement('div');
    el.className = 'app3d-label' + (view === 'inset' ? ' inset' : '');
    el.textContent = text;
    ov.labels.appendChild(el);
    var NS = 'http://www.w3.org/2000/svg';
    var line = document.createElementNS(NS, 'line'), dot = document.createElementNS(NS, 'circle');
    line.setAttribute('class', view === 'inset' ? 'inset' : '');
    dot.setAttribute('class', view === 'inset' ? 'inset' : '');
    dot.setAttribute('r', '2.5');
    ov.leaders.appendChild(line);
    ov.leaders.appendChild(dot);
    var L = { key: key, at: at, view: view, dx: dx, dy: dy, el: el, line: line, dot: dot, w: 0, h: 0, shown: null };
    labels.push(L);
    return L;
  }

  function setLabelText(key, text) {
    for (var i = 0; i < labels.length; i++) if (labels[i].key === key && labels[i].el.textContent !== text) { labels[i].el.textContent = text; labels[i].w = 0; }
  }

  function buildLabels() {
    ov.labels.textContent = '';
    ov.leaders.textContent = '';
    var bulbW = parts.bulb.getWorldPosition(new T.Vector3());
    addLabel('atom', 'Atomizer', bulbW.clone().add(new T.Vector3(0, 0.026, 0)), 'main', -10, -38);
    addLabel('chamber', 'Droplet chamber, cut away', pol(0.146, 60 * DEG, 0.312), 'main', 70, -40);
    addLabel('scope', 'Viewing scope', pol(0.235, PHI.scope, YC - 0.014), 'main', -36, 44);
    addLabel('eye', 'Eyepiece', lensPos.clone(), 'main', -64, -26);
    addLabel('lamp', 'Arc lamp', pol(0.254, PHI.lamp, YC + 0.12), 'main', 10, -30);
    addLabel('src', 'α source: off', parts.srcCap.getWorldPosition(new T.Vector3()), 'main', 10, 46);
    addLabel('supply', 'Plate voltage supply', parts.supply.localToWorld(new T.Vector3(0, 0.004, 0.074)), 'main', 0, 30);
    addLabel('tp', 'Top plate (+)', pol(0.006, CUT_B, Y_TPB + 0.002), 'inset', 50, -16);
    addLabel('hole', 'Pinhole', new T.Vector3(0, Y_TPT - 0.001, 0), 'inset', -44, -12);
    addLabel('gap', 'Gap ' + (C.d * 1000).toFixed(2) + ' mm', pol(0.007, CUT_A, YC + 0.001), 'inset', -40, -26);
    addLabel('fov', '3 mm field of view', new T.Vector3(0, YC - FOV_R, 0), 'inset', -72, 16);
    addLabel('bp', 'Bottom plate (−)', pol(0.006, CUT_B, Y_BPT - 0.0015), 'inset', 50, 4);
    var e = addLabel('E', 'E', parts.eAnchor, 'inset', 18, 0);
    e.when = function () { return fieldGroup.visible; };
  }

  function placeLabels(W, H) {
    var v = V1, ib = insetBox;
    for (var i = 0; i < labels.length; i++) {
      var L = labels[i], show = labelsOn && !inEye && (!L.when || L.when()), x = 0, y = 0;
      if (L.view === 'inset' && ib.w < 200) show = false;      // too small a magnified view to label
      if (show) {
        var cam = L.view === 'inset' ? insetCam : camera;
        v.copy(L.at).project(cam);
        if (v.z > 1 || v.z < -1) show = false;
        if (L.view === 'inset') {
          x = ib.x + (v.x + 1) / 2 * ib.w; y = ib.y + (1 - v.y) / 2 * ib.h;
          if (x < ib.x + 4 || x > ib.x + ib.w - 4 || y < ib.y + 4 || y > ib.y + ib.h - 4) show = false;
        } else {
          x = (v.x + 1) / 2 * W; y = (1 - v.y) / 2 * H;
          if (x < 0 || x > W || y < 0 || y > H || (x > ib.x - 6 && y < ib.y + ib.h + 6)) show = false;
        }
      }
      if (!show) {
        if (L.shown !== false) { L.el.style.display = 'none'; L.line.style.display = 'none'; L.dot.style.display = 'none'; L.shown = false; }
        continue;
      }
      if (L.shown !== true) { L.el.style.display = ''; L.line.style.display = ''; L.dot.style.display = ''; L.shown = true; L.w = 0; }
      if (!L.w) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
      var lx = x + L.dx, ly = y + L.dy;
      if (L.view === 'inset') {
        lx = clamp(lx, ib.x + L.w / 2 + 4, ib.x + ib.w - L.w / 2 - 4);
        ly = clamp(ly, ib.y + L.h / 2 + 4, ib.y + ib.h - L.h / 2 - 22);
      } else {
        lx = clamp(lx, L.w / 2 + 4, W - L.w / 2 - 4);
        ly = clamp(ly, L.h / 2 + 4, H - L.h / 2 - 4);
      }
      L.el.style.transform = 'translate(' + (lx - L.w / 2).toFixed(1) + 'px,' + (ly - L.h / 2).toFixed(1) + 'px)';
      L.line.setAttribute('x1', x.toFixed(1)); L.line.setAttribute('y1', y.toFixed(1));
      L.line.setAttribute('x2', lx.toFixed(1)); L.line.setAttribute('y2', ly.toFixed(1));
      L.dot.setAttribute('cx', x.toFixed(1)); L.dot.setAttribute('cy', y.toFixed(1));
    }
  }

  // ---------- views ----------

  /**
   * The camera pose for a view in a viewport of the given aspect (width over height; the camera's own by
   * default). A portrait view is framed as if square: it keeps the chamber large and crops the edges rather
   * than backing off until everything is tiny.
   */
  function viewPose(v, aspect) {
    var a = Math.max(aspect || camera.aspect || 1.6, 1), tn = Math.tan(v.fov * DEG / 2);
    var dist = Math.max(v.fitH / tn, v.fitW / (a * tn));
    var t = new T.Vector3(v.target[0], v.target[1], v.target[2]);
    var p = t.clone().add(new T.Vector3(Math.sin(v.phi) * Math.cos(v.elev), Math.sin(v.elev), Math.cos(v.phi) * Math.cos(v.elev)).multiplyScalar(dist));
    return { p: p, t: t, fov: v.fov };
  }

  function stageAspect() { return (stage.clientWidth || 1) / (stage.clientHeight || 1); }

  function setPose(pose) {
    camera.position.copy(pose.p);
    controls.target.copy(pose.t);
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
    camera.lookAt(pose.t);
  }

  function ease(k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }

  /** Fly the camera to a pose over dur ms (at once when the system asks for reduced motion). */
  function startAnim(to, dur, ctrl, done) {
    if (root.Page && root.Page.prefersReducedMotion()) dur = 0;
    anim = { p0: camera.position.clone(), t0: controls.target.clone(), f0: camera.fov, p1: to.p.clone(), t1: to.t.clone(), f1: to.fov, c: ctrl || null,
      start: performance.now(), dur: dur, done: done || null };
    controls.enableDamping = false;
  }

  function stepAnim() {
    var k = anim.dur > 0 ? Math.min(1, (performance.now() - anim.start) / anim.dur) : 1, e = ease(k);
    if (anim.c) {
      var a = (1 - e) * (1 - e), b = 2 * (1 - e) * e, c = e * e;
      camera.position.set(a * anim.p0.x + b * anim.c.x + c * anim.p1.x, a * anim.p0.y + b * anim.c.y + c * anim.p1.y, a * anim.p0.z + b * anim.c.z + c * anim.p1.z);
    } else camera.position.lerpVectors(anim.p0, anim.p1, e);
    controls.target.lerpVectors(anim.t0, anim.t1, e);
    camera.fov = mix(anim.f0, anim.f1, e);
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
    if (k >= 1) {
      var done = anim.done;
      anim = null;
      controls.enableDamping = true;
      if (done) done();
    }
  }

  function goTo(name) {
    if (!ready || inEye) return;
    viewName = name;
    moved = false;
    startAnim(viewPose(VIEWS[name], stageAspect()), 750);
  }

  function applyLayers() {
    if (cutOn) { camera.layers.enable(L_CUT); camera.layers.disable(L_FULL); }
    else { camera.layers.enable(L_FULL); camera.layers.disable(L_CUT); }
    setLabelText('chamber', cutOn ? 'Droplet chamber, cut away' : 'Droplet chamber');
  }

  // ---------- rendering ----------

  function layoutInset(W, H) {
    var w = Math.round(clamp(W * 0.34, Math.min(170, W * 0.5), 520)), h = Math.round(w * 0.74);   // never more than half the width of a narrow view
    if (h > H * 0.62) { h = Math.round(H * 0.62); w = Math.round(h / 0.74); }
    var b = { x: W - w - 12, y: 12, w: w, h: h };
    if (b.x !== insetBox.x || b.w !== insetBox.w || b.h !== insetBox.h) {
      insetBox = b;
      var s = ov.inset.style;
      s.left = b.x + 'px'; s.top = b.y + 'px'; s.width = b.w + 'px'; s.height = b.h + 'px';
    }
  }

  /** World size of one CSS pixel at a point, seen by a camera in a viewport of the given height. */
  function pxWorld(cam, pos, viewH) {
    return 2 * cam.position.distanceTo(pos) * Math.tan(cam.fov * DEG / 2) / viewH;
  }

  /** Size the drops and the rings for one camera: drops never smaller than about a pixel, rings a constant size on screen. */
  function prepPass(cam, viewH, inset) {
    var i, s;
    for (i = 0; i < dropMeshes.length; i++) {
      var dm = dropMeshes[i];
      if (!dm.visible) continue;
      s = Math.max(DROP_R, 1.3 * pxWorld(cam, dm.position, viewH));
      dm.scale.setScalar(s);
    }
    if (ringMesh.visible) {
      ringMesh.scale.setScalar(RING_PX * pxWorld(cam, ringMesh.position, viewH));
      ringMesh.quaternion.copy(cam.quaternion);
    }
    for (i = 0; i < sparkMeshes.length; i++) {
      var sp = sparkMeshes[i];
      if (!sp.visible) continue;
      var px = pxWorld(cam, sp.position, viewH);
      sp.scale.setScalar(Math.max(sp.userData.r, (4 + 10 * sp.userData.f) * px));
      sp.quaternion.copy(cam.quaternion);
    }
    for (i = 0; i < mistMeshes.length; i++) {
      var mm = mistMeshes[i];
      if (!mm.visible) continue;
      s = mm.userData.r;
      mm.scale.setScalar(inset ? Math.min(s, 0.00045) : Math.max(s, 1.6 * pxWorld(cam, mm.position, viewH)));
    }
  }

  function render(rend, scn, cam) {
    var W = stage.clientWidth || 1, H = stage.clientHeight || 1;
    layoutInset(W, H);
    rend.setScissorTest(false);
    rend.setViewport(0, 0, W, H);
    cam.updateMatrixWorld();
    prepPass(cam, H, false);
    rend.render(scn, cam);
    var b = insetBox, yGL = H - b.y - b.h;
    insetCam.aspect = b.w / b.h;
    insetCam.updateProjectionMatrix();
    prepPass(insetCam, b.h, true);
    // Inside the chamber it is dark but for the lamp: the room lights are dimmed for the magnified view.
    for (var i = 0; i < roomLights.length; i++) roomLights[i].intensity = roomLights[i].userData.base * 0.3;
    rend.setScissorTest(true);
    rend.setScissor(b.x, yGL, b.w, b.h);
    rend.setViewport(b.x, yGL, b.w, b.h);
    rend.setClearColor(0x111315, 1);
    rend.render(scn, insetCam);
    for (i = 0; i < roomLights.length; i++) roomLights[i].intensity = roomLights[i].userData.base;
    rend.setClearColor(0x000000, 0);
    rend.setScissorTest(false);
    rend.setViewport(0, 0, W, H);
    placeLabels(W, H);
  }

  function onFrame(dt) {
    var st = stage.closest('.stage');
    var hidden = st && st.classList.contains('in-eye') && !st.classList.contains('is-zooming');
    stage.suspended = hidden || offscreen;
    // When the view changes shape (a resized window, a wider screen), a camera the user has not moved
    // reframes the model to the new shape.
    var asp = stageAspect();
    if (Math.abs(asp - lastAspect) > 1e-3) {
      lastAspect = asp;
      if (ready && !moved && !anim && !inEye) setPose(viewPose(VIEWS[viewName], asp));
    }
    if (anim) stepAnim();
    var k = 1 - Math.exp(-dt * 14);
    for (var key in target) now[key] += (target[key] - now[key]) * k;
    parts.blade.rotation.x = now.blade;
    parts.needle.rotation.z = -now.needle;
    parts.knob.rotation.z = -now.knob;
    parts.srcLever.rotation.z = now.lever;
    parts.focusKnob.rotation.x = now.focus;
    var q = (performance.now() - squeezeAt) / 260;
    var f = q >= 0 && q < 1 ? Math.sin(Math.PI * q) : 0;
    parts.bulb.scale.set(1 - 0.16 * f, 1 - 0.16 * f, 1.34 * (1 + 0.04 * f));
    parts.upCap.position.z = pressed === 'up' ? -0.0018 : 0;
    parts.downCap.position.z = pressed === 'down' ? -0.0018 : 0;
    if (streakGroup.visible) {
      var t = performance.now() / 1000;
      for (var i = 0; i < streaks.length; i++) {
        var s = streaks[i], d = ((t * s.speed + s.phase * s.len) % s.len);
        s.mesh.position.copy(s.origin).addScaledVector(s.dir, d);
      }
    }
  }

  // ---------- picking and pointer ----------

  function partOf(o) {
    while (o) { if (o.userData && o.userData.part) return o; o = o.parent; }
    return null;
  }

  function pointerInfo(e) {
    var r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, W: r.width, H: r.height };
  }

  function inInset(p) { var b = insetBox; return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h; }

  var ray = null, ndc = null;
  function setRay(p, cam, box) {
    if (box) ndc.set((p.x - box.x) / box.w * 2 - 1, -(p.y - box.y) / box.h * 2 + 1);
    else ndc.set(p.x / p.W * 2 - 1, -p.y / p.H * 2 + 1);
    ray.setFromCamera(ndc, cam);
    ray.layers.mask = cam.layers.mask;
  }

  /** The clickable part under the pointer in the main view, if nothing opaque is in front of it. */
  function partAt(p) {
    if (inInset(p)) return null;
    setRay(p, camera, null);
    var hits = ray.intersectObjects(pickables, true);
    for (var i = 0; i < hits.length; i++) {
      var o = hits[i].object;
      if (!o.isMesh || (o.material && o.material.transparent)) continue;
      return partOf(o);
    }
    return null;
  }

  /** The drop nearest the pointer on screen in whichever view it is over, within `within` px. */
  function nearestDrop(p, within) {
    var cam = camera, box = null, best = null, bestD = within, v = V2;
    if (inInset(p)) { cam = insetCam; box = insetBox; }
    for (var i = 0; i < dropMeshes.length; i++) {
      var dm = dropMeshes[i], d = dm.userData.drop;
      if (!dm.visible || !d || d.above) continue;
      v.copy(dm.position).project(cam);
      if (v.z > 1) continue;
      var x = box ? box.x + (v.x + 1) / 2 * box.w : (v.x + 1) / 2 * p.W;
      var y = box ? box.y + (1 - v.y) / 2 * box.h : (1 - v.y) / 2 * p.H;
      var dist = Math.hypot(x - p.x, y - p.y);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return best;
  }

  function inGapAt(p) {
    if (inInset(p)) setRay(p, insetCam, insetBox); else setRay(p, camera, null);
    ray.layers.enableAll();
    return ray.intersectObject(gapVol, false).length > 0;
  }

  function highlight(part, on) {
    if (!part) return;
    part.traverse(function (o) {
      if (!o.isMesh) return;
      if (on) {
        o.userData.baseMat = o.material;
        var hm = o.material.userData.hl;
        if (!hm) {
          hm = o.material.clone();
          hm.name = o.material.name;
          hm.emissive = new T.Color(0x2670cc);
          hm.emissiveIntensity = 0.45;
          o.material.userData.hl = hm;
        }
        o.material = hm;
      } else if (o.userData.baseMat) {
        o.material = o.userData.baseMat;
        o.userData.baseMat = null;
      }
    });
  }

  var TIPS = {
    bulb: 'Atomizer bulb: click to spray',
    up: 'Raise the voltage (hold to keep going)',
    down: 'Lower the voltage (hold to keep going)',
    eye: 'Eyepiece: click to look in'
  };
  function tipFor(part) {
    var k = part.userData.part, sim = last && last.sim;
    if (k === 'field') return 'Knife switch: click to ' + (sim && sim.s > 0 ? 'short the plates' : 'put the voltage on the plates');
    if (k === 'source') return 'α source: click to ' + (sim && sim.source ? 'shield it' : 'expose it');
    return TIPS[k] || '';
  }

  function setHover(part, p, drop) {
    if (part !== hover) {
      highlight(hover, false);
      highlight(part, true);
      hover = part;
    }
    var text = part ? tipFor(part) : drop ? 'Drop ' + drop.id + ': click to track it' : '';
    stage.style.cursor = text ? 'pointer' : '';
    if (!text || !p) { ov.tip.hidden = true; return; }
    ov.tip.hidden = false;
    if (ov.tip.textContent !== text) ov.tip.textContent = text;
    var tw = ov.tip.offsetWidth, x = clamp(p.x + 14, 4, p.W - tw - 4), y = p.y + 18;
    if (y > p.H - 30) y = p.y - 32;
    ov.tip.style.transform = 'translate(' + x + 'px,' + y + 'px)';
  }

  function updateHover() {
    hoverQueued = false;
    if (!lastPointer || down || anim || inEye) { if (!down) setHover(null); return; }
    var p = lastPointer, part = partAt(p), drop = part ? null : nearestDrop(p, 10);
    setHover(part, p, drop);
  }

  function stopHold() {
    clearTimeout(holdDelay); clearInterval(holdTimer); holdDelay = holdTimer = null;
    if (pressed) { pressed = null; controls.enabled = !inEye; }
  }

  function onDown(e) {
    if (!ready || e.button !== 0 || inEye || anim) return;
    var p = pointerInfo(e);
    down = { x: p.x, y: p.y };
    var part = partAt(p), k = part && part.userData.part;
    if (k === 'up' || k === 'down') {
      var step = k === 'up' ? 10 : -10;
      pressed = k;
      controls.enabled = false;
      down.hold = true;
      if (handlers.volt) handlers.volt(step);
      holdDelay = setTimeout(function () { holdTimer = setInterval(function () { if (handlers.volt) handlers.volt(step); }, 90); }, 400);
    }
  }

  function onUp(e) {
    if (!down) return;
    var d = down;
    down = null;
    if (d.hold) { stopHold(); return; }
    var p = pointerInfo(e);
    if (Math.hypot(p.x - d.x, p.y - d.y) > 6 || inEye || anim) return;
    var part = partAt(p), k = part && part.userData.part;
    if (k === 'bulb' && handlers.spray) handlers.spray();
    else if (k === 'field' && handlers.field) handlers.field();
    else if (k === 'source' && handlers.source) handlers.source();
    else if (k === 'eye' && handlers.look) { setHover(null); handlers.look(); }
    else if (!k && handlers.pick) {
      var drop = nearestDrop(p, 14);
      handlers.pick({ drop: drop, inGap: !drop && inGapAt(p) });
    }
    if (k === 'field' || k === 'source') setHover(part, p, null);
  }

  function wirePointer() {
    stage.addEventListener('pointerdown', onDown, true);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', function () { down = null; stopHold(); });
    stage.addEventListener('pointerleave', function () { lastPointer = null; stopHold(); setHover(null); });
    stage.addEventListener('pointermove', function (e) {
      lastPointer = pointerInfo(e);
      if (e.buttons) { if (down && Math.hypot(lastPointer.x - down.x, lastPointer.y - down.y) > 6) setHover(null); return; }
      if (!hoverQueued) { hoverQueued = true; requestAnimationFrame(updateHover); }
    });
    root.addEventListener('blur', stopHold);
    stage.addEventListener('keydown', onKey);
    if ('IntersectionObserver' in root) {
      new IntersectionObserver(function (en) { offscreen = !en[0].isIntersecting; }).observe(stage);
    }
  }

  /** The keyboard route for the drag and the wheel: with the view focused, the arrow keys turn the model and + and − zoom. */
  function onKey(e) {
    if (!ready || inEye || anim || e.altKey || e.ctrlKey || e.metaKey) return;
    var k = e.key, turn = 10 * DEG, zoom = 1;
    var sph = new T.Spherical().setFromVector3(V1.copy(camera.position).sub(controls.target));
    if (k === 'ArrowLeft') sph.theta -= turn;
    else if (k === 'ArrowRight') sph.theta += turn;
    else if (k === 'ArrowUp') sph.phi = clamp(sph.phi - turn, 0.05, Math.PI - 0.05);
    else if (k === 'ArrowDown') sph.phi = clamp(sph.phi + turn, 0.05, Math.PI - 0.05);
    else if (k === '+' || k === '=') zoom = 0.8;
    else if (k === '-' || k === '_') zoom = 1.25;
    else return;
    sph.radius = clamp(sph.radius * zoom, controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(V1.setFromSpherical(sph));
    camera.lookAt(controls.target);
    controls.update();
    moved = true;
    e.preventDefault();
  }

  function wireTools() {
    var all = $('app-view-all'), ch = $('app-view-chamber'), cut = $('app-cut'), lab = $('app-labels-btn');
    if (all) all.addEventListener('click', function () { goTo('all'); });
    if (ch) ch.addEventListener('click', function () { goTo('chamber'); });
    if (cut) cut.addEventListener('click', function () {
      cutOn = !cutOn;
      cut.setAttribute('aria-pressed', String(cutOn));
      if (ready) applyLayers();
    });
    if (lab) lab.addEventListener('click', function () {
      labelsOn = !labelsOn;
      lab.setAttribute('aria-pressed', String(labelsOn));
    });
  }

  // ---------- start ----------

  function build(lib) {
    T = lib.THREE;
    V1 = new T.Vector3(); V2 = new T.Vector3(); V3 = new T.Vector3();
    ray = new T.Raycaster(); ndc = new T.Vector2();
    renderer = stage._renderer; scene = stage._scene; camera = stage._camera; controls = stage._controls;
    makeMaterials();
    model = group('millikan-oil-drop-apparatus', null);
    fullGroup = group('intact-chamber', null);
    buildChamber();
    buildScope();
    buildSource();
    buildLamp();
    buildFittings();
    buildAtomizer();
    buildSupply();
    buildLeads();
    model.updateMatrixWorld(true);
    var eye = model.getObjectByName('eyepiece');
    lensPos = eye.localToWorld(new T.Vector3(0, 0.0478, 0));
    lensDir = eye.localToWorld(new T.Vector3(0, 1, 0)).sub(eye.localToWorld(new T.Vector3(0, 0, 0))).normalize();

    stage.setObject(model);
    model.traverse(function (o) { if (o.isMesh && o.material && o.material.transparent) o.castShadow = false; });
    fullGroup.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(fullGroup);
    buildLive();
    scene.add(dyn);
    pickables = [model, fullGroup];

    // Light: the stage's studio set, a little fill from the front left, and finer shadows.
    var fill = new T.DirectionalLight(0xffffff, 0.55);
    fill.position.set(-3, 2.5, 4);
    scene.add(fill);
    var key = stage._key;
    key.shadow.normalBias = 0.0008;
    key.shadow.bias = -0.0001;
    key.shadow.camera.left = -0.55; key.shadow.camera.right = 0.55; key.shadow.camera.top = 0.55; key.shadow.camera.bottom = -0.55;
    key.shadow.camera.updateProjectionMatrix();
    scene.traverse(function (o) { if (o.isLight && !o.isSpotLight) { o.userData.base = o.intensity; roomLights.push(o); } });

    camera.near = 0.002;
    camera.far = 30;
    controls.minDistance = 0.03;
    controls.maxDistance = 3;
    controls.zoomToCursor = true;
    lastAspect = stageAspect();
    setPose(viewPose(VIEWS.all, lastAspect));
    controls.update();
    controls.addEventListener('start', function () { moved = true; });   // a drag or wheel: the camera is the user's from here on
    applyLayers();

    insetCam = new T.PerspectiveCamera(30, 4 / 3, 0.001, 2);
    var it = new T.Vector3(0, YC + 0.0012, 0);
    insetCam.position.copy(it).add(new T.Vector3(Math.sin(PHI.inset) * Math.cos(12 * DEG), Math.sin(12 * DEG), Math.cos(PHI.inset) * Math.cos(12 * DEG)).multiplyScalar(0.056));
    insetCam.lookAt(it);
    insetCam.layers.enable(L_CUT);
    insetCam.updateMatrixWorld();
    tmpCam = new T.PerspectiveCamera();

    buildLabels();
    stage.onFrame = onFrame;
    stage.onRender = render;
    wirePointer();
    ready = true;
    if (last) draw(last.sim, last.trackedId);
  }

  function init(h) {
    handlers = h || {};
    stage = $('app');
    ov.labels = $('app-labels');
    ov.leaders = $('app-leaders');
    ov.inset = $('app-inset');
    ov.tip = $('app-tip');
    wireTools();
    if (!stage || !stage.ready) return;
    stage.ready.then(build).catch(function (err) { if (root.console) console.error(err); });
  }

  /** Bring the model up to date with the simulation. */
  function draw(sim, trackedId) {
    last = { sim: sim, trackedId: trackedId };
    if (!ready) return;
    var drops = sim.drops, n = drops.length, i, d;
    while (dropMeshes.length < n) {
      var dm = new T.Mesh(dropGeo, dropMat);
      dm.name = 'drop';
      dyn.add(dm);
      dropMeshes.push(dm);
    }
    var tracked = null;
    for (i = 0; i < dropMeshes.length; i++) {
      var mesh_ = dropMeshes[i];
      mesh_.visible = i < n;
      if (i >= n) { mesh_.userData.drop = null; continue; }
      d = drops[i];
      dropPos(d, sim, mesh_.position);
      mesh_.userData.drop = d;
      if (d.id === trackedId) tracked = mesh_;
    }
    ringMesh.visible = !!tracked;
    if (tracked) ringMesh.position.copy(tracked.position);

    // A ring spreads and fades from any drop that has just captured an ion.
    var k = 0;
    for (i = 0; i < n; i++) {
      d = drops[i];
      var age = sim.time - d.changed;
      if (d.above || !(age >= 0 && age < SPARK_T)) continue;
      if (k >= sparkMeshes.length) {
        var sp = new T.Mesh(sparkGeo, new T.MeshBasicMaterial({ color: 0x9c8cff, transparent: true, depthTest: false }));
        sp.renderOrder = 19;
        dyn.add(sp);
        sparkMeshes.push(sp);
      }
      var f = age / SPARK_T, s = sparkMeshes[k++];
      s.visible = true;
      s.position.copy(dropMeshes[i].position);
      s.userData.r = 0.28e-3 + 0.77e-3 * f;
      s.userData.f = f;
      s.material.opacity = 1 - f;
    }
    for (i = k; i < sparkMeshes.length; i++) sparkMeshes[i].visible = false;

    // The puff of mist after a squeeze: from the atomizer's port, in and down to the space above the top plate.
    var t = sim.time - sim.sprayAt, puffing = t >= 0 && t < MIST_T;
    for (i = 0; i < MIST_N; i++) {
      var mm = mistMeshes[i], sd = mistSeeds[i];
      mm.visible = puffing;
      if (!puffing) continue;
      var tt = Math.max(0, t - sd.delay), life = MIST_T - sd.delay, q = clamp(tt / (life * 0.8), 0, 1), e = 1 - (1 - q) * (1 - q);
      var cx = mix(mistFrom.x, 0, 0.55) + sd.bow, cz = mix(mistFrom.z, 0, 0.55) + sd.bow, cy = mistFrom.y - 0.02;
      var tx = mistTo.x + sd.jx, ty = mistTo.y + sd.jy, tz = mistTo.z + sd.jz;
      var a = (1 - e) * (1 - e), b = 2 * (1 - e) * e, c = e * e;
      mm.position.set(a * mistFrom.x + b * cx + c * tx, a * mistFrom.y + b * cy + c * ty, a * mistFrom.z + b * cz + c * tz);
      mm.userData.r = sd.r * (1 + 1.4 * q);
      mm.material.opacity = tt > 0 ? 0.8 * (1 - tt / life) : 0;
    }

    // Field, knife switch and pilot lamp; the meter, counter and knob; the source and its lever.
    fieldGroup.visible = sim.s > 0;
    target.blade = sim.s > 0 ? 0 : 65 * DEG;
    m.pilot.emissiveIntensity = sim.s > 0 ? 2.2 : 0;
    target.needle = (-50 + 100 * clamp(sim.V, 0, V_MAX) / V_MAX) * DEG;
    target.knob = (-135 + 270 * clamp(sim.V, 0, V_MAX) / V_MAX) * DEG;
    var vr = Math.round(sim.V);
    if (counter.shown !== vr) { counter.shown = vr; drawCounter(vr); }
    streakGroup.visible = !!sim.source;
    target.lever = sim.source ? 35 * DEG : -35 * DEG;
    setLabelText('src', 'α source: ' + (sim.source ? 'on' : 'off'));
    target.focus = sim.focus / 1e-3 * Math.PI;
  }

  /** The bulb squeezes for a moment when it is pressed. */
  function squeeze() { squeezeAt = performance.now(); }

  /** Fly into the eyepiece: the camera swings round to its axis and closes in on the lens. */
  function flyToEye() {
    if (!ready) return;
    stopHold();
    setHover(null);
    home = { p: camera.position.clone(), t: controls.target.clone(), fov: camera.fov };
    inEye = true;
    controls.enabled = false;
    startAnim({ p: lensPos.clone().addScaledVector(lensDir, 0.012), t: lensPos.clone().addScaledVector(lensDir, -0.05), fov: 30 }, 900,
      lensPos.clone().addScaledVector(lensDir, 0.22));
  }

  /** And back out: to where the user had put the camera, or to the view reframed for the stage's present shape. */
  function flyHome() {
    if (!ready) return;
    var to = moved && home ? home : viewPose(VIEWS[viewName], stageAspect());
    startAnim(to, 900, lensPos.clone().addScaledVector(lensDir, 0.22), function () { inEye = false; controls.enabled = true; });
  }

  /** Where the eyepiece lens is, in CSS px from the stage's top-left corner. */
  function eyepiecePoint(stageEl) {
    var hr = stage.getBoundingClientRect(), sr = stageEl.getBoundingClientRect();
    if (!ready) return { x: hr.left - sr.left + hr.width / 2, y: hr.top - sr.top + hr.height / 2 };
    camera.updateMatrixWorld();
    V3.copy(lensPos).project(camera);
    return { x: hr.left - sr.left + clamp((V3.x + 1) / 2, 0, 1) * hr.width, y: hr.top - sr.top + clamp((1 - V3.y) / 2, 0, 1) * hr.height };
  }

  /** Where the lens will be once the camera is back home, in a view w × h px. */
  function lensAt(w, h) {
    if (!ready) return { x: w / 2, y: h / 2 };
    var pose = moved && home ? home : viewPose(VIEWS[viewName], w / h);
    tmpCam.fov = pose.fov; tmpCam.aspect = w / h; tmpCam.near = 0.002; tmpCam.far = 30;
    tmpCam.position.copy(pose.p);
    tmpCam.lookAt(pose.t);
    tmpCam.updateMatrixWorld();
    tmpCam.updateProjectionMatrix();
    V3.copy(lensPos).project(tmpCam);
    return { x: clamp((V3.x + 1) / 2, 0, 1) * w, y: clamp((1 - V3.y) / 2, 0, 1) * h };
  }

  /** Height of the view at a given width (it keeps a 16 : 10 shape above its least height). */
  /** Height of the view at a given width: the stylesheet sets it from the window, not the width, so it is the present height. */
  function heightFor(w) {
    var h = stage ? stage.clientHeight || parseFloat(getComputedStyle(stage).height) : 0;
    return h > 0 ? h : w * 10 / 16;
  }

  function fit() { /* the stage follows its own size */ }

  root.Apparatus = { init: init, fit: fit, draw: draw, squeeze: squeeze, eyepiecePoint: eyepiecePoint, lensAt: lensAt, heightFor: heightFor, flyToEye: flyToEye, flyHome: flyHome };
})(window);
