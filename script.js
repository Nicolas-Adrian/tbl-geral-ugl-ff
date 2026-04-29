const STORAGE_KEY = "obs-overlay-ranking-v1";
const SYNC_CHANNEL = "obs-overlay-ranking-live";

const SAMPLE_TEAMS = [
  { name: "FAZ O P", points: 305, matches: 10, booyahs: 3, kills: 82, color: "#8f63ff" },
  { name: "STRESSED", points: 250, matches: 10, booyahs: 1, kills: 77, color: "#40b8ff" },
  { name: "MEDELLIN RUBRO NEGRO", points: 245, matches: 10, booyahs: 2, kills: 70, color: "#ef5b57" },
  { name: "RUSH", points: 239, matches: 10, booyahs: 1, kills: 69, color: "#dc8b2d" },
  { name: "FLUXO", points: 234, matches: 10, booyahs: 1, kills: 71, color: "#bfbfbf" },
  { name: "ALIEN GAMING", points: 222, matches: 10, booyahs: 2, kills: 65, color: "#7a78ff" },
  { name: "DOLLARS", points: 176, matches: 10, booyahs: 0, kills: 58, color: "#ff874a" },
  { name: "AMAZON CRIPZ", points: 159, matches: 10, booyahs: 0, kills: 47, color: "#ffffff" },
  { name: "ANTISOCIAL TEAM", points: 158, matches: 10, booyahs: 0, kills: 43, color: "#d6d6d6" },
  { name: "TERRORNET", points: 148, matches: 10, booyahs: 0, kills: 51, color: "#c4c7d8" },
  { name: "VASCO ESPORTS", points: 134, matches: 10, booyahs: 0, kills: 42, color: "#ffffff" },
  { name: "A NOVA ORDEM", points: 76, matches: 10, booyahs: 0, kills: 25, color: "#4ca4ff" }
];

const APP_CONFIG = window.APP_CONFIG || {};
const API_BASE_URL = typeof APP_CONFIG.apiBaseUrl === "string" ? APP_CONFIG.apiBaseUrl.trim() : "";
const POLL_INTERVAL_MS = Number(APP_CONFIG.pollIntervalMs) > 0 ? Number(APP_CONFIG.pollIntervalMs) : 3000;
const REQUEST_TIMEOUT_MS = Number(APP_CONFIG.requestTimeoutMs) > 0 ? Number(APP_CONFIG.requestTimeoutMs) : 10000;

const channel = !API_BASE_URL && typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(SYNC_CHANNEL) : null;

const scoreboardRows = document.getElementById("scoreboardRows");
const statsContainer = document.getElementById("teamEditorTable");
const logoManager = document.getElementById("logoManager");
const resetButton = document.getElementById("resetButton");
const adminRoot = document.getElementById("adminRoot");
const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));

