/* Millikan Oil Drop Lab: wires the controls, the two views and their transition, the observer's bench
 * beside the eyepiece, drop tracking, the stopwatch and the automatic timer, the measurements table,
 * the drop properties and the charge analysis.
 */
(function (root) {
  'use strict';

  var P = root.Page, M = root.Model, C = M.C, NB = P.NB, MINUS = P.MINUS;
  var sim = root.Sim.create();
  var V_MAX = 1200;                  // V, the supply's range (the field at full scale matches the old 600 V across 7.60 mm)
  var LINE = 0.5e-3;                 // m between the long reticle lines
  var E19 = 1e-19;

  function $(id) { return document.getElementById(id); }
  var els = {};
  ['spray', 'pause', 'speed', 'reset', 'volts', 'volts-num', 'volts-num-msg', 'field-on', 'field-state', 'source-on', 'source-state', 'focus', 'focus-out', 'view-toggle', 'track-prev', 'track-next', 'track-stop',
    'view-status', 'view-sr', 'results-now', 'bench', 'side', 'side-col', 'stage', 'cutaway-box', 'eyepiece-box', 'eye', 'app', 'stage-caption',
    'sw-display', 'sw-start', 'sw-reset', 'sw-dist', 'sw-motion', 'sw-record', 'sw-msg', 'auto-time', 'record-status',
    'meas-body', 'meas-empty', 'meas-sd-note', 'csv', 'clear-data', 'props-body', 'props-empty', 'trial-e', 'trial-e-out', 'find-e', 'reveal', 'average-on', 'average-state',
    'c-df', 'c-tf', 'c-v', 'c-dr', 'c-tr', 'c-motion', 'c-msg', 'c-s1', 'c-s2', 'c-s3', 'c-s4', 'c-s5', 'c-s6',
    't-count', 't-count-sub', 't-fit', 't-fit-sub', 't-unit', 't-unit-sub', 't-acc', 't-acc-sub', 'ana-status', 'qchart', 'qtip', 'q-body', 'lg-true'
  ].forEach(function (id) { els[id] = $(id); });

  var state = {
    paused: false, speed: 1, view: 'cutaway', zooming: false, trackedId: null, lastFrame: 0,
    nowAt: 0, swAt: 0,
    sw: { running: false, t0: 0, elapsed: 0, key: null, dropId: null, y0: null, n0: null, sourceOn: false, invalid: false },
    run: null, rows: [], nextRow: 1, trialE: 1.0e-19, best: null, reveal: false,
    average: false, exposures: 0        // exposures to the source so far: rows made between two of them share a charge state
  };

  // ---------- formatting ----------

  function fmt(v, d) { return P.fmt(v, d); }
  function e19(q, d) { return fmt(q / E19, d) + ' × 10⁻¹⁹ C'; }
  function fieldKey() { return sim.s === 0 ? 'off' : 'on:' + sim.V; }
  function fieldText(s, V) { return s === 0 ? 'Off' : fmt(V, 0) + NB + 'V'; }
  function dropName(id) { return 'Drop ' + id; }
  function setStatus(el, text) { if (el.textContent !== text) el.textContent = text; }

  // ---------- apparatus controls ----------

  /** A squeeze of the bulb, from the button or from the bulb itself in the cutaway. */
  function doSpray() {
    sim.spray();
    root.Apparatus.squeeze();
    drawViews();
    showNow(true);
  }
  els.spray.addEventListener('click', doSpray);

  els.pause.addEventListener('click', function () {
    state.paused = !state.paused;
    els.pause.textContent = state.paused ? 'Play' : 'Pause';
  });

  els.speed.addEventListener('change', function () { state.speed = parseFloat(els.speed.value) || 1; });

  /** The voltage box shows the supply's setting, unless the user is in the middle of typing a new one. */
  function showVolts() {
    var box = els['volts-num'];
    if (document.activeElement !== box || !box._editing) box.value = String(Math.round(sim.V));
    showResultsNow();
  }

  /** Read a typed plate voltage: 600, 600 V, 1.2 kV, 0.6k. NaN if it cannot be read. */
  function parseVolts(text) {
    var t = String(text).trim().replace(/[−–]/g, '-').replace(/\s+/g, '').replace(/,/g, '').replace(/^\+/, '');
    var m = /^(-?\d*\.?\d+(?:e[-+]?\d+)?)(kv|k|v)?$/i.exec(t);
    if (!m) return NaN;
    var v = parseFloat(m[1]);
    if (m[2] && /^k/i.test(m[2])) v *= 1000;
    return v;
  }

  /** Apply the typed voltage: clamped to the supply's range, with the reason in words; an unreadable entry is flagged. */
  function applyVoltsNum() {
    var box = els['volts-num'], msgEl = els['volts-num-msg'];
    box._editing = false;
    var v = parseVolts(box.value), msg = '';
    if (!isFinite(v)) {
      box.setAttribute('aria-invalid', 'true');
      msgEl.textContent = 'Type a number of volts from 0 to ' + V_MAX + ', such as 600.';
      return;
    }
    v = Math.round(v);
    if (v > V_MAX) { v = V_MAX; msg = 'Set to ' + V_MAX + NB + 'V, the most the supply gives.'; }
    if (v < 0) { v = 0; msg = 'Set to 0' + NB + 'V: the supply cannot reverse the plates.'; }
    box.removeAttribute('aria-invalid');
    msgEl.textContent = msg;
    setVolts(v);
    box.value = String(v);
  }

  /** The line at the top of the results page: how the apparatus stands and what has been measured. */
  function showResultsNow() {
    var el = els['results-now'];
    if (!el) return;
    var rows = state.rows.length, nF = 0, drops = {};
    state.rows.forEach(function (r) { drops[r.dropId] = true; if (r.kind === 'field') nF++; });
    var nD = Object.keys(drops).length;
    var parts = ['Plate voltage ' + fmt(sim.V, 0) + NB + 'V, ' + (sim.s > 0 ? 'field on' : 'plates shorted') + ', source ' + (sim.source ? 'on' : 'off')];
    parts.push(state.trackedId ? 'tracking ' + dropName(state.trackedId).toLowerCase() : 'no drop tracked');
    parts.push(rows ? rows + ' measurement' + (rows === 1 ? '' : 's') + ' on ' + nD + ' drop' + (nD === 1 ? '' : 's') + ', ' + nF + ' with the field on' : 'no measurements yet');
    setStatus(el, 'Apparatus: ' + parts.join('; ') + '.');
  }

  /** Set the plate voltage from the slider or from the arrows on the drawn supply. */
  function setVolts(v) {
    v = Math.max(0, Math.min(V_MAX, Math.round(v)));
    if (v !== sim.V) { endAutoRun(); sim.V = v; }
    if (parseFloat(els.volts.value) !== v) els.volts.value = String(v);
    showVolts();
    drawViews();
    showNow(true);
  }
  els.volts.addEventListener('input', function () {
    els['volts-num'].removeAttribute('aria-invalid');
    els['volts-num-msg'].textContent = '';
    setVolts(parseFloat(els.volts.value));
  });
  els['volts-num'].addEventListener('input', function () { els['volts-num']._editing = true; });
  els['volts-num'].addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); applyVoltsNum(); }
    else if (e.key === 'Escape' && els['volts-num']._editing) {
      // Abandon the edit; this Escape does not also leave presentation mode.
      e.stopPropagation();
      els['volts-num']._editing = false;
      els['volts-num'].removeAttribute('aria-invalid');
      els['volts-num-msg'].textContent = '';
      showVolts();
    }
  });
  els['volts-num'].addEventListener('blur', function () { if (els['volts-num']._editing) applyVoltsNum(); });

  function showSwitch(input, stateEl, on) {
    if (input.checked !== on) input.checked = on;
    if (stateEl.textContent !== (on ? 'On' : 'Off')) stateEl.textContent = on ? 'On' : 'Off';
  }

  function setField(on) {
    var s = on ? 1 : 0;
    showSwitch(els['field-on'], els['field-state'], on);
    if (s === sim.s) return;
    endAutoRun();
    sim.s = s;
    drawViews();
    showNow(true);
    showResultsNow();
  }
  els['field-on'].addEventListener('change', function () { setField(els['field-on'].checked); });

  function setSource(on) {
    showSwitch(els['source-on'], els['source-state'], on);
    if (on === sim.source) return;
    endAutoRun();
    if (on) state.exposures++;
    sim.source = on;
    drawViews();
    showNow(true);
    showResultsNow();
  }
  els['source-on'].addEventListener('change', function () { setSource(els['source-on'].checked); });

  /** The focal plane in words: the scope looks along z, so positive is toward the observer. */
  function showFocus() {
    var f = sim.focus / 1e-3;
    els['focus-out'].textContent = Math.abs(f) < 0.001 ? 'centre of the gap' : fmt(Math.abs(f), 2) + NB + 'mm ' + (f > 0 ? 'nearer' : 'farther');
  }
  els.focus.addEventListener('input', function () {
    sim.focus = parseFloat(els.focus.value) * 1e-3;
    showFocus();
    drawViews();
  });

  /**
   * An in-page confirmation, shown after the row holding the button that asked: the browser's own
   * confirm dialog can be suppressed, and a dialog is not needed for a question this small.
   */
  function askInline(row, message, onYes) {
    var box = row._confirm;
    if (!box) {
      box = document.createElement('div');
      box.className = 'confirm';
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', 'Are you sure');
      var p = document.createElement('p');
      p.className = 'confirm-msg';
      var yes = document.createElement('button'), no = document.createElement('button');
      yes.type = 'button'; yes.className = 'btn'; yes.textContent = 'Yes, Go Ahead';
      no.type = 'button'; no.className = 'btn'; no.textContent = 'Keep Everything';
      box.appendChild(p); box.appendChild(yes); box.appendChild(no);
      row.parentNode.insertBefore(box, row.nextSibling);
      row._confirm = box;
      box._p = p; box._yes = yes;
      function close() { box.hidden = true; if (box._trigger && box._trigger.focus) box._trigger.focus(); }
      no.addEventListener('click', close);
      yes.addEventListener('click', function () { var fn = box._onYes; box._onYes = null; close(); if (fn) fn(); });
      box.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    }
    box._p.textContent = message;
    box._onYes = onYes;
    box._trigger = document.activeElement;
    box.hidden = false;
    box._yes.focus();
  }

  /** Back to the start: no drops, no measurements, the clock at zero and the controls at their defaults. */
  function resetExperiment() {
    if (state.rows.length) {
      askInline(els.reset.parentNode, 'Reset the experiment? This clears the drops, the clock and all ' + state.rows.length + ' measurement' + (state.rows.length === 1 ? '' : 's') + '.', doReset);
      return;
    }
    doReset();
  }

  function doReset() {
    state.run = null;
    sim.clear();
    sim.time = 0;
    sim.changes = 0;
    sim.nextId = 1;
    sim.sprayAt = -Infinity;
    state.trackedId = null;
    state.rows = [];
    state.nextRow = 1;
    state.sw = { running: false, t0: 0, elapsed: 0, key: null, dropId: null, y0: null, n0: null, sourceOn: false, invalid: false };
    els['sw-start'].textContent = 'Start';
    els['sw-msg'].textContent = '';
    els['sw-motion'].value = '-1';
    els['sw-dist'].value = '4';
    sim.V = 600;
    els.volts.value = '600';
    showVolts();
    sim.s = 0;
    showSwitch(els['field-on'], els['field-state'], false);
    sim.source = false;
    showSwitch(els['source-on'], els['source-state'], false);
    sim.focus = 0;
    els.focus.value = '0';
    showFocus();
    els['trial-e'].value = '1.00';
    state.trialE = 1.0e-19;
    showTrialE();
    state.exposures = 0;
    state.average = false;
    showSwitch(els['average-on'], els['average-state'], false);
    if (state.paused) { state.paused = false; els.pause.textContent = 'Pause'; }
    renderRows();
    analyse();
    showStopwatch(true);
    showNow(true);
    drawViews();
    var note = 'Experiment reset: drops, clock and measurements cleared.';
    setStatus(els['view-status'], note);
    // The note goes away at the next click or key press anywhere, if nothing has replaced it by then.
    setTimeout(function () {
      function clear() {
        document.removeEventListener('pointerdown', clear, true);
        document.removeEventListener('keydown', clear, true);
        if (els['view-status'].textContent === note) els['view-status'].textContent = '';
      }
      document.addEventListener('pointerdown', clear, true);
      document.addEventListener('keydown', clear, true);
    }, 0);
  }
  els.reset.addEventListener('click', resetExperiment);

  // ---------- tracking ----------

  function setTracked(id, message) {
    if (id !== state.trackedId) {
      endAutoRun();
      state.trackedId = id;
    }
    setStatus(els['view-status'], message || (id ? 'Tracking ' + dropName(id).toLowerCase() + '.' : 'Not tracking a drop.'));
    drawViews();
    showNow(true);
    showResultsNow();
  }

  function trackStep(delta) {
    var list = sim.inViewDrops();
    if (!list.length) { setTracked(null, 'No drops in view. Spray some, or wait for them to drift in.'); return; }
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === state.trackedId) idx = i;
    var next = idx < 0 ? (delta > 0 ? 0 : list.length - 1) : (idx + delta + list.length) % list.length;
    var d = list[next];
    setTracked(d.id, 'Tracking ' + dropName(d.id).toLowerCase() + ', ' + (next + 1) + ' of ' + list.length + ' in view.');
  }

  els['track-next'].addEventListener('click', function () { trackStep(1); });
  els['track-prev'].addEventListener('click', function () { trackStep(-1); });
  els['track-stop'].addEventListener('click', function () { setTracked(null); });

  els.eye.addEventListener('click', function (e) {
    var pt = root.Eyepiece.pointToField(e.clientX, e.clientY);
    if (!pt) return;
    var d = sim.nearest(pt.x, pt.y, 0.14e-3);
    if (d) setTracked(d.id);
    else setStatus(els['view-status'], 'No drop there. Click closer to a point of light.');
  });

  // In the cutaway too, a click on or near a drop tracks it; the model reports the clicks (see Apparatus.init below).
  function pickInCutaway(hit) {
    if (state.view !== 'cutaway' || state.zooming) return;
    if (hit.drop) setTracked(hit.drop.id);
    else if (hit.inGap) setStatus(els['view-status'], 'No drop there. Click closer to a drop.');
  }

  // ---------- the two views and the bench ----------

  function drawViews() {
    if (state.view === 'cutaway' || state.zooming) root.Apparatus.draw(sim, state.trackedId);
    if (state.view === 'eye' || state.zooming) root.Eyepiece.draw(sim, state.trackedId);
  }

  /** The focus and the stopwatch sit beside the eyepiece; the bench's column opens and closes with the view. */
  function setSide(on) {
    els.bench.classList.toggle('with-side', on);
    P.queueLayout();
  }

  function wideBench() { return !!(root.matchMedia && root.matchMedia('(min-width: 981px)').matches); }

  /** Offset of the eyepiece lens from the stage's centre, for a stage of the given width (the layout after the bench closes). */
  function lensOffsetAt(stageWidth) {
    var viewH = root.Apparatus.heightFor(stageWidth);
    var minH = els.stage.classList.contains('eye-size') ? parseFloat(getComputedStyle(els.stage).minHeight) || 0 : 0;
    var stageH = Math.max(viewH, minH), lens = root.Apparatus.lensAt(stageWidth, viewH);
    return { x: lens.x - stageWidth / 2, y: lens.y - stageH / 2 };
  }

  /** Run fn when the box's transform transition ends (or after 1.1 s if that never comes). */
  function afterTransition(box, fn) {
    var done = false;
    function finish(e) {
      if (done || (e && e.propertyName && e.propertyName !== 'transform')) return;
      done = true;
      box.removeEventListener('transitionend', finish);
      fn();
    }
    box.addEventListener('transitionend', finish);
    setTimeout(finish, 1100);
  }

  function setView(eye) {
    if (state.zooming || eye === (state.view === 'eye')) return;
    var stage = els.stage, eyeBox = els['eyepiece-box'], cutBox = els['cutaway-box'];
    state.zooming = true;
    els['view-toggle'].disabled = true;
    var col = els['side-col'], wide = wideBench();
    if (eye) {
      // The eyepiece view starts as a speck on the lens of the drawing as it now sits and grows into place,
      // while the bench's column opens beside it over the same time, so the stage narrows smoothly.
      var p = root.Apparatus.eyepiecePoint(stage), sr = stage.getBoundingClientRect();
      stage.style.setProperty('--tx', (p.x - sr.width / 2).toFixed(1) + 'px');
      stage.style.setProperty('--ty', (p.y - sr.height / 2).toFixed(1) + 'px');
      eyeBox.hidden = false;
      root.Eyepiece.layout();
      root.Eyepiece.draw(sim, state.trackedId);
      var panelH = 0;
      if (wide) {
        // The panel takes its final width now, so its text is laid out once; the column grows from nothing to that height.
        els.side.style.width = ((els.bench.getBoundingClientRect().width - 24) / 2.35).toFixed(1) + 'px';
        col.style.height = '0px';
        void stage.offsetWidth;
        panelH = els.side.offsetHeight;
      }
      void stage.offsetWidth;                      // commit the start state before the transition
      root.Apparatus.flyToEye();                   // the camera closes in on the eyepiece while the view fades
      stage.classList.add('is-zooming');
      stage.classList.add('in-eye');
      stage.classList.add('eye-size');
      setSide(true);
      if (wide) col.style.height = panelH + 'px';
      setStatus(els['view-sr'], 'Eyepiece view.');
      afterTransition(eyeBox, function () {
        stage.classList.remove('is-zooming');
        cutBox.style.visibility = 'hidden';
        cutBox.setAttribute('aria-hidden', 'true');
        col.style.height = '';
        els.side.style.width = '';
        state.zooming = false;
        state.view = 'eye';
        els['view-toggle'].textContent = 'Step Back to the Cutaway';
        els['view-toggle'].disabled = false;
        root.Eyepiece.layout();
        drawViews();
      });
    } else {
      // The eyepiece view shrinks back onto the lens of the full-width drawing while the bench's column closes.
      endAutoRun();
      cutBox.style.visibility = '';
      cutBox.removeAttribute('aria-hidden');
      root.Apparatus.draw(sim, state.trackedId);
      var off = lensOffsetAt(els.bench.getBoundingClientRect().width);
      root.Apparatus.flyHome();
      stage.style.setProperty('--tx', off.x.toFixed(1) + 'px');
      stage.style.setProperty('--ty', off.y.toFixed(1) + 'px');
      if (wide) {
        els.side.style.width = els.side.getBoundingClientRect().width.toFixed(1) + 'px';
        col.style.height = col.offsetHeight + 'px';
      }
      void stage.offsetWidth;
      stage.classList.add('is-zooming');
      stage.classList.remove('in-eye');
      setSide(false);
      if (wide) col.style.height = '0px';
      setStatus(els['view-sr'], 'Cutaway view.');
      afterTransition(eyeBox, function () {
        stage.classList.remove('is-zooming');
        eyeBox.hidden = true;
        stage.classList.remove('eye-size');
        col.style.height = '';
        els.side.style.width = '';
        state.zooming = false;
        state.view = 'cutaway';
        els['view-toggle'].textContent = 'Look Into the Eyepiece';
        els['view-toggle'].disabled = false;
        root.Apparatus.fit();
        drawViews();
      });
    }
  }

  els['view-toggle'].addEventListener('click', function () { setView(state.view !== 'eye'); });

  // ---------- readouts ----------

  /** The running caption under the stage: clock, drops in view, and the tracked drop's position (not a live region). */
  function showNow(force) {
    if (!force && sim.time - state.nowAt < 0.2 && state.nowAt <= sim.time) return;
    state.nowAt = sim.time;
    var inView = sim.inViewDrops().length, counts = sim.counts();
    var parts = ['Clock ' + fmt(sim.time, 1) + NB + 's', inView + ' of ' + counts.gap + ' drop' + (counts.gap === 1 ? '' : 's') + ' in view' + (counts.above ? ' (' + counts.above + ' still above the top plate)' : '')];
    var d = state.trackedId ? sim.byId(state.trackedId) : null;
    if (d) {
      var y = (d.y - C.d / 2) / 1e-3, v = sim.velocityOf(d), where = sim.inView(d) ? '' : ', out of view';
      var motion = Math.abs(v) < 2e-6 ? 'about still' : v > 0 ? 'rising' : 'falling';
      var puff = sim.settled(d) ? '' : ', still carried by the puff of air from the spray';
      var since = sim.time - d.changed, changed = since < 6 ? ' (charge changed ' + (since < 1 ? 'just now' : fmt(since, 0) + NB + 's ago') + ')' : '';
      parts.push(dropName(d.id) + ': ' + fmt(Math.abs(y), 2) + NB + 'mm ' + (y >= 0 ? 'above' : 'below') + ' the centre, ' + motion + puff + where + changed);
    } else parts.push('No drop tracked');
    setStatus(els['stage-caption'], parts.join(' · '));
  }

  // ---------- stopwatch ----------

  function swTime() { return state.sw.running ? sim.time - state.sw.t0 : state.sw.elapsed; }

  function showStopwatch(force) {
    if (!force && sim.time - state.swAt < 0.1 && state.swAt <= sim.time) return;
    state.swAt = sim.time;
    setStatus(els['sw-display'], fmt(swTime(), 2) + NB + 's');
  }

  els['sw-start'].addEventListener('click', function () {
    var sw = state.sw, d = state.trackedId ? sim.byId(state.trackedId) : null;
    if (!sw.running) {
      sw.running = true;
      sw.t0 = sim.time;
      sw.key = fieldKey();
      sw.dropId = state.trackedId;
      sw.y0 = d ? d.y : null;
      sw.n0 = d ? d.n : null;
      sw.sourceOn = sim.source;
      sw.invalid = false;
      els['sw-start'].textContent = 'Stop';
      els['sw-msg'].textContent = '';
    } else {
      sw.running = false;
      sw.elapsed = sim.time - sw.t0;
      els['sw-start'].textContent = 'Start';
      if (d && d.id === sw.dropId && sw.y0 !== null) els['sw-motion'].value = d.y < sw.y0 ? '-1' : '1';
      if (fieldKey() !== sw.key) { sw.invalid = true; els['sw-msg'].textContent = 'The field changed while the watch ran. Reset it and time the drop again.'; }
      else if (sim.source || sw.sourceOn) { sw.invalid = true; els['sw-msg'].textContent = 'The source was on while the watch ran, so the charge may have changed. Reset it and time the drop again with the source off.'; }
    }
    showStopwatch(true);
  });

  els['sw-reset'].addEventListener('click', function () {
    state.sw.running = false;
    state.sw.elapsed = 0;
    state.sw.invalid = false;
    els['sw-start'].textContent = 'Start';
    els['sw-msg'].textContent = '';
    showStopwatch(true);
  });

  els['sw-record'].addEventListener('click', function () {
    var sw = state.sw, msg = '';
    if (sw.running) msg = 'Stop the watch first.';
    else if (!(sw.elapsed > 0)) msg = 'Start and stop the watch as the drop crosses the reticle lines, then record.';
    else if (sw.invalid) msg = 'That timing cannot be used. Reset the watch and time the drop again.';
    else if (!sw.dropId) msg = 'No drop was being tracked when the watch started. Track a drop, then time it.';
    else if (fieldKey() !== sw.key) msg = 'The field has changed since the timing. Set it back to ' + (sw.key === 'off' ? 'off' : fieldText(1, parseFloat(sw.key.slice(3)))) + ' to record it, or time the drop again.';
    if (msg) { els['sw-msg'].textContent = msg; return; }
    els['sw-msg'].textContent = '';
    var dist = parseInt(els['sw-dist'].value, 10) * LINE, time = sw.elapsed;
    var off = sw.key === 'off', s = off ? 0 : 1, V = off ? 0 : parseFloat(sw.key.slice(3));
    var dir = off ? -1 : parseInt(els['sw-motion'].value, 10);
    var dNow = sim.byId(sw.dropId), mixed = !(dNow && dNow.n === sw.n0);
    addRow({ dropId: sw.dropId, kind: off ? 'fall' : 'field', s: s, V: V, dist: dist, time: time, vy: dir * dist / time, how: 'stopwatch',
      trueN: mixed ? null : sw.n0, mixed: mixed });
    sw.elapsed = 0;
    showStopwatch(true);
  });

  // ---------- automatic timing of reticle crossings ----------

  /**
   * A run is a stretch of steady motion of the tracked drop, in one direction under one field setting.
   * Each time the drop has crossed as many long lines as the Distance timed asks for, the interval is
   * recorded and a new one starts at that line; a run cut short is dropped, not recorded.
   */
  function autoStep(prevT, prevY, t, y, d) {
    // Nothing can be timed once the drop is out of view, or while the puff of air from the spray still carries it.
    if (!sim.inView(d) || !sim.settled(d)) { endAutoRun(); return; }
    var k0 = Math.floor(prevY / LINE), k1 = Math.floor(y / LINE);
    if (k0 === k1) return;
    var dir = y > prevY ? 1 : -1, lineIdx = dir > 0 ? k1 : k0;
    if (Math.abs(lineIdx) > 2) return;                   // only the lines inside the field can be watched
    var yb = lineIdx * LINE, tc = prevT + (t - prevT) * (yb - prevY) / (y - prevY);
    var key = fieldKey(), run = state.run;
    if (run && (run.key !== key || run.dir !== dir || run.dropId !== state.trackedId)) { endAutoRun(); run = null; }
    if (!run) {
      state.run = { dropId: state.trackedId, key: key, s: sim.s, V: sim.V, dir: dir, t0: tc, k0: lineIdx, k1: lineIdx, count: 0, n: d.n, mixed: false };
      return;
    }
    if (lineIdx === run.k1) return;            // Brownian jitter back and forth across one line
    if (d.n !== run.n) run.mixed = true;        // a stray ion changed the charge part way (instructor check)
    run.k1 = lineIdx;
    run.count++;
    var wanted = parseInt(els['sw-dist'].value, 10) || 1;
    if (run.count < wanted) return;
    var dist = Math.abs(run.k1 - run.k0) * LINE, time = tc - run.t0;
    if (time > 0) {
      addRow({ dropId: run.dropId, kind: run.key === 'off' ? 'fall' : 'field', s: run.s, V: run.V, dist: dist, time: time, vy: run.dir * dist / time, how: 'auto',
        trueN: run.mixed ? null : run.n, mixed: run.mixed });
    }
    run.t0 = tc;                               // the next interval starts at this line
    run.k0 = lineIdx;
    run.count = 0;
    run.n = d.n;
    run.mixed = false;
  }

  /** Close the current run; a stretch shorter than the Distance timed is not recorded. */
  function endAutoRun() {
    state.run = null;
  }

  els['auto-time'].addEventListener('change', function () { if (!els['auto-time'].checked) endAutoRun(); });

  // ---------- measurements ----------

  function addRow(row) {
    row.id = state.nextRow++;
    row.epoch = state.exposures;
    state.rows.push(row);
    renderRows();
    analyse();
    var sd = speedSd(row), pct = isFinite(sd) && row.vy ? sd / Math.abs(row.vy) * 100 : NaN;
    setStatus(els['record-status'], 'Recorded: ' + dropName(row.dropId).toLowerCase() + (row.kind === 'fall' ? ' falling, field off, ' : (row.vy > 0 ? ' rising, ' : ' falling, ') + fmt(row.V, 0) + NB + 'V, ') +
      fmt(row.dist * 1000, 3) + NB + 'mm in ' + fmt(row.time, 2) + NB + 's' + (isFinite(pct) ? ', Brownian scatter about ' + fmt(pct, 1) + NB + '%' : '') + '.');
  }

  function removeRow(id) {
    state.rows = state.rows.filter(function (r) { return r.id !== id; });
    renderRows();
    analyse();
  }

  /** Mean fall speed (m/s) of a drop from its field-off rows, with the count, or NaN. */
  function fallOf(dropId) {
    var sum = 0, n = 0;
    state.rows.forEach(function (r) { if (r.dropId === dropId && r.kind === 'fall') { sum += r.dist / r.time; n++; } });
    return { vf: n ? sum / n : NaN, n: n };
  }

  function chargeOf(row) {
    if (row.kind !== 'field') return NaN;
    return M.charge(fallOf(row.dropId).vf, row.vy, row.s, row.V);
  }

  // ---------- the scatter Brownian motion puts into a timing ----------

  /** Relative scatter (one standard deviation) of a speed timed over dist in time: the rms random displacement over the distance. */
  function brownianRel(r, dist, time) { return Math.sqrt(2 * M.diffusion(r) * time) / dist; }

  /** The drop's radius from its mean fall speed, or NaN before any fall is timed. */
  function radiusOf(dropId) {
    var f = fallOf(dropId);
    return f.n ? M.radiusFromFall(f.vf) : NaN;
  }

  /** Relative scatter of a drop's mean fall speed: its fall rows combined, each with its own scatter. */
  function fallRel(dropId) {
    var r = radiusOf(dropId), sum = 0, n = 0;
    if (!isFinite(r)) return NaN;
    state.rows.forEach(function (row) {
      if (row.dropId !== dropId || row.kind !== 'fall') return;
      var rel = brownianRel(r, row.dist, row.time);
      sum += rel * rel;
      n++;
    });
    return n ? Math.sqrt(sum) / n : NaN;
  }

  /** Expected scatter of a row's speed, m/s. */
  function speedSd(row) {
    var r = radiusOf(row.dropId);
    return isFinite(r) ? brownianRel(r, row.dist, row.time) * Math.abs(row.vy) : NaN;
  }

  /**
   * Expected scatter of a field-on row's charge, in coulombs, in two parts: from the scatter of its own
   * speed (independent from run to run) and from that of the drop's mean fall speed (shared by every run
   * of the drop). With q = K m(v_f) (v_f + v) / v_f, the two sensitivities are dq/dv = K m / v_f and
   * dq/dv_f = (K m / v_f) (k (v_f + v) - v) / v_f, where k = d ln m / d ln v_f.
   */
  function chargeSdParts(row) {
    var none = { own: NaN, fall: NaN };
    if (row.kind !== 'field' || !(row.V > 0)) return none;
    var f = fallOf(row.dropId);
    if (!f.n) return none;
    var r = M.radiusFromFall(f.vf), h = C.b / (2 * C.p);
    var A = M.mass(r) * C.g * C.d / row.V / f.vf;
    var k = 3 * (r + 2 * h) / (2 * (r + h));
    var dv = brownianRel(r, row.dist, row.time) * Math.abs(row.vy);
    var dvf = fallRel(row.dropId) * f.vf;
    return { own: A * dv, fall: A * Math.abs(k * (f.vf + row.vy) - row.vy) * dvf / f.vf };
  }

  function chargeSd(row) {
    var p = chargeSdParts(row);
    return Math.hypot(p.own, p.fall);
  }

  function cell(tr, text, cls) {
    var td = document.createElement('td');
    if (cls) td.className = cls;
    td.textContent = text;
    tr.appendChild(td);
    return td;
  }

  function renderRows() {
    var body = els['meas-body'];
    body.textContent = '';
    state.rows.forEach(function (r) {
      var tr = document.createElement('tr');
      cell(tr, dropName(r.dropId), 'text');
      cell(tr, fieldText(r.s, r.V), 'text');
      cell(tr, r.vy > 0 ? 'Rising' : 'Falling', 'text');
      cell(tr, fmt(r.dist * 1000, 3));
      cell(tr, fmt(r.time, 2));
      var sdv = speedSd(r);
      cell(tr, fmt(Math.abs(r.vy) * 1000, 4) + (isFinite(sdv) ? NB + '±' + NB + fmt(sdv * 1000, 4) : ''));
      var q = chargeOf(r), sdq = chargeSd(r);
      cell(tr, r.kind === 'fall' ? '' : isFinite(q) ? fmt(Math.abs(q) / E19, 2) + (isFinite(sdq) ? NB + '±' + NB + fmt(sdq / E19, 2) : '') + (q > 0 ? ' (positive)' : '') : 'needs a fall');
      cell(tr, r.how === 'auto' ? 'Automatic' : 'Stopwatch', 'text');
      var td = document.createElement('td');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn row-remove';
      btn.textContent = 'Remove';
      btn.setAttribute('aria-label', 'Remove measurement ' + r.id + ', ' + dropName(r.dropId).toLowerCase());
      btn.addEventListener('click', function () { removeRow(r.id); });
      td.appendChild(btn);
      tr.appendChild(td);
      body.appendChild(tr);
    });
    els['meas-empty'].hidden = state.rows.length > 0;
    els['meas-sd-note'].hidden = !state.rows.length;
  }

  els['clear-data'].addEventListener('click', function () {
    if (!state.rows.length) return;
    askInline(els['clear-data'].parentNode, 'Clear all ' + state.rows.length + ' measurement' + (state.rows.length === 1 ? '' : 's') + '?', function () {
      state.rows = [];
      state.run = null;
      renderRows();
      analyse();
      setStatus(els['record-status'], 'All measurements cleared.');
    });
  });

  els.csv.addEventListener('click', function () {
    var lines = ['row,drop,field,voltage_V,motion,distance_mm,time_s,speed_mm_per_s,speed_sd_mm_per_s,radius_um,mass_kg,charge_1e-19_C,charge_sd_1e-19_C,charge_sign,how'];
    state.rows.forEach(function (r) {
      var q = chargeOf(r), f = fallOf(r.dropId), rad = isFinite(f.vf) ? M.radiusFromFall(f.vf) : NaN, sdv = speedSd(r), sdq = chargeSd(r);
      lines.push([r.id, r.dropId, r.s === 0 ? 'off' : 'on', r.V, r.vy > 0 ? 'rising' : 'falling',
        (r.dist * 1000).toFixed(3), r.time.toFixed(3), (Math.abs(r.vy) * 1000).toFixed(5), isFinite(sdv) ? (sdv * 1000).toFixed(5) : '',
        isFinite(rad) ? (rad * 1e6).toFixed(4) : '', isFinite(rad) ? M.mass(rad).toExponential(4) : '',
        isFinite(q) ? (Math.abs(q) / E19).toFixed(4) : '', isFinite(sdq) ? (sdq / E19).toFixed(4) : '',
        isFinite(q) ? (q > 0 ? 'positive' : 'negative') : '', r.how].join(','));
    });
    var blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'millikan-measurements.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });

  // ---------- drop properties ----------

  function renderProps() {
    var body = els['props-body'], ids = [];
    state.rows.forEach(function (r) { if (ids.indexOf(r.dropId) < 0) ids.push(r.dropId); });
    body.textContent = '';
    var shown = 0;
    ids.forEach(function (id) {
      var f = fallOf(id);
      if (!f.n) return;
      var r = M.radiusFromFall(f.vf), m = M.mass(r), charges = 0;
      state.rows.forEach(function (row) { if (row.dropId === id && isFinite(chargeOf(row))) charges++; });
      var tr = document.createElement('tr'), rel = fallRel(id);
      cell(tr, dropName(id), 'text');
      cell(tr, String(f.n));
      cell(tr, fmt(f.vf * 1000, 4) + (isFinite(rel) ? NB + '±' + NB + fmt(rel * f.vf * 1000, 4) : ''));
      cell(tr, fmt(r * 1e6, 3));
      cell(tr, fmt(m * 1e15, 3));
      cell(tr, String(charges));
      body.appendChild(tr);
      shown++;
    });
    els['props-empty'].hidden = shown > 0;
  }

  // ---------- charge calculation, step by step from typed numbers ----------

  // The equations are MathML, part of HTML: fractions, roots and exponents laid out as an equation
  // editor would, in the system's math font. Each <math> line carries a linear text version in alttext.
  var MML = 'http://www.w3.org/1998/Math/MathML';

  function me(tag, text) {
    var e = document.createElementNS(MML, tag);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function mi(s) { return me('mi', s); }
  function mn(s) { return me('mn', s); }
  function mo(s) { return me('mo', s); }
  function wrap(tag, parts) {
    var e = me(tag);
    parts.forEach(function (p) { e.appendChild(typeof p === 'string' ? mo(p) : p); });
    return e;
  }
  function row() { return wrap('mrow', Array.prototype.slice.call(arguments)); }
  function frac(n, d) { return wrap('mfrac', [n, d]); }
  function sqrtOf() { return wrap('msqrt', Array.prototype.slice.call(arguments)); }
  function sub(b, s) { return wrap('msub', [b, typeof s === 'string' ? mi(s) : s]); }
  function sup(b, s) { return wrap('msup', [b, typeof s === 'string' ? mn(s) : s]); }
  function paren() { return row.apply(null, ['('].concat(Array.prototype.slice.call(arguments), [')'])); }
  /** |x| with bars that do not stretch: a lone "|" before a tall fraction is taken for a fence and grows to its height. */
  function abs(x) {
    var l = mo('|'), r = mo('|');
    l.setAttribute('stretchy', 'false');
    r.setAttribute('stretchy', 'false');
    return row(l, x, r);
  }

  /** The linear text of a MathML tree, for the alttext: (numerator) ÷ (denominator), √(…), base^exponent, base_subscript. */
  function linear(n) {
    var t = n.tagName ? n.tagName.toLowerCase() : '';
    var kids = Array.prototype.map.call(n.childNodes, linear);
    if (t === 'mfrac') return '(' + kids[0] + ') ÷ (' + kids[1] + ')';
    if (t === 'msqrt') return '√(' + kids.join(' ') + ')';
    if (t === 'msup') return kids[0] + '^' + kids[1];
    if (t === 'msub') return kids[0] + '_' + kids[1];
    if (t === 'mrow' || t === 'math') return kids.join(' ');
    return (n.textContent || '').trim();
  }

  /** Add one equation line to a step; a line that starts with "=" continues the one above and is indented. */
  function eq(box) {
    var parts = Array.prototype.slice.call(arguments, 1), r = row.apply(null, parts);
    var m = me('math');
    m.setAttribute('alttext', linear(r));
    m.appendChild(r);
    var line = document.createElement('div');
    line.className = 'eq' + (parts[0] === '=' ? ' eq-cont' : '');
    line.appendChild(m);
    box.appendChild(line);
  }

  /**
   * Add a sentence to a step. What the step is waiting for goes into the slot under its title, above the
   * formula; what a result means goes among the working.
   */
  function note(box, text, pending) {
    if (pending) {
      var slot = box.parentNode.querySelector('.calc-pending');
      slot.textContent = text;
      slot.hidden = false;
      return;
    }
    var p = document.createElement('p');
    p.className = 'calc-why';
    p.textContent = text;
    box.appendChild(p);
  }

  var SUPS = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };

  /** A number in scientific notation as plain text with superscript digits, for the definitions. */
  function sciText(x, sig, u) {
    var exp = Math.floor(Math.log10(Math.abs(x))), mant = x / Math.pow(10, exp);
    if (Math.abs(Number(mant.toFixed(sig - 1))) >= 10) { exp++; mant /= 10; }
    var e = String(exp).split('').map(function (ch) { return SUPS[ch]; }).join('');
    return fmt(mant, sig - 1) + ' × 10' + e + (u ? NB + u : '');
  }

  /**
   * What each symbol in a step stands for: rows of [symbol (MathML node), meaning, value]. The value is
   * the given constant, the number typed above, or null for a quantity this exercise works out.
   */
  function terms(box, rows) {
    var dl = document.createElement('dl');
    dl.className = 'terms';
    rows.forEach(function (t) {
      var div = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
      var m = me('math');
      var r = row(t[0]);
      m.setAttribute('alttext', linear(r));
      m.appendChild(r);
      dt.appendChild(m);
      dd.appendChild(document.createTextNode(t[1]));
      if (t[2]) {
        dd.appendChild(document.createTextNode(': '));
        var v = document.createElement('span');
        v.className = 'given';
        v.textContent = t[2];
        dd.appendChild(v);
      }
      div.appendChild(dt);
      div.appendChild(dd);
      dl.appendChild(div);
    });
    box.appendChild(dl);
  }

  /** The typed value as a number, null when empty, NaN when unreadable; accepts a comma and a true minus. */
  function typed(el) {
    var s = el.value.trim().replace(/−/g, '-').replace(',', '.');
    if (!s) return null;
    var v = Number(s);
    return isFinite(v) ? v : NaN;
  }

  function calc() {
    var fields = [
      ['c-df', 'fall distance'], ['c-tf', 'fall time'], ['c-v', 'plate voltage'], ['c-dr', 'distance with the field on'], ['c-tr', 'time with the field on']
    ];
    var vals = {}, bad = [];
    fields.forEach(function (f) {
      var v = typed(els[f[0]]);
      var invalid = v !== null && !(v > 0);
      els[f[0]].setAttribute('aria-invalid', invalid ? 'true' : 'false');
      if (invalid) bad.push(f[1]);
      vals[f[0]] = v > 0 ? v : null;
    });
    var msg = bad.length ? 'Each value must be a number greater than zero: check the ' + bad.join(', ') + '.' : '';
    if (els['c-msg'].textContent !== msg) els['c-msg'].textContent = msg;

    var df = vals['c-df'], tf = vals['c-tf'], V = vals['c-v'], dr = vals['c-dr'], tr = vals['c-tr'];
    var dir = parseInt(els['c-motion'].value, 10);
    var rho = C.rhoOil - C.rhoAir, eta = M.viscosity(C.T);
    var vf = null, r = null, m = null, v = null, E = null, q = null;
    var s = {};
    for (var i = 1; i <= 6; i++) {
      s[i] = els['c-s' + i].querySelector('.calc-lines');
      s[i].textContent = '';
      var pend = els['c-s' + i].querySelector('.calc-pending');
      pend.textContent = '';
      pend.hidden = true;
    }
    var vF = sub(mi('v'), 'f');
    var worked = state.worked = {};
    var measured = function (v, d, u) { return v ? 'your measurement, typed above: ' + fmt(v, d) + NB + u : 'your measurement, typed above'; };
    var GIVEN = {
      eta: ['the viscosity of the air at the chamber’s ' + fmt(C.T - 273.15, 1) + NB + '°C (given)', sciText(eta, 3, 'Pa·s')],
      rho: ['the density of the oil less that of the air it displaces, ' + fmt(C.rhoOil, 0) + ' − ' + fmt(C.rhoAir, 1) + ' (given)', fmt(rho, 1) + NB + 'kg/m³'],
      g: ['the acceleration of gravity (given)', fmt(C.g, 2) + NB + 'm/s²'],
      b: ['the constant in the Cunningham slip correction, needed because these drops are not much larger than the distance an air molecule travels between collisions (given)', sciText(C.b, 3, 'Pa·m')],
      p: ['the air pressure in the chamber (given)', sciText(C.p, 4, 'Pa')],
      d: ['the separation of the plates (given)', fmt(C.d * 1000, 2) + NB + 'mm = ' + sciText(C.d, 3, 'm')]
    };

    // The page works each value out only to check the worksheets; the working itself is left to the student.
    // 1. Fall speed.
    terms(s[1], [
      [vF.cloneNode(true), 'the drop’s steady fall speed with the plates shorted; found in this step', null],
      [sub(mi('D'), 'f'), 'the distance the drop fell between the reticle lines you timed; ' + measured(df, 3, 'mm'), null],
      [sub(mi('t'), 'f'), 'the time it took to fall that far; ' + measured(tf, 2, 's'), null]
    ]);
    if (df && tf) vf = worked.vf = df / 1000 / tf;
    else note(s[1], 'Enter the fall distance and the fall time.', true);

    // 2. Radius.
    terms(s[2], [
      [mi('r'), 'the radius of the drop; found in this step', null],
      [vF.cloneNode(true), 'the fall speed from step 1', null],
      [mi('η'), GIVEN.eta[0], GIVEN.eta[1]],
      [mi('ρ'), GIVEN.rho[0], GIVEN.rho[1]],
      [mi('g'), GIVEN.g[0], GIVEN.g[1]],
      [mi('b'), GIVEN.b[0], GIVEN.b[1]],
      [mi('p'), GIVEN.p[0], GIVEN.p[1]]
    ]);
    if (vf) r = worked.r = M.radiusFromFall(vf);
    else note(s[2], 'Needs the fall speed from step 1.', true);

    // 3. Mass.
    terms(s[3], [
      [mi('m'), 'the mass of the drop, the volume of a sphere times the density; found in this step', null],
      [mi('r'), 'the radius from step 2', null],
      [mi('ρ'), GIVEN.rho[0], GIVEN.rho[1]]
    ]);
    if (r) m = worked.m = M.mass(r);
    else note(s[3], 'Needs the radius from step 2.', true);

    // 4. Velocity with the field on.
    terms(s[4], [
      [mi('v'), 'the drop’s steady velocity with the field on, up positive; found in this step', null],
      [mi('D'), 'the distance it moved between the reticle lines you timed; ' + measured(dr, 3, 'mm'), null],
      [mi('t'), 'the time it took; ' + measured(tr, 2, 's'), null],
      [mo('±'), '+ for a drop that rose, − for one that fell; your observation, chosen above: ' + (dir > 0 ? 'rising' : 'falling'), null]
    ]);
    if (dr && tr) v = worked.v = dir * dr / 1000 / tr;
    else note(s[4], 'Enter the distance and time with the field on, and whether the drop rose or fell.', true);

    // 5. Field.
    terms(s[5], [
      [mi('E'), 'the electric field between the plates, the voltage divided by the gap; found in this step', null],
      [mi('V'), 'the plate voltage you set; ' + measured(V, 0, 'V'), null],
      [mi('d'), GIVEN.d[0], GIVEN.d[1]]
    ]);
    if (V) E = worked.E = V / C.d;
    else note(s[5], 'Enter the plate voltage.', true);
    note(s[5], 'The field points down, from the positive top plate to the negative bottom plate.');

    // 6. Charge.
    terms(s[6], [
      [mi('q'), 'the charge on the drop, from the balance of its weight, the drag and the electric force; found in this step', null],
      [mi('m'), 'the mass from step 3', null],
      [mi('g'), GIVEN.g[0], GIVEN.g[1]],
      [mi('v'), 'the velocity with the field on from step 4', null],
      [vF.cloneNode(true), 'the fall speed from step 1', null],
      [mi('E'), 'the electric field from step 5', null]
    ]);
    if (m && v !== null && E) {
      q = worked.q = M.charge(vf, v, 1, V);
      note(s[6], q < 0 ? (v > 0 ? 'The drop rose against a field that points down, so its charge is negative.' : 'The drop fell more slowly than with the field off, so the field held it back and its charge is negative.')
        : q > 0 ? 'The drop fell faster than with the field off, so the field pushed it down and its charge is positive.' : 'The drop moved exactly as it does with the field off, so its charge is zero.');
      note(s[6], 'The worksheet gives the size of the charge; with its sign it is one charge for the Charge Analysis panel, where the charges of many drops together reveal the unit they are all multiples of.');
    } else note(s[6], 'Needs the mass from step 3, the velocity from step 4 and the field from step 5.', true);
    checkWorksheets();
  }

  ['c-df', 'c-tf', 'c-v', 'c-dr', 'c-tr'].forEach(function (id) { els[id].addEventListener('input', calc); });
  els['c-motion'].addEventListener('change', calc);

  // ---------- worksheets: each equation again, with boxes to type your own values into ----------

  var SUPS_IN = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+' };
  var UNIT_WORDS = {
    'mm': 'millimetres', 's': 'seconds', 'm/s': 'metres per second', 'm': 'metres', 'm²': 'square metres', 'kg': 'kilograms',
    'N': 'newtons', 'V': 'volts', 'V/m': 'volts per metre', 'C': 'coulombs', 'Pa·m': 'pascal metres', 'Pa': 'pascals',
    'Pa·s': 'pascal seconds', 'm/s²': 'metres per second squared', 'kg/m³': 'kilograms per cubic metre'
  };

  /** A typed number: plain, 1.82e-5, or 1.82 × 10⁻⁵ (also x, *, ^); null when empty, NaN when unreadable. */
  function parseNum(str) {
    var s = String(str).trim().replace(/−/g, '-').replace(/,/g, '.');
    if (!s) return null;
    s = s.replace(/10\s*([⁰-⁹¹²³⁺⁻]+)/g, function (all, sup) {
      return '10^' + sup.split('').map(function (c) { return SUPS_IN[c] || ''; }).join('');
    });
    var m = s.match(/^([-+]?\d*\.?\d+)\s*(?:[×xX*]\s*10\s*\^?\s*([-+]?\d+))?$/);
    if (m) return parseFloat(m[1]) * (m[2] !== undefined ? Math.pow(10, parseInt(m[2], 10)) : 1);
    var v = Number(s);
    return isFinite(v) ? v : NaN;
  }

  var sheets = [];

  function fxEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /**
   * Render the parts of a worksheet line: strings are operators, {sym} a symbol with subscripts,
   * {sup} a superscript, {frac: [num, den]} a fraction, {sqrt: [...]} a root, {in} a typed box
   * (pre-filled when it is a given constant), {mirror} repeats a typed box's value, {sign} a ± menu.
   */
  function fxRender(sheet, parts, into) {
    parts.forEach(function (p) {
      if (typeof p === 'string') { into.appendChild(fxEl('span', 'fx-op', p)); return; }
      if (p.sym) { var sy = fxEl('span', 'fx-sym'); P.setRich(sy, p.sym); into.appendChild(sy); return; }
      if (p.sup) { into.appendChild(fxEl('span', 'fx-sup', p.sup)); return; }
      if (p.frac) {
        var f = fxEl('span', 'fx-frac'), n = fxEl('span', 'fx-num'), d = fxEl('span', 'fx-den');
        fxRender(sheet, p.frac[0], n);
        fxRender(sheet, p.frac[1], d);
        f.appendChild(n);
        f.appendChild(d);
        into.appendChild(f);
        return;
      }
      if (p.sqrt) {
        var rt = fxEl('span', 'fx-root'), rad = fxEl('span', 'fx-radicand');
        fxRender(sheet, p.sqrt, rad);
        rt.appendChild(rad);
        into.appendChild(rt);
        return;
      }
      if (p.group) {
        var grp = fxEl('span', 'fx-group');
        fxRender(sheet, p.group, grp);
        into.appendChild(grp);
        return;
      }
      if (p.in) {
        var wrap = fxEl('span', 'fx-field'), inp = fxEl('input', 'num fx-in' + (p.given !== undefined ? ' given' : ''));
        inp.type = 'text';
        inp.inputMode = 'decimal';
        inp.autocomplete = 'off';
        inp.spellcheck = false;
        inp.setAttribute('aria-label', p.label + (p.unit ? ', in ' + (UNIT_WORDS[p.unit] || p.unit) : '') + (p.given !== undefined ? ' (given)' : ''));
        if (p.given !== undefined) inp.value = p.given;
        else if (p.ph) inp.placeholder = P.plainText(p.ph);
        inp.addEventListener('input', function () { evalSheet(sheet); });
        sheet.inputs[p.in] = inp;
        wrap.appendChild(inp);
        if (p.unit) wrap.appendChild(fxEl('span', 'fx-unit', p.unit));
        into.appendChild(wrap);
        return;
      }
      if (p.mirror) {
        var mr = fxEl('span', 'fx-mirror', '…');
        sheet.mirrors.push({ el: mr, name: p.mirror });
        into.appendChild(mr);
        if (p.unit) into.appendChild(fxEl('span', 'fx-unit', p.unit));
        return;
      }
      if (p.sign) {
        var sel = fxEl('select', 'fx-sign');
        sel.setAttribute('aria-label', p.label);
        [['1', '+'], ['-1', '−']].forEach(function (o) { var op = fxEl('option', null, o[1]); op.value = o[0]; sel.appendChild(op); });
        sel.addEventListener('change', function () { evalSheet(sheet); });
        sheet.inputs[p.sign] = sel;
        into.appendChild(sel);
      }
    });
  }

  /**
   * One line of a worksheet: the parts, then the result and its check against the working. The closing
   * "=" stays with the result, so a line too long for the panel continues with "= result" like the working.
   */
  function sheetRow(sheet, parts, compute, key, abs) {
    var line = fxEl('div', 'fx-line');
    var closes = parts[parts.length - 1] === '=';
    fxRender(sheet, closes ? parts.slice(0, -1) : parts, line);
    var out = fxEl('span', 'fx-out', '—'), check = fxEl('span', 'fx-check'), tail = fxEl('span', 'fx-group fx-result');
    if (closes) tail.appendChild(fxEl('span', 'fx-op', '='));
    tail.appendChild(out);
    tail.appendChild(check);
    line.appendChild(tail);
    sheet.box.appendChild(line);
    sheet.rows.push({ out: out, check: check, compute: compute, key: key, abs: !!abs, value: null });
  }

  function evalSheet(sheet) {
    var vals = {};
    Object.keys(sheet.inputs).forEach(function (k) {
      var el = sheet.inputs[k];
      if (el.tagName === 'SELECT') { vals[k] = parseInt(el.value, 10); return; }
      vals[k] = parseNum(el.value);
      el.setAttribute('aria-invalid', vals[k] !== null && !isFinite(vals[k]) ? 'true' : 'false');
    });
    sheet.mirrors.forEach(function (mr) {
      var v = vals[mr.name];
      mr.el.textContent = v === null || v === undefined || !isFinite(v) ? '…' : sheet.inputs[mr.name].value.trim();
    });
    sheet.rows.forEach(function (r) {
      var res = r.compute(vals);
      r.value = res && res.v !== null && res.v !== undefined && isFinite(res.v) ? res.v : null;
      r.out.textContent = r.value === null ? '—' : res.text;
    });
    checkSheet(sheet);
  }

  /** Compare each worksheet result with the working below it, within 2 %. */
  function checkSheet(sheet) {
    sheet.rows.forEach(function (r) {
      var w = state.worked ? state.worked[r.key] : undefined, txt = '', ok = false;
      if (r.value !== null && w !== undefined && w !== null && isFinite(w)) {
        var a = r.abs ? Math.abs(r.value) : r.value, b = r.abs ? Math.abs(w) : w;
        ok = Math.abs(a - b) <= 0.02 * Math.max(Math.abs(a), Math.abs(b), 1e-300);
        txt = ok ? '✓ agrees with the measurements typed above' : '▲ disagrees with the measurements typed above; check the units and the numbers';
      }
      if (r.check.textContent !== txt) r.check.textContent = txt;
      r.check.classList.toggle('ok', ok);
    });
  }
  function checkWorksheets() { sheets.forEach(checkSheet); }

  function pos(x) { return x !== null && x !== undefined && isFinite(x) && x > 0; }
  function num(x) { return x !== null && x !== undefined && isFinite(x); }

  /** Build every step's symbolic equation and, under it across the panel, its worksheet. Runs once. */
  function buildWork() {
    var rho = C.rhoOil - C.rhoAir, eta = M.viscosity(C.T);
    var vF = function () { return sub(mi('v'), 'f'); };
    var bOver2p = function () { return frac(mi('b'), row(mn('2'), mi('p'))); };
    var slipTerm = function () { return frac(row(mn('9'), mi('η'), vF()), row(mn('2'), mi('g'), mi('ρ'))); };
    // A given constant may appear in more than one worksheet; each gets its own box.
    var G = {
      b: { in: 'b', label: 'b, the slip correction constant', unit: 'Pa·m', given: sciText(C.b, 3) },
      p: { in: 'p', label: 'p, the air pressure', unit: 'Pa', given: sciText(C.p, 4) },
      eta: { in: 'eta', label: 'η, the viscosity of the air', unit: 'Pa·s', given: sciText(eta, 3) },
      g: { in: 'g', label: 'g, the acceleration of gravity', unit: 'm/s²', given: fmt(C.g, 2) },
      rho: { in: 'rho', label: 'ρ, the effective density of the oil', unit: 'kg/m³', given: fmt(rho, 1) },
      d: { in: 'd', label: 'd, the plate separation', unit: 'm', given: sciText(C.d, 3) }
    };

    function step(n, title, symbolic, rows) {
      var work = els['c-s' + n].querySelector('.calc-work');
      var grid = fxEl('div', 'eq-row'), sym = fxEl('div', 'eq-sym'), box = fxEl('div', 'fx');
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', 'Worksheet for step ' + n + ', ' + title);
      symbolic(sym);
      grid.appendChild(sym);
      grid.appendChild(box);
      work.appendChild(grid);
      var sheet = { box: box, rows: [], inputs: {}, mirrors: [] };
      rows(sheet);
      sheets.push(sheet);
      evalSheet(sheet);
    }

    step(1, 'fall speed', function (sym) {
      eq(sym, vF(), '=', frac(sub(mi('D'), 'f'), sub(mi('t'), 'f')));
    }, function (sh) {
      sheetRow(sh, [{ sym: 'v_f' }, '=', { frac: [[{ in: 'df', label: 'D f, the fall distance', unit: 'mm', ph: 'D_f' }], [{ in: 'tf', label: 't f, the fall time', unit: 's', ph: 't_f' }]] }, '='],
        function (v) { if (!pos(v.df) || !pos(v.tf)) return { v: null }; var x = v.df / 1000 / v.tf; return { v: x, text: fmt(x * 1000, 4) + NB + 'mm/s = ' + sciText(x, 4, 'm/s') }; }, 'vf');
    });

    step(2, 'radius', function (sym) {
      eq(sym, mi('r'), '=', sqrtOf(sup(paren(bOver2p()), '2'), '+', slipTerm()), '−', bOver2p());
    }, function (sh) {
      // One line for the whole formula; b and p appear twice, so their second appearance mirrors the first.
      // "r = √…" is grouped so the root starts beside the r rather than on a line of its own.
      sheetRow(sh, [{ group: [{ sym: 'r' }, '=', { sqrt: ['(', { frac: [[G.b], ['2 ×', G.p]] }, ')', { sup: '2' }, '+',
        { frac: [['9 ×', G.eta, '×', { in: 'vf', label: 'v f, the fall speed', unit: 'm/s', ph: 'v_f' }], ['2 ×', G.g, '×', G.rho]] }] }] },
        { group: ['−', { frac: [[{ mirror: 'b', unit: 'Pa·m' }], ['2 ×', { mirror: 'p', unit: 'Pa' }]] }] }, '='],
        function (v) {
          if (!pos(v.b) || !pos(v.p) || !pos(v.eta) || !pos(v.vf) || !pos(v.g) || !pos(v.rho)) return { v: null };
          var h = v.b / (2 * v.p), x = Math.sqrt(h * h + 9 * v.eta * v.vf / (2 * v.g * v.rho)) - h;
          return { v: x, text: sciText(x, 4, 'm') + ' = ' + fmt(x * 1e6, 3) + NB + 'µm' };
        }, 'r');
    });

    step(3, 'mass', function (sym) {
      eq(sym, mi('m'), '=', frac(mn('4'), mn('3')), mi('π'), sup(mi('r'), '3'), mi('ρ'));
    }, function (sh) {
      sheetRow(sh, [{ sym: 'm' }, '=', { frac: [['4'], ['3']] }, '× π × (', { in: 'r', label: 'r, the radius', unit: 'm', ph: 'r' }, ')', { sup: '3' }, '×', G.rho, '='],
        function (v) { if (!pos(v.r) || !pos(v.rho)) return { v: null }; var x = 4 / 3 * Math.PI * v.r * v.r * v.r * v.rho; return { v: x, text: sciText(x, 4, 'kg') }; }, 'm');
    });

    step(4, 'velocity with the field on', function (sym) {
      eq(sym, mi('v'), '=', '±', frac(mi('D'), mi('t')));
    }, function (sh) {
      sheetRow(sh, [{ sym: 'v' }, '=', { sign: 'sgn', label: 'Sign of the velocity: plus for a drop that rose, minus for one that fell' }, { frac: [[{ in: 'd', label: 'D, the distance with the field on', unit: 'mm', ph: 'D' }], [{ in: 't', label: 't, the time with the field on', unit: 's', ph: 't' }]] }, '='],
        function (v) { if (!pos(v.d) || !pos(v.t)) return { v: null }; var x = v.sgn * v.d / 1000 / v.t, sg = x < 0 ? MINUS : '+'; return { v: x, text: sg + fmt(Math.abs(x) * 1000, 4) + NB + 'mm/s = ' + sg + sciText(Math.abs(x), 4, 'm/s') }; }, 'v');
    });

    step(5, 'electric field', function (sym) {
      eq(sym, mi('E'), '=', frac(mi('V'), mi('d')));
    }, function (sh) {
      sheetRow(sh, [{ sym: 'E' }, '=', { frac: [[{ in: 'V', label: 'V, the plate voltage', unit: 'V', ph: 'V' }], [G.d]] }, '='],
        function (v) { if (!pos(v.V) || !pos(v.d)) return { v: null }; var x = v.V / v.d; return { v: x, text: sciText(x, 4, 'V/m') }; }, 'E');
    });

    step(6, 'charge', function (sym) {
      eq(sym, abs(mi('q')), '=', frac(row(mi('m'), mi('g'), paren(mn('1'), '+', frac(mi('v'), vF()))), mi('E')));
    }, function (sh) {
      sheetRow(sh, ['|', { sym: 'q' }, '|', '=', { frac: [[{ in: 'm', label: 'm, the mass', unit: 'kg', ph: 'm' }, '×', G.g, '× ( 1 +', { frac: [[{ in: 'v', label: 'v, the velocity with the field on, with its sign', unit: 'm/s', ph: 'v' }], [{ in: 'vf', label: 'v f, the fall speed', unit: 'm/s', ph: 'v_f' }]] }, ')'], [{ in: 'E', label: 'E, the electric field', unit: 'V/m', ph: 'E' }]] }, '='],
        function (v) { if (!pos(v.m) || !pos(v.g) || !num(v.v) || !pos(v.vf) || !pos(v.E)) return { v: null }; var x = Math.abs(v.m * v.g * (1 + v.v / v.vf) / v.E); return { v: x, text: sciText(x, 4, 'C') }; }, 'q', true);
    });
  }

  // ---------- analysis ----------

  function showTrialE() { els['trial-e-out'].textContent = fmt(state.trialE / E19, 2) + ' × 10⁻¹⁹' + NB + 'C'; }

  els['trial-e'].addEventListener('input', function () {
    if (slideAnim) { cancelAnimationFrame(slideAnim); slideAnim = null; }   // a hand on the slider stops the glide
    state.trialE = parseFloat(els['trial-e'].value) * E19;
    showTrialE();
    analyse();
  });

  els.reveal.addEventListener('change', function () {
    state.reveal = els.reveal.checked;
    els['lg-true'].hidden = !state.reveal;
    document.querySelectorAll('.true-col').forEach(function (c) { c.hidden = !state.reveal; });
    analyse();
  });

  /**
   * The charges for the analysis: one per field-on row, or, with Average Repeated Measurements on, one per
   * drop and charge state. Runs of a drop with no exposure to the source between them measure the same
   * charge, so they are averaged; the scatter of the mean combines their independent timing scatter
   * (down by the square root of the count) with the fall-speed scatter they all share.
   */
  function charges() {
    var groups = {}, order = [];
    state.rows.forEach(function (r) {
      var q = chargeOf(r);
      if (!isFinite(q)) return;
      var key = state.average ? r.dropId + ':' + r.epoch : 'row ' + r.id;
      if (!groups[key]) { groups[key] = { dropId: r.dropId, rows: [], qs: [], parts: [] }; order.push(key); }
      groups[key].rows.push(r);
      groups[key].qs.push(q);
      groups[key].parts.push(chargeSdParts(r));
    });
    return order.map(function (key) {
      var g = groups[key], n = g.qs.length;
      var signed = g.qs.reduce(function (s, x) { return s + x; }, 0) / n;
      var own = Math.sqrt(g.parts.reduce(function (s, p) { return s + p.own * p.own; }, 0)) / n;
      var fall = g.parts.reduce(function (s, p) { return s + p.fall; }, 0) / n;
      var trueNs = g.rows.map(function (r) { return r.trueN; });
      var known = trueNs.every(function (t) { return t !== null && t === trueNs[0]; });
      return {
        dropId: g.dropId, ids: g.rows.map(function (r) { return r.id; }), q: Math.abs(signed), signed: signed, sd: Math.hypot(own, fall),
        trueN: known ? trueNs[0] : null, mixed: g.rows.some(function (r) { return r.mixed; }), trueQ: known ? Math.abs(trueNs[0]) * C.e : null
      };
    });
  }

  function setAverage(on) {
    showSwitch(els['average-on'], els['average-state'], on);
    if (on === state.average) return;
    state.average = on;
    analyse();
  }
  els['average-on'].addEventListener('change', function () { setAverage(els['average-on'].checked); });

  function analyse() {
    renderProps();
    var list = charges(), qs = list.map(function (c) { return c.q; });
    var drops = {}, pending = 0, folded = 0;
    list.forEach(function (c) { drops[c.dropId] = true; folded += c.ids.length - 1; });
    state.rows.forEach(function (r) { if (r.kind === 'field' && !isFinite(chargeOf(r))) pending++; });
    var nDrops = Object.keys(drops).length;

    els['t-count'].textContent = String(qs.length);
    els['t-count-sub'].textContent = qs.length ? 'on ' + nDrops + ' drop' + (nDrops === 1 ? '' : 's') + (folded ? ', ' + folded + ' repeated run' + (folded === 1 ? '' : 's') + ' averaged in' : '') +
      (pending ? '; ' + pending + ' field-on row' + (pending === 1 ? '' : 's') + ' still need a fall time' : '') : 'time a fall and a rise of the same drop';

    var f = M.fit(qs, state.trialE);
    els['t-fit'].textContent = qs.length ? 'RMS ' + fmt(f.rms, 3) + ' units' : '—';
    els['t-fit-sub'].textContent = qs.length ? 'largest miss ' + fmt(f.max, 2) + ' of a unit; multiples in the table' : 'how far the charges sit from whole multiples';

    // With the instructor check on, the search runs on the true charges of the measured drops.
    var basis = state.reveal ? list.filter(function (c) { return c.trueQ; }).map(function (c) { return c.trueQ; }) : qs;
    state.best = M.bestUnit(basis);
    var b = state.best;
    els['t-unit'].textContent = b ? e19(b.e, 3) : '—';
    els['t-unit-sub'].textContent = b ? 'multiples 1 to ' + Math.max.apply(null, b.ns) + ' (' + b.distinct + ' different), RMS ' + fmt(b.rms, 3) + (state.reveal ? ', from the true charges' : '')
      : (qs.length ? 'no unit fits yet' : 'press Search for Unit of Charge once charges are in');
    var pct = b ? (b.e - C.e) / C.e * 100 : NaN;
    els['t-acc'].textContent = b ? (pct >= 0 ? '+' : MINUS) + fmt(Math.abs(pct), 1) + NB + '%' : '—';
    els['t-acc-sub'].textContent = 'accepted e = 1.602 × 10⁻¹⁹ C';

    var points = list.map(function (c, i) {
      return { label: dropName(c.dropId) + (c.ids.length > 1 ? ', mean of measurements ' + c.ids.join(', ') : ', measurement ' + c.ids[0]), q: c.q, sd: c.sd, n: f.ns[i], trueQ: c.trueQ };
    });
    root.Chart.set(points, state.trialE, state.reveal);

    var body = els['q-body'];
    body.textContent = '';
    list.forEach(function (c, i) {
      var tr = document.createElement('tr');
      cell(tr, dropName(c.dropId) + ' (#' + c.ids.join(', #') + (c.ids.length > 1 ? ', mean' : '') + ')', 'text');
      cell(tr, fmt(c.q / E19, 2));
      cell(tr, isFinite(c.sd) ? fmt(c.sd / E19, 2) : DASH);
      cell(tr, c.signed > 0 ? 'positive' : 'negative', 'text');
      cell(tr, String(f.ns[i]));
      cell(tr, fmt(c.q / f.ns[i] / E19, 3));
      cell(tr, fmt(c.q / state.trialE - f.ns[i], 2));
      var td = cell(tr, c.trueN === null ? (c.mixed ? 'changed during the timing' : '') : String(Math.abs(c.trueN)) + (c.trueN < 0 ? ' (negative)' : ' (positive)'), 'true-col');
      td.hidden = !state.reveal;
      body.appendChild(tr);
    });
    showResultsNow();
  }

  function setTrial(v) {
    els['trial-e'].value = v.toFixed(2);
    state.trialE = parseFloat(els['trial-e'].value) * E19;
    showTrialE();
    analyse();
  }

  /** Slide the trial unit to a value over about a second (straight there under reduced motion), then call done. */
  var slideAnim = null;
  function slideTrialE(target, done) {
    if (slideAnim) { cancelAnimationFrame(slideAnim); slideAnim = null; }
    var from = parseFloat(els['trial-e'].value), to = Math.min(4, Math.max(0.8, target / E19));
    if (P.prefersReducedMotion() || Math.abs(to - from) < 0.005) { setTrial(to); done(); return; }
    var dur = 900, t0 = performance.now();
    function step() {
      var k = Math.min(1, (performance.now() - t0) / dur), ease = 1 - Math.pow(1 - k, 3);
      setTrial(from + (to - from) * ease);
      if (k < 1) slideAnim = requestAnimationFrame(step);
      else { slideAnim = null; setTrial(to); done(); }
    }
    slideAnim = requestAnimationFrame(step);
  }

  els['find-e'].addEventListener('click', function () {
    analyse();
    var b = state.best;
    if (!b) {
      setStatus(els['ana-status'], charges().length ? 'No unit fits these charges yet. Time more drops, or the same drop at more charges, and prefer small charges.' : 'No charges to analyse yet. Time a fall and a rise of the same drop first.');
      return;
    }
    var basis = state.reveal ? ' true charge' : ' charge';
    slideTrialE(b.e, function () {
      var pct = (b.e - C.e) / C.e * 100;
      setStatus(els['ana-status'], 'Unit found: ' + e19(b.e, 3) + ' from ' + b.ns.length + basis + (b.ns.length === 1 ? '' : 's') + ' (multiples 1 to ' + Math.max.apply(null, b.ns) + '), ' +
        fmt(Math.abs(pct), 1) + NB + '% ' + (pct >= 0 ? 'above' : 'below') + ' the accepted value.' + (b.distinct < 3 ? ' Only ' + b.distinct + ' different multiple' + (b.distinct === 1 ? '' : 's') + ': measure more charges to be sure of the unit.' : ''));
    });
  });

  // ---------- the loop ----------

  /** One step of dt simulated seconds, with the timing, the views and the readouts that follow it. */
  function advance(dt) {
    var prevT = sim.time, d = state.trackedId ? sim.byId(state.trackedId) : null;
    var prevY = d ? d.y - C.d / 2 : null;
    sim.step(dt);
    if (state.trackedId) {
      d = sim.byId(state.trackedId);
      if (!d) setTracked(null, dropName(state.trackedId) + ' reached a plate and was lost.');
      else if (state.view === 'eye' && els['auto-time'].checked && !sim.source && prevY !== null) autoStep(prevT, prevY, sim.time, d.y - C.d / 2, d);
    }
    drawViews();
    showStopwatch();
    showNow();
  }

  function frame(ts) {
    root.requestAnimationFrame(frame);
    var dtReal = state.lastFrame ? Math.min(0.05, (ts - state.lastFrame) / 1000) : 0;
    state.lastFrame = ts;
    if (!state.paused && dtReal > 0) advance(dtReal * state.speed);
  }

  // ---------- table scroll boxes ----------

  /**
   * A table wider than its box scrolls sideways. While it does, the box is a focusable region named after
   * the table, so the keyboard can scroll it too (WCAG 2.1.1, style guide 8.7); when the table fits again
   * the box leaves the tab order. Content and size changes are watched, so the state follows the table.
   */
  function watchTableScroll() {
    var boxes = Array.prototype.slice.call(document.querySelectorAll('.table-scroll'));
    function update() {
      boxes.forEach(function (box) {
        var scrolls = box.scrollWidth > box.clientWidth + 1;
        if (scrolls === (box.getAttribute('tabindex') === '0')) return;
        if (scrolls) {
          var caption = box.querySelector('caption');
          box.setAttribute('tabindex', '0');
          box.setAttribute('role', 'region');
          box.setAttribute('aria-label', (caption ? caption.textContent.trim() : 'Table') + ', scrolls sideways');
        } else {
          box.removeAttribute('tabindex');
          box.removeAttribute('role');
          box.removeAttribute('aria-label');
        }
      });
    }
    if ('ResizeObserver' in root) {
      var ro = new ResizeObserver(update);
      boxes.forEach(function (box) { ro.observe(box); var table = box.querySelector('table'); if (table) ro.observe(table); });
    } else root.addEventListener('resize', update);
    update();
  }

  // ---------- start ----------

  P.init({
    themeKey: 'millikan-oil-drop-lab-theme',
    refresh: function () { root.Eyepiece.refresh(); root.Chart.refresh(); drawViews(); root.Chart.draw(); },
    layout: function () { root.Apparatus.fit(); root.Eyepiece.layout(); root.Chart.layout(); drawViews(); root.Chart.draw(); },
    escape: function () { return root.Chart.closeTip(); }
  });
  // The model's working parts: the bulb, the knife switch, Raise and Lower (held to repeat), the source
  // lever and the eyepiece. The controls above are the keyboard route.
  root.Apparatus.init({
    spray: doSpray,
    field: function () { setField(sim.s === 0); },
    source: function () { setSource(!sim.source); },
    look: function () { setView(true); },
    volt: function (step) { setVolts(sim.V + 2 * step); },
    pick: pickInCutaway
  });
  // The eyepiece canvas follows the stage as the bench's column opens and closes.
  if ('ResizeObserver' in root) {
    new ResizeObserver(function () {
      if (state.view === 'eye' || state.zooming) { root.Eyepiece.layout(); root.Eyepiece.draw(sim, state.trackedId); }
    }).observe(els.stage);
  }
  root.Eyepiece.init(els.eye);
  root.Chart.init(els.qchart, els.qtip);
  showVolts();
  showFocus();
  showTrialE();
  showNow(true);
  showStopwatch(true);
  renderRows();
  analyse();
  buildWork();
  calc();
  drawViews();
  watchTableScroll();
  root.requestAnimationFrame(frame);
  P.start();

  root.app = { sim: sim, state: state, setView: setView, setTracked: setTracked, analyse: analyse, advance: advance, reset: resetExperiment, calc: calc };
})(window);
