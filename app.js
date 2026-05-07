
"use strict";   // strict exception handling
// MAP INITIALIZATION

const map = L.map("map", {
  zoomControl: false,
  preferCanvas: true
}).setView([34.135, 74.836], 17);

L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution: "&copy; OpenStreetMap & Carto",
  maxZoom: 20
}).addTo(map);

/* =====================================================
   2. MAP PANES
===================================================== */

map.createPane("landUsePane");
map.createPane("roadsPane");
map.createPane("buildingsPane");
map.createPane("poiPane");
map.createPane("routePane");

map.getPane("landUsePane").style.zIndex = 400;
map.getPane("roadsPane").style.zIndex = 450;
map.getPane("buildingsPane").style.zIndex = 520;
map.getPane("poiPane").style.zIndex = 650;
map.getPane("routePane").style.zIndex = 700;

map.getPane("roadsPane").style.pointerEvents = "none";
map.getPane("routePane").style.pointerEvents = "none";

/* =====================================================
   3. DOM ELEMENTS
===================================================== */

const searchInput = document.getElementById("searchInput");
const searchSuggestions = document.getElementById("searchSuggestions");

const infoCard = document.getElementById("infoCard");
const closeCard = document.getElementById("closeCard");

const cardImage = document.getElementById("cardImage");
const cardCategory = document.getElementById("cardCategory");
const cardTitle = document.getElementById("cardTitle");
const cardDesc = document.getElementById("cardDesc");
const cardLocation = document.getElementById("cardLocation");
const cardTime = document.getElementById("cardTime");
const cardPhone = document.getElementById("cardPhone");

const directionBtn = document.getElementById("directionBtn");
const bottomDirectionBtn = document.getElementById("bottomDirectionBtn");

const bottomTitle = document.getElementById("bottomTitle");
const bottomDesc = document.getElementById("bottomDesc");

const zoomInBtn = document.getElementById("zoomIn");
const zoomOutBtn = document.getElementById("zoomOut");
const locateBtn = document.getElementById("locateBtn");

const locationPrompt = document.getElementById("locationPrompt");
const allowLocationBtn = document.getElementById("allowLocationBtn");
const skipLocationBtn = document.getElementById("skipLocationBtn");

/* =====================================================
   4. GLOBAL STATE
===================================================== */

let selectedDestination = null;
let selectedFeatureData = null;

let userLatLng = null;
let userMarker = null;
let selectedMarker = null;

let routeLayer = null;
let routeHelperStart = null;
let routeHelperEnd = null;

let campusBounds = null;
let roadGraph = {};
let searchItems = [];
let currentFilter = "all";

let watchId = null;
let isTracking = false;
let hasReachedDestination = false;

/*
  Important bug fix:
  Every new route gets a new route id.
  Old watchPosition updates are ignored.
*/
let activeRouteId = 0;

/* =====================================================
   5. GEOJSON READER
===================================================== */

function normalizeGeoJSON(data) {
  if (!data) return null;

  if (Array.isArray(data)) {
    if (data.length === 0) return null;

    if (data[0] && data[0].type === "FeatureCollection") {
      return data[0];
    }

    if (data[0] && data[0].type === "Feature") {
      return {
        type: "FeatureCollection",
        features: data
      };
    }
  }

  if (data.type === "FeatureCollection" && Array.isArray(data.features)) {
    return data;
  }

  if (Array.isArray(data.features)) {
    return {
      type: "FeatureCollection",
      features: data.features
    };
  }

  return null;
}

function getGlobalData(possibleNames) {
  for (const name of possibleNames) {
    try {
      const value = Function(`
        return typeof ${name} !== "undefined" ? ${name} : undefined;
      `)();

      if (typeof value !== "undefined") {
        return value;
      }
    } catch (error) {
      // ignore missing variable
    }
  }

  return null;
}

const buildingsGeoJSON = normalizeGeoJSON(
  getGlobalData([
    "buildingsData",
    "campusBuildings",
    "buildings",
    "buildingData",
    "BuildingData",
    "BUILDINGS",
    "buildingGeoJSON",
    "buildingsGeoJSON"
  ])
);

const landUseGeoJSON = normalizeGeoJSON(
  getGlobalData([
    "landUseData",
    "landuseData",
    "landUse",
    "landuse",
    "landUseGeoJSON",
    "landuseGeoJSON",
    "LANDUSE"
  ])
);

