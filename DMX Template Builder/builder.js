const videoSelect = document.getElementById("video-select");
const addRowButton = document.getElementById("add-row");
const sortRowsButton = document.getElementById("sort-rows");
const saveButton = document.getElementById("save-template");
const exportButton = document.getElementById("export-template");
const statusEl = document.getElementById("status-message");
const actionsBody = document.getElementById("actions-body");
const templateInfoEl = document.getElementById("template-info");
const videoEl = document.getElementById("preview-video");
const previewToggle = document.getElementById("preview-mode-toggle");
const rowTemplate = document.getElementById("action-row-template");

let videos = [];
let currentVideo = null;
let actions = [];
let templatePath = "";
let apiBasePath = null;
let previewMode = false;
let previewSyncHandle = null;
let suppressPreviewPause = false;

const API_BASE_CANDIDATES = [
  "/api",
  "./api",
  "../api",
  "/dmx-template-builder/api",
];

const DEFAULT_ACTION = Object.freeze({ time: "00:00:00", channel: 1, value: 0, fade: 0 });

init();

function init() {
  loadVideos();
  videoSelect.addEventListener("change", handleVideoSelection);
  addRowButton.addEventListener("click", handleAddRow);
  sortRowsButton.addEventListener("click", () => {
    actions = sortActions(actions);
    renderActions();
    queuePreviewSync();
  });
  saveButton.addEventListener("click", handleSaveTemplate);
  exportButton.addEventListener("click", () => exportTemplate());
  if (previewToggle) {
    previewToggle.addEventListener("click", handlePreviewToggle);
  }
  if (videoEl) {
    videoEl.addEventListener("play", handleVideoPlay);
    videoEl.addEventListener("pause", handleVideoPause);
    videoEl.addEventListener("seeked", handleVideoSeeked);
  }
}

function handleAddRow() {
  const time = getCurrentVideoTimecode();
  addAction({ time });
}

function getCurrentVideoTimecode() {
  if (!videoEl) return DEFAULT_ACTION.time;
  const currentTime = Number.isFinite(videoEl.currentTime)
    ? Math.max(0, videoEl.currentTime)
    : 0;
  return secondsToTimecode(currentTime);
}

async function handlePreviewToggle() {
  if (!currentVideo) {
    showStatus("Select a song before using preview mode.", "error");
    return;
  }
  if (previewToggle) {
    previewToggle.disabled = true;
  }
  try {
    if (previewMode) {
      await disablePreviewMode();
    } else {
      await enablePreviewMode();
    }
  } finally {
    if (previewToggle) {
      previewToggle.disabled = false;
    }
  }
}

async function enablePreviewMode() {
  try {
    await syncPreview({ force: true, showError: true });
    previewMode = true;
    updatePreviewToggle(true);
    playVideoSilently();
    showStatus("Preview mode enabled. Video and lights are live.", "success");
  } catch (error) {
    console.error(error);
    previewMode = false;
    updatePreviewToggle(false);
    if (error && error.message) {
      showStatus(error.message, "error");
    } else {
      showStatus("Unable to start preview mode.", "error");
    }
    throw error;
  }
}

async function disablePreviewMode(options = {}) {
  cancelPreviewSync();
  const wasActive = previewMode;
  previewMode = false;
  updatePreviewToggle(false);
  try {
    await stopPreviewLights({ silent: options.silent });
  } catch (error) {
    console.error(error);
    if (!options.silent) {
      showStatus(error.message || "Unable to stop preview mode.", "error");
    }
  }
  pauseVideoSilently();
  if (wasActive && !options.silent) {
    showStatus("Preview mode disabled.", "info");
  }
}

function updatePreviewToggle(active) {
  if (!previewToggle) return;
  const isActive = Boolean(active);
  previewToggle.setAttribute("aria-pressed", isActive ? "true" : "false");
  previewToggle.classList.toggle("is-active", isActive);
  previewToggle.textContent = isActive ? "Preview Mode: On" : "Preview Mode: Off";
}

