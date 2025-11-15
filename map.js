// map.js
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';

// ---------------------- CONFIG ----------------------

// Mapbox public token
mapboxgl.accessToken = 'pk.eyJ1IjoidHJpc3RhbnJvbWFuMTAiLCJhIjoiY21oenBpYTltMHJ6dDJqb2lydGZmNXdrdyJ9.dE5aZAIbKMJtsZ0YHSa7Lw';

// Boston bike lanes GeoJSON 
const BOSTON_BIKE_LANES_URL =
  'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson';

// Cambridge bike lanes GeoJSON URL 
const CAMBRIDGE_BIKE_LANES_URL =
  'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson';

const BLUEBIKES_STATIONS_URL =
  'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';

const BLUEBIKES_TRIPS_URL =
  'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

// Color scale for flow (departures vs arrivals)
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

// ---------------------- HELPERS ----------------------

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Filter trips within +/- 60 minutes of timeFilter
function filterTripsByTime(trips, timeFilter) {
  if (timeFilter === -1) return trips;

  return trips.filter((trip) => {
    const startedMinutes = minutesSinceMidnight(trip.started_at);
    const endedMinutes = minutesSinceMidnight(trip.ended_at);

    return (
      Math.abs(startedMinutes - timeFilter) <= 60 ||
      Math.abs(endedMinutes - timeFilter) <= 60
    );
  });
}

// Compute arrivals / departures / total per station
function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id,
  );

  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id,
  );

  return stations.map((station) => {
    const id = station.short_name; 
    const sArrivals = arrivals.get(id) ?? 0;
    const sDepartures = departures.get(id) ?? 0;
    const totalTraffic = sArrivals + sDepartures;

    return {
      ...station,
      arrivals: sArrivals,
      departures: sDepartures,
      totalTraffic,
    };
  });
}

// ---------------------- MAP SETUP ----------------------

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027], // [lon, lat]
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

// Project station lon/lat into SVG pixel coords
function getCoords(station) {
  
  const lon = +station.lon;
  const lat = +station.lat;
  const point = new mapboxgl.LngLat(lon, lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// ---------------------- MAIN ----------------------

map.on('load', async () => {
  console.log('Map loaded');

  // ----- Step 2: bike lanes (Boston + Cambridge) -----
  const bikeLanePaint = {
    'line-color': '#32D400',
    'line-width': 3,
    'line-opacity': 0.6,
  };

  map.addSource('boston_route', {
    type: 'geojson',
    data: BOSTON_BIKE_LANES_URL,
  });

  map.addLayer({
    id: 'boston-bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: bikeLanePaint,
  });

  if (CAMBRIDGE_BIKE_LANES_URL !== 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson') {
    map.addSource('cambridge_route', {
      type: 'geojson',
      data: CAMBRIDGE_BIKE_LANES_URL,
    });

    map.addLayer({
      id: 'cambridge-bike-lanes',
      type: 'line',
      source: 'cambridge_route',
      paint: bikeLanePaint,
    });
  }

  // ----- Step 3: SVG overlay & station data -----
  const svg = d3.select('#map').select('svg');

  const stationsJson = await d3.json(BLUEBIKES_STATIONS_URL);
  
  let stations = stationsJson.data.stations;

  // ----- Step 4: trips + traffic -----
  let trips = await d3.csv(BLUEBIKES_TRIPS_URL, (trip) => {
    trip.started_at = new Date(trip.started_at);
    trip.ended_at = new Date(trip.ended_at);
    return trip;
  });

  let stationsWithTraffic = computeStationTraffic(stations, trips);

  // sqrt scale for area-correct circle size
  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stationsWithTraffic, (d) => d.totalTraffic)])
    .range([0, 25]);

  // Draw circles
  const circles = svg
    .selectAll('circle')
    .data(stationsWithTraffic, (d) => d.short_name)
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .attr('opacity', 0.8)
    .each(function (d) {
      d3.select(this)
        .append('title')
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
        );
    })
    .style('--departure-ratio', (d) =>
      stationFlow(
        d.totalTraffic ? d.departures / d.totalTraffic : 0.5,
      ),
    );

  // Keep markers aligned with map
  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  // ----- Step 5: slider + filtering -----
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  let currentTimeFilter = -1;

  function updateScatterPlot(timeFilter) {
    const filteredTrips = filterTripsByTime(trips, timeFilter);
    const filteredStations = computeStationTraffic(stations, filteredTrips);

    // adjust radius range when filtered
    const maxTraffic =
      d3.max(filteredStations, (d) => d.totalTraffic) ?? 0;

    radiusScale.domain([0, maxTraffic || 1]);
    if (timeFilter === -1) {
      radiusScale.range([0, 25]);
    } else {
      radiusScale.range([3, 50]);
    }

    circles
      .data(filteredStations, (d) => d.short_name)
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .each(function (d) {
        const t = d3.select(this).select('title');
        if (!t.empty()) {
          t.text(
            `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
          );
        }
      })
      .style('--departure-ratio', (d) =>
        stationFlow(
          d.totalTraffic ? d.departures / d.totalTraffic : 0.5,
        ),
      );

    updatePositions();
  }

  function updateTimeDisplay() {
    currentTimeFilter = Number(timeSlider.value);

    if (currentTimeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'inline';
    } else {
      selectedTime.textContent = formatTime(currentTimeFilter);
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(currentTimeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay(); // initial render
});