const roadsGeoJSON = normalizeGeoJSON(
  getGlobalData([
    "roadsData",
    "campusRoads",
    "roads",
    "roadData",
    "RoadData",
    "ROADS",
    "roadsGeoJSON",
    "roadGeoJSON"
  ])
);

const poiGeoJSON = normalizeGeoJSON(
  getGlobalData([
    "poiData",
    "campusPOI",
    "pois",
    "poi",
    "poiGeoJSON",
    "POI",
    "poiFeatures"
  ])
);

console.log("Buildings features:", buildingsGeoJSON?.features?.length || 0);
console.log("Road features:", roadsGeoJSON?.features?.length || 0);
console.log("LandUse features:", landUseGeoJSON?.features?.length || 0);
console.log("POI features:", poiGeoJSON?.features?.length || 0);

/* =====================================================
   6. LAYER GROUPS
===================================================== */

const landUseLayerGroup = L.layerGroup().addTo(map);
const roadsLayerGroup = L.layerGroup().addTo(map);
const buildingsLayerGroup = L.layerGroup().addTo(map);
const poiLayerGroup = L.layerGroup().addTo(map);

/* =====================================================
   7. HELPER FUNCTIONS
===================================================== */

function safeText(value, fallback = "Not available") {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
}

function getProps(feature) {
  return feature && feature.properties ? feature.properties : {};
}

function getName(feature) {
  const p = getProps(feature);

  return safeText(
    p.name ||
      p.Name ||
      p.NAME ||
      p.building_name ||
      p.Building_Name ||
      p.buildingName ||
      p.building ||
      p.Building ||
      p.title ||
      p.Title,
    "Unnamed Place"
  );
}

function getCategory(feature) {
  const p = getProps(feature);

  const raw = String(
    p.category ||
      p.Category ||
      p.type ||
      p.Type ||
      p.class ||
      p.Class ||
      p.amenity ||
      p.Amenity ||
      p.landuse ||
      p.landUse ||
      p.kind ||
      p.Kind ||
      ""
  ).toLowerCase();

  const name = getName(feature).toLowerCase();

  if (raw.includes("hostel") || name.includes("hostel")) return "hostel";

  if (
    raw.includes("cafe") ||
    raw.includes("cafeteria") ||
    raw.includes("canteen") ||
    name.includes("cafe") ||
    name.includes("cafeteria") ||
    name.includes("canteen")
  ) {
    return "cafe";
  }

  if (raw.includes("parking") || name.includes("parking")) return "parking";

  if (
    raw.includes("gate") ||
    raw.includes("entrance") ||
    name.includes("gate") ||
    name.includes("entrance")
  ) {
    return "entrance";
  }

  if (
    raw.includes("academic") ||
    raw.includes("department") ||
    raw.includes("school") ||
    raw.includes("faculty") ||
    raw.includes("centre") ||
    raw.includes("center") ||
    raw.includes("institute") ||
    name.includes("department") ||
    name.includes("school") ||
    name.includes("faculty") ||
    name.includes("centre") ||
    name.includes("center") ||
    name.includes("library") ||
    name.includes("institute")
  ) {
    return "academic";
  }

  return raw || "other";
}

function getDescription(feature) {
  const p = getProps(feature);

  return safeText(
    p.description ||
      p.Description ||
      p.desc ||
      p.Desc ||
      p.details ||
      p.info,
    "University of Kashmir campus location."
  );
}

function getImage(feature) {
  const p = getProps(feature);

  return (
    p.image ||
    p.Image ||
    p.img ||
    p.photo ||
    p.thumbnail ||
    "images/default-building.jpg"
  );
}

function getPhone(feature) {
  const p = getProps(feature);
  return safeText(p.phone || p.Phone || p.contact || p.mobile || p.telephone);
}

function getTime(feature) {
  const p = getProps(feature);
  return safeText(p.time || p.Time || p.timing || p.hours || p.opening_hours);
}

function getLocation(feature) {
  const p = getProps(feature);

  return safeText(
    p.location || p.Location || p.address,
    "University of Kashmir Campus"
  );
}

function categoryLabel(category) {
  const labels = {
    academic: "Academic",
    hostel: "Hostel",
    cafe: "Cafe",
    entrance: "Gate",
    parking: "Parking",
    other: "Campus Place"
  };

  return labels[category] || "Campus Place";
}

