// ====================
// API and event themes
// ====================

const API_URL =
  "https://live-music-api.vivianwei-li.workers.dev";

const eventThemes = {
  Concert: {
    hex: "#ff4e9b",
    rgb: "255, 78, 155"
  },
  "Club Show": {
    hex: "#4dd8ff",
    rgb: "77, 216, 255"
  },
  "Stadium Show": {
    hex: "#ba86ff",
    rgb: "186, 134, 255"
  }
};

const defaultTheme = {
  hex: "#f1b95e",
  rgb: "241, 185, 94"
};

const HOME_VIEW = {
  lat: 20,
  lng: 0,
  altitude: 2.1
};

// ====================
// Page elements
// ====================

const globeElement = document.getElementById("globe");
const artistPanel = document.getElementById("artist-panel");
const searchInput = document.getElementById("artist-search");
const genreFilter = document.getElementById("genre-filter");
const panelScrim = document.getElementById("panel-scrim");

let shows = [];
let hoveredShow = null;
let selectedShow = null;
let audioOn = true;
let audioContext;
let loading = false;
let lastUpdated = null;
let previousFocus = null;

// Small helpers

function setText(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = value;
  }
}

function getTheme(show) {
  return eventThemes[show.genre] || defaultTheme;
}

function safeUrl(value) {
  if (!value) return "";

  try {
    const url = new URL(value);

    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function plainText(value) {
  const documentValue = new DOMParser().parseFromString(
    String(value || ""),
    "text/html"
  );

  return documentValue.body.textContent
    .replace(/\s+/g, " ")
    .trim();
}

// ====================
// Real event categories
// ====================

genreFilter.replaceChildren();

[
  ["all", "All shows"],
  ["Concert", "Concerts"],
  ["Club Show", "Club shows"],
  ["Stadium Show", "Stadium shows"]
].forEach(([value, label]) => {
  const option = document.createElement("option");

  option.value = value;
  option.textContent = label;

  genreFilter.append(option);
});

searchInput.placeholder = "Search a show, city or venue";

const legend = document.querySelector(".genre-legend");

if (legend) {
  legend.replaceChildren();

  Object.entries(eventThemes).forEach(([label, theme]) => {
    const item = document.createElement("span");
    const dot = document.createElement("i");

    dot.style.background = theme.hex;
    dot.style.boxShadow = `0 0 12px ${theme.hex}`;

    item.append(dot, document.createTextNode(label));
    legend.append(item);
  });
}

// ====================
// Globe
// ====================

const globe = new Globe(globeElement)
  .backgroundColor("rgba(0,0,0,0)")
  .globeImageUrl(
    "https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-night.jpg"
  )
  .backgroundImageUrl(null)
  .showAtmosphere(true)
  .atmosphereColor("#c49a52")
  .atmosphereAltitude(0.16)
  .pointsData([])
  .pointLat("lat")
  .pointLng("lng")
  .pointColor(show => getTheme(show).hex)
  .pointRadius(show => show === hoveredShow ? 1.25 : 0.95)
  .pointAltitude(show => show === hoveredShow ? 0.025 : 0.01)
  .pointResolution(16)
  .pointsMerge(false)
  .pointLabel(point => {
  const count = point.events?.length || 1;

  return `
    <div style="max-width:260px;padding:12px;line-height:1.6;">
      <strong>${escapeHtml(point.city)}</strong><br>
      ${
        count > 1
          ? `${count} shows in this area`
          : escapeHtml(point.title)
      }
      <br>
      <span style="color:#d7baff;">
        ${count > 1 ? "Click to choose a show" : "Click to explore"}
      </span>
    </div>
  `;
})
.ringsData([])
.ringLat("lat")
.ringLng("lng")
.ringColor(point => getTheme(point).hex)
.ringMaxRadius(2.2)
.ringPropagationSpeed(1.1)
.ringRepeatPeriod(1200)
.onPointHover(point => {
  hoveredShow = point || null;

  // Refresh size while keeping the same point objects.
  globe.pointRadius(
    item => item === hoveredShow ? 1.25 : 0.95
  );

  globe.pointAltitude(
    item => item === hoveredShow ? 0.025 : 0.01
  );

  globe.ringsData(point ? [point] : []);
  globeElement.style.cursor = point ? "pointer" : "grab";
})
.onPointClick(point => {
  if (point.events?.length > 1) {
    openLocationPicker(point);
  } else {
    openShow(point.events?.[0] || point);
  }
});

globe.onGlobeReady(() => {
  const material = globe.globeMaterial();

  if (!material) return;

  material.color?.set("#c9a45e");
  material.specular?.set("#6f552d");

  if ("shininess" in material) {
    material.shininess = 14;
  }

  material.needsUpdate = true;
});

globe.controls().enableDamping = true;
globe.controls().dampingFactor = 0.08;
globe.pointOfView(HOME_VIEW, 0);

// Date filter

const dateFilterRow = document.createElement("div");
dateFilterRow.className = "date-filter-row";

const dateFilterLabel = document.createElement("label");
dateFilterLabel.htmlFor = "date-filter";
dateFilterLabel.textContent = "WHEN";

const dateFilter = document.createElement("select");
dateFilter.id = "date-filter";

[
  ["all", "All loaded shows"],
  ["7", "Next 7 days"],
  ["30", "Next 30 days"]
].forEach(([value, text]) => {
  const option = document.createElement("option");

  option.value = value;
  option.textContent = text;

  dateFilter.append(option);
});

const dateFilterNote = document.createElement("p");
dateFilterNote.textContent =
  "Explore the events currently loaded from Ticket Fairy.";

dateFilterRow.append(dateFilterLabel, dateFilter);

const searchRow = document.querySelector(".search-row");

if (searchRow) {
  searchRow.after(dateFilterRow);
  dateFilterRow.after(dateFilterNote);
}

dateFilterNote.className = "date-filter-note";

dateFilter.addEventListener("change", () => {
  // Close outdated details before showing the new results.
  if (selectedShow) closeShow();

  if (locationDialog.open) {
    locationDialog.close();
  }

  playClickSound();
  updateGlobe();
});

// ====================
// Filter and count
// ====================

function getVisibleShows() {
  const query = searchInput.value.trim().toLowerCase();
  const selectedGenre = genreFilter.value;
  const selectedDays = dateFilter.value;

  const now = Date.now();

  const endTime = selectedDays === "all"
    ? Infinity
    : now + Number(selectedDays) * 24 * 60 * 60 * 1000;

  return shows.filter(show => {
    const matchesGenre =
      selectedGenre === "all" ||
      show.genre === selectedGenre;

    const searchableText =
      `${show.title} ${show.city} ${show.venue} ${show.country}`
        .toLowerCase();

    const matchesSearch = searchableText.includes(query);

    const startTime = new Date(show.startDate).getTime();

    // Date windows include events starting from now.
    // Events with hidden dates remain available under "All".
    const matchesDate =
      selectedDays === "all" ||
      (
        !show.hideDate &&
        startTime >= now &&
        startTime < endTime
      );

    return matchesGenre && matchesSearch && matchesDate;
  });
}
// Group events that share the same map location.
function getMapPoints() {
  const events = getVisibleShows();

  // Nearby venues form one selectable area.
  const mergeDistanceKm = 250;

  const parents = events.map((_, index) => index);

  function find(index) {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }

    return index;
  }

  function distanceKm(first, second) {
    const radians = degrees => degrees * Math.PI / 180;

    const latitudeDifference = radians(second.lat - first.lat);
    const longitudeDifference = radians(second.lng - first.lng);

    const value =
      Math.sin(latitudeDifference / 2) ** 2 +
      Math.cos(radians(first.lat)) *
      Math.cos(radians(second.lat)) *
      Math.sin(longitudeDifference / 2) ** 2;

    return 6371 * 2 * Math.asin(
      Math.sqrt(Math.min(1, Math.max(0, value)))
    );
  }

  // Join nearby events, including chains of nearby venues.
  for (let first = 0; first < events.length; first++) {
    for (let second = first + 1; second < events.length; second++) {
      if (
        distanceKm(events[first], events[second]) <=
        mergeDistanceKm
      ) {
        parents[find(second)] = find(first);
      }
    }
  }

  const groups = new Map();

  events.forEach((show, index) => {
    const root = find(index);

    if (!groups.has(root)) {
      groups.set(root, []);
    }

    groups.get(root).push(show);
  });

  return [...groups.values()].map(group => {
    const representative = group[0];

    const cities = [
      ...new Set(group.map(show => show.city))
    ];

    return {
      ...representative,

      // Keep the marker at a real venue coordinate.
      // Each event retains its own original coordinates.
      city: cities.length > 1
        ? `${representative.city} + nearby`
        : representative.city,

      events: group,
      cities
    };
  });
}
function updateGlobe() {
  const visibleShows = getVisibleShows();
  const mapPoints = getMapPoints();

  hoveredShow = null;

 globe.pointsData(mapPoints);

// Show numbers only for locations with multiple events.
globe.labelsData(
  mapPoints.filter(point => point.events.length > 1)
);

globe.ringsData([]);

  setText(
    "event-count",
    String(visibleShows.length).padStart(2, "0")
  );

  if (lastUpdated) {
    const time = new Intl.DateTimeFormat("en", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(lastUpdated);

    setText(
      "updated-label",
      visibleShows.length
        ? `${mapPoints.length} LOCATIONS · UPDATED ${time}`
        : "NO MATCHING SHOWS"
    );
  }
}

// ====================
// Convert API data
// ====================

function normaliseEvent(event) {
  const types = event.eventTypes || [];

  let genre;

  if (types.includes("stadiumShow")) {
    genre = "Stadium Show";
  } else if (types.includes("concert")) {
    genre = "Concert";
  } else if (types.includes("clubShow")) {
    genre = "Club Show";
  } else {
    return null;
  }

  const venue = event.venue || {};

  // Missing coordinates must not become 0, 0.
  if (
    venue.hidden ||
    venue.latitude == null ||
    venue.longitude == null ||
    String(venue.latitude).trim() === "" ||
    String(venue.longitude).trim() === ""
  ) {
    return null;
  }

  const lat = Number(venue.latitude);
  const lng = Number(venue.longitude);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return null;
  }

  const start = new Date(event.startDate);
  const end = new Date(event.endDate || event.startDate);

  if (!Number.isFinite(start.getTime())) {
    return null;
  }

  if (
    Number.isFinite(end.getTime()) &&
    end.getTime() < Date.now()
  ) {
    return null;
  }

  return {
    id: event.url || `${event.displayName}-${event.startDate}`,
    title: event.displayName || "Untitled show",
    genre,
    city: venue.city || "City not listed",
    country: String(venue.country || "").toUpperCase(),
    venue: venue.name || "Venue to be announced",
    startDate: event.startDate,
    timezone: event.timezone,
    hideDate: event.hideDate,
    lat,
    lng,
    image: safeUrl(event.imageURL || event.thumbnailURL),
    description: plainText(
      event.description || event.shortDescription
    ),
    summary: plainText(
      event.shortDescription || event.subtitle
    ),
    price: event.startingPrice,
    ticketUrl: safeUrl(event.url)
  };
}

// ====================
// Load live events
// ====================

async function loadShows() {
  if (loading) return;

  loading = true;

  setText(
    "data-mode",
    lastUpdated ? "UPDATING" : "LOADING SHOWS"
  );

  try {
    const response = await fetch(API_URL, {
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      throw new Error(`API returned HTTP ${response.status}`);
    }

    const result = await response.json();

    if (
      result.error ||
      result.success === false ||
      !Array.isArray(result.data?.events)
    ) {
      throw new Error(
        result.message || "Unexpected event data."
      );
    }

    const uniqueShows = new Map();

    result.data.events.forEach(event => {
      const show = normaliseEvent(event);

      if (show) {
        uniqueShows.set(show.id, show);
      }
    });

    shows = [...uniqueShows.values()].sort(
      (a, b) => new Date(a.startDate) - new Date(b.startDate)
    );

    lastUpdated = new Date();

    setText("data-mode", "LIVE EVENT DATA");

    updateGlobe();

    // Refresh an open panel if its event is still returned.
    if (selectedShow) {
      const updatedShow = shows.find(
        show => show.id === selectedShow.id
      );

      if (updatedShow) {
        fillPanel(updatedShow);
      } else {
        closeShow();
      }
    }

    const footer = document.querySelector(
      ".footer span:last-child"
    );

    if (footer) {
      footer.textContent =
        "EVENT DATA · TICKET FAIRY";
    }

    console.info(
      `Loaded ${shows.length} mapped music events from ` +
      `${result.data.events.length} returned records.`
    );
  } catch (error) {
    console.error("Could not load events:", error);

    setText(
      "data-mode",
      lastUpdated ? "SAVED SESSION DATA" : "CONNECTION FAILED"
    );

    setText(
      "updated-label",
      lastUpdated
        ? "UPDATE FAILED · SHOWING PREVIOUS RESULTS"
        : "COULD NOT LOAD SHOWS · PLEASE RETRY"
    );
  } finally {
    loading = false;
  }
}

// Add a retry / refresh button beside the existing data label.

const dataLabel = document.getElementById("updated-label");

if (dataLabel) {
  const refreshButton = document.createElement("button");

  refreshButton.type = "button";
  refreshButton.textContent = "↻ Refresh";
  refreshButton.setAttribute("aria-label", "Refresh event data");

  Object.assign(refreshButton.style, {
    background: "transparent",
    border: "1px solid #8b703f",
    color: "#e2c68c",
    borderRadius: "4px",
    padding: "5px 9px",
    marginLeft: "10px",
    cursor: "pointer",
    pointerEvents: "auto"
  });

  refreshButton.addEventListener("click", () => {
    playClickSound();
    loadShows();
  });

  dataLabel.after(refreshButton);
}

// ====================
// Event details
// ====================

// Create a place for the real event description and price.

const extraDetails = document.createElement("div");
extraDetails.id = "event-extra-details";

Object.assign(extraDetails.style, {
  margin: "20px 0",
  lineHeight: "1.7",
  fontSize: "14px"
});

const ticketLink = document.getElementById("ticket-link");

if (ticketLink) {
  ticketLink.before(extraDetails);
} else {
  artistPanel.append(extraDetails);
}

function formatEventDate(show) {
  if (show.hideDate) {
    return "See event page for dates";
  }

  const options = {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  };

  if (show.timezone) {
    options.timeZone = show.timezone;
  }

  try {
    return new Intl.DateTimeFormat("en", options)
      .format(new Date(show.startDate));
  } catch {
    return show.startDate;
  }
}

function formatPrice(price) {
  if (
    !price ||
    price.amount == null ||
    price.amount === "" ||
    !price.currency ||
    !Number.isFinite(Number(price.amount))
  ) {
    return "Price not provided · check ticket page";
  }

  try {
    return "From " + new Intl.NumberFormat("en", {
      style: "currency",
      currency: price.currency
    }).format(Number(price.amount));
  } catch {
    return `From ${price.amount} ${price.currency}`;
  }
}

function fillPanel(show) {
  selectedShow = show;

  const theme = getTheme(show);

  document.documentElement.style.setProperty(
    "--accent",
    theme.hex
  );

  document.documentElement.style.setProperty(
    "--accent-rgb",
    theme.rgb
  );

  setText("panel-genre", `LIVE / ${show.genre.toUpperCase()}`);
  setText("panel-artist", show.title);
  setText(
    "panel-tagline",
    show.summary || `${show.genre} in ${show.city}.`
  );

  setText("panel-date", formatEventDate(show));
  setText("panel-venue", show.venue);
  setText(
    "panel-city",
    [show.city, show.country].filter(Boolean).join(", ")
  );

  setText(
    "panel-clue-text",
    `Follow this signal to ${show.venue} in ${show.city}.`
  );

  const art = document.getElementById("panel-art");

  if (art) {
    art.replaceChildren();

    if (show.image) {
      const image = document.createElement("img");

      image.src = show.image;
      image.alt = `Promotional image for ${show.title}`;

      Object.assign(image.style, {
        width: "100%",
        height: "100%",
        objectFit: "contain",
        display: "block",
        background: "#100e0b"
      });

      image.addEventListener("error", () => {
        art.textContent = "LIVE MUSIC";
      }, { once: true });

      art.append(image);
    } else {
      art.textContent = "LIVE MUSIC";
    }
  }

  extraDetails.replaceChildren();

  const price = document.createElement("p");
  price.textContent = formatPrice(show.price);
  price.style.fontWeight = "700";
  price.style.color = theme.hex;

  const timeNote = document.createElement("p");

  timeNote.textContent = show.timezone
    ? `Venue local time · ${show.timezone}`
    : "Time shown as supplied by the event provider.";

  timeNote.style.fontSize = "12px";
  timeNote.style.opacity = "0.75";

  const description = document.createElement("p");

  description.textContent =
    show.description || "More details are available on the ticket page.";

  description.style.whiteSpace = "pre-line";

  extraDetails.append(price, timeNote, description);

  if (ticketLink) {
    ticketLink.hidden = !show.ticketUrl;

    if (show.ticketUrl) {
      ticketLink.href = show.ticketUrl;
      ticketLink.target = "_blank";
      ticketLink.rel = "noopener noreferrer";
      ticketLink.textContent = "VIEW EVENT & TICKETS ↗";
    }
  }
}

function openShow(show) {
  previousFocus = document.activeElement;

  fillPanel(show);

  artistPanel.classList.add("open");
  artistPanel.setAttribute("aria-hidden", "false");
  artistPanel.style.overflowY = "auto";

  panelScrim?.classList.add("open");

  playClickSound();

  globe.pointOfView({
    lat: show.lat,
    lng: show.lng,
    altitude: 1.7
  }, 800);

  document.getElementById("panel-close")?.focus();
}

function closeShow() {
  selectedShow = null;

  artistPanel.classList.remove("open");
  artistPanel.setAttribute("aria-hidden", "true");

  panelScrim?.classList.remove("open");

  document.documentElement.style.setProperty(
    "--accent",
    defaultTheme.hex
  );

  document.documentElement.style.setProperty(
    "--accent-rgb",
    defaultTheme.rgb
  );

  previousFocus?.focus();
}

// ====================
// Click sound
// ====================

async function playClickSound() {
  if (!audioOn) return;

  try {
    audioContext ||= new AudioContext();

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const volume = audioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = 740;

    volume.gain.setValueAtTime(0.0001, now);
    volume.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
    volume.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

    oscillator.connect(volume);
    volume.connect(audioContext.destination);

    oscillator.start(now);
    oscillator.stop(now + 0.26);
  } catch (error) {
    console.info("Optional sound unavailable:", error);
  }
}

// ====================
// User interactions
// ====================

searchInput.addEventListener("input", updateGlobe);
genreFilter.addEventListener("change", updateGlobe);

document.getElementById("panel-close")
  ?.addEventListener("click", closeShow);

panelScrim?.addEventListener("click", closeShow);

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && selectedShow) {
    closeShow();
  }
});