function queuePreviewSync() {
  if (!previewMode) return;
  if (previewSyncHandle) {
    clearTimeout(previewSyncHandle);
  }
  previewSyncHandle = window.setTimeout(() => {
    previewSyncHandle = null;
    syncPreview({ showError: false }).catch((error) => {
      console.error(error);
    });
  }, 150);
}

function cancelPreviewSync() {
  if (previewSyncHandle) {
    clearTimeout(previewSyncHandle);
    previewSyncHandle = null;
  }
}

async function syncPreview(options = {}) {
  if (!currentVideo) {
    throw new Error("Select a song before using preview mode.");
  }
  if (!previewMode && !options.force) {
    return;
  }
  let prepared;
  try {
    prepared = prepareActionsForSave();
  } catch (error) {
    if (options.showError) {
      showStatus(error.message || "Unable to update preview.", "error");
    }
    throw error;
  }
  try {
    await sendPreview(prepared);
  } catch (error) {
    if (options.showError) {
      showStatus(error.message || "Unable to update preview.", "error");
    }
    throw error;
  }
}

async function sendPreview(preparedActions) {
  if (!currentVideo) {
    throw new Error("Select a song before using preview mode.");
  }
  const hasVideo = videoEl && Number.isFinite(videoEl.currentTime);
  const startTime = hasVideo ? Math.max(0, videoEl.currentTime) : 0;
  const response = await fetchApi(`/dmx/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      video_id: currentVideo.id,
      actions: preparedActions,
      start_time: startTime,
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = payload.error || `Unable to update preview (${response.status})`;
    throw new Error(message);
  }
}

async function stopPreviewLights(options = {}) {
  try {
    const response = await fetchApi(`/dmx/preview`, { method: "DELETE" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Unable to stop preview (${response.status})`);
    }
  } catch (error) {
    if (!options.silent) {
      throw error;
    }
    console.error(error);
    return;
  }
}

function playVideoSilently() {
  if (!videoEl) return;
  const promise = videoEl.play();
  if (promise && typeof promise.catch === "function") {
    promise.catch(() => {});
  }
}

function pauseVideoSilently() {
  if (!videoEl || videoEl.paused) return;
  suppressPreviewPause = true;
  videoEl.pause();
  window.setTimeout(() => {
    suppressPreviewPause = false;
  }, 0);
}

function handleVideoPlay() {
  if (!previewMode) return;
  queuePreviewSync();
}

function handleVideoPause() {
  if (!previewMode) return;
  if (suppressPreviewPause) return;
  stopPreviewLights({ silent: true }).catch((error) => {
    console.error(error);
  });
}

function handleVideoSeeked() {
  if (!previewMode) return;
  queuePreviewSync();
}

async function loadVideos() {
  try {
    const { payload } = await fetchFromApiCandidates("/videos");
    videos = payload.videos || [];
    populateVideoSelect(videos);
    showStatus(`Loaded ${videos.length} video${videos.length === 1 ? "" : "s"}.`, "success");
  } catch (error) {
    console.error(error);
    showStatus("Unable to load videos from server", "error");
  }
}

function populateVideoSelect(list) {
  videoSelect.innerHTML = '<option value="">Select a song…</option>';
  for (const video of list) {
    const option = document.createElement("option");
    option.value = video.id;
    option.textContent = video.name || `Video ${video.id}`;
    videoSelect.append(option);
  }
}

function handleVideoSelection() {
  if (previewMode) {
    disablePreviewMode({ silent: true }).catch((error) => {
      console.error(error);
    });
  }
  const videoId = videoSelect.value;
  if (!videoId) {
    currentVideo = null;
    actions = [];
    templatePath = "";
    setControlsEnabled(false);
    renderActions();
    resetVideoPreview();
    templateInfoEl.hidden = true;
    return;
  }

  currentVideo = videos.find((video) => video.id === videoId) || null;
  if (!currentVideo) {
    showStatus("Selected song could not be found.", "error");
    return;
  }

  loadTemplate(videoId);
}