function getEmoji(category) {
  const emojis = {
    academic: "🎓",
    hostel: "🏠",
    cafe: "☕",
    entrance: "🚪",
    parking: "🅿️",
    other: "📍"
  };

  return emojis[category] || "📍";
}

function shouldShowFeature(feature, filter) {
  if (filter === "all") return true;
  return getCategory(feature) === filter;
}

function getFeatureCenter(layer) {
  if (layer.getBounds) {
    return layer.getBounds().getCenter();
  }

  if (layer.getLatLng) {
    return layer.getLatLng();
  }

  return null;
}

function clearLayer(layerGroup) {
  layerGroup.clearLayers();
}

/* =====================================================
   8. MAP STYLES
===================================================== */

function buildingStyle(feature) {
  const category = getCategory(feature);

  const styles = {
    academic: {
      color: "#38bdf8",
      fillColor: "#075985",
      fillOpacity: 0.46
    },
    hostel: {
      color: "#a78bfa",
      fillColor: "#4c1d95",
      fillOpacity: 0.46
    },
    cafe: {
      color: "#fb923c",
      fillColor: "#7c2d12",
      fillOpacity: 0.52
    },
    entrance: {
      color: "#4ade80",
      fillColor: "#14532d",
      fillOpacity: 0.46
    },
    parking: {
      color: "#facc15",
      fillColor: "#713f12",
      fillOpacity: 0.4
    },
    other: {
      color: "#38bdf8",
      fillColor: "#075985",
      fillOpacity: 0.44
    }
  };

  const s = styles[category] || styles.other;

  return {
    pane: "buildingsPane",
    color: s.color,
    weight: 1.6,
    opacity: 1,
    fillColor: s.fillColor,
    fillOpacity: s.fillOpacity
  };
}

function landUseStyle(feature) {
  const category = getCategory(feature);

  if (category === "parking") {
    return {
      pane: "landUsePane",
      color: "#facc15",
      weight: 1.2,
      opacity: 0.85,
      fillColor: "#713f12",
      fillOpacity: 0.26
    };
  }

  return {
    pane: "landUsePane",
    color: "#22c55e",
    weight: 1,
    opacity: 0.58,
    fillColor: "#064e3b",
    fillOpacity: 0.12
  };
}

function roadStyle(feature) {
  const p = getProps(feature);
  const type = String(p.type || p.Type || p.road_type || "").toLowerCase();

  if (type.includes("foot") || type.includes("path")) {
    return {
      pane: "roadsPane",
      color: "#94a3b8",
      weight: 1.7,
      opacity: 0.55,
      dashArray: "5, 6",
      lineCap: "round",
      lineJoin: "round"
    };
  }

  if (type.includes("primary") || type.includes("main")) {
    return {
      pane: "roadsPane",
      color: "#e5e7eb",
      weight: 3,
      opacity: 0.72,
      lineCap: "round",
      lineJoin: "round"
    };
  }

  return {
    pane: "roadsPane",
    color: "#cbd5e1",
    weight: 2.3,
    opacity: 0.62,
    lineCap: "round",
    lineJoin: "round"
  };
}

/* =====================================================
   9. ICONS
===================================================== */

function createDivIcon(className, html, size = [28, 28]) {
  return L.divIcon({
    className: "",
    html: `<div class="${className}">${html}</div>`,
    iconSize: size,
    iconAnchor: [size[0] / 2, size[1] / 2]
  });
}

function poiIcon(feature) {
  return createDivIcon("poiIcon", getEmoji(getCategory(feature)), [18, 18]);
}

const userLocationIcon = L.divIcon({
  className: "",
  html: `<div class="userLocationDot"></div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12]
});

const selectedLocationIcon = L.divIcon({
  className: "",
  html: `<div class="selectedMarker">📍</div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 30]
});

/* =====================================================
   10. INFO CARD
===================================================== */

