const videoSelect = document.getElementById("video-select");
const addRowButton = document.getElementById("add-row");
const saveButton = document.getElementById("save-template");
const exportButton = document.getElementById("export-template");
const statusEl = document.getElementById("status-message");
const actionsBody = document.getElementById("actions-body");
const templateInfoEl = document.getElementById("template-info");
const videoEl = document.getElementById("preview-video");
const previewToggle = document.getElementById("preview-mode-toggle");
const rowTemplate = document.getElementById("action-row-template");
const channelPresetsContainer = document.getElementById("channel-presets");
const channelStatusListEl = document.getElementById("channel-status-list");
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
const collapsedTimeGroups = new Set();
let renderedRows = [];
let groupHeaderRows = new Map();
let actionGroupTimes = [];
let lastKnownTimelineSeconds = 0;

const ACTION_ID_PROPERTY = "__actionLocalId";
let actionIdCounter = 0;

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
  saveButton.addEventListener("click", handleSaveTemplate);
  exportButton.addEventListener("click", () => exportTemplate());
  if (previewToggle) {
    previewToggle.addEventListener("click", handlePreviewToggle);
  }
  if (videoEl) {
    videoEl.addEventListener("play", handleVideoPlay);
    videoEl.addEventListener("pause", handleVideoPause);
    videoEl.addEventListener("seeked", handleVideoSeeked);
    videoEl.addEventListener("timeupdate", handleVideoTimeUpdate);
    videoEl.addEventListener("loadedmetadata", handleVideoLoadedMetadata);
  }
  updateWorkspaceVisibility();
}

function resetActionIdCounter() {
  actionIdCounter = 0;
}

function generateActionId() {
  actionIdCounter += 1;
  return `action-${actionIdCounter}`;
}

function ensureActionLocalId(action) {
  if (!action || typeof action !== "object") {
    return "";
  }
  if (!Object.prototype.hasOwnProperty.call(action, ACTION_ID_PROPERTY)) {
    Object.defineProperty(action, ACTION_ID_PROPERTY, {
      value: generateActionId(),
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return action[ACTION_ID_PROPERTY];
}

function getActionLocalId(action) {
  return ensureActionLocalId(action);
}

function describeFocusedActionField(element) {
  if (!element || !element.dataset) return null;
  const { actionId, field } = element.dataset;
  if (!actionId || !field) return null;
  const descriptor = { actionId, field };
  if (typeof element.selectionStart === "number" && typeof element.selectionEnd === "number") {
    descriptor.selectionStart = element.selectionStart;
    descriptor.selectionEnd = element.selectionEnd;
  }
  return descriptor;
}

function focusActionField(descriptor) {
  if (!descriptor) return;
  if (!actionsBody) return;
  const { actionId, field } = descriptor;
  if (!actionId || !field) return;
  const selector = `[data-action-id="${actionId}"][data-field="${field}"]`;
  const target = actionsBody.querySelector(selector);
  if (!target) return;
  try {
    target.focus({ preventScroll: true });
  } catch (error) {
    target.focus();
  }
  if (
    target instanceof HTMLInputElement &&
    typeof descriptor.selectionStart === "number" &&
    typeof descriptor.selectionEnd === "number"
  ) {
    try {
      target.setSelectionRange(descriptor.selectionStart, descriptor.selectionEnd);
    } catch (error) {
      // Ignore selection errors for input types that do not support setSelectionRange.
    }
  }
}

function setActionFieldMetadata(element, actionId, field) {
  if (!element) return;
  element.dataset.actionId = actionId;
  element.dataset.field = field;
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
  updateActiveActionHighlight();
  if (!previewMode) return;
  queuePreviewSync();
}

function handleVideoTimeUpdate() {
  updateActiveActionHighlight();
}

function handleVideoLoadedMetadata() {
  updateActiveActionHighlight(0);
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
    resetActionIdCounter();
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
    resetActionIdCounter();
    actions = (data.actions || []).map((action) => ({ ...DEFAULT_ACTION, ...action }));
    actions.forEach(ensureActionLocalId);
    autoAssignPresetsToActions(actions);
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

function autoAssignPresetsToActions(list) {
  if (!Array.isArray(list) || !list.length) return;
  if (!Array.isArray(channelPresets) || !channelPresets.length) return;

  list.forEach((action) => {
    if (!action || typeof action !== "object") return;

    let preset = null;
    if (action.channelPresetId) {
      preset = getChannelPreset(action.channelPresetId);
      if (!preset) {
        action.channelPresetId = null;
      }
    }

    if (!action.channelPresetId) {
      const channelNumber = Number.parseInt(action.channel, 10);
      if (Number.isFinite(channelNumber)) {
        preset =
          channelPresets.find(
            (item) => Number.isFinite(item.channel) && item.channel === channelNumber,
          ) || null;
        if (preset) {
          action.channelPresetId = preset.id;
        }
      }
    } else if (!preset) {
      preset = getChannelPreset(action.channelPresetId);
    }

    if (!preset) {
      action.valuePresetId = null;
      return;
    }

    const presetChannel = Number.parseInt(preset.channel, 10);
    if (Number.isFinite(presetChannel)) {
      action.channel = clamp(presetChannel, 1, 512);
    }

    if (!Array.isArray(preset.values) || !preset.values.length) {
      action.valuePresetId = null;
      return;
    }

    let valuePreset = null;
    if (action.valuePresetId) {
      valuePreset = preset.values.find((value) => value.id === action.valuePresetId) || null;
      if (!valuePreset) {
        action.valuePresetId = null;
      }
    }

    if (!valuePreset) {
      const actionValue = Number.parseInt(action.value, 10);
      if (Number.isFinite(actionValue)) {
        valuePreset =
          preset.values.find(
            (value) => Number.isFinite(value.value) && value.value === actionValue,
          ) || null;
      }
      if (valuePreset) {
        action.valuePresetId = valuePreset.id;
      }
    }

    if (valuePreset) {
      const presetValue = Number.parseInt(valuePreset.value, 10);
      if (Number.isFinite(presetValue)) {
        action.value = clamp(presetValue, 0, 255);
      }
    }
  });
}

function renderActions(options = {}) {
  const focusDescriptor =
    options.preserveFocus || describeFocusedActionField(document.activeElement);

  actions = sortActions(actions);
  actionsBody.innerHTML = "";
  renderedRows = new Array(actions.length).fill(null);
  actionGroupTimes = new Array(actions.length).fill(null);
  groupHeaderRows = new Map();

  if (!actions.length) {
    const emptyRow = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.innerHTML = '<div class="empty-state">No lighting steps yet. Use “Add Step” to begin.</div>';
    emptyRow.append(cell);
    actionsBody.append(emptyRow);
    collapsedTimeGroups.clear();
    updateActiveActionHighlight(lastKnownTimelineSeconds);
    return;
  }

  const grouped = [];
  actions.forEach((action, index) => {
    const timeKey = action.time || DEFAULT_ACTION.time;
    actionGroupTimes[index] = timeKey;
    const lastGroup = grouped[grouped.length - 1];
    if (lastGroup && lastGroup.time === timeKey) {
      lastGroup.items.push({ action, index });
    } else {
      grouped.push({ time: timeKey, items: [{ action, index }] });
    }
  });

  const activeTimes = new Set();

  grouped.forEach(({ time, items }) => {
    activeTimes.add(time);
    const collapsed = collapsedTimeGroups.has(time);
    const headerRow = createGroupHeaderRow(time, items.length, collapsed);
    groupHeaderRows.set(time, headerRow);
    actionsBody.append(headerRow);

    if (!collapsed) {
      items.forEach(({ action, index }) => {
        const row = createActionRow(action, index, time);
        renderedRows[index] = row;
        actionsBody.append(row);
      });
    }
  });

  for (const time of [...collapsedTimeGroups]) {
    if (!activeTimes.has(time)) {
      collapsedTimeGroups.delete(time);
    }
  }

  if (focusDescriptor) {
    focusActionField(focusDescriptor);
  }

  updateActiveActionHighlight();
}

function createGroupHeaderRow(time, count, collapsed) {
  const row = document.createElement("tr");
  row.className = "action-group-header";
  row.dataset.groupTime = time;

  const cell = document.createElement("td");
  cell.colSpan = 5;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "action-group-header__button";
  button.setAttribute("aria-expanded", String(!collapsed));
  button.dataset.groupTime = time;
  button.addEventListener("click", () => toggleGroupCollapsed(time));

  const icon = document.createElement("span");
  icon.className = "action-group-header__icon";
  icon.textContent = collapsed ? "▶" : "▼";
  icon.setAttribute("aria-hidden", "true");

  const label = document.createElement("span");
  label.className = "action-group-header__time";
  label.textContent = time;

  const countEl = document.createElement("span");
  countEl.className = "action-group-header__count";
  countEl.textContent = `(${count})`;

  button.append(icon, label, countEl);
  cell.append(button);
  row.append(cell);

  return row;
}

function createActionRow(action, index, groupTime) {
  const actionId = getActionLocalId(action);
  const row = rowTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.actionIndex = String(index);
  row.dataset.actionId = actionId;
  if (groupTime) {
    row.dataset.groupTime = groupTime;
    row.classList.add("action-group-item");
  }

  const timeInput = createInput({
    type: "text",
    value: action.time,
    placeholder: "00:01:23",
  });
  setActionFieldMetadata(timeInput, actionId, "time");
  timeInput.addEventListener("change", (event) => handleTimeChange(event, index));
  timeInput.addEventListener("focus", () => seekToIndex(index));
  appendToColumn(row, "time", timeInput);

  const channelField = createChannelField(action, index, actionId);
  appendToColumn(row, "channel", channelField);

  const valueField = createValueField(action, index, actionId);
  appendToColumn(row, "value", valueField);

  const fadeInput = createInput({
    type: "number",
    value: action.fade,
    min: 0,
    step: 0.1,
  });
  setActionFieldMetadata(fadeInput, actionId, "fade");
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
  if (toolsCell) {
    toolsCell.append(tools);
  }

  return row;
}

function toggleGroupCollapsed(time) {
  if (collapsedTimeGroups.has(time)) {
    collapsedTimeGroups.delete(time);
  } else {
    collapsedTimeGroups.add(time);
  }
  renderActions();
  const focusTarget = Array.from(
    actionsBody.querySelectorAll(".action-group-header__button")
  ).find((button) => button.dataset.groupTime === time);
  if (focusTarget) {
    try {
      focusTarget.focus({ preventScroll: true });
    } catch (error) {
      focusTarget.focus();
    }
  }
}

function updateActiveActionHighlight(secondsOverride) {
  const seconds = resolveTimelineSeconds(secondsOverride);
  lastKnownTimelineSeconds = seconds;
  const index = findLatestActionIndexAtTime(seconds);
  setHighlightedAction(index);
  updateChannelStatusDisplay(seconds);
}

function resolveTimelineSeconds(secondsOverride) {
  if (typeof secondsOverride === "number" && Number.isFinite(secondsOverride)) {
    return Math.max(0, secondsOverride);
  }
  return getVideoCurrentTimeSeconds();
}

function getVideoCurrentTimeSeconds() {
  if (!videoEl) {
    return Math.max(0, lastKnownTimelineSeconds);
  }
  const current = Number.parseFloat(videoEl.currentTime);
  if (Number.isFinite(current)) {
    return Math.max(0, current);
  }
  return Math.max(0, lastKnownTimelineSeconds);
}

function findLatestActionIndexAtTime(targetSeconds) {
  const epsilon = 0.001;
  let bestIndex = null;
  let bestTime = -Infinity;
  actions.forEach((action, index) => {
    const actionSeconds = parseTimeString(action.time);
    if (actionSeconds === null) return;
    if (actionSeconds - targetSeconds > epsilon) return;
    if (actionSeconds > bestTime || (actionSeconds === bestTime && (bestIndex === null || index > bestIndex))) {
      bestTime = actionSeconds;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function setHighlightedAction(index) {
  const normalizedIndex = Number.isInteger(index) && index >= 0 ? index : null;
  groupHeaderRows.forEach((row) => {
    row.classList.remove("is-active");
  });
  renderedRows.forEach((row) => {
    if (row) {
      row.classList.remove("is-active");
    }
  });

  if (normalizedIndex === null) {
    return;
  }

  const row = renderedRows[normalizedIndex];
  if (row) {
    row.classList.add("is-active");
    return;
  }

  const groupTime = actionGroupTimes[normalizedIndex];
  if (!groupTime) {
    return;
  }
  const headerRow = groupHeaderRows.get(groupTime);
  if (headerRow) {
    headerRow.classList.add("is-active");
  }
}

function updateChannelStatusDisplay(seconds) {
  if (!channelStatusListEl) return;
  channelStatusListEl.innerHTML = "";
  const activeChannels = computeChannelStatesAtTime(seconds);
  if (!activeChannels.length) {
    const empty = document.createElement("p");
    empty.className = "channel-status__empty";
    empty.textContent = "All channels at blackout.";
    channelStatusListEl.append(empty);
    return;
  }

  const list = document.createElement("ul");
  list.className = "channel-status__list";

  activeChannels.forEach((state) => {
    const item = document.createElement("li");
    item.className = "channel-status__item";

    const channelPreset = findChannelPresetForState(state);
    const valuePreset = findValuePresetForState(state, channelPreset);

    const label = document.createElement("span");
    label.className = "channel-status__item-label";
    label.textContent = formatChannelStatusChannelLabel(state, channelPreset);

    const valueEl = document.createElement("span");
    valueEl.textContent = formatChannelStatusValueLabel(state, valuePreset);

    item.title = formatChannelStatusTooltip(state, channelPreset, valuePreset);

    item.append(label, valueEl);
    list.append(item);
  });

  channelStatusListEl.append(list);
}

function computeChannelStatesAtTime(targetSeconds) {
  if (!actions.length) return [];
  const epsilon = 0.001;
  const timeline = actions
    .map((action, index) => ({
      action,
      index,
      seconds: parseTimeString(action.time),
    }))
    .filter((item) => item.seconds !== null && item.seconds - targetSeconds <= epsilon)
    .sort((a, b) => {
      if (a.seconds === b.seconds) {
        return a.index - b.index;
      }
      return a.seconds - b.seconds;
    });

  const states = new Map();
  timeline.forEach(({ action }) => {
    const channel = Number.parseInt(action.channel, 10);
    const value = Number.parseInt(action.value, 10);
    if (!Number.isFinite(channel) || channel < 1 || channel > 512) return;
    if (!Number.isFinite(value)) return;

    const normalizedValue = clamp(value, 0, 255);
    const channelPresetId =
      typeof action.channelPresetId === "string" && action.channelPresetId
        ? action.channelPresetId
        : null;
    const valuePresetId =
      typeof action.valuePresetId === "string" && action.valuePresetId
        ? action.valuePresetId
        : null;

    states.set(channel, {
      channel,
      value: normalizedValue,
      channelPresetId,
      valuePresetId,
    });
  });

  return Array.from(states.values())
    .filter((state) => state.value > 0)
    .sort((a, b) => a.channel - b.channel);
}

function findChannelPresetForState(state) {
  if (!state) return null;
  if (state.channelPresetId) {
    const preset = getChannelPreset(state.channelPresetId);
    if (preset) {
      return preset;
    }
  }
  const channelNumber = Number.parseInt(state.channel, 10);
  if (!Number.isFinite(channelNumber)) {
    return null;
  }
  return (
    channelPresets.find((preset) => Number.isFinite(preset.channel) && preset.channel === channelNumber) ||
    null
  );
}

function findValuePresetForState(state, channelPreset) {
  if (!state || !channelPreset) return null;
  if (state.valuePresetId) {
    const preset = channelPreset.values?.find((value) => value.id === state.valuePresetId);
    if (preset) {
      return preset;
    }
  }
  const numericValue = Number.parseInt(state.value, 10);
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  if (!Array.isArray(channelPreset.values)) {
    return null;
  }
  return channelPreset.values.find((value) => Number.isFinite(value.value) && value.value === numericValue) || null;
}

function formatChannelStatusChannelLabel(state, channelPreset) {
  if (channelPreset) {
    if (channelPreset.name) {
      return channelPreset.name;
    }
    if (Number.isFinite(channelPreset.channel)) {
      return `Channel ${channelPreset.channel}`;
    }
  }
  return `Channel ${state.channel}`;
}

function formatChannelStatusValueLabel(state, valuePreset) {
  if (valuePreset) {
    if (valuePreset.name) {
      return valuePreset.name;
    }
    if (Number.isFinite(valuePreset.value)) {
      return String(valuePreset.value);
    }
  }
  if (Number.isFinite(state.value)) {
    return String(state.value);
  }
  return `${state.value ?? "0"}`;
}

function formatChannelStatusTooltip(state, channelPreset, valuePreset) {
  const channelNumber = Number.isFinite(state.channel) ? state.channel : Number.parseInt(state.channel, 10);
  const valueNumber = Number.isFinite(state.value) ? state.value : Number.parseInt(state.value, 10);
  const baseChannel = Number.isFinite(channelNumber) ? `Channel ${channelNumber}` : "Channel";
  const baseValue = Number.isFinite(valueNumber) ? `Value ${valueNumber}` : "Value";
  const channelLabel = channelPreset?.name ? `${channelPreset.name} (${baseChannel})` : baseChannel;
  const valueLabel = valuePreset?.name ? `${valuePreset.name} (${baseValue})` : baseValue;
  return `${channelLabel} — ${valueLabel}`;
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

function createChannelField(action, index, actionId) {
  const wrapper = document.createElement("div");
  wrapper.className = "preset-select";

  const select = document.createElement("select");
  setActionFieldMetadata(select, actionId, "channelPreset");
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
  setActionFieldMetadata(input, actionId, "channel");
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

function createValueField(action, index, actionId) {
  const wrapper = document.createElement("div");
  wrapper.className = "preset-select";

  const select = document.createElement("select");
  setActionFieldMetadata(select, actionId, "valuePreset");
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
  setActionFieldMetadata(input, actionId, "value");
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
  const action = actions[index];
  if (!action) {
    queuePreviewSync();
    return;
  }
  const actionId = getActionLocalId(action);
  action.time = formatted;
  const focusDescriptor = {
    actionId,
    field: "time",
    selectionStart: event.target.selectionStart,
    selectionEnd: event.target.selectionEnd,
  };
  renderActions({ preserveFocus: focusDescriptor });
  const newIndex = actions.findIndex((item) => getActionLocalId(item) === actionId);
  if (newIndex !== -1) {
    seekToIndex(newIndex);
  }
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
  updateActiveActionHighlight(lastKnownTimelineSeconds);
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
  updateActiveActionHighlight(seconds);
  if (!videoEl || !videoEl.src) return;
  videoEl.currentTime = seconds;
  if (previewMode) {
    playVideoSilently();
    queuePreviewSync();
  } else {
    videoEl.pause();
  }
}

function addAction(action) {
  const newAction = { ...DEFAULT_ACTION, ...action };
  const actionId = getActionLocalId(newAction);
  actions.push(newAction);
  renderActions({ preserveFocus: { actionId, field: "time" } });
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
  if (!videoEl) return;
  videoEl.removeAttribute("src");
  videoEl.load();
  lastKnownTimelineSeconds = 0;
  updateActiveActionHighlight(0);
}

function setVideoSource(url) {
  if (!url) {
    resetVideoPreview();
    return;
  }
  const absolute = new URL(url, window.location.href).href;
  if (videoEl && videoEl.src !== absolute) {
    videoEl.src = url;
    videoEl.load();
    lastKnownTimelineSeconds = 0;
    updateActiveActionHighlight(0);
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
  const hasSelectedSong = Boolean(currentVideo);
  const presetsVisible = !hasSelectedSong && Boolean(showingChannelPresets);

  if (channelPresetsSection) {
    channelPresetsSection.hidden = !presetsVisible;
    channelPresetsSection.setAttribute("aria-hidden", presetsVisible ? "false" : "true");
  }

  if (builderLayout) {
    const builderVisible = hasSelectedSong;
    builderLayout.hidden = !builderVisible;
    builderLayout.setAttribute("aria-hidden", builderVisible ? "false" : "true");
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
