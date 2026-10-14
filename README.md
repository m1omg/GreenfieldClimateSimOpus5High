# Worldclimate — planetary climate simulator

A 3D web game and sandbox for steering the climate of a terrestrial planet: snowball worlds,
waterbelts, temperate Earths, hothouses, moist and runaway greenhouses, post-runaway magma
oceans, Venus-like dry hothouses, Mars-like deserts, eyeball planets, waterworlds and more.
The planet's state emerges from the physics. Nothing is scripted.

## Run

**Play online:** https://m1omg.github.io/GreenfieldClimateSimOpus5High/

Any static file server works (ES modules + a Web Worker need `http://`, not `file://`):

```bash
python3 -m http.server 8765
# open http://127.0.0.1:8765/
```

No build step. three.js r170 is vendored in `vendor/` and the starfield is in `assets/`.

**Controls:** drag to orbit, scroll (or pinch) to zoom, <kbd>Space</kbd> play/pause, <kbd>[</kbd>/<kbd>]</kbd> slower/faster.
On touch devices and narrow windows the two panels become slide-out drawers: tap the **Planet**
tab on the left edge or the **Climate** tab on the right edge (or the state chip at the top), and
tap the planet to close them. The left panel holds the star, orbit, planet, atmosphere and geology settings. Gas and water
sliders *follow the evolving simulation*: grab one to override it. The right panel shows the
climate-state classification, readouts, energy budget, history charts, latitude profile,
composition and an event log.

## Time

Simulated time is tied to the **wall clock**, from 1 yr/s to 100 Myr/s, so it does not depend
on your monitor's refresh rate. The model runs in a Web Worker and its rendering is decoupled.
An implicit (backward-Euler/Newton) solver with adaptive steps takes ~1-year steps through fast
transitions (an ocean boiling off, a snowball collapse) and up to 200-kyr steps through quiet
eons. If the CPU cannot keep up, the time bar shows the *achieved* rate honestly. Typical
throughput: ~250 Myr of a stable climate, or ~30 kyr of an active runaway, per second of compute.

## Rendering cost

The planet, clouds and Venus-like decks are procedural (dozens of simplex-noise octaves per pixel),
which is far too expensive to evaluate every frame on tablets and phones. All static noise is baked
once on the GPU into cube maps, and the slowly evolving, domain-warped cloud field is baked as
keyframes 8 s apart that are cross-faded in the shader. The next keyframe is rendered one thin strip
per frame, so no frame pays for more than ~1/200 of it. Only the finest cloud octaves are still
evaluated live, on top of the baked warp, and only when zooming in makes them larger than a pixel.
The terrain normal is precomputed in the worker. The image matches the fully procedural version
(mean difference < 0.1 % on the surface) at roughly a quarter of the per-pixel cost. Rendering runs
at the full device resolution (up to 2×), stepping down only as a last resort on a device that cannot
hold ~40 fps.

## What is simulated

**Radiation (the core).** Thermal emission comes from a spectral column model with 448 wavenumber
points: band-envelope absorption for H₂O, CO₂, CH₄ and SO₂ (after Jeevanjee & Fueglistaler 2020),
the water-vapour self/foreign continuum, and collision-induced absorption for CO₂–CO₂, N₂–N₂, H₂–N₂
and H₂–H₂. The temperature profile follows a non-dilute moist pseudo-adiabat that stays valid all
the way to a pure-steam atmosphere, with temperature-dependent heat capacities. Emission uses a
source function linear in optical depth. Stellar radiation goes through a 9-layer delta-Eddington
two-stream scheme with Rayleigh scattering, gas absorption, water clouds, a Venus-like sulfuric
deck and organic haze, all integrated against the **star's actual blackbody spectrum**, with
spectral surface albedos (snow, sea ice, ocean, soil, sand, regolith, lava). Results are cached in
lazily filled lookup tables keyed on composition.

**Climate.** Thirty-six 5° latitude bands, or substellar-angle bands for tidally locked worlds. Each
band has an energy balance, diffusive heat transport scaled by column mass, heat capacity,
molecular weight, rotation, latent heat and a baroclinic-eddy compensation term, plus a deep ocean,
sea ice and snow. Clouds respond to humidity, steam fraction, rotation and substellar convection.
A latent-heat "effective heat capacity" makes ocean evaporation take exactly as long as the energy
budget demands.