document.getElementById("reset-view")
  ?.addEventListener("click", () => {
    closeShow();
    globe.pointOfView(HOME_VIEW, 800);
  });

document.getElementById("sound-toggle")
  ?.addEventListener("click", event => {
    audioOn = !audioOn;

    const button = event.currentTarget;
    const label = button.querySelector("span:last-child");

    if (label) {
      label.textContent = audioOn ? "Sound on" : "Sound off";
    } else {
      button.textContent = audioOn ? "Sound on" : "Sound off";
    }

    button.setAttribute("aria-pressed", String(audioOn));
  });

// ====================
// Responsive globe
// ====================

function resizeGlobe() {
  const bounds = globeElement.getBoundingClientRect();

  const offsetX = window.innerWidth <= 900
    ? 0
    : Math.min(100, Math.max(42, window.innerWidth * 0.055));

  globe
    .width(bounds.width)
    .height(bounds.height)
    .globeOffset([offsetX, 0]);
}

window.addEventListener("resize", resizeGlobe);

resizeGlobe();
updateGlobe();
loadShows();

// Check for updated event data every five minutes.
// Hidden browser tabs pause these requests.

setInterval(() => {
  if (!document.hidden) {
    loadShows();
  }
}, 5 * 60 * 1000);
// ====================
// Ambient sparkle background
// ====================