async function loadTemplate(videoId) {
  setControlsEnabled(false);
  showStatus("Loading template…");
  try {
    const response = await fetchApi(`/dmx/templates/${encodeURIComponent(videoId)}`);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Request failed (${response.status})`);
    }

    const data = await response.json();
    actions = (data.actions || []).map((action) => ({ ...DEFAULT_ACTION, ...action }));
    templatePath = data.video?.dmx_template || "";
    const videoUrl = data.video?.video_url || currentVideo?.video_url || "";

    updateTemplateInfo(templatePath, data.template_exists);
    setVideoSource(videoUrl);
    setControlsEnabled(true);
    renderActions();

    if (!actions.length) {
      showStatus("Template loaded. Add your first cue to get started.", "info");
    } else {
      showStatus(`Loaded ${actions.length} cue${actions.length === 1 ? "" : "s"}.`, "success");
    }
  } catch (error) {
    console.error(error);
    showStatus(error.message || "Unable to load template", "error");
    renderActions();
  }
}

function renderActions() {
  actionsBody.innerHTML = "";

  if (!actions.length) {
    const emptyRow = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.innerHTML = '<div class="empty-state">No lighting steps yet. Use “Add Step” to begin.</div>';
    emptyRow.append(cell);
    actionsBody.append(emptyRow);
    return;
  }

  actions.forEach((action, index) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);

    const timeInput = createInput({
      type: "text",
      value: action.time,
      placeholder: "00:01:23",
    });
    timeInput.addEventListener("change", (event) => handleTimeChange(event, index));
    timeInput.addEventListener("focus", () => seekToIndex(index));
    appendToColumn(row, "time", timeInput);

    const channelInput = createInput({
      type: "number",
      value: action.channel,
      min: 1,
      max: 512,
      step: 1,
    });
    channelInput.addEventListener("change", (event) => handleNumberChange(event, index, "channel", 1, 512));
    appendToColumn(row, "channel", channelInput);

    const valueInput = createInput({
      type: "number",
      value: action.value,
      min: 0,
      max: 255,
      step: 1,
    });
    valueInput.addEventListener("change", (event) => handleNumberChange(event, index, "value", 0, 255));
    appendToColumn(row, "value", valueInput);

    const fadeInput = createInput({
      type: "number",
      value: action.fade,
      min: 0,
      step: 0.1,
    });
    fadeInput.addEventListener("change", (event) => handleFadeChange(event, index));
    appendToColumn(row, "fade", fadeInput);

    const toolsCell = row.querySelector('[data-column="tools"]');
    const tools = document.createElement("div");
    tools.className = "row-tools";

    const jumpButton = document.createElement("button");
    jumpButton.type = "button";
    jumpButton.textContent = "Go";
    jumpButton.addEventListener("click", () => seekToIndex(index));

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Delete";
    removeButton.addEventListener("click", () => removeAction(index));

    tools.append(jumpButton, removeButton);
    toolsCell.append(tools);

    actionsBody.append(row);
  });
}

function createInput({ type, value, placeholder, min, max, step }) {
  const input = document.createElement("input");
  input.type = type;
  if (placeholder) {
    input.placeholder = placeholder;
  }
  if (min !== undefined) input.min = min;
  if (max !== undefined) input.max = max;
  if (step !== undefined) input.step = step;
  input.value = value ?? "";
  return input;
}

function appendToColumn(row, column, element) {
  const cell = row.querySelector(`[data-column="${column}"]`);
  if (cell) {
    cell.append(element);
  }
}

function handleTimeChange(event, index) {
  const value = event.target.value.trim();
  const seconds = parseTimeString(value);
  if (seconds === null) {
    event.target.classList.add("invalid");
    event.target.setCustomValidity("Use HH:MM:SS format (seconds may include decimals).");
    event.target.reportValidity();
    return;
  }
  event.target.classList.remove("invalid");
  event.target.setCustomValidity("");
  const formatted = secondsToTimecode(seconds);
  event.target.value = formatted;
  actions[index].time = formatted;
  seekToIndex(index);
  queuePreviewSync();
}

function handleNumberChange(event, index, key, min, max) {
  const raw = event.target.value;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    event.target.classList.add("invalid");
    event.target.setCustomValidity("Enter a whole number.");
    event.target.reportValidity();
    return;
  }
  const clamped = clamp(parsed, min, max);
  actions[index][key] = clamped;
  event.target.value = clamped;
  event.target.classList.remove("invalid");
  event.target.setCustomValidity("");
  queuePreviewSync();
}

function handleFadeChange(event, index) {
  const raw = event.target.value;
  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed) || parsed < 0) {
    event.target.classList.add("invalid");
    event.target.setCustomValidity("Fade must be zero or positive.");
    event.target.reportValidity();
    return;
  }
  const normalized = Math.max(0, parsed);
  actions[index].fade = Number(normalized.toFixed(3));
  event.target.value = actions[index].fade;
  event.target.classList.remove("invalid");
  event.target.setCustomValidity("");
  queuePreviewSync();
}

function seekToIndex(index) {
  const action = actions[index];
  if (!action) return;
  const seconds = parseTimeString(action.time);
  if (seconds === null) return;
  if (!videoEl.src) return;
  videoEl.currentTime = seconds;
  if (previewMode) {
    playVideoSilently();
    queuePreviewSync();
  } else {
    videoEl.pause();
  }
}

function addAction(action) {
  actions.push({ ...DEFAULT_ACTION, ...action });
  renderActions();
  queuePreviewSync();
}

function removeAction(index) {
  actions.splice(index, 1);
  renderActions();
  showStatus("Removed cue.", "info");
  queuePreviewSync();
}

function sortActions(list) {
  return [...list].sort((a, b) => {
    const aTime = parseTimeString(a.time) ?? 0;
    const bTime = parseTimeString(b.time) ?? 0;
    return aTime - bTime;
  });
}

function setControlsEnabled(enabled) {
  addRowButton.disabled = !enabled;
  sortRowsButton.disabled = !enabled;
  saveButton.disabled = !enabled;
  exportButton.disabled = !enabled;
  if (previewToggle) {
    if (!enabled && previewMode) {
      disablePreviewMode({ silent: true }).catch((error) => {
        console.error(error);
      });
    }
    previewToggle.disabled = !enabled;
  }
}

function resetVideoPreview() {
  pauseVideoSilently();
  videoEl.removeAttribute("src");
  videoEl.load();
}

function setVideoSource(url) {
  if (!url) {
    resetVideoPreview();
    return;
  }
  const absolute = new URL(url, window.location.href).href;
  if (videoEl.src !== absolute) {
    videoEl.src = url;
    videoEl.load();
  }
}

function updateTemplateInfo(path, exists) {
  if (!path) {
    templateInfoEl.hidden = true;
    templateInfoEl.textContent = "";
    return;
  }
  const status = exists ? "Existing template" : "New template (file will be created on save)";
  templateInfoEl.hidden = false;
  templateInfoEl.textContent = `${status}: ${path}`;
}

function showStatus(message, type = "info") {
  statusEl.textContent = message;
  statusEl.className = type === "error" ? "error" : type === "success" ? "success" : "";
}

async function handleSaveTemplate() {
  if (!currentVideo) return;
  try {
    const prepared = prepareActionsForSave();
    const response = await fetchApi(`/dmx/templates/${encodeURIComponent(currentVideo.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actions: prepared }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Request failed (${response.status})`);
    }
    showStatus("Template saved successfully.", "success");
  } catch (error) {
    console.error(error);
    const message = (error && error.message) || "Unable to save template";
    showStatus(`${message}. A JSON download has been generated instead.`, "error");
    exportTemplate(undefined, { silent: true });
  }
}

function exportTemplate(preparedActions, options = {}) {
  if (!currentVideo) return;
  let actionsToExport = preparedActions;
  if (!actionsToExport) {
    try {
      actionsToExport = prepareActionsForSave();
    } catch (error) {
      console.error(error);
      showStatus(error.message || "Unable to export template", "error");
      return;
    }
  }
  const payload = {
    video: {
      id: currentVideo.id,
      name: currentVideo.name,
    },
    actions: actionsToExport,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const filename = `${slugify(currentVideo.name || currentVideo.id)}_dmx.json`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  requestAnimationFrame(() => {
    URL.revokeObjectURL(url);
    link.remove();
  });
  if (!options.silent) {
    showStatus("Template exported as a download.", "success");
  }
}

function normalizeBasePath(value) {
  if (!value) return "";
  if (value === "/") return "";
  return value.replace(/\/+$/, "");
}

function buildApiUrl(base, path) {
  const normalizedBase = normalizeBasePath(base || "");
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  const combined = normalizedPath ? `${normalizedBase}/${normalizedPath}` : normalizedBase;
  return new URL(combined || "/", window.location.href).toString();
}

async function fetchApi(path, options) {
  const base = apiBasePath || API_BASE_CANDIDATES[0];
  const url = buildApiUrl(base, path);
  return fetch(url, options);
}

async function fetchFromApiCandidates(path) {
  const errors = [];
  for (const candidate of API_BASE_CANDIDATES) {
    try {
      const url = buildApiUrl(candidate, path);
      const response = await fetch(url);
      if (!response.ok) {
        errors.push(new Error(`Request failed for ${url} (${response.status})`));
        continue;
      }
      const payload = await response.json();
      apiBasePath = candidate;
      return { payload, basePath: candidate };
    } catch (error) {
      errors.push(error);
    }
  }

  const aggregateError =
    errors[errors.length - 1] || new Error("Unable to reach any API endpoints");
  throw aggregateError;
}

function prepareActionsForSave() {
  const prepared = [];
  actions.forEach((action, index) => {
    const seconds = parseTimeString(action.time);
    if (seconds === null) {
      throw new Error(`Row ${index + 1}: invalid time format.`);
    }
    const channel = Number.parseInt(action.channel, 10);
    if (Number.isNaN(channel) || channel < 1 || channel > 512) {
      throw new Error(`Row ${index + 1}: channel must be between 1 and 512.`);
    }
    const value = Number.parseInt(action.value, 10);
    if (Number.isNaN(value) || value < 0 || value > 255) {
      throw new Error(`Row ${index + 1}: value must be between 0 and 255.`);
    }
    const fade = Number.parseFloat(action.fade) || 0;
    if (fade < 0) {
      throw new Error(`Row ${index + 1}: fade cannot be negative.`);
    }
    prepared.push({
      time: secondsToTimecode(seconds),
      channel,
      value,
      fade: Number(fade.toFixed(3)),
    });
  });
  return sortActions(prepared);
}

function parseTimeString(value) {
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length !== 3) return null;
  const [hoursStr, minutesStr, secondsStr] = parts;
  const hours = Number.parseInt(hoursStr, 10);
  const minutes = Number.parseInt(minutesStr, 10);
  const seconds = Number.parseFloat(secondsStr);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds)) return null;
  if (minutes < 0 || minutes >= 60) return null;
  if (seconds < 0 || seconds >= 60) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function secondsToTimecode(seconds) {
  const wholeSeconds = Math.floor(seconds);
  const milliseconds = Math.round((seconds - wholeSeconds) * 1000);
  const hrs = Math.floor(wholeSeconds / 3600);
  const mins = Math.floor((wholeSeconds % 3600) / 60);
  const secs = wholeSeconds % 60;
  const pad = (num) => String(num).padStart(2, "0");
  const time = `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  if (milliseconds) {
    return `${time}.${String(milliseconds).padStart(3, "0")}`;
  }
  return time;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function slugify(value) {
  return (value || "template")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_")
    || "template";
}