function openInfoCard(feature, latlng) {
  const category = getCategory(feature);
  const name = getName(feature);

  selectedFeatureData = feature;
  selectedDestination = latlng;
  hasReachedDestination = false;

  if (cardImage) {
    cardImage.src = getImage(feature);

    cardImage.onerror = function () {
      cardImage.src = "icons/library.jpg";
    };
  }

  cardCategory.textContent = categoryLabel(category);
  cardTitle.textContent = name;
  cardDesc.textContent = getDescription(feature);
  cardLocation.textContent = getLocation(feature);
  cardTime.textContent = getTime(feature);
  cardPhone.textContent = getPhone(feature);

  bottomTitle.textContent = name;
  bottomDesc.textContent = `${categoryLabel(category)} • Click Get Directions to navigate from your location.`;

  infoCard.classList.add("show");

  if (selectedMarker) {
    map.removeLayer(selectedMarker);
  }

  selectedMarker = L.marker(latlng, {
    icon: selectedLocationIcon,
    pane: "poiPane",
    zIndexOffset: 9999
  }).addTo(map);

  map.flyTo(latlng, Math.max(map.getZoom(), 18), {
    animate: true,
    duration: 0.7
  });
}

if (closeCard) {
  closeCard.addEventListener("click", function () {
    infoCard.classList.remove("show");
  });
}

/* =====================================================
   11. RESET SELECTED PLACE
===================================================== */

function resetSelectedPlace() {
  activeRouteId++;

  selectedDestination = null;
  selectedFeatureData = null;
  hasReachedDestination = false;

  if (infoCard) {
    infoCard.classList.remove("show");
  }

  if (selectedMarker) {
    map.removeLayer(selectedMarker);
    selectedMarker = null;
  }

  clearRoute();
  stopTrackingUser();

  bottomTitle.textContent = "Campus Map";
  bottomDesc.textContent = "Search or select a category to explore University of Kashmir campus.";
}

/* =====================================================
   12. LOAD LAND USE
===================================================== */

function loadLandUse(filter = "all") {
  clearLayer(landUseLayerGroup);

  if (!landUseGeoJSON || !landUseGeoJSON.features) {
    console.warn("landUse.js not found or variable name is incorrect.");
    return;
  }

  L.geoJSON(landUseGeoJSON, {
    pane: "landUsePane",
    interactive: true,

    filter: function (feature) {
      const category = getCategory(feature);

      if (filter === "all") return true;
      if (filter === "parking") return category === "parking";

      return false;
    },

    style: landUseStyle,

    onEachFeature: function (feature, layer) {
      const name = getName(feature);

      layer.on("click", function () {
        const center = getFeatureCenter(layer);
        if (center) openInfoCard(feature, center);
      });

      const center = getFeatureCenter(layer);

      if (center) {
        searchItems.push({
          name,
          category: getCategory(feature),
          feature,
          layer,
          latlng: center
        });
      }
    }
  }).addTo(landUseLayerGroup);
}

/* =====================================================
   13. LOAD BUILDINGS
===================================================== */

function loadBuildings(filter = "all") {
  clearLayer(buildingsLayerGroup);

  if (!buildingsGeoJSON || !buildingsGeoJSON.features) {
    console.warn("buildings.js not found or building variable name/structure is incorrect.");
    return;
  }

  const visibleBuildings = buildingsGeoJSON.features.filter(function (feature) {
    return shouldShowFeature(feature, filter);
  });

  console.log("Visible buildings:", visibleBuildings.length);

  L.geoJSON(
    {
      type: "FeatureCollection",
      features: visibleBuildings
    },
    {
      pane: "buildingsPane",
      interactive: true,

      style: function (feature) {
        return buildingStyle(feature);
      },

      pointToLayer: function (feature, latlng) {
        return L.marker(latlng, {
          pane: "poiPane",
          icon: createDivIcon("buildingIcon", getEmoji(getCategory(feature)), [20, 20])
        });
      },

      onEachFeature: function (feature, layer) {
        const name = getName(feature);

        layer.on("click", function () {
          const center = getFeatureCenter(layer);
          if (center) openInfoCard(feature, center);
        });

        layer.on("mouseover", function () {
          if (layer.setStyle) {
            layer.setStyle({
              weight: 2.3,
              opacity: 1,
              fillOpacity: 0.66
            });
          }
        });

        layer.on("mouseout", function () {
          if (layer.setStyle) {
            layer.setStyle(buildingStyle(feature));
          }
        });

        if (name && name !== "Unnamed Place") {
          layer.bindTooltip(name, {
            permanent: false,
            direction: "top",
            className: "buildingLabel",
            offset: [0, -8]
          });
        }

        const center = getFeatureCenter(layer);

        if (center) {
          searchItems.push({
            name,
            category: getCategory(feature),
            feature,
            layer,
            latlng: center
          });
        }
      }
    }
  ).addTo(buildingsLayerGroup);
}

/* =====================================================
   14. LOAD ROADS
===================================================== */