(() => {
  if (document.getElementById("sparkle-background")) return;

  const shell = document.querySelector(".site-shell");

  if (!shell) return;

  const canvas = document.createElement("canvas");

  canvas.id = "sparkle-background";
  canvas.setAttribute("aria-hidden", "true");

  shell.prepend(canvas);

  const context = canvas.getContext("2d");

  if (!context) return;

  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  let width = 0;
  let height = 0;
  let particles = [];
  let animationFrame = null;
  let lastFrame = null;
  let elapsed = 0;

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const count = width < 700 ? 65 : 140;

    particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: Math.random() * 1.1 + 0.3,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.7 + 0.3,
      drift: Math.random() * 3 + 1,
      bright: Math.random() > 0.88
    }));

    draw(elapsed);
  }

  function draw(time) {
    context.clearRect(0, 0, width, height);

    particles.forEach(particle => {
      const twinkle =
        0.5 + 0.5 * Math.sin(time * particle.speed + particle.phase);

      const alpha = 0.12 + twinkle * 0.6;

      const x =
        particle.x +
        Math.sin(time * 0.13 + particle.phase) * 14;

      const y =
        ((particle.y - time * particle.drift) % height + height) %
        height;

      context.fillStyle = `rgba(220, 199, 255, ${alpha})`;

      context.beginPath();
      context.arc(x, y, particle.radius, 0, Math.PI * 2);
      context.fill();

      if (particle.bright) {
        const glow = context.createRadialGradient(
          x, y, 0,
          x, y, 9
        );

        glow.addColorStop(
          0,
          `rgba(243, 215, 255, ${alpha * 0.45})`
        );

        glow.addColorStop(1, "rgba(180, 130, 255, 0)");

        context.fillStyle = glow;
        context.fillRect(x - 9, y - 9, 18, 18);

        context.strokeStyle =
          `rgba(245, 224, 255, ${twinkle * 0.5})`;

        context.lineWidth = 0.6;

        context.beginPath();
        context.moveTo(x - 3, y);
        context.lineTo(x + 3, y);
        context.moveTo(x, y - 3);
        context.lineTo(x, y + 3);
        context.stroke();
      }
    });
  }

  function animate(timestamp) {
    if (lastFrame !== null) {
      elapsed += Math.min((timestamp - lastFrame) / 1000, 0.05);
    }

    lastFrame = timestamp;

    draw(elapsed);

    animationFrame = requestAnimationFrame(animate);
  }

  function updateAnimation() {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }

    lastFrame = null;

    if (!document.hidden && !reducedMotion.matches) {
      animationFrame = requestAnimationFrame(animate);
    } else {
      draw(elapsed);
    }
  }

  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", updateAnimation);
  reducedMotion.addEventListener("change", updateAnimation);

  resize();
  updateAnimation();
})();

