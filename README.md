# CraterNav

Interactive results page for a personal project on crater-based optical navigation around the
Moon: a neural network finds the craters in every image from a simulated lunar orbiter, each one
is matched to a catalogue of 1.3 million known craters, and an extended Kalman filter turns the
matches into the spacecraft's position.

**Live → https://eduacu2001.github.io/craternav/**

- Three orbits at 100 km (5 h 53 min), starting from a 1 km position error: median position
  error in daylight **105 m**, 95 % of the time below **184 m**. The same filter without craters
  drifts to **48 km**.
- Crater detector: a U-Net with 0.49 million parameters, trained on 4,000 images rendered from
  the LOLA elevation model. On twelve regions of the Moon it never saw, it finds 57 % of the
  catalogued craters, and 73 % of what it reports is in the catalogue.
- The filter estimates each crater's catalogue error alongside the orbit, so the position error
  stays inside the filter's own 3σ bounds.
- Data: LRO Lunar Orbiter Laser Altimeter gridded elevation models (NASA PDS) and the Robbins
  (2019) database of lunar craters.

This repository holds only the page: static HTML, CSS and JavaScript, with the data it shows.
The simulation, training and navigation code (Python) is not public.

Eduardo Acuña · eduacu2001@gmail.com
