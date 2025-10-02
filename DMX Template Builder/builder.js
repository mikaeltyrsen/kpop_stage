const videoSelect = document.getElementById("video-select");
const addRowButton = document.getElementById("add-row");
const sortRowsButton = document.getElementById("sort-rows");
const saveButton = document.getElementById("save-template");
const exportButton = document.getElementById("export-template");
const statusEl = document.getElementById("status-message");
const actionsBody = document.getElementById("actions-body");
const templateInfoEl = document.getElementById("template-info");
const videoEl = document.getElementById("preview-video");
const rowTemplate = document.getElementById("action-row-template");

let videos = [];
let currentVideo = null;
let actions = [];
let templatePath = "";

const DEFAULT_ACTION = Object.freeze({ time: "00:00:00", channel: 1, value: 0, fade: 0 });

init();

function init() {
  loadVideos();
  videoSelect.addEventListener("change", handleVideoSelection);
  addRowButton.addEventListener("click", () => {
    addAction({ ...DEFAULT_ACTION });
  });
  sortRowsButton.addEventListener("click", () => {
    actions = sortActions(actions);
    renderActions();
  });
  saveButton.addEventListener("click", handleSaveTemplate);
  exportButton.addEventListener("click", () => exportTemplate());
}

async function loadVideos() {
  try {
    const response = await fetch("/api/videos");
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    const payload = await response.json();
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
    const response = await fetch(`/api/dmx/templates/${encodeURIComponent(videoId)}`);
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
}

function seekToIndex(index) {
  const action = actions[index];
  if (!action) return;
  const seconds = parseTimeString(action.time);
  if (seconds === null) return;
  if (!videoEl.src) return;
  videoEl.currentTime = seconds;
  videoEl.pause();
}

function addAction(action) {
  actions.push({ ...DEFAULT_ACTION, ...action });
  renderActions();
}

function removeAction(index) {
  actions.splice(index, 1);
  renderActions();
  showStatus("Removed cue.", "info");
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
}

function resetVideoPreview() {
  videoEl.pause();
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
    const response = await fetch(`/api/dmx/templates/${encodeURIComponent(currentVideo.id)}`, {
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