// ====================
// Choose a show at a shared location
// ====================

const locationDialog = document.createElement("dialog");
locationDialog.className = "location-dialog";
locationDialog.setAttribute(
  "aria-labelledby",
  "location-dialog-title"
);

document.body.append(locationDialog);

function openLocationPicker(point) {
  locationDialog.replaceChildren();

  const header = document.createElement("div");
  header.className = "location-dialog-header";

  const headingGroup = document.createElement("div");

  const eyebrow = document.createElement("p");
  eyebrow.className = "location-eyebrow";
  eyebrow.textContent = "CHOOSE YOUR NIGHT";

  const heading = document.createElement("h2");
  heading.id = "location-dialog-title";
  heading.textContent = point.city;

  const subtitle = document.createElement("p");
  subtitle.className = "location-subtitle";
  subtitle.textContent =
  `${point.events.length} shows in this area · Choose one below`;

  const closeButton = document.createElement("button");
  closeButton.className = "location-close";
  closeButton.type = "button";
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", "Close show list");

  closeButton.addEventListener("click", () => {
    locationDialog.close();
  });

  headingGroup.append(eyebrow, heading, subtitle);
  header.append(headingGroup, closeButton);

  const list = document.createElement("div");
  list.className = "location-show-list";

  [...point.events]
    .sort(
      (a, b) =>
        new Date(a.startDate) - new Date(b.startDate)
    )
    .forEach(show => {
      const card = document.createElement("button");

      card.type = "button";
      card.className = "location-show-card";

      card.style.setProperty(
        "--show-color",
        getTheme(show).hex
      );

      if (show.image) {
        const image = document.createElement("img");

        image.src = show.image;
        image.alt = "";
        image.loading = "lazy";

        image.addEventListener("error", () => {
          image.hidden = true;
        }, { once: true });

        card.append(image);
      }

      const content = document.createElement("span");
      content.className = "location-show-content";

      const category = document.createElement("span");
      category.className = "location-show-category";
      category.textContent = show.genre;

      const title = document.createElement("strong");
      title.textContent = show.title;

      const date = document.createElement("span");
      date.textContent = formatEventDate(show);

      const venue = document.createElement("span");
      venue.textContent = show.venue;

      const arrow = document.createElement("span");
      arrow.className = "location-show-arrow";
      arrow.textContent = "↗";
      arrow.setAttribute("aria-hidden", "true");

      content.append(category, title, date, venue);
      card.append(content, arrow);

      card.addEventListener("click", () => {
        locationDialog.close();
        openShow(show);
      });

      list.append(card);
    });

  locationDialog.append(header, list);

  playClickSound();

  globe.pointOfView({
    lat: point.lat,
    lng: point.lng,
    altitude: 1.7
  }, 800);

  if (!locationDialog.open) {
    locationDialog.showModal();
  }

  closeButton.focus();
}