function loadRoads() {
  clearLayer(roadsLayerGroup);

  if (!roadsGeoJSON || !roadsGeoJSON.features) {
    console.warn("roads.js not found or road variable name is incorrect.");
    return;
  }

  L.geoJSON(roadsGeoJSON, {
    pane: "roadsPane",
    interactive: false,
    style: roadStyle
  }).addTo(roadsLayerGroup);
}

/* =====================================================
   15. LOAD POI
===================================================== */

function loadPOI(filter = "all") {
  clearLayer(poiLayerGroup);

  if (!poiGeoJSON || !poiGeoJSON.features) {
    console.warn("poi.js not found or POI variable name is incorrect.");
    return;
  }

  L.geoJSON(poiGeoJSON, {
    pane: "poiPane",

    filter: function (feature) {
      return shouldShowFeature(feature, filter);
    },

    pointToLayer: function (feature, latlng) {
      return L.marker(latlng, {
        pane: "poiPane",
        icon: poiIcon(feature)
      });
    },

    onEachFeature: function (feature, layer) {
      const name = getName(feature);

      layer.bindTooltip(name, {
        permanent: false,
        direction: "top",
        className: "buildingLabel"
      });

      layer.on("click", function () {
        const center = getFeatureCenter(layer);
        if (center) openInfoCard(feature, center);
      });

      const center = getFeatureCenter(layer);

      if (center) {
        searchItems.push({
          name,
          category: getCategory(feature),
          feature,
          layer,
          latlng: center
        });
      }
    }
  }).addTo(poiLayerGroup);
}

/* =====================================================
   16. REFRESH LAYERS
===================================================== */

function refreshMapLayers(filter = "all") {
  searchItems = [];

  loadLandUse(filter);
  loadRoads();
  loadBuildings(filter);
  loadPOI(filter);

  updateBottomPanelForFilter(filter);
}

function updateBottomPanelForFilter(filter) {
  const count = searchItems.filter(function (item) {
    if (filter === "all") return true;
    return item.category === filter;
  }).length;

  if (filter === "all") {
    bottomTitle.textContent = "All Campus Places";
    bottomDesc.textContent = `${count} places available. Search or click any place on the map.`;
    return;
  }

  bottomTitle.textContent = categoryLabel(filter);
  bottomDesc.textContent = `${count} places found in this category.`;
}

/* =====================================================
   17. CATEGORY FILTER
===================================================== */

function fitCampusWithUiPadding() {
  if (!campusBounds) return;

  map.fitBounds(campusBounds, {
    paddingTopLeft: [40, 145],
    paddingBottomRight: [40, 190],
    maxZoom: 18
  });
}

document.querySelectorAll(".category").forEach(function (button) {
  button.addEventListener("click", function () {
    document.querySelectorAll(".category").forEach(function (btn) {
      btn.classList.remove("active");
    });

    this.classList.add("active");

    activeRouteId++;
    stopTrackingUser();
    clearRoute();

    currentFilter = this.dataset.filter;
    refreshMapLayers(currentFilter);

    fitCampusWithUiPadding();
  });
});

/* =====================================================
   18. SEARCH
===================================================== */

function renderSuggestions(query) {
  const q = query.trim().toLowerCase();

  searchSuggestions.innerHTML = "";

  if (!q) {
    searchSuggestions.classList.remove("show");
    return;
  }

  const results = searchItems
    .filter(function (item) {
      const name = item.name.toLowerCase();
      const category = item.category.toLowerCase();

      return name.includes(q) || category.includes(q);
    })
    .slice(0, 10);

  if (results.length === 0) {
    searchSuggestions.innerHTML = `<div class="suggestionItem">No result found</div>`;
    searchSuggestions.classList.add("show");
    return;
  }

  results.forEach(function (item) {
    const div = document.createElement("div");
    div.className = "suggestionItem";
    div.innerHTML = `${getEmoji(item.category)} ${item.name}`;

    div.addEventListener("click", function () {
      activeRouteId++;
      stopTrackingUser();
      clearRoute();

      searchInput.value = item.name;
      searchSuggestions.classList.remove("show");

      if (item.latlng) {
        openInfoCard(item.feature, item.latlng);
      }
    });

    searchSuggestions.appendChild(div);
  });

  searchSuggestions.classList.add("show");
}

if (searchInput) {
  searchInput.addEventListener("input", function () {
    const value = this.value.trim();

    if (!value) {
      searchSuggestions.innerHTML = "";
      searchSuggestions.classList.remove("show");
      resetSelectedPlace();
      return;
    }

    renderSuggestions(value);
  });

  searchInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      const first = searchSuggestions.querySelector(".suggestionItem");

      if (first && first.textContent !== "No result found") {
        first.click();
      }
    }
  });
}

document.addEventListener("click", function (event) {
  if (!event.target.closest(".searchBox")) {
    searchSuggestions.classList.remove("show");
  }
});

/* =====================================================
   19. USER LOCATION + LIVE TRACKING
===================================================== */

function updateUserMarker(latlng, openPopup = false) {
  userLatLng = latlng;

  if (userMarker) {
    userMarker.setLatLng(userLatLng);
  } else {
    userMarker = L.marker(userLatLng, {
      icon: userLocationIcon,
      pane: "poiPane",
      zIndexOffset: 10000
    }).addTo(map);
  }

  userMarker.bindPopup("You are here");

  if (openPopup) {
    userMarker.openPopup();
  }
}

function requestUserLocation() {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported by this browser.");
    if (locationPrompt) locationPrompt.classList.add("hide");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    function (position) {
      const latlng = L.latLng(
        position.coords.latitude,
        position.coords.longitude
      );

      updateUserMarker(latlng, true);

      map.flyTo(userLatLng, 18, {
        animate: true,
        duration: 0.8
      });

      if (locationPrompt) locationPrompt.classList.add("hide");
    },

    function () {
      alert("Location permission denied. You can still explore the campus map.");
      if (locationPrompt) locationPrompt.classList.add("hide");
    },

    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );
}

function getFreshUserLocation() {
  return new Promise(function (resolve, reject) {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      function (position) {
        const latlng = L.latLng(
          position.coords.latitude,
          position.coords.longitude
        );

        updateUserMarker(latlng, false);
        resolve(latlng);
      },

      function (error) {
        reject(error);
      },

      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  });
}

function startTrackingUser(routeId) {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported by this browser.");
    return;
  }

  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  isTracking = true;
  hasReachedDestination = false;

  bottomTitle.textContent = "Live Tracking Started";
  bottomDesc.textContent = "Follow the route. Your position will update while you move.";

  watchId = navigator.geolocation.watchPosition(
    function (position) {
      if (routeId !== activeRouteId) {
        return;
      }

      const latlng = L.latLng(
        position.coords.latitude,
        position.coords.longitude
      );

      updateUserMarker(latlng, false);

      map.panTo(userLatLng, {
        animate: true,
        duration: 0.4
      });

      if (selectedDestination && !hasReachedDestination) {
        const distanceToDestination = userLatLng.distanceTo(selectedDestination);

        if (distanceToDestination <= 15) {
          hasReachedDestination = true;
          stopTrackingUser();

          bottomTitle.textContent = "Destination Reached";
          bottomDesc.textContent = "You have reached your selected campus location.";

          alert("You have reached your destination.");
        } else {
          const distanceText =
            distanceToDestination >= 1000
              ? `${(distanceToDestination / 1000).toFixed(2)} km`
              : `${Math.round(distanceToDestination)} m`;

          bottomTitle.textContent = "Live Tracking";
          bottomDesc.textContent = `Distance remaining: ${distanceText}`;
        }
      }
    },

    function (error) {
      if (routeId !== activeRouteId) {
        return;
      }

      console.error("Tracking error:", error);
      alert("Unable to track your location.");
      stopTrackingUser();
    },

    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000
    }
  );
}

function stopTrackingUser() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  isTracking = false;
}

if (allowLocationBtn) {
  allowLocationBtn.addEventListener("click", requestUserLocation);
}

if (skipLocationBtn) {
  skipLocationBtn.addEventListener("click", function () {
    locationPrompt.classList.add("hide");
  });
}

if (locateBtn) {
  locateBtn.addEventListener("click", requestUserLocation);
}

/* =====================================================
   20. ZOOM CONTROLS
===================================================== */

zoomInBtn.addEventListener("click", function () {
  map.zoomIn();
});

zoomOutBtn.addEventListener("click", function () {
  map.zoomOut();
});

/* =====================================================
   21. ROAD GRAPH
===================================================== */

function coordToLatLng(coord) {
  return L.latLng(coord[1], coord[0]);
}

function keyFromLatLng(latlng) {
  return `${latlng.lat.toFixed(6)},${latlng.lng.toFixed(6)}`;
}

function latLngFromKey(key) {
  const parts = key.split(",").map(Number);
  return L.latLng(parts[0], parts[1]);
}

function addGraphEdge(aKey, bKey, distance) {
  if (!roadGraph[aKey]) roadGraph[aKey] = [];
  if (!roadGraph[bKey]) roadGraph[bKey] = [];

  roadGraph[aKey].push({
    node: bKey,
    weight: distance
  });

  roadGraph[bKey].push({
    node: aKey,
    weight: distance
  });
}

function buildRoadGraph() {
  roadGraph = {};

  if (!roadsGeoJSON || !roadsGeoJSON.features) {
    console.warn("Road graph not built: roads GeoJSON missing.");
    return;
  }

  roadsGeoJSON.features.forEach(function (feature) {
    const geometry = feature.geometry;
    if (!geometry) return;

    let lines = [];

    if (geometry.type === "LineString") {
      lines = [geometry.coordinates];
    }

    if (geometry.type === "MultiLineString") {
      lines = geometry.coordinates;
    }

    lines.forEach(function (line) {
      for (let i = 0; i < line.length - 1; i++) {
        const a = coordToLatLng(line[i]);
        const b = coordToLatLng(line[i + 1]);

        const aKey = keyFromLatLng(a);
        const bKey = keyFromLatLng(b);

        const distance = a.distanceTo(b);

        addGraphEdge(aKey, bKey, distance);
      }
    });
  });

  console.log("Road graph nodes:", Object.keys(roadGraph).length);
}

function findNearestRoadNode(latlng) {
  let nearestKey = null;
  let nearestDistance = Infinity;

  Object.keys(roadGraph).forEach(function (key) {
    const nodeLatLng = latLngFromKey(key);
    const distance = latlng.distanceTo(nodeLatLng);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestKey = key;
    }
  });

  return nearestKey;
}

function dijkstra(graph, startKey, endKey) {
  const distances = {};
  const previous = {};
  const visited = new Set();
  const queue = [];

  Object.keys(graph).forEach(function (node) {
    distances[node] = Infinity;
    previous[node] = null;
  });

  distances[startKey] = 0;

  queue.push({
    node: startKey,
    distance: 0
  });

  while (queue.length > 0) {
    queue.sort(function (a, b) {
      return a.distance - b.distance;
    });

    const current = queue.shift();
    const currentNode = current.node;

    if (visited.has(currentNode)) continue;
    visited.add(currentNode);

    if (currentNode === endKey) break;

    const neighbors = graph[currentNode] || [];

    neighbors.forEach(function (neighbor) {
      if (visited.has(neighbor.node)) return;

      const newDistance = distances[currentNode] + neighbor.weight;

      if (newDistance < distances[neighbor.node]) {
        distances[neighbor.node] = newDistance;
        previous[neighbor.node] = currentNode;

        queue.push({
          node: neighbor.node,
          distance: newDistance
        });
      }
    });
  }

  const path = [];
  let currentNode = endKey;

  while (currentNode) {
    path.unshift(currentNode);
    currentNode = previous[currentNode];
  }

  if (path[0] !== startKey) {
    return null;
  }

  return {
    path,
    distance: distances[endKey]
  };
}

/* =====================================================
   22. DIRECTIONS
===================================================== */

function clearRoute() {
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }

  if (routeHelperStart) {
    map.removeLayer(routeHelperStart);
    routeHelperStart = null;
  }

  if (routeHelperEnd) {
    map.removeLayer(routeHelperEnd);
    routeHelperEnd = null;
  }
}