let currentState = buildDefaultState();
let syncIntervalId = null;
let lastKnownUpdatedAt = currentState.updatedAt;
const draftValues = new Map();

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function createPlaceholderLogo(name, color) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(function (chunk) {
      return chunk[0];
    })
    .join("")
    .toUpperCase();

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${color}" />
          <stop offset="100%" stop-color="#111111" />
        </linearGradient>
      </defs>
      <rect width="160" height="160" rx="28" fill="url(#g)" />
      <circle cx="80" cy="80" r="58" fill="rgba(0,0,0,.18)" />
      <text
        x="50%"
        y="54%"
        dominant-baseline="middle"
        text-anchor="middle"
        font-family="Arial, sans-serif"
        font-size="54"
        font-style="italic"
        font-weight="700"
        fill="#ffffff"
      >
        ${initials}
      </text>
    </svg>
  `.trim();

  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}

function buildDefaultState() {
  return {
    updatedAt: Date.now(),
    teams: SAMPLE_TEAMS.map(function (team, index) {
      return {
        id: slugify(team.name) || "time-" + String(index + 1),
        name: team.name,
        points: team.points,
        matches: team.matches,
        booyahs: team.booyahs,
        kills: team.kills,
        logoUrl: createPlaceholderLogo(team.name, team.color)
      };
    })
  };
}

function canUseStorage() {
  try {
    localStorage.setItem("_overlay_test_", "1");
    localStorage.removeItem("_overlay_test_");
    return true;
  } catch (error) {
    return false;
  }
}

function coerceNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTeam(team, index) {
  const name = typeof team?.name === "string" && team.name.trim() ? team.name.trim() : "TIME " + String(index + 1);
  return {
    id: typeof team?.id === "string" && team.id ? team.id : slugify(name) || "time-" + String(index + 1),
    name,
    points: coerceNumber(team?.points, 0),
    matches: coerceNumber(team?.matches, 10),
    booyahs: coerceNumber(team?.booyahs, 0),
    kills: coerceNumber(team?.kills, 0),
    logoUrl:
      typeof team?.logoUrl === "string" && team.logoUrl.trim()
        ? team.logoUrl.trim()
        : createPlaceholderLogo(name, SAMPLE_TEAMS[index % SAMPLE_TEAMS.length].color)
  };
}

function sortTeamsForRanking(teams) {
  return teams.slice().sort(function (left, right) {
    if (right.points !== left.points) return right.points - left.points;
    if (right.booyahs !== left.booyahs) return right.booyahs - left.booyahs;
    return left.name.localeCompare(right.name, "pt-BR");
  });
}

function normalizeState(rawState) {
  const base = buildDefaultState();
  const sourceTeams = Array.isArray(rawState?.teams) && rawState.teams.length ? rawState.teams : base.teams;
  const teams = Array.from({ length: 12 }, function (_, index) {
    return normalizeTeam(sourceTeams[index] || base.teams[index], index);
  });

  return {
    updatedAt: coerceNumber(rawState?.updatedAt, Date.now()),
    teams: sortTeamsForRanking(teams)
  };
}

function readCachedState() {
  if (!canUseStorage()) {
    return buildDefaultState();
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const initialState = buildDefaultState();
    cacheStateLocally(initialState, false);
    return initialState;
  }

  try {
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    const fallback = buildDefaultState();
    cacheStateLocally(fallback, false);
    return fallback;
  }
}

function cacheStateLocally(state, notifyPeers) {
  const normalized = normalizeState(state);

  if (canUseStorage()) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  }

  if (notifyPeers && channel) {
    channel.postMessage(normalized);
  }

  return normalized;
}

function hasRemoteBackend() {
  return Boolean(API_BASE_URL);
}

function buildApiUrl(action) {
  const url = new URL(API_BASE_URL);
  url.searchParams.set("action", action);
  return url.toString();
}

async function fetchJsonWithTimeout(url, options) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(function () {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error("Falha ao comunicar com o backend.");
    }

    return await response.json();
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function readRemoteState() {
  const payload = await fetchJsonWithTimeout(buildApiUrl("state"), {
    method: "GET",
    cache: "no-store"
  });

  if (!payload.ok) {
    throw new Error(payload.error || "Nao foi possivel carregar os dados.");
  }

  return normalizeState(payload.state);
}

async function writeRemoteState(nextState, action) {
  const normalized = normalizeState({
    ...nextState,
    updatedAt: Date.now()
  });

  const body = new URLSearchParams();
  body.set("action", action);
  body.set("state", JSON.stringify(normalized));

  const payload = await fetchJsonWithTimeout(API_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: body.toString()
  });

  if (!payload.ok) {
    throw new Error(payload.error || "Nao foi possivel salvar os dados.");
  }

  return normalizeState(payload.state);
}

async function loadState() {
  if (!hasRemoteBackend()) {
    return readCachedState();
  }

  try {
    const remoteState = await readRemoteState();
    cacheStateLocally(remoteState, false);
    return remoteState;
  } catch (error) {
    console.warn("Falha ao carregar do Apps Script. Usando cache local.", error);
    return readCachedState();
  }
}

async function saveState(nextState) {
  if (!hasRemoteBackend()) {
    const localState = cacheStateLocally(
      {
        ...nextState,
        updatedAt: Date.now()
      },
      true
    );
    currentState = localState;
    lastKnownUpdatedAt = localState.updatedAt;
    return localState;
  }

  const remoteState = await writeRemoteState(nextState, "save");
  cacheStateLocally(remoteState, false);
  currentState = remoteState;
  lastKnownUpdatedAt = remoteState.updatedAt;
  return remoteState;
}

async function resetState() {
  const defaultState = buildDefaultState();

  if (!hasRemoteBackend()) {
    return saveState(defaultState);
  }

  const remoteState = await writeRemoteState(defaultState, "reset");
  cacheStateLocally(remoteState, false);
  currentState = remoteState;
  lastKnownUpdatedAt = remoteState.updatedAt;
  return remoteState;
}

function subscribe(onChange) {
  if (!hasRemoteBackend()) {
    window.addEventListener("storage", function (event) {
      if (event.key !== STORAGE_KEY || !event.newValue) {
        return;
      }

      try {
        onChange(normalizeState(JSON.parse(event.newValue)));
      } catch (error) {
        onChange(readCachedState());
      }
    });

    if (channel) {
      channel.addEventListener("message", function (event) {
        onChange(normalizeState(event.data));
      });
    }

    return;
  }

  if (syncIntervalId) {
    window.clearInterval(syncIntervalId);
  }

  syncIntervalId = window.setInterval(async function () {
    try {
      const nextState = await readRemoteState();
      if (nextState.updatedAt !== lastKnownUpdatedAt) {
        lastKnownUpdatedAt = nextState.updatedAt;
        cacheStateLocally(nextState, false);
        onChange(nextState);
      }
    } catch (error) {
      console.warn("Falha ao sincronizar com o Apps Script.", error);
    }
  }, POLL_INTERVAL_MS);
}

function renderOverlay(state) {
  if (!scoreboardRows) return;
  scoreboardRows.innerHTML = "";

  sortTeamsForRanking(state.teams)
    .slice(0, 12)
    .forEach(function (team, index) {
      const row = document.createElement("article");
      row.className = "score-row" + (index === 0 ? " is-leading" : "");

      const rankCell = document.createElement("div");
      rankCell.className = "rank-cell";
      rankCell.textContent = String(index + 1).padStart(2, "0");

      const logoCell = document.createElement("div");
      logoCell.className = "logo-cell";
      const logo = document.createElement("img");
      logo.src = team.logoUrl;
      logo.alt = "Logo do " + team.name;
      logoCell.appendChild(logo);

      const teamNameCell = document.createElement("div");
      teamNameCell.className = "team-name-cell";
      teamNameCell.textContent = team.name;

      const pointsCell = document.createElement("div");
      pointsCell.className = "stat-cell stat-points";
      pointsCell.textContent = String(team.points);

      const matchesCell = document.createElement("div");
      matchesCell.className = "stat-cell";
      matchesCell.textContent = String(team.matches);

      const booyahsCell = document.createElement("div");
      booyahsCell.className = "stat-cell";
      booyahsCell.textContent = String(team.booyahs);

      const killsCell = document.createElement("div");
      killsCell.className = "stat-cell";
      killsCell.textContent = String(team.kills);

      row.append(rankCell, logoCell, teamNameCell, pointsCell, matchesCell, booyahsCell, killsCell);
      scoreboardRows.appendChild(row);
    });
}

function cloneState() {
  return JSON.parse(JSON.stringify(currentState));
}

function getDraftKey(teamId, field) {
  return teamId + "::" + field;
}

function getDraftValue(teamId, field, fallback) {
  const key = getDraftKey(teamId, field);
  return draftValues.has(key) ? draftValues.get(key) : fallback;
}

function setDraftValue(teamId, field, value) {
  draftValues.set(getDraftKey(teamId, field), value);
}

function clearDraftValue(teamId, field) {
  draftValues.delete(getDraftKey(teamId, field));
}

function isEditingAdminField() {
  const activeElement = document.activeElement;
  return Boolean(
    adminRoot &&
      activeElement &&
      adminRoot.contains(activeElement) &&
      activeElement.matches("input, textarea, select")
  );
}

async function updateTeam(teamIndex, field, value) {
  const nextState = cloneState();
  const numericFields = ["points", "matches", "booyahs", "kills"];
  const teamId = nextState.teams[teamIndex] ? nextState.teams[teamIndex].id : "";
  nextState.teams[teamIndex][field] = numericFields.includes(field) ? Number(value) || 0 : value;

  try {
    currentState = await saveState(nextState);
    if (teamId) {
      clearDraftValue(teamId, field);
    }
    renderAdmin();
    renderOverlay(currentState);
  } catch (error) {
    window.alert("Nao foi possivel salvar a alteracao.");
  }
}

function renderStatsTab() {
  if (!statsContainer) return;

  statsContainer.innerHTML = `
    <div class="editor-head">
      <span>POS.</span>
      <span>TIME</span>
      <span>PONTOS</span>
      <span>QUEDAS</span>
      <span>BOOYAHS</span>
      <span>KILLS</span>
    </div>
  `;

  currentState.teams.forEach(function (team, index) {
    const row = document.createElement("div");
    row.className = "editor-row";

    const position = document.createElement("span");
    position.className = "position-pill";
    position.textContent = String(index + 1).padStart(2, "0");

    const nameField = document.createElement("label");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = getDraftValue(team.id, "name", team.name);
    nameInput.dataset.teamIndex = String(index);
    nameInput.dataset.teamId = team.id;
    nameInput.dataset.field = "name";
    nameField.appendChild(nameInput);

    const metrics = [
      { field: "points", value: team.points },
      { field: "matches", value: team.matches },
      { field: "booyahs", value: team.booyahs },
      { field: "kills", value: team.kills }
    ];

    row.appendChild(position);
    row.appendChild(nameField);

    metrics.forEach(function (metric) {
      const wrapper = document.createElement("label");
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.value = String(getDraftValue(team.id, metric.field, metric.value));
      input.dataset.teamIndex = String(index);
      input.dataset.teamId = team.id;
      input.dataset.field = metric.field;
      wrapper.appendChild(input);
      row.appendChild(wrapper);
    });

    statsContainer.appendChild(row);
  });

  statsContainer.querySelectorAll("input").forEach(function (input) {
    input.addEventListener("input", function (event) {
      const teamId = event.target.dataset.teamId;
      const field = event.target.dataset.field;
      setDraftValue(teamId, field, event.target.value);
    });

    input.addEventListener("change", function (event) {
      const teamIndex = Number(event.target.dataset.teamIndex);
      const field = event.target.dataset.field;
      updateTeam(teamIndex, field, event.target.value);
    });
  });
}

function fileToResizedDataUrl(file) {
  return new Promise(function (resolve, reject) {
    const imageUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = function () {
      const maxSize = 280;
      const ratio = Math.min(maxSize / image.width, maxSize / image.height, 1);
      const width = Math.max(Math.round(image.width * ratio), 1);
      const height = Math.max(Math.round(image.height * ratio), 1);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) {
        URL.revokeObjectURL(imageUrl);
        reject(new Error("Nao foi possivel preparar a imagem."));
        return;
      }

      canvas.width = width;
      canvas.height = height;
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);

      URL.revokeObjectURL(imageUrl);
      resolve(canvas.toDataURL("image/png"));
    };

    image.onerror = function () {
      URL.revokeObjectURL(imageUrl);
      reject(new Error("Nao foi possivel abrir a imagem."));
    };

    image.src = imageUrl;
  });
}

function renderLogosTab() {
  if (!logoManager) return;
  logoManager.innerHTML = "";

  currentState.teams.forEach(function (team, index) {
    const card = document.createElement("article");
    card.className = "logo-card";

    const preview = document.createElement("div");
    preview.className = "logo-preview";
    const previewImage = document.createElement("img");
    previewImage.src = team.logoUrl;
    previewImage.alt = "Logo atual do " + team.name;
    preview.appendChild(previewImage);

    const body = document.createElement("div");
    body.className = "logo-card-body";

    const title = document.createElement("h3");
    title.textContent = team.name;

    const urlField = document.createElement("label");
    urlField.className = "field-stack";
    const urlText = document.createElement("span");
    urlText.textContent = "Link da imagem";
    const urlInput = document.createElement("input");
    urlInput.type = "url";
    urlInput.value = getDraftValue(team.id, "logoUrl", team.logoUrl);
    urlInput.dataset.teamIndex = String(index);
    urlInput.dataset.teamId = team.id;
    urlInput.dataset.role = "logo-url";
    urlField.append(urlText, urlInput);

    const uploadField = document.createElement("label");
    uploadField.className = "upload-field";
    const uploadText = document.createElement("span");
    uploadText.textContent = "Enviar arquivo";
    const uploadInput = document.createElement("input");
    uploadInput.type = "file";
    uploadInput.accept = "image/*";
    uploadInput.dataset.teamIndex = String(index);
    uploadInput.dataset.role = "logo-file";
    uploadField.append(uploadText, uploadInput);

    body.append(title, urlField, uploadField);
    card.append(preview, body);
    logoManager.appendChild(card);
  });

  logoManager.querySelectorAll('[data-role="logo-url"]').forEach(function (input) {
    input.addEventListener("input", function (event) {
      const teamId = event.target.dataset.teamId;
      setDraftValue(teamId, "logoUrl", event.target.value);
    });

    input.addEventListener("change", function (event) {
      const teamIndex = Number(event.target.dataset.teamIndex);
      updateTeam(teamIndex, "logoUrl", event.target.value.trim());
    });
  });

  logoManager.querySelectorAll('[data-role="logo-file"]').forEach(function (input) {
    input.addEventListener("change", function (event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;

      const teamIndex = Number(event.target.dataset.teamIndex);
      fileToResizedDataUrl(file)
        .then(function (dataUrl) {
          return updateTeam(teamIndex, "logoUrl", dataUrl);
        })
        .catch(function (error) {
          window.alert(error.message);
        });
    });
  });
}

function renderAdmin() {
  renderStatsTab();
  renderLogosTab();
}

function activateTab(targetId) {
  tabButtons.forEach(function (button) {
    button.classList.toggle("is-active", button.dataset.tabTarget === targetId);
  });
  tabPanels.forEach(function (panel) {
    panel.classList.toggle("is-active", panel.id === targetId);
  });
}

function applyMode() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("view") === "overlay" ? "overlay" : "admin";
  document.body.classList.add(mode + "-mode");
  document.body.classList.remove(mode === "overlay" ? "admin-mode" : "overlay-mode");
  document.title = mode === "overlay" ? "Overlay - Tabela Geral" : "Painel Admin - Tabela Geral";
}

function bindEvents() {
  if (resetButton) {
    resetButton.addEventListener("click", async function () {
      try {
        currentState = await resetState();
        renderAdmin();
        renderOverlay(currentState);
      } catch (error) {
        window.alert("Nao foi possivel restaurar o exemplo.");
      }
    });
  }

  tabButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      activateTab(button.dataset.tabTarget);
    });
  });
}

async function initializeApp() {
  applyMode();
  currentState = await loadState();
  lastKnownUpdatedAt = currentState.updatedAt;
  renderOverlay(currentState);
  renderAdmin();
  bindEvents();

  subscribe(function (nextState) {
    currentState = normalizeState(nextState);
    lastKnownUpdatedAt = currentState.updatedAt;
    renderOverlay(currentState);
    if (!isEditingAdminField()) {
      renderAdmin();
    }
  });
}

initializeApp();
