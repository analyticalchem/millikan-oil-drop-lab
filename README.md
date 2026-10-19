# Millikan Oil Drop Lab

An interactive teaching page that simulates the Millikan oil drop experiment.

Spray a mist of oil into the chamber, pick a drop, and time it falling under gravity with the plates shorted and rising (or falling more slowly) in the electric field between the plates. The fall gives the drop's radius and mass; each timed run with the field on gives its charge. Expose the ionization source to change a drop's charge and time it again. The charges come in whole-number multiples of one unit, the charge of the electron, and the page's analysis finds that unit from your own measurements.

The apparatus can be viewed as a 3D cutaway (a model of Millikan's apparatus with a quarter of the chamber cut away, showing the plates, the glass spacer, the pinhole, the window ports, viewing scope, arc lamp, atomizer, α source and plate voltage supply, with a magnified view of the gap where the drops are) or through the eyepiece (a dark field with a reticle and the drops as points of light). One button flies the camera into the eyepiece and back out again; beside the eyepiece sit the scope focus and the stopwatch and recording panel. The model itself can be worked with the pointer: the bulb sprays, the knife switch on the supply and the source lever toggle, Raise and Lower beside the voltmeter change the voltage (hold to repeat), and clicking the eyepiece looks into it; the controls above do the same from the keyboard.

No build step: plain HTML, CSS and JavaScript. The 3D view is drawn with three.js 0.184 (MIT), kept in `js/vendor/three` so the page makes no third-party requests and works offline.

## Running it

- **Locally:** serve the folder over HTTP with any static server (for example the Live Server extension in VS Code) and open `index.html` from it. The 3D view loads three.js as an ES module, which browsers refuse from a `file://` address, so double-clicking `index.html` shows the page without the model.
- **GitHub Pages:** *Settings → Pages → Deploy from a branch*, default branch, `/ (root)`. Served at `https://analyticalchem.github.io/millikan-oil-drop-lab/`.

## Doing the experiment

1. **Spray Oil Drops**, or click the atomizer bulb in the cutaway. The bulb blows a mist from the nozzle into the space above the top plate; the puff of air carries the drops through the hole in the plate into the gap, and the rest land on the plate. Look into the eyepiece and pick one that falls slowly and is sharp at the current focus.
2. **Track it** by clicking it in either view, or with the Previous Drop and Next Drop buttons. The tracked drop is ringed in both views.
3. **Time its fall** with the plates shorted across a known number of long reticle lines (0.5 mm apart), with the stopwatch or by letting the page time the crossings. The Drop Properties panel then lists its radius and mass.
4. **Switch the Plate Voltage on.** The top plate is always positive and the bottom plate negative, so a negatively charged drop (most of them) rises; time its rise. A positively charged drop falls faster instead and is measured the same way.
5. **Change its charge** by exposing the source for a few seconds, then time the rise again. A violet ring spreads from a drop at the moment it captures an ion; the change shows in its motion only while the field is on. Repeat for several charges and several drops.
6. **Search for Unit of Charge.** Slide the trial unit until the charges line up with its multiples, or press Search for Unit of Charge and watch the slider glide to the unit the page finds. With the instructor check on, the search uses the true charges of the measured drops. The Average Repeated Measurements switch, off by default, folds the runs of a drop made with no exposure to the source between them into one charge, their mean, with the scatter of the mean.

Reset Experiment clears the drops, the clock and every measurement and returns the controls to their starting values, leaving the view as it is and asking first (in the page, not a browser dialog) when there are measurements to lose. Measurements can be downloaded as CSV (with each drop's radius and mass). An instructor check reveals the true charge of each measured drop.

The Charge Calculation panel takes a drop's numbers typed in from the Measurements table (fall distance and time, field-on distance, time and direction, plate voltage) and leads through the steps: fall speed, radius, mass, field-on velocity, electric field, and the size of the charge in coulombs. The panel starts folded to its title and opens with a click on it. It stops at the charge on purpose: what the charges are multiples of is what the Charge Analysis panel finds, and only afterwards is the result compared with the accepted value. Each step shows its formula in MathML (part of HTML, no library), set in the system's math font with real fractions, roots and exponents and carrying a linear text version for screen readers. Under the formula, across the width of the panel, is a worksheet version of it built from typed boxes, with the given constants (g, p, η, ρ, b, d) already filled in: type the other values, and the result appears at the end of the line with a check against what the measurements typed at the top give. The page does not work the numbers out for you; the worksheet is where that happens. A step still waiting for a value says so under its title. Below the worksheet a definitions list names every symbol: what it means, whether it is found in this step, comes from an earlier step or from your measurement (with the number you typed), or is a given constant with its value.

## The physics

- A drop's terminal fall speed balances its weight (oil less air) against Stokes drag with the Cunningham slip correction, `6 π η r v / (1 + b/(p r))`; the radius follows from the fall speed, `r = √((b/2p)² + 9 η v_f / (2 g ρ)) − b/2p`, and the mass is `m = (4/3) π r³ ρ`.
- With the field `E = V/d` on (top plate positive, bottom negative), `|q| = m g (1 + v/v_f) d / V`, where `v` is the velocity with the field on (up positive) and `v_f` the fall speed. A rising drop gives the familiar `(v_f + v_r)/v_f`; a drop that falls faster with the field on is positively charged.
- Constants: `g` = 9.80 m/s², oil density 886 kg/m³ less air 1.20 kg/m³, `d` = 14.92 mm (Millikan's 1913 condenser), `b` = 8.20 × 10⁻³ Pa·m, `p` = 1.013 × 10⁵ Pa, air at 22.0 °C (η = 1.82 × 10⁻⁵ Pa·s by Sutherland's formula).
- The unit search scans trial values from 4 × 10⁻¹⁹ C downward and takes the largest local minimum of the RMS deviation from whole multiples that is within 2.5 times the best RMS found (never tighter than 0.07 of a unit), then refines it by least squares.

## The simulation

- Drops have radii of about 0.35 to 1.3 µm and a few elementary charges each (three quarters negative), and move at their terminal velocity, recomputed every frame. A fresh drop rides the puff of air from the bulb: swept toward the 0.8 mm hole in the top plate, through it, and a few millimetres down into the gap before the stream dies away.
- Brownian motion of the right size for each drop's radius and the air temperature makes repeated timings differ slightly. Every recorded speed and charge carries the scatter this predicts, one standard deviation: the root-mean-square Brownian displacement over the interval divided by the distance timed, carried through the charge formula with the drop's fall speed averaged over all its falls. The Measurements table, the Charge Analysis chart (as a bar through each dot) and the CSV all show it. A longer Distance timed shrinks it, which is why the default is 4 divisions (2 mm).
- With the source on, each drop captures an ion about every two seconds (±1, sometimes ±2 units); with it off, a drop's charge never changes. A slow convection current drifts the drops sideways.
- The scope has a shallow depth of field and shows an upright image. The clock, stopwatch and automatic timer run on simulated time, so the Speed setting only shortens the wait.
- The automatic timer works while you look through the eyepiece: it notes the moment the tracked drop crosses each long reticle line inside the field of view and records a measurement each time the drop has covered the Distance timed set beside the stopwatch, in one direction under one field setting. A shorter stretch, cut off by a change of field or direction or by the drop leaving the view, is not recorded, and timing pauses while the source is on. A freshly sprayed drop is left alone until the puff of air that carried it through the hole has died away, about five seconds.

## The model

The cutaway is built by `js/apparatus3d.js` in three.js and shown in the `<three-d-stage>` viewer (`js/three-d-stage.js`), modelled on photographs of Millikan's original apparatus at Caltech: a cast-iron chamber on a flanged base, a bolted lid with a ribbed cone, flanged window ports at plate height, an air cock, the leads to the plates, the atomizer on its pillar, the scope with its diagonal eyepiece on an aluminium stand, an arc lamp, and a plate voltage supply with a voltmeter, a counter, Raise and Lower buttons, a knob and a knife switch. Parts are at about true size, including the 14.92 mm gap between the plates of Millikan's 1913 condenser; the supply runs from 0 to 1200 V so the field reaches the same strength as before. A quarter of the chamber is cut away (the Cutaway button puts it back), and a second camera draws the magnified view of the gap in the top right corner, with the drops hundreds of times life size. Drag to turn (or focus the view and use the arrow keys), Ctrl + scroll or pinch to zoom (or press + and −), right-drag to pan; Whole Apparatus and Chamber jump between views. Camera flights are instant when the system asks for reduced motion. The view grows with the window: on screens wider than 1500 px the page column widens (up to 1800 px), a tall window gets a taller view, and until you move the camera yourself it reframes the model to whatever shape the view takes.

## Presentation mode

Press **Present** or **Alt + Shift + P** (Option + Shift + P on a Mac); Escape leaves it. Add `?present=1` to a link to open it ready to present.

## Files

```
index.html          page structure and text
css/styles.css      tokens (with the apparatus and eyepiece colours), components, themes, presentation mode
css/page.css        this page: the stage and its two views, the transition, the bench, the drawing, data panels
js/page.js          theme, presentation mode, formatting
js/model.js         the physics: drag, terminal velocities, radius and charge from measurements, finding the unit
js/sim.js           the drops: spraying, motion, Brownian jitter, ionization
js/apparatus3d.js   the 3D cutaway (three.js model, magnified view of the gap, pointer controls)
js/three-d-stage.js the 3D viewer: renderer, lights, orbit controls (its model download toolbar is switched off here)
js/vendor/three/    three.js 0.184: the module, OrbitControls and the exporters, with its MIT licence
js/eyepiece.js      the eyepiece view (canvas)
js/chart.js         the charge dot plot
js/main.js          wires the controls, views, bench, tracking, timing, tables and analysis
```

## License

MIT. See [LICENSE](LICENSE).