// Clicking the dark area outside the dialog closes it.
locationDialog.addEventListener("click", event => {
  if (event.target !== locationDialog) return;

  const bounds = locationDialog.getBoundingClientRect();

  const outside =
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom;

  if (outside) {
    locationDialog.close();
  }
});

// ====================
// Cluster sizes and count labels
// ====================

function markerRadius(point) {
  const count = point.events?.length || 1;

  const normalSize = Math.min(
    1.3,
    0.65 + Math.sqrt(count) * 0.12
  );

  return normalSize + (point === hoveredShow ? 0.18 : 0);
}

function hoverMapPoint(point) {
  hoveredShow = point || null;

  globe
    .pointRadius(markerRadius)
    .pointAltitude(
      item => item === hoveredShow ? 0.025 : 0.01
    )
    .ringsData(point ? [point] : []);

  globeElement.style.cursor = point ? "pointer" : "grab";
}

function chooseMapPoint(point) {
  if (point.events?.length > 1) {
    openLocationPicker(point);
  } else {
    openShow(point.events?.[0] || point);
  }
}

globe
  .pointRadius(markerRadius)
  .labelsData([])
  .labelLat("lat")
  .labelLng("lng")
  .labelText(point => String(point.events.length))
  .labelSize(0.85)
  .labelColor(() => "#ffffff")
  .labelAltitude(0.045)
  .labelIncludeDot(false)
  .labelResolution(3)
  .labelsTransitionDuration(250)
  .labelLabel(point =>
    `${point.events.length} shows · Click to choose`
  )
  .onPointHover(hoverMapPoint)
  .onLabelHover(hoverMapPoint)
  .onPointClick(chooseMapPoint)
  .onLabelClick(chooseMapPoint);

updateGlobe();

setText(
  "updated-label",
  lastUpdated
    ? document.getElementById("updated-label").textContent
    : "LOADING EVENT LOCATIONS"
);