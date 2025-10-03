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
const channelPresetsContainer = document.getElementById("channel-presets");
const addChannelPresetButton = document.getElementById("add-channel-preset");
const channelPresetsSection = document.querySelector(".preset-settings");
const builderLayout = document.querySelector(".builder-layout");
const openChannelPresetsButton = document.getElementById("open-channel-presets");

const PREVIEW_STATE_LABELS = {
  on: "Preview Mode: On",
  off: "Preview Mode: Off",
  enabling: "Enabling Preview Mode…",
  disabling: "Disabling Preview Mode…",
};

let videos = [];
let currentVideo = null;
let actions = [];
let templatePath = "";
let apiBasePath = null;
let previewMode = false;
let previewSyncHandle = null;
let suppressPreviewPause = false;
let channelPresets = [];
let showingChannelPresets = true;
const collapsedChannelPresetIds = new Set();

const API_BASE_CANDIDATES = [
  "/api",
  "./api",
  "../api",
  "/dmx-template-builder/api",
];

const CHANNEL_PRESET_STORAGE_KEY = "dmxTemplateBuilder.channelPresets";

const DEFAULT_ACTION = Object.freeze({
  time: "00:00:00",
  channel: 1,
  value: 0,
  fade: 0,
  channelPresetId: null,
  valuePresetId: null,
});

init();

function init() {
  initChannelPresetsUI();
  if (openChannelPresetsButton) {
    openChannelPresetsButton.addEventListener("click", handleOpenChannelPresets);
  }
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
  updateWorkspaceVisibility();
}

function handleAddRow() {
  const time = getCurrentVideoTimecode();
  addAction({ time });
}

function handleOpenChannelPresets() {
  if (videoSelect.value) {
    videoSelect.value = "";
    handleVideoSelection();
    return;
  }
  if (!showingChannelPresets) {
    showingChannelPresets = true;
    updateWorkspaceVisibility();
  }
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
    setPreviewToggleBusy(true, !previewMode);
  }
  try {
    if (previewMode) {
      await disablePreviewMode();
    } else {
      await enablePreviewMode();
    }
  } finally {
    if (previewToggle) {
      setPreviewToggleBusy(false);
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
  previewToggle.classList.remove("is-busy");
  previewToggle.disabled = false;
  const label = isActive ? PREVIEW_STATE_LABELS.on : PREVIEW_STATE_LABELS.off;
  previewToggle.textContent = label;
  previewToggle.setAttribute("title", label);
}

function setPreviewToggleBusy(isBusy, targetEnabledState) {
  if (!previewToggle) return;
  const shouldEnable = Boolean(targetEnabledState);
  previewToggle.classList.toggle("is-busy", Boolean(isBusy));
  previewToggle.disabled = Boolean(isBusy);
  if (isBusy) {
    const label = shouldEnable
      ? PREVIEW_STATE_LABELS.enabling
      : PREVIEW_STATE_LABELS.disabling;
    previewToggle.textContent = label;
    previewToggle.setAttribute("title", label);
    return;
  }
  updatePreviewToggle(previewMode);
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
    showingChannelPresets = true;
    actions = [];
    templatePath = "";
    setControlsEnabled(false);
    renderActions();
    resetVideoPreview();
    templateInfoEl.hidden = true;
    updateWorkspaceVisibility();
    return;
  }

  showingChannelPresets = false;
  updateWorkspaceVisibility();
  currentVideo = videos.find((video) => video.id === videoId) || null;
  if (!currentVideo) {
    showStatus("Selected song could not be found.", "error");
    videoSelect.value = "";
    showingChannelPresets = true;
    updateWorkspaceVisibility();
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

    const channelField = createChannelField(action, index);
    appendToColumn(row, "channel", channelField);

    const valueField = createValueField(action, index);
    appendToColumn(row, "value", valueField);

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

function createChannelField(action, index) {
  const wrapper = document.createElement("div");
  wrapper.className = "preset-select";

  const select = document.createElement("select");
  select.addEventListener("change", (event) => handleChannelPresetChange(event, index));

  const customOption = document.createElement("option");
  customOption.value = "custom";
  customOption.textContent = "Custom…";
  select.append(customOption);

  const sortedPresets = getSortedChannelPresets();
  let selectedPreset = null;
  sortedPresets.forEach((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.dataset.channelPresetId = preset.id;
    option.textContent = formatChannelPresetLabel(preset);
    select.append(option);
    if (preset.id === action.channelPresetId) {
      selectedPreset = preset;
    }
  });

  if (action.channelPresetId && !selectedPreset) {
    action.channelPresetId = null;
  }

  if (selectedPreset) {
    select.value = selectedPreset.id;
  } else {
    select.value = "custom";
  }

  const input = createInput({
    type: "number",
    value: action.channel,
    min: 1,
    max: 512,
    step: 1,
  });
  input.addEventListener("change", (event) => handleChannelNumberChange(event, index));
  if (selectedPreset) {
    input.value = selectedPreset.channel;
    input.disabled = true;
    input.title = "Channel is set by preset";
  } else {
    input.disabled = false;
    input.title = "";
  }

  wrapper.append(select, input);
  return wrapper;
}

function createValueField(action, index) {
  const wrapper = document.createElement("div");
  wrapper.className = "preset-select";

  const select = document.createElement("select");
  select.addEventListener("change", (event) => handleValuePresetChange(event, index));

  const customOption = document.createElement("option");
  customOption.value = "custom";
  customOption.textContent = "Custom…";
  select.append(customOption);

  let selectedChannelPreset = null;
  if (action.channelPresetId) {
    selectedChannelPreset =
      channelPresets.find((preset) => preset.id === action.channelPresetId) || null;
    if (!selectedChannelPreset) {
      action.channelPresetId = null;
      action.valuePresetId = null;
    }
  }

  const valuePresets = selectedChannelPreset ? selectedChannelPreset.values || [] : [];
  let selectedValuePreset = null;
  valuePresets.forEach((valuePreset) => {
    const option = document.createElement("option");
    option.value = valuePreset.id;
    option.dataset.valuePresetId = valuePreset.id;
    option.textContent = formatValuePresetLabel(valuePreset);
    select.append(option);
    if (valuePreset.id === action.valuePresetId) {
      selectedValuePreset = valuePreset;
    }
  });

  if (action.valuePresetId && !selectedValuePreset) {
    action.valuePresetId = null;
  }

  if (selectedValuePreset) {
    select.value = selectedValuePreset.id;
  } else {
    select.value = "custom";
  }

  const input = createInput({
    type: "number",
    value: action.value,
    min: 0,
    max: 255,
    step: 1,
  });
  input.addEventListener("change", (event) => handleValueNumberChange(event, index));
  if (selectedValuePreset) {
    input.value = selectedValuePreset.value;
    input.disabled = true;
    input.title = "Value is set by preset";
  } else {
    input.disabled = false;
    input.title = "";
  }

  wrapper.append(select, input);
  return wrapper;
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

function handleChannelNumberChange(event, index) {
  const action = actions[index];
  if (action) {
    action.channelPresetId = null;
    action.valuePresetId = null;
  }
  handleNumberChange(event, index, "channel", 1, 512);
}

function handleValueNumberChange(event, index) {
  const action = actions[index];
  if (action) {
    action.valuePresetId = null;
  }
  handleNumberChange(event, index, "value", 0, 255);
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

function handleChannelPresetChange(event, index) {
  const selectedId = event.target.value;
  const action = actions[index];
  if (!action) return;

  if (selectedId && selectedId !== "custom") {
    const preset = channelPresets.find((item) => item.id === selectedId);
    if (preset) {
      action.channelPresetId = preset.id;
      const presetChannel = Number.parseInt(preset.channel, 10);
      if (Number.isFinite(presetChannel)) {
        action.channel = clamp(presetChannel, 1, 512);
      }

      if (Array.isArray(preset.values) && preset.values.length) {
        const existing = preset.values.find((value) => value.id === action.valuePresetId);
        const selectedValue = existing || preset.values[0];
        action.valuePresetId = selectedValue.id;
        const valueNumber = Number.parseInt(selectedValue.value, 10);
        if (Number.isFinite(valueNumber)) {
          action.value = clamp(valueNumber, 0, 255);
        }
      } else {
        action.valuePresetId = null;
      }

      renderActions();
      queuePreviewSync();
      return;
    }
  }

  action.channelPresetId = null;
  action.valuePresetId = null;
  renderActions();
  queuePreviewSync();
}

function handleValuePresetChange(event, index) {
  const selectedId = event.target.value;
  const action = actions[index];
  if (!action) return;

  if (selectedId && selectedId !== "custom" && action.channelPresetId) {
    const preset = channelPresets.find((item) => item.id === action.channelPresetId);
    const valuePreset = preset?.values?.find((value) => value.id === selectedId);
    if (valuePreset) {
      action.valuePresetId = valuePreset.id;
      const valueNumber = Number.parseInt(valuePreset.value, 10);
      if (Number.isFinite(valueNumber)) {
        action.value = clamp(valueNumber, 0, 255);
      }
      renderActions();
      queuePreviewSync();
      return;
    }
  }

  action.valuePresetId = null;
  renderActions();
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

function initChannelPresetsUI() {
  if (!channelPresetsContainer) return;
  channelPresets = loadChannelPresets();
  renderChannelPresets();
  if (addChannelPresetButton) {
    addChannelPresetButton.addEventListener("click", () => {
      addChannelPreset();
    });
  }
}

function renderChannelPresets() {
  if (!channelPresetsContainer) return;

  pruneCollapsedChannelPresets();
  channelPresetsContainer.innerHTML = "";

  if (!channelPresets.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "preset-settings__empty";
    emptyState.textContent = "No channel presets yet. Use “Add Channel Preset” to create one.";
    channelPresetsContainer.append(emptyState);
    return;
  }

  const sorted = getSortedChannelPresets();
  sorted.forEach((preset) => {
    const card = document.createElement("article");
    card.className = "preset-card";
    card.dataset.presetId = preset.id;

    const isCollapsed = collapsedChannelPresetIds.has(preset.id);
    if (isCollapsed) {
      card.classList.add("is-collapsed");
    }
    const contentId = `preset-content-${preset.id}`;

    const header = document.createElement("div");
    header.className = "preset-card__header";

    const titleGroup = document.createElement("div");
    titleGroup.className = "preset-card__title-group";

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "preset-card__toggle";
    toggleButton.textContent = isCollapsed ? "+" : "−";
    toggleButton.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    toggleButton.setAttribute("aria-controls", contentId);
    toggleButton.setAttribute("aria-label", isCollapsed ? "Expand preset" : "Collapse preset");
    toggleButton.title = isCollapsed ? "Expand preset" : "Collapse preset";
    toggleButton.addEventListener("click", () => {
      if (collapsedChannelPresetIds.has(preset.id)) {
        collapsedChannelPresetIds.delete(preset.id);
      } else {
        collapsedChannelPresetIds.add(preset.id);
      }
      renderChannelPresets();
    });

    const title = document.createElement("h3");
    title.className = "preset-card__title";
    title.textContent = formatChannelPresetTitle(preset);
    titleGroup.append(toggleButton, title);
    header.append(titleGroup);

    const actionsEl = document.createElement("div");
    actionsEl.className = "preset-card__actions";
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "secondary";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => removeChannelPreset(preset.id));
    actionsEl.append(removeButton);
    header.append(actionsEl);

    card.append(header);

    const content = document.createElement("div");
    content.className = "preset-card__content";
    content.id = contentId;
    content.hidden = isCollapsed;

    const row = document.createElement("div");
    row.className = "preset-card__row";

    const nameField = document.createElement("label");
    nameField.className = "preset-field";
    const nameLabel = document.createElement("span");
    nameLabel.textContent = "Name";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "Mover - Pan";
    nameInput.value = preset.name || "";
    nameInput.addEventListener("input", (event) => handlePresetNameInput(event, preset.id));
    nameField.append(nameLabel, nameInput);

    const channelField = document.createElement("label");
    channelField.className = "preset-field";
    const channelLabel = document.createElement("span");
    channelLabel.textContent = "Channel";
    const channelInput = document.createElement("input");
    channelInput.type = "number";
    channelInput.min = 1;
    channelInput.max = 512;
    channelInput.step = 1;
    channelInput.value = preset.channel ?? "";
    channelInput.addEventListener("change", (event) => handlePresetChannelInput(event, preset.id));
    channelField.append(channelLabel, channelInput);

    row.append(nameField, channelField);
    content.append(row);

    const valuesSection = document.createElement("div");
    valuesSection.className = "preset-values";

    const valuesHeading = document.createElement("h3");
    valuesHeading.textContent = "Values";
    valuesSection.append(valuesHeading);

    if (!preset.values.length) {
      const emptyValues = document.createElement("p");
      emptyValues.className = "preset-values__empty";
      emptyValues.textContent = "No saved values yet. Add common colours or positions.";
      valuesSection.append(emptyValues);
    }

    preset.values.forEach((valuePreset) => {
      const valueRow = document.createElement("div");
      valueRow.className = "preset-value-row";
      valueRow.dataset.valuePresetId = valuePreset.id;

      const valueName = document.createElement("input");
      valueName.type = "text";
      valueName.placeholder = "Green";
      valueName.value = valuePreset.name || "";
      valueName.addEventListener("input", (event) => {
        handlePresetValueNameInput(event, preset.id, valuePreset.id);
      });

      const valueInput = document.createElement("input");
      valueInput.type = "number";
      valueInput.min = 0;
      valueInput.max = 255;
      valueInput.step = 1;
      valueInput.value = valuePreset.value ?? 0;
      valueInput.addEventListener("change", (event) => {
        handlePresetValueNumberInput(event, preset.id, valuePreset.id);
      });

      const removeValueButton = document.createElement("button");
      removeValueButton.type = "button";
      removeValueButton.textContent = "Remove";
      removeValueButton.addEventListener("click", () => {
        removeChannelPresetValue(preset.id, valuePreset.id);
      });

      valueRow.append(valueName, valueInput, removeValueButton);
      valuesSection.append(valueRow);
    });

    const addValueButton = document.createElement("button");
    addValueButton.type = "button";
    addValueButton.className = "secondary";
    addValueButton.textContent = "Add Value";
    addValueButton.addEventListener("click", () => addChannelPresetValue(preset.id));
    valuesSection.append(addValueButton);

    content.append(valuesSection);
    card.append(content);
    channelPresetsContainer.append(card);
  });
}

function updateWorkspaceVisibility() {
  const presetsVisible = Boolean(showingChannelPresets);
  if (channelPresetsSection) {
    channelPresetsSection.hidden = !presetsVisible;
    channelPresetsSection.setAttribute("aria-hidden", presetsVisible ? "false" : "true");
  }
  if (builderLayout) {
    builderLayout.hidden = presetsVisible;
    builderLayout.setAttribute("aria-hidden", presetsVisible ? "true" : "false");
  }
  if (openChannelPresetsButton) {
    openChannelPresetsButton.setAttribute("aria-pressed", presetsVisible ? "true" : "false");
  }
}

function pruneCollapsedChannelPresets() {
  const validIds = new Set(channelPresets.map((preset) => preset.id));
  Array.from(collapsedChannelPresetIds).forEach((presetId) => {
    if (!validIds.has(presetId)) {
      collapsedChannelPresetIds.delete(presetId);
    }
  });
}

function addChannelPreset() {
  const preset = {
    id: generateId("preset"),
    name: "",
    channel: findNextAvailableChannel(),
    values: [],
  };
  channelPresets.push(preset);
  saveChannelPresets();
  renderChannelPresets();
  renderActions();
}

function removeChannelPreset(presetId) {
  const index = channelPresets.findIndex((preset) => preset.id === presetId);
  if (index === -1) return;
  channelPresets.splice(index, 1);
  collapsedChannelPresetIds.delete(presetId);
  saveChannelPresets();
  actions.forEach((action) => {
    if (action.channelPresetId === presetId) {
      action.channelPresetId = null;
      action.valuePresetId = null;
    }
  });
  renderChannelPresets();
  renderActions();
  queuePreviewSync();
}

function addChannelPresetValue(presetId) {
  const preset = getChannelPreset(presetId);
  if (!preset) return;
  if (!Array.isArray(preset.values)) {
    preset.values = [];
  }
  const value = {
    id: generateId("value"),
    name: "",
    value: findNextAvailableValue(preset),
  };
  preset.values.push(value);
  saveChannelPresets();
  renderChannelPresets();
  renderActions();
}

function removeChannelPresetValue(presetId, valueId) {
  const preset = getChannelPreset(presetId);
  if (!preset || !Array.isArray(preset.values)) return;
  const index = preset.values.findIndex((value) => value.id === valueId);
  if (index === -1) return;
  preset.values.splice(index, 1);
  saveChannelPresets();
  actions.forEach((action) => {
    if (action.channelPresetId === presetId && action.valuePresetId === valueId) {
      action.valuePresetId = null;
    }
  });
  renderChannelPresets();
  renderActions();
  queuePreviewSync();
}

function handlePresetNameInput(event, presetId) {
  const preset = getChannelPreset(presetId);
  if (!preset) return;
  preset.name = event.target.value;
  saveChannelPresets();
  updatePresetCardTitle(event.target.closest(".preset-card"), preset);
  refreshChannelPresetOptions(preset);
}

function handlePresetChannelInput(event, presetId) {
  const preset = getChannelPreset(presetId);
  if (!preset) return;
  const raw = Number.parseInt(event.target.value, 10);
  if (Number.isNaN(raw)) {
    event.target.classList.add("invalid");
    event.target.setCustomValidity("Channel must be between 1 and 512.");
    event.target.reportValidity();
    return;
  }
  const clamped = clamp(raw, 1, 512);
  event.target.value = clamped;
  event.target.classList.remove("invalid");
  event.target.setCustomValidity("");
  preset.channel = clamped;
  saveChannelPresets();
  updatePresetCardTitle(event.target.closest(".preset-card"), preset);
  refreshChannelPresetOptions(preset);
  updateActionsForChannelPreset(presetId);
  renderChannelPresets();
  renderActions();
  queuePreviewSync();
}

function handlePresetValueNameInput(event, presetId, valueId) {
  const valuePreset = getChannelValuePreset(presetId, valueId);
  if (!valuePreset) return;
  valuePreset.name = event.target.value;
  saveChannelPresets();
  refreshValuePresetOptions(presetId, valuePreset);
}

function handlePresetValueNumberInput(event, presetId, valueId) {
  const valuePreset = getChannelValuePreset(presetId, valueId);
  if (!valuePreset) return;
  const raw = Number.parseInt(event.target.value, 10);
  if (Number.isNaN(raw)) {
    event.target.classList.add("invalid");
    event.target.setCustomValidity("Value must be between 0 and 255.");
    event.target.reportValidity();
    return;
  }
  const clamped = clamp(raw, 0, 255);
  event.target.value = clamped;
  event.target.classList.remove("invalid");
  event.target.setCustomValidity("");
  valuePreset.value = clamped;
  saveChannelPresets();
  refreshValuePresetOptions(presetId, valuePreset);
  updateActionsForValuePreset(presetId, valueId);
  renderActions();
  queuePreviewSync();
}

function loadChannelPresets() {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(CHANNEL_PRESET_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => sanitizeChannelPreset(item)).filter(Boolean);
  } catch (error) {
    console.error("Unable to load channel presets", error);
    return [];
  }
}

function saveChannelPresets() {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    const payload = channelPresets.map((preset) => ({
      id: preset.id,
      name: preset.name || "",
      channel: clamp(Number.parseInt(preset.channel, 10) || 1, 1, 512),
      values: Array.isArray(preset.values)
        ? preset.values.map((value) => ({
            id: value.id,
            name: value.name || "",
            value: clamp(Number.parseInt(value.value, 10) || 0, 0, 255),
          }))
        : [],
    }));
    window.localStorage.setItem(CHANNEL_PRESET_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.error("Unable to save channel presets", error);
  }
}

function sanitizeChannelPreset(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" && raw.id ? raw.id : generateId("preset");
  const name = typeof raw.name === "string" ? raw.name : "";
  const channelNumber = Number.parseInt(raw.channel, 10);
  const channel = Number.isFinite(channelNumber) ? clamp(channelNumber, 1, 512) : 1;
  const values = Array.isArray(raw.values)
    ? raw.values.map((value) => sanitizeChannelValue(value)).filter(Boolean)
    : [];
  return { id, name, channel, values };
}

function sanitizeChannelValue(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" && raw.id ? raw.id : generateId("value");
  const name = typeof raw.name === "string" ? raw.name : "";
  const rawValue = Number.parseInt(raw.value, 10);
  const value = Number.isFinite(rawValue) ? clamp(rawValue, 0, 255) : 0;
  return { id, name, value };
}

function getChannelPreset(presetId) {
  return channelPresets.find((preset) => preset.id === presetId) || null;
}

function getChannelValuePreset(presetId, valueId) {
  const preset = getChannelPreset(presetId);
  if (!preset || !Array.isArray(preset.values)) return null;
  return preset.values.find((value) => value.id === valueId) || null;
}

function updatePresetCardTitle(card, preset) {
  if (!card) return;
  const title = card.querySelector(".preset-card__title");
  if (title) {
    title.textContent = formatChannelPresetTitle(preset);
  }
}

function formatChannelPresetTitle(preset) {
  const channelNumber = Number.isFinite(preset.channel) ? preset.channel : null;
  if (preset.name && channelNumber !== null) {
    return `${preset.name} — Channel ${channelNumber}`;
  }
  if (preset.name) {
    return preset.name;
  }
  if (channelNumber !== null) {
    return `Channel ${channelNumber}`;
  }
  return "New channel preset";
}

function formatChannelPresetLabel(preset) {
  const channelNumber = Number.isFinite(preset.channel) ? preset.channel : null;
  if (preset.name) {
    return preset.name;
  }
  if (channelNumber !== null) {
    return `Channel ${channelNumber}`;
  }
  return "Channel Preset";
}

function formatValuePresetLabel(valuePreset) {
  const valueNumber = Number.isFinite(valuePreset.value) ? valuePreset.value : 0;
  return valuePreset.name ? `${valuePreset.name} (${valueNumber})` : `Value ${valueNumber}`;
}

function getSortedChannelPresets() {
  return [...channelPresets].sort((a, b) => {
    const aChannel = Number.isFinite(a.channel) ? a.channel : Number.POSITIVE_INFINITY;
    const bChannel = Number.isFinite(b.channel) ? b.channel : Number.POSITIVE_INFINITY;
    if (aChannel !== bChannel) {
      return aChannel - bChannel;
    }
    return (a.name || "").localeCompare(b.name || "");
  });
}

function refreshChannelPresetOptions(preset) {
  if (!actionsBody) return;
  const selector = `option[data-channel-preset-id="${preset.id}"]`;
  actionsBody.querySelectorAll(selector).forEach((option) => {
    option.textContent = formatChannelPresetLabel(preset);
  });
}

function refreshValuePresetOptions(presetId, valuePreset) {
  if (!actionsBody) return;
  const selector = `option[data-value-preset-id="${valuePreset.id}"]`;
  actionsBody.querySelectorAll(selector).forEach((option) => {
    option.textContent = formatValuePresetLabel(valuePreset);
  });
}

function updateActionsForChannelPreset(presetId) {
  const preset = getChannelPreset(presetId);
  if (!preset) return;
  const channelNumber = Number.parseInt(preset.channel, 10);
  if (!Number.isFinite(channelNumber)) return;
  actions.forEach((action) => {
    if (action.channelPresetId === presetId) {
      action.channel = clamp(channelNumber, 1, 512);
    }
  });
}

function updateActionsForValuePreset(presetId, valueId) {
  const valuePreset = getChannelValuePreset(presetId, valueId);
  if (!valuePreset) return;
  const numericValue = Number.parseInt(valuePreset.value, 10);
  if (!Number.isFinite(numericValue)) return;
  actions.forEach((action) => {
    if (action.channelPresetId === presetId && action.valuePresetId === valueId) {
      action.value = clamp(numericValue, 0, 255);
    }
  });
}

function findNextAvailableChannel() {
  const used = new Set(
    channelPresets
      .map((preset) => Number.parseInt(preset.channel, 10))
      .filter((value) => Number.isFinite(value)),
  );
  for (let channel = 1; channel <= 512; channel += 1) {
    if (!used.has(channel)) {
      return channel;
    }
  }
  return 1;
}

function findNextAvailableValue(preset) {
  const used = new Set(
    (preset.values || [])
      .map((value) => Number.parseInt(value.value, 10))
      .filter((entry) => Number.isFinite(entry)),
  );
  for (let value = 0; value <= 255; value += 1) {
    if (!used.has(value)) {
      return value;
    }
  }
  return 0;
}

function generateId(prefix = "id") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
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