**Slow processes.** These cover the hydrological cycle with land ice sheets (flow, calving,
sublimation, cold trapping) and the carbonate–silicate cycle (land and seafloor weathering,
volcanic outgassing, ocean dissolved carbon, carbonate decomposition on hot surfaces). They also
include CO₂ condensation and atmospheric collapse, hydrogen escape (diffusion- or energy-limited,
leaving O₂ behind), bulk atmospheric erosion (cosmic-shoreline scaling), the biosphere's O₂ and CH₄,
volcanic SO₂, stellar brightening and XUV decline, and high-pressure-ice shutdown of seafloor
weathering.

## How long does a runaway greenhouse take?

From the research done for this project (energy-budget reasoning, checked against 3D GCM studies):

* **Onset.** Absorbed sunlight must exceed what a water-saturated atmosphere can radiate, the
  Simpson–Nakajima limit of ~282 W/m² (Goldblatt et al. 2013; Boukrouche et al. 2021: 283 W/m²).
  For an Earth-like planet 3D models put the onset at ~1.1–1.2 S⊕ (Leconte et al. 2013; Wolf &
  Toon 2015; Chaverot et al. 2023). Clouds and sub-saturation push it above the 1D value of ~1.06 S⊕.
* **Evaporation phase.** Boiling off Earth's ocean needs ~8×10¹² J/m²: latent heat plus heating
  2.7 tonnes/m² of water toward the critical point. Chaverot et al. (2023) find a roughly constant
  imbalance of ~10–25 W/m² near the threshold, rising to ~80 W/m² at higher insolation. That gives
  **~10⁴–10⁵ years** just above the threshold, a few thousand years when strongly forced, and up to
  Myr when a slowly brightening star drives the planet across the threshold.
* **Dry transition.** Once the ocean is gone the surface heats within centuries to millennia,
  until emission through spectral windows lifts the outgoing flux above the limit at ~1500–2000 K
  (Boukrouche et al. 2021: ~1800 K for 270 bar).
* **Water loss.** Hydrogen escape strips the steam over **~10⁷–10⁹ yr**, depending on the star's
  XUV output (Hamano et al. 2013: type-II planets stay molten for up to ~100 Myr). Without liquid
  water, silicate weathering stops and outgassed CO₂ plus decomposed carbonates build a Venus-like
  atmosphere.

In the simulator, Earth at 1.3 S⊕ evaporates its ocean in ~3.5 kyr. At 1.25 S⊕ it passes through a
long moist-greenhouse phase first. The ETA to full evaporation is shown live.

## Climate states recognised

Temperate · Glacial · Waterbelt (Jormungand) · Snowball · Eyeball · Hothouse · Moist greenhouse ·
Runaway (ocean boiling off) · Wet runaway (steam atmosphere) · Magma ocean · Dry runaway
(Venus-like) · Hot desert · Desert/land planet · Cold-trapped (moist bistability) · Mars-like cold
desert · Atmospheric collapse (CO₂ frost) · Airless · Waterworld (with HP-ice tag) · Hazy
(Titan-like) · Hydrogen greenhouse. Tags flag abiotic O₂, CO₂ ice caps, organic haze and others.

## Verification

```bash
node tests/verify.mjs      # 26 literature checks, a few minutes
```

The suite covers Earth's clear-sky OLR, CO₂ forcing, the steam limit, Earth's mean temperature,
albedo and 100-Myr stability, climate sensitivity (3.6 K), snowball onset and deglaciation,
runaway onset, evaporation time and post-runaway state, and Venus, Mars, Proxima b, desert and
waterworld behaviour. Other scripts in `tests/` were used for calibration and diagnostics.

## Assets

`assets/starfield.jpg` was generated for this project with GPT Image 2.5 (via Krea). The planet
surface, clouds and atmosphere are procedural shaders driven live by the simulation, because
sea level, ice, vegetation and clouds all change as the climate evolves.

## Key references

Abbot et al. 2011 (Jormungand); Abe et al. 2011 (land planets); Boukrouche et al. 2021
(post-runaway); Chaverot et al. 2023 (3D runaway transition); Forget et al. 2013 (early Mars
collapse); Goldblatt et al. 2013 (runaway limit); Hamano et al. 2013 (magma-ocean types);
Hoffman et al. 1998 (snowball Earth); Jeevanjee & Fueglistaler 2020 (spectral models); Kasting et
al. 1993; Kite & Ford 2018 (waterworlds); Kodama et al. 2018; Kopparapu et al. 2013, 2014
(habitable zones); Leconte et al. 2013 (3D runaway, moist bistability); Pierrehumbert & Gaidos
2011 (H₂ greenhouse); Turbet et al. 2016, 2021 (Proxima b, steam hysteresis); Walker et al. 1981
(weathering thermostat); Wolf & Toon 2015; Yang et al. 2013, 2014 (cloud stabilisation);
Zahnle & Catling 2017 (cosmic shoreline).