async function handleDirectionClick() {
  if (!selectedDestination) {
    alert("Please select a building/place first.");
    return;
  }

  if (!roadGraph || Object.keys(roadGraph).length === 0) {
    alert("Road graph is not available. Check your roads.js file.");
    return;
  }

  activeRouteId++;
  const thisRouteId = activeRouteId;

  stopTrackingUser();
  clearRoute();

  try {
    await getFreshUserLocation();
  } catch (error) {
    alert("Please enable your location first.");
    requestUserLocation();
    return;
  }

  if (thisRouteId !== activeRouteId) {
    return;
  }

  const startNode = findNearestRoadNode(userLatLng);
  const endNode = findNearestRoadNode(selectedDestination);

  if (!startNode || !endNode) {
    alert("Could not find nearest road node.");
    return;
  }

  if (startNode === endNode) {
    alert("You are already very close to this destination.");
    return;
  }

  const result = dijkstra(roadGraph, startNode, endNode);

  if (!result || !result.path || result.path.length < 2) {
    alert("No connected road path found. Check road snapping/connectivity in QGIS.");
    return;
  }

  const routeCoordinates = result.path.map(latLngFromKey);

  routeLayer = L.polyline(routeCoordinates, {
    pane: "routePane",
    interactive: false,
    color: "#f97316",
    weight: 6,
    opacity: 0.96,
    lineCap: "round",
    lineJoin: "round"
  }).addTo(map);

  routeHelperStart = L.polyline([userLatLng, routeCoordinates[0]], {
    pane: "routePane",
    interactive: false,
    color: "#f97316",
    weight: 3,
    opacity: 0.7,
    dashArray: "6, 7"
  }).addTo(map);

  routeHelperEnd = L.polyline(
    [routeCoordinates[routeCoordinates.length - 1], selectedDestination],
    {
      pane: "routePane",
      interactive: false,
      color: "#f97316",
      weight: 3,
      opacity: 0.7,
      dashArray: "6, 7"
    }
  ).addTo(map);

  const fullRouteGroup = L.featureGroup([
    routeLayer,
    routeHelperStart,
    routeHelperEnd
  ]);

  map.fitBounds(fullRouteGroup.getBounds(), {
    paddingTopLeft: [140, 120],
    paddingBottomRight: [120, 140],
    maxZoom: 18
  });

  const distanceMeters =
    result.distance +
    userLatLng.distanceTo(routeCoordinates[0]) +
    selectedDestination.distanceTo(routeCoordinates[routeCoordinates.length - 1]);

  const distanceText =
    distanceMeters >= 1000
      ? `${(distanceMeters / 1000).toFixed(2)} km`
      : `${Math.round(distanceMeters)} m`;

  const walkingMinutes = Math.max(1, Math.round(distanceMeters / 80));

  bottomTitle.textContent = "Route Ready";
  bottomDesc.textContent = `Distance: ${distanceText} • Estimated walking time: ${walkingMinutes} min • Live tracking started.`;

  infoCard.classList.remove("show");

  startTrackingUser(thisRouteId);
}

directionBtn.addEventListener("click", handleDirectionClick);
bottomDirectionBtn.addEventListener("click", handleDirectionClick);

/* =====================================================
   23. CAMPUS BOUNDS
===================================================== */

function fitCampusOnly() {
  const layers = [];

  landUseLayerGroup.eachLayer(function (layer) {
    layers.push(layer);
  });

  roadsLayerGroup.eachLayer(function (layer) {
    layers.push(layer);
  });

  buildingsLayerGroup.eachLayer(function (layer) {
    layers.push(layer);
  });

  poiLayerGroup.eachLayer(function (layer) {
    layers.push(layer);
  });

  if (layers.length === 0) return;

  let bounds = null;

  layers.forEach(function (layer) {
    if (layer.getBounds && layer.getBounds().isValid()) {
      if (!bounds) {
        bounds = layer.getBounds();
      } else {
        bounds.extend(layer.getBounds());
      }
    } else if (layer.getLatLng) {
      const latlng = layer.getLatLng();

      if (!bounds) {
        bounds = L.latLngBounds([latlng]);
      } else {
        bounds.extend(latlng);
      }
    }
  });

  if (!bounds || !bounds.isValid()) return;

  campusBounds = bounds.pad(0.25);

  map.fitBounds(bounds, {
    paddingTopLeft: [40, 145],
    paddingBottomRight: [40, 190],
    maxZoom: 18
  });

  map.setMaxBounds(campusBounds);

  map.on("drag", function () {
    map.panInsideBounds(campusBounds, {
      animate: false
    });
  });

  map.setMinZoom(15);
  map.setMaxZoom(20);
}

/* =====================================================
   24. INITIAL LOAD
===================================================== */

function initApp() {
  refreshMapLayers("all");
  buildRoadGraph();

  setTimeout(function () {
    fitCampusOnly();
  }, 400);

  bottomTitle.textContent = "Campus Map";
  bottomDesc.textContent = "Search or select a category to explore University of Kashmir campus.";

  console.log("Campus Navigation System loaded successfully.");
}

initApp();