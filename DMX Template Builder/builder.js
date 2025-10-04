const videoSelect = document.getElementById("video-select");
const addStepButton = document.getElementById("add-step");
const saveButton = document.getElementById("save-template");
const exportButton = document.getElementById("export-template");
const statusEl = document.getElementById("status-message");
const actionsBody = document.getElementById("actions-body");
const templateInfoEl = document.getElementById("template-info");
const videoEl = document.getElementById("preview-video");
const rowTemplate = document.getElementById("action-row-template");
const channelPresetsContainer = document.getElementById("channel-presets");
const channelStatusListEl = document.getElementById("channel-status-list");
const addChannelPresetButton = document.getElementById("add-channel-preset");
const channelPresetsSection = document.querySelector(".preset-settings");
const builderLayout = document.querySelector(".builder-layout");
const tabButtons = Array.from(document.querySelectorAll(".builder-tab"));
const tabPanels = Array.from(document.querySelectorAll("[data-tab-panel]"));
const timelinePanel = document.getElementById("timeline-panel");
const presetsPanel = document.getElementById("presets-panel");
const templatesPanel = document.getElementById("templates-panel");
const timelineEmptyState = document.getElementById("timeline-empty-state");
const lightTemplatesContainer = document.getElementById("light-templates");
const addLightTemplateButton = document.getElementById("add-light-template");
const templatePickerEl = document.getElementById("template-picker");
const templatePickerSearch = document.getElementById("template-picker-search");
const templatePickerResults = document.getElementById("template-picker-results");
const templatePickerCloseElements = Array.from(
  document.querySelectorAll("[data-template-picker-close]"),
);
const templateRowTemplate = document.getElementById("template-row-template");

let videos = [];
let currentVideo = null;
let actions = [];
let templatePath = "";
let apiBasePath = null;
let previewMode = false;
let previewSyncHandle = null;
let previewActivationPromise = null;
let suppressPreviewPause = false;
let channelPresets = [];
let activeTab = "timeline";
const collapsedChannelPresetIds = new Set();
const collapsedStepIds = new Set();
let actionGroupIds = [];
let stepInfoById = new Map();
let draggingActionId = null;
let lastKnownTimelineSeconds = 0;
let lightTemplates = [];
let templatePickerStepId = null;
let templateInstanceCounter = 0;

const TEMPLATE_INSTANCE_PROPERTY = "__templateInstanceId";
const TEMPLATE_ROW_PROPERTY = "__templateRowId";

const ACTION_ID_PROPERTY = "__actionLocalId";
let actionIdCounter = 0;
const STEP_ID_PROPERTY = "__stepLocalId";
let stepIdCounter = 0;

const API_BASE_CANDIDATES = [
  "/api",
  "./api",
  "../api",
  "/dmx-template-builder/api",
];

const CHANNEL_PRESET_STORAGE_KEY = "dmxTemplateBuilder.channelPresets";

const LIGHT_TEMPLATE_STORAGE_KEY = "dmxTemplateBuilder.lightTemplates";

const DEFAULT_ACTION = Object.freeze({
  time: "00:00:00",
  channel: 1,
  value: 0,
  fade: 0,
  channelPresetId: null,
  valuePresetId: null,
  templateId: null,
  templateInstanceId: null,
  templateRowId: null,
});

init();

async function init() {
  initTabs();
  try {
    await initChannelPresetsUI();
  } catch (error) {
    console.error("Unable to initialize channel presets", error);
  }
  try {
    await initLightTemplatesUI();
  } catch (error) {
    console.error("Unable to initialize light templates", error);
  }
  loadVideos();
  videoSelect.addEventListener("change", handleVideoSelection);
  if (addStepButton) {
    addStepButton.addEventListener("click", handleAddStep);
  }
  saveButton.addEventListener("click", handleSaveTemplate);
  exportButton.addEventListener("click", () => exportTemplate());
  if (videoEl) {
    videoEl.addEventListener("play", handleVideoPlay);
    videoEl.addEventListener("pause", handleVideoPause);
    videoEl.addEventListener("seeked", handleVideoSeeked);
    videoEl.addEventListener("timeupdate", handleVideoTimeUpdate);
    videoEl.addEventListener("loadedmetadata", handleVideoLoadedMetadata);
  }
  updateWorkspaceVisibility();
}

function initTabs() {
  if (!Array.isArray(tabButtons) || !tabButtons.length) {
    return;
  }
  tabButtons.forEach((button) => {
    if (!(button instanceof HTMLElement)) return;
    button.addEventListener("click", () => {
      const target = button.dataset.tab || "timeline";
      setActiveTab(target);
    });
  });
  updateTabSelection();
}

function updateTabSelection() {
  tabButtons.forEach((button) => {
    if (!(button instanceof HTMLElement)) return;
    const target = button.dataset.tab || "timeline";
    const isActive = target === activeTab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
    button.setAttribute("tabindex", isActive ? "0" : "-1");
  });

  tabPanels.forEach((panel) => {
    if (!(panel instanceof HTMLElement)) return;
    const target = panel.dataset.tabPanel || "timeline";
    const isActive = target === activeTab;
    panel.hidden = !isActive;
    panel.setAttribute("aria-hidden", isActive ? "false" : "true");
  });
}

function setActiveTab(tab) {
  const normalized = tab || "timeline";
  if (normalized === activeTab) {
    return;
  }
  activeTab = normalized;
  updateTabSelection();
  updateWorkspaceVisibility();
}

function resetActionIdCounter() {
  actionIdCounter = 0;
}

function generateActionId() {
  actionIdCounter += 1;
  return `action-${actionIdCounter}`;
}

function resetStepIdCounter() {
  stepIdCounter = 0;
}

function generateStepId() {
  stepIdCounter += 1;
  return `step-${stepIdCounter}`;
}

function resetTemplateInstanceCounter() {
  templateInstanceCounter = 0;
}

function seedTemplateInstanceCounter(list) {
  resetTemplateInstanceCounter();
  if (!Array.isArray(list)) {
    return;
  }
  let maxValue = 0;
  list.forEach((action) => {
    const rawId = action?.templateInstanceId;
    if (typeof rawId !== "string") return;
    const match = rawId.match(/(\d+)$/);
    if (!match) return;
    const numeric = Number.parseInt(match[1], 10);
    if (Number.isFinite(numeric)) {
      maxValue = Math.max(maxValue, numeric);
    }
  });
  if (maxValue > 0) {
    templateInstanceCounter = maxValue;
  }
}

function setActionStepId(action, stepId) {
  if (!action || typeof action !== "object") {
    return null;
  }
  const finalStepId = stepId || generateStepId();
  if (Object.prototype.hasOwnProperty.call(action, STEP_ID_PROPERTY)) {
    action[STEP_ID_PROPERTY] = finalStepId;
  } else {
    Object.defineProperty(action, STEP_ID_PROPERTY, {
      value: finalStepId,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  return finalStepId;
}

function getActionStepId(action) {
  if (!action || typeof action !== "object") {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(action, STEP_ID_PROPERTY)) {
    return action[STEP_ID_PROPERTY];
  }
  return setActionStepId(action);
}

function assignStepIdsForActions(list) {
  resetStepIdCounter();
  const timeToStep = new Map();
  list.forEach((action) => {
    const timeKey = action.time || DEFAULT_ACTION.time;
    let stepId = timeToStep.get(timeKey);
    if (!stepId) {
      stepId = generateStepId();
      timeToStep.set(timeKey, stepId);
    }
    setActionStepId(action, stepId);
  });
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
  const { actionId, groupId, field } = element.dataset;
  if (!field) return null;
  if (groupId) {
    const descriptor = { kind: "group", groupId, field };
    if (typeof element.selectionStart === "number" && typeof element.selectionEnd === "number") {
      descriptor.selectionStart = element.selectionStart;
      descriptor.selectionEnd = element.selectionEnd;
    }
    return descriptor;
  }
  if (!actionId) return null;
  const descriptor = { kind: "action", actionId, field };
  if (typeof element.selectionStart === "number" && typeof element.selectionEnd === "number") {
    descriptor.selectionStart = element.selectionStart;
    descriptor.selectionEnd = element.selectionEnd;
  }
  return descriptor;
}

function focusActionField(descriptor) {
  if (!descriptor) return;
  if (!actionsBody) return;
  if (descriptor.kind === "group") {
    const { groupId, field } = descriptor;
    if (!groupId || !field) return;
    const selector = `[data-group-id="${groupId}"][data-field="${field}"]`;
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
        // Ignore selection errors.
      }
    }
    return;
  }
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

function handleAddStep() {
  const time = getCurrentVideoTimecode();
  const stepId = generateStepId();
  collapsedStepIds.delete(stepId);
  addAction(
    { time },
    {
      stepId,
      focusDescriptor: { kind: "group", groupId: stepId, field: "step-time" },
    },
  );
}

function getCurrentVideoTimecode() {
  if (!videoEl) return DEFAULT_ACTION.time;
  const currentTime = Number.isFinite(videoEl.currentTime)
    ? Math.max(0, videoEl.currentTime)
    : 0;
  return secondsToTimecode(currentTime);
}

async function enablePreviewMode() {
  if (previewMode) {
    return true;
  }
  if (!currentVideo) {
    return false;
  }
  if (previewActivationPromise) {
    await previewActivationPromise;
    if (previewMode || !currentVideo) {
      return Boolean(previewMode);
    }
  }

  const targetVideoId = currentVideo?.id || null;
  previewActivationPromise = (async () => {
    try {
      await syncPreview({ force: true, showError: true });
      if (!currentVideo || currentVideo.id !== targetVideoId) {
        return false;
      }
      previewMode = true;
      playVideoSilently();
      return true;
    } catch (error) {
      console.error(error);
      previewMode = false;
      if (error && error.message) {
        showStatus(error.message, "error");
      } else {
        showStatus("Unable to start live preview.", "error");
      }
      return false;
    } finally {
      previewActivationPromise = null;
    }
  })();

  return previewActivationPromise;
}

async function disablePreviewMode(options = {}) {
  cancelPreviewSync();
  const wasActive = previewMode;
  previewMode = false;
  try {
    await stopPreviewLights({ silent: options.silent });
  } catch (error) {
    console.error(error);
    if (!options.silent) {
      showStatus(error.message || "Unable to stop live preview.", "error");
    }
  }
  pauseVideoSilently();
  if (wasActive && !options.silent) {
    showStatus("Live preview disabled.", "info");
  }
}

function queuePreviewSync() {
  if (!currentVideo) return;
  if (!previewMode) {
    enablePreviewMode();
    return;
  }
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
    throw new Error("Select a song before using live preview.");
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
    throw new Error("Select a song before using live preview.");
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
      throw new Error(payload.error || `Unable to stop live preview (${response.status})`);
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
  if (currentVideo || previewMode || previewActivationPromise) {
    disablePreviewMode({ silent: true }).catch((error) => {
      console.error(error);
    });
  }
  const videoId = videoSelect.value;
  if (!videoId) {
    currentVideo = null;
    actions = [];
    resetActionIdCounter();
    resetStepIdCounter();
    collapsedStepIds.clear();
    stepInfoById.clear();
    draggingActionId = null;
    templatePath = "";
    setControlsEnabled(false);
    renderActions();
    resetVideoPreview();
    templateInfoEl.hidden = true;
    updateWorkspaceVisibility();
    return;
  }

  currentVideo = videos.find((video) => video.id === videoId) || null;
  if (!currentVideo) {
    showStatus("Selected song could not be found.", "error");
    videoSelect.value = "";
    updateWorkspaceVisibility();
    return;
  }

  updateWorkspaceVisibility();
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
    resetStepIdCounter();
    collapsedStepIds.clear();
    stepInfoById.clear();
    draggingActionId = null;
    actions = (data.actions || []).map((action) => ({ ...DEFAULT_ACTION, ...action }));
    actions.forEach(ensureActionLocalId);
    seedTemplateInstanceCounter(actions);
    assignStepIdsForActions(actions);
    autoAssignPresetsToActions(actions);
    const templateIds = new Set(
      actions
        .map((action) => action.templateId)
        .filter((templateId) => typeof templateId === "string" && templateId),
    );
    templateIds.forEach((templateId) => {
      syncTemplateInstances(templateId, { render: false });
    });
    templatePath = data.video?.dmx_template || "";
    const videoUrl = data.video?.video_url || currentVideo?.video_url || "";

    updateTemplateInfo(templatePath, data.template_exists);
    setVideoSource(videoUrl);
    setControlsEnabled(true);
    renderActions();
    enablePreviewMode();

    if (!actions.length) {
      showStatus(
        "Template loaded. Live preview is active. Add your first cue to get started.",
        "info",
      );
    } else {
      showStatus(
        `Loaded ${actions.length} cue${actions.length === 1 ? "" : "s"}. Live preview is active.`,
        "success",
      );
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
  if (!actionsBody) return;
  actionsBody.innerHTML = "";
  actionGroupIds = new Array(actions.length).fill(null);
  stepInfoById = new Map();

  if (!actions.length) {
    const emptyRow = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.innerHTML = '<div class="empty-state">No steps yet. Use “Add Step” to begin.</div>';
    emptyRow.append(cell);
    actionsBody.append(emptyRow);
    collapsedStepIds.clear();
    updateActiveActionHighlight(lastKnownTimelineSeconds);
    return;
  }

  const groupsInOrder = [];
  const groupLookup = new Map();

  actions.forEach((action, index) => {
    const stepId = getActionStepId(action);
    const timeValue = action.time || DEFAULT_ACTION.time;
    actionGroupIds[index] = stepId;
    let group = groupLookup.get(stepId);
    if (!group) {
      group = { id: stepId, time: timeValue, items: [] };
      groupLookup.set(stepId, group);
      groupsInOrder.push(group);
    }
    if (!group.items.length) {
      group.time = timeValue;
    }
    group.items.push({ action, index });
  });

  groupsInOrder.forEach((group) => {
    const indices = group.items.map((item) => item.index);
    stepInfoById.set(group.id, {
      id: group.id,
      time: group.time,
      indices,
    });
  });

  const activeGroups = new Set();

  groupsInOrder.forEach((group) => {
    activeGroups.add(group.id);
    const collapsed = collapsedStepIds.has(group.id);
    const headerRow = createGroupHeaderRow(group, collapsed);
    actionsBody.append(headerRow);

    if (!collapsed) {
      const templateCounts = new Map();
      group.items.forEach(({ action }) => {
        if (action.templateInstanceId) {
          const key = action.templateInstanceId;
          templateCounts.set(key, (templateCounts.get(key) || 0) + 1);
        }
      });

      let lastTemplateInstanceId = null;
      group.items.forEach(({ action, index }) => {
        if (action.templateId && action.templateInstanceId) {
          if (action.templateInstanceId !== lastTemplateInstanceId) {
            const bannerRow = createTemplateBannerRow(
              group,
              action,
              templateCounts.get(action.templateInstanceId) || 0,
            );
            actionsBody.append(bannerRow);
          }
          lastTemplateInstanceId = action.templateInstanceId;
        } else {
          lastTemplateInstanceId = null;
        }
        const row = createActionRow(action, index, group);
        actionsBody.append(row);
      });
    }
  });

  for (const stepId of [...collapsedStepIds]) {
    if (!activeGroups.has(stepId)) {
      collapsedStepIds.delete(stepId);
    }
  }

  if (focusDescriptor) {
    focusActionField(focusDescriptor);
  }

  updateActiveActionHighlight();
}

function createGroupHeaderRow(group, collapsed) {
  const row = document.createElement("tr");
  row.className = "action-group-header";
  row.dataset.groupId = group.id;
  row.dataset.groupTime = group.time;

  const cell = document.createElement("td");
  cell.colSpan = 5;

  const content = document.createElement("div");
  content.className = "action-group-header__content";

  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "action-group-header__toggle";
  toggleButton.setAttribute("aria-expanded", String(!collapsed));
  toggleButton.dataset.groupId = group.id;
  toggleButton.addEventListener("click", () => toggleGroupCollapsed(group.id));
  toggleButton.addEventListener("focus", () => {
    const firstIndex = group.items[0]?.index;
    if (Number.isInteger(firstIndex)) {
      setHighlightedAction(firstIndex);
    } else {
      setHighlightedStep(group.id);
    }
  });

  const icon = document.createElement("span");
  icon.className = "action-group-header__icon";
  icon.textContent = collapsed ? "▶" : "▼";
  icon.setAttribute("aria-hidden", "true");

  const label = document.createElement("span");
  label.className = "action-group-header__label";
  label.textContent = "Step";

  toggleButton.append(icon, label);

  const timeInput = createInput({
    type: "text",
    value: group.time,
    placeholder: "00:01:23",
  });
  timeInput.classList.add("action-group-header__time-input");
  timeInput.dataset.groupId = group.id;
  timeInput.dataset.field = "step-time";
  timeInput.addEventListener("change", (event) => handleStepTimeChange(event, group.id));
  timeInput.addEventListener("focus", () => {
    const firstIndex = group.items[0]?.index;
    if (Number.isInteger(firstIndex)) {
      setHighlightedAction(firstIndex);
    } else {
      setHighlightedStep(group.id);
    }
  });

  const actionsContainer = document.createElement("div");
  actionsContainer.className = "action-group-header__actions";

  const countEl = document.createElement("span");
  countEl.className = "action-group-header__count";
  const count = group.items.length;
  countEl.textContent = `${count} row${count === 1 ? "" : "s"}`;

  const addRowButton = document.createElement("button");
  addRowButton.type = "button";
  addRowButton.className = "action-group-header__add-row";
  addRowButton.dataset.groupId = group.id;
  addRowButton.textContent = "Add Row";
  addRowButton.addEventListener("click", () => handleAddRowToGroup(group.id));
  addRowButton.addEventListener("focus", () => setHighlightedStep(group.id));

  const addTemplateButton = document.createElement("button");
  addTemplateButton.type = "button";
  addTemplateButton.className = "action-group-header__add-template";
  addTemplateButton.dataset.groupId = group.id;
  addTemplateButton.textContent = "Add Template";
  addTemplateButton.addEventListener("click", () => handleAddTemplateToGroup(group.id));
  addTemplateButton.addEventListener("focus", () => setHighlightedStep(group.id));

  actionsContainer.append(countEl, addRowButton, addTemplateButton);

  content.append(toggleButton, timeInput, actionsContainer);
  cell.append(content);
  row.append(cell);

  row.addEventListener("dragover", (event) => handleGroupHeaderDragOver(event, group.id));
  row.addEventListener("dragleave", handleGroupHeaderDragLeave);
  row.addEventListener("drop", (event) => handleGroupHeaderDrop(event, group.id));

  return row;
}

function createTemplateBannerRow(group, action, count) {
  const row = document.createElement("tr");
  row.className = "action-group-template";
  row.dataset.groupId = group.id;
  if (action.templateInstanceId) {
    row.dataset.templateInstanceId = action.templateInstanceId;
  }

  const cell = document.createElement("td");
  cell.colSpan = 5;

  const content = document.createElement("div");
  content.className = "action-group-template__content";

  const title = document.createElement("span");
  title.className = "action-group-template__title";
  const template = getLightTemplate(action.templateId);
  title.textContent = template ? formatLightTemplateTitle(template) : "Template";

  const countEl = document.createElement("span");
  countEl.className = "action-group-template__count";
  const total = Number.isFinite(count) ? count : group.items.length;
  countEl.textContent = `${total} row${total === 1 ? "" : "s"}`;

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "action-group-template__edit";
  editButton.textContent = "Edit Template";
  editButton.addEventListener("click", () => handleEditTemplateFromTimeline(action.templateId));

  content.append(title, countEl, editButton);
  cell.append(content);
  row.append(cell);
  return row;
}

function createActionRow(action, index, group) {
  const actionId = getActionLocalId(action);
  const row = rowTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.actionIndex = String(index);
  row.dataset.actionId = actionId;
  row.dataset.groupId = group.id;
  row.dataset.groupTime = group.time;
  row.classList.add("action-group-item");
  if (action.templateInstanceId) {
    row.dataset.templateInstanceId = action.templateInstanceId;
    row.dataset.templateId = action.templateId || "";
    row.dataset.templateRowId = action.templateRowId || "";
    row.classList.add("action-group-item--template");
  }
  row.draggable = true;

  row.addEventListener("focusin", () => {
    setHighlightedAction(index);
    seekToIndex(index);
  });
  row.addEventListener("dragstart", handleRowDragStart);
  row.addEventListener("dragend", handleRowDragEnd);
  row.addEventListener("dragover", handleRowDragOver);
  row.addEventListener("dragleave", handleRowDragLeave);
  row.addEventListener("drop", handleRowDrop);

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

  const duplicateButton = document.createElement("button");
  duplicateButton.type = "button";
  duplicateButton.className = "secondary";
  duplicateButton.textContent = "Duplicate";
  duplicateButton.addEventListener("click", () => duplicateAction(index));

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "Delete";
  removeButton.addEventListener("click", () => removeAction(index));

  tools.append(jumpButton, duplicateButton, removeButton);
  if (toolsCell) {
    toolsCell.append(tools);
  }

  return row;
}

function toggleGroupCollapsed(stepId) {
  if (collapsedStepIds.has(stepId)) {
    collapsedStepIds.delete(stepId);
  } else {
    collapsedStepIds.add(stepId);
  }
  renderActions();
  const focusTarget = actionsBody.querySelector(
    `.action-group-header__toggle[data-group-id="${stepId}"]`
  );
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

function handleGroupHeaderDragOver(event, stepId) {
  if (!draggingActionId) return;
  event.preventDefault();
  const row = event.currentTarget;
  row.classList.add("is-drop-target");
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
}

function handleGroupHeaderDragLeave(event) {
  const row = event.currentTarget;
  row.classList.remove("is-drop-target");
}

function handleGroupHeaderDrop(event, stepId) {
  if (!draggingActionId) return;
  event.preventDefault();
  const row = event.currentTarget;
  row.classList.remove("is-drop-target");
  const groupInfo = stepInfoById.get(stepId);
  const indices = groupInfo?.indices || [];
  const insertionIndex = indices.length ? indices[indices.length - 1] + 1 : actions.length;
  const targetTime = groupInfo?.time || DEFAULT_ACTION.time;
  collapsedStepIds.delete(stepId);
  clearAllDropIndicators();
  placeActionAt(draggingActionId, insertionIndex, {
    targetGroupId: stepId,
    targetTime,
  });
  draggingActionId = null;
}

function handleRowDragStart(event) {
  const row = event.currentTarget;
  if (!(row instanceof HTMLElement)) return;
  const actionId = row.dataset.actionId;
  if (!actionId) return;
  draggingActionId = actionId;
  row.classList.add("is-dragging");
  if (row.dataset.groupId) {
    setHighlightedStep(row.dataset.groupId);
  }
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    try {
      event.dataTransfer.setData("text/plain", actionId);
    } catch (error) {
      // Ignore data transfer errors from unsupported browsers.
    }
  }
}

function handleRowDragEnd(event) {
  const row = event.currentTarget;
  if (row instanceof HTMLElement) {
    row.classList.remove("is-dragging");
  }
  draggingActionId = null;
  clearAllDropIndicators();
}

function handleRowDragOver(event) {
  if (!draggingActionId) return;
  event.preventDefault();
  const row = event.currentTarget;
  if (!(row instanceof HTMLElement)) return;
  const rect = row.getBoundingClientRect();
  const offset = event.clientY - rect.top;
  const before = offset < rect.height / 2;
  row.classList.toggle("drop-before", before);
  row.classList.toggle("drop-after", !before);
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
}

function handleRowDragLeave(event) {
  const row = event.currentTarget;
  if (!(row instanceof HTMLElement)) return;
  row.classList.remove("drop-before", "drop-after");
}

function handleRowDrop(event) {
  if (!draggingActionId) return;
  event.preventDefault();
  const row = event.currentTarget;
  if (!(row instanceof HTMLElement)) return;
  const rect = row.getBoundingClientRect();
  const before = event.clientY - rect.top < rect.height / 2;
  const indexValue = Number.parseInt(row.dataset.actionIndex || "-1", 10);
  if (!Number.isInteger(indexValue) || indexValue < 0) {
    return;
  }
  row.classList.remove("drop-before", "drop-after");
  clearAllDropIndicators();
  const groupId = row.dataset.groupId || null;
  const groupInfo = groupId ? stepInfoById.get(groupId) : null;
  const insertionIndex = before ? indexValue : indexValue + 1;
  const targetTime = groupInfo?.time || row.dataset.groupTime || DEFAULT_ACTION.time;
  placeActionAt(draggingActionId, insertionIndex, {
    targetGroupId: groupId,
    targetTime,
  });
  draggingActionId = null;
}

function clearAllDropIndicators() {
  if (!actionsBody) return;
  actionsBody.querySelectorAll(".action-group-item").forEach((element) => {
    element.classList.remove("drop-before", "drop-after", "is-dragging");
  });
  actionsBody.querySelectorAll(".action-group-header.is-drop-target").forEach((element) => {
    element.classList.remove("is-drop-target");
  });
}

function placeActionAt(actionId, insertionIndex, options = {}) {
  const sourceIndex = actions.findIndex((item) => getActionLocalId(item) === actionId);
  if (sourceIndex === -1) {
    return;
  }
  const action = actions[sourceIndex];
  const currentGroupId = getActionStepId(action);
  actions.splice(sourceIndex, 1);

  let targetIndex = Number.isInteger(insertionIndex) ? insertionIndex : actions.length;
  if (sourceIndex < targetIndex) {
    targetIndex -= 1;
  }
  if (targetIndex < 0) {
    targetIndex = 0;
  }
  if (targetIndex > actions.length) {
    targetIndex = actions.length;
  }

  const targetGroupId = options.targetGroupId || currentGroupId;
  const finalGroupId = targetGroupId ? setActionStepId(action, targetGroupId) : getActionStepId(action);
  const targetTime = options.targetTime || action.time || DEFAULT_ACTION.time;
  action.time = secondsToTimecode(parseTimeString(targetTime) ?? parseTimeString(action.time) ?? 0);

  actions.splice(targetIndex, 0, action);
  renderActions();
  const newIndex = actions.findIndex((item) => getActionLocalId(item) === actionId);
  if (newIndex !== -1) {
    setHighlightedAction(newIndex);
  } else if (finalGroupId) {
    setHighlightedStep(finalGroupId);
  }
  queuePreviewSync();
}

function setHighlightedStep(stepId) {
  clearGroupHighlights();
  if (!stepId) return;
  highlightGroupById(stepId);
}

function clearGroupHighlights() {
  if (!actionsBody) return;
  actionsBody
    .querySelectorAll(".action-group-header.is-active, .action-group-item.is-active")
    .forEach((element) => {
      element.classList.remove("is-active");
    });
}

function highlightGroupById(stepId) {
  if (!actionsBody) return;
  actionsBody
    .querySelectorAll(`[data-group-id="${stepId}"]`)
    .forEach((element) => {
      element.classList.add("is-active");
    });
}

function setHighlightedAction(index) {
  const normalizedIndex = Number.isInteger(index) && index >= 0 ? index : null;
  if (normalizedIndex === null) {
    clearGroupHighlights();
    return;
  }
  const stepId = actionGroupIds[normalizedIndex];
  if (!stepId) {
    clearGroupHighlights();
    return;
  }
  setHighlightedStep(stepId);
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

  const slider = createInput({
    type: "range",
    value: action.value,
    min: 0,
    max: 255,
    step: 1,
  });
  slider.classList.add("value-slider");

  const input = createInput({
    type: "number",
    value: action.value,
    min: 0,
    max: 255,
    step: 1,
  });
  setActionFieldMetadata(input, actionId, "value");
  input.addEventListener("change", (event) => {
    handleValueNumberChange(event, index);
    slider.value = event.target.value;
  });

  slider.addEventListener("input", () => {
    if (input.disabled) {
      slider.value = input.value || "0";
      return;
    }
    input.value = slider.value;
  });

  slider.addEventListener("change", () => {
    if (input.disabled) {
      slider.value = input.value || "0";
      return;
    }
    const syntheticEvent = new Event("change", { bubbles: true });
    input.dispatchEvent(syntheticEvent);
  });
  if (selectedValuePreset) {
    input.value = selectedValuePreset.value;
    slider.value = selectedValuePreset.value;
    input.disabled = true;
    slider.disabled = true;
    input.title = "Value is set by preset";
    slider.title = "Value is set by preset";
  } else {
    input.disabled = false;
    slider.disabled = false;
    input.title = "";
    slider.title = "";
  }

  wrapper.append(select, slider, input);
  return wrapper;
}

function appendToColumn(row, column, element) {
  const cell = row.querySelector(`[data-column="${column}"]`);
  if (cell) {
    cell.append(element);
  }
}

function handleStepTimeChange(event, stepId) {
  const input = event.target;
  const value = input.value.trim();
  const seconds = parseTimeString(value);
  if (seconds === null) {
    input.classList.add("invalid");
    input.setCustomValidity("Use HH:MM:SS format (seconds may include decimals).");
    input.reportValidity();
    return;
  }
  input.classList.remove("invalid");
  input.setCustomValidity("");
  const formatted = secondsToTimecode(seconds);
  input.value = formatted;

  let updated = false;
  actions.forEach((action) => {
    if (getActionStepId(action) === stepId) {
      action.time = formatted;
      updated = true;
    }
  });

  const focusDescriptor = {
    kind: "group",
    groupId: stepId,
    field: "step-time",
    selectionStart: input.selectionStart,
    selectionEnd: input.selectionEnd,
  };

  renderActions({ preserveFocus: focusDescriptor });

  if (updated) {
    const newIndex = actions.findIndex((item) => getActionStepId(item) === stepId);
    if (newIndex !== -1) {
      seekToIndex(newIndex);
      return;
    }
  }
  setHighlightedStep(stepId);
  queuePreviewSync();
}

function handleAddRowToGroup(stepId) {
  const groupInfo = stepInfoById.get(stepId);
  const time = groupInfo?.time || DEFAULT_ACTION.time;
  const insertIndex =
    groupInfo && Array.isArray(groupInfo.indices) && groupInfo.indices.length
      ? groupInfo.indices[groupInfo.indices.length - 1] + 1
      : actions.length;
  collapsedStepIds.delete(stepId);
  addAction(
    { time },
    {
      stepId,
      insertIndex,
      focusField: "channel",
    },
  );
}

function handleAddTemplateToGroup(stepId) {
  collapsedStepIds.delete(stepId);
  openTemplatePicker(stepId);
}

function handleEditTemplateFromTimeline(templateId) {
  if (!templateId) return;
  setActiveTab("templates");
  renderLightTemplates({ focusTemplateId: templateId });
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
  setHighlightedAction(index);
  const seconds = parseTimeString(action.time);
  if (seconds === null) return;
  updateActiveActionHighlight(seconds);
  if (!videoEl || !videoEl.src) return;
  const wasPaused = videoEl.paused;
  videoEl.currentTime = seconds;
  if (!wasPaused) {
    playVideoSilently();
  }
  queuePreviewSync();
}

function addAction(action, options = {}) {
  const newAction = { ...DEFAULT_ACTION, ...action };
  const actionId = getActionLocalId(newAction);
  const stepId = setActionStepId(newAction, options.stepId);
  const insertIndex =
    Number.isInteger(options.insertIndex) && options.insertIndex >= 0
      ? Math.min(options.insertIndex, actions.length)
      : actions.length;
  actions.splice(insertIndex, 0, newAction);

  const focusDescriptor =
    options.focusDescriptor ||
    (options.focusField
      ? { kind: "action", actionId, field: options.focusField }
      : { kind: "action", actionId, field: "channel" });

  renderActions({ preserveFocus: focusDescriptor });
  setHighlightedStep(stepId);
  queuePreviewSync();
  return { action: newAction, actionId, stepId };
}

function removeAction(index) {
  actions.splice(index, 1);
  renderActions();
  showStatus("Removed cue.", "info");
  queuePreviewSync();
}

function duplicateAction(index) {
  const original = actions[index];
  if (!original) return;
  const stepId = getActionStepId(original);
  const copy = {
    time: original.time,
    channel: original.channel,
    value: original.value,
    fade: original.fade,
    channelPresetId: original.channelPresetId,
    valuePresetId: original.valuePresetId,
  };
  addAction(copy, { stepId, insertIndex: index + 1, focusField: "channel" });
}

function sortActions(list) {
  return [...list].sort((a, b) => {
    const aTime = parseTimeString(a.time) ?? 0;
    const bTime = parseTimeString(b.time) ?? 0;
    return aTime - bTime;
  });
}

function setControlsEnabled(enabled) {
  if (addStepButton) {
    addStepButton.disabled = !enabled;
  }
  saveButton.disabled = !enabled;
  exportButton.disabled = !enabled;
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

async function initChannelPresetsUI() {
  if (!channelPresetsContainer) return;
  channelPresets = await loadChannelPresets();
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
  const timelineActive = activeTab === "timeline";
  const presetsActive = activeTab === "presets";
  const templatesActive = activeTab === "templates";

  if (channelPresetsSection) {
    const visible = presetsActive;
    channelPresetsSection.hidden = !visible;
    channelPresetsSection.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  if (templatesPanel) {
    const visible = templatesActive;
    templatesPanel.hidden = !visible;
    templatesPanel.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  if (builderLayout) {
    const visible = timelineActive && hasSelectedSong;
    builderLayout.hidden = !visible;
    builderLayout.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  if (templateInfoEl) {
    if (!timelineActive) {
      templateInfoEl.hidden = true;
    }
  }

  if (timelinePanel) {
    timelinePanel.setAttribute("aria-hidden", timelineActive ? "false" : "true");
  }

  if (timelineEmptyState) {
    const showEmpty = timelineActive && !hasSelectedSong;
    timelineEmptyState.hidden = !showEmpty;
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

async function loadChannelPresets() {
  const fallback = loadChannelPresetsFromLocalStorage();
  try {
    const { payload } = await fetchFromApiCandidates("/channel-presets");
    const presets = Array.isArray(payload?.presets) ? payload.presets : [];
    const sanitized = presets.map((item) => sanitizeChannelPreset(item)).filter(Boolean);
    saveChannelPresetsToLocalStorage(sanitized);
    return sanitized;
  } catch (error) {
    console.error("Unable to load channel presets from server", error);
    return fallback;
  }
}

function saveChannelPresets() {
  const payload = buildChannelPresetPayload();
  saveChannelPresetsToLocalStorage(payload);
  persistChannelPresets(payload).catch((error) => {
    console.error("Unable to save channel presets", error);
  });
}

function buildChannelPresetPayload() {
  return channelPresets.map((preset) => ({
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
}

function loadChannelPresetsFromLocalStorage() {
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
    console.error("Unable to load channel presets from local storage", error);
    return [];
  }
}

function saveChannelPresetsToLocalStorage(presets) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(CHANNEL_PRESET_STORAGE_KEY, JSON.stringify(presets));
  } catch (error) {
    console.error("Unable to cache channel presets locally", error);
  }
}

async function persistChannelPresets(presets) {
  const response = await fetchApi("/channel-presets", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ presets }),
  });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  try {
    const payload = await response.json();
    if (payload && Array.isArray(payload.presets)) {
      const sanitized = payload.presets.map((item) => sanitizeChannelPreset(item)).filter(Boolean);
      saveChannelPresetsToLocalStorage(sanitized);
    }
  } catch (error) {
    console.error("Unable to parse channel preset save response", error);
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

function sanitizeLightTemplateRow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" && raw.id ? raw.id : generateId("templateRow");
  const channelNumber = Number.parseInt(raw.channel, 10);
  const channel = Number.isFinite(channelNumber) ? clamp(channelNumber, 1, 512) : 1;
  const valueNumber = Number.parseInt(raw.value, 10);
  const value = Number.isFinite(valueNumber) ? clamp(valueNumber, 0, 255) : 0;
  const fadeNumber = Number.parseFloat(raw.fade);
  const fade = Number.isFinite(fadeNumber) ? Math.max(0, Number(fadeNumber.toFixed(3))) : 0;
  const channelPresetId =
    typeof raw.channelPresetId === "string" && raw.channelPresetId ? raw.channelPresetId : null;
  const valuePresetId =
    typeof raw.valuePresetId === "string" && raw.valuePresetId ? raw.valuePresetId : null;
  return { id, channel, value, fade, channelPresetId, valuePresetId };
}

function sanitizeLightTemplate(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" && raw.id ? raw.id : generateId("template");
  const name = typeof raw.name === "string" ? raw.name : "";
  const rows = Array.isArray(raw.rows)
    ? raw.rows.map((row) => sanitizeLightTemplateRow(row)).filter(Boolean)
    : [];
  return { id, name, rows };
}

function loadLightTemplatesFromLocalStorage() {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(LIGHT_TEMPLATE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => sanitizeLightTemplate(item)).filter(Boolean);
  } catch (error) {
    console.error("Unable to load light templates from local storage", error);
    return [];
  }
}

function saveLightTemplatesToLocalStorage(templates) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(LIGHT_TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
  } catch (error) {
    console.error("Unable to cache light templates locally", error);
  }
}

async function loadLightTemplates() {
  const fallback = loadLightTemplatesFromLocalStorage();
  try {
    const { payload } = await fetchFromApiCandidates("/light-templates");
    const templates = Array.isArray(payload?.templates) ? payload.templates : [];
    const sanitized = templates.map((item) => sanitizeLightTemplate(item)).filter(Boolean);
    saveLightTemplatesToLocalStorage(sanitized);
    return sanitized;
  } catch (error) {
    console.error("Unable to load light templates from server", error);
    return fallback;
  }
}

function saveLightTemplates() {
  const payload = buildLightTemplatePayload();
  saveLightTemplatesToLocalStorage(payload);
  persistLightTemplates(payload).catch((error) => {
    console.error("Unable to save light templates", error);
  });
}

function buildLightTemplatePayload() {
  return lightTemplates.map((template) => ({
    id: template.id,
    name: template.name || "",
    rows: Array.isArray(template.rows)
      ? template.rows.map((row) => ({
          id: row.id || generateId("templateRow"),
          channel: clamp(Number.parseInt(row.channel, 10) || 1, 1, 512),
          value: clamp(Number.parseInt(row.value, 10) || 0, 0, 255),
          fade: Math.max(0, Number.parseFloat(row.fade) || 0),
          channelPresetId:
            typeof row.channelPresetId === "string" && row.channelPresetId
              ? row.channelPresetId
              : null,
          valuePresetId:
            typeof row.valuePresetId === "string" && row.valuePresetId
              ? row.valuePresetId
              : null,
        }))
      : [],
  }));
}

async function persistLightTemplates(templates) {
  const response = await fetchApi("/light-templates", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templates }),
  });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  try {
    const payload = await response.json();
    if (payload && Array.isArray(payload.templates)) {
      const sanitized = payload.templates
        .map((item) => sanitizeLightTemplate(item))
        .filter(Boolean);
      saveLightTemplatesToLocalStorage(sanitized);
    }
  } catch (error) {
    console.error("Unable to parse light template save response", error);
  }
}

function getLightTemplate(templateId) {
  return lightTemplates.find((template) => template.id === templateId) || null;
}

function getTemplateRow(templateId, rowId) {
  const template = getLightTemplate(templateId);
  if (!template || !Array.isArray(template.rows)) return null;
  return template.rows.find((row) => row.id === rowId) || null;
}

function createTemplateRowDefaults(overrides = {}) {
  return {
    id: overrides.id || generateId("templateRow"),
    channel: clamp(Number.parseInt(overrides.channel, 10) || 1, 1, 512),
    value: clamp(Number.parseInt(overrides.value, 10) || 0, 0, 255),
    fade: Math.max(0, Number.parseFloat(overrides.fade) || 0),
    channelPresetId:
      typeof overrides.channelPresetId === "string" && overrides.channelPresetId
        ? overrides.channelPresetId
        : null,
    valuePresetId:
      typeof overrides.valuePresetId === "string" && overrides.valuePresetId
        ? overrides.valuePresetId
        : null,
  };
}

function createLightTemplateDefaults(overrides = {}) {
  const rows = Array.isArray(overrides.rows) && overrides.rows.length
    ? overrides.rows.map((row) => sanitizeLightTemplateRow(row)).filter(Boolean)
    : [createTemplateRowDefaults()];
  return {
    id: overrides.id || generateId("template"),
    name: typeof overrides.name === "string" ? overrides.name : "",
    rows,
  };
}

async function initLightTemplatesUI() {
  if (addLightTemplateButton) {
    addLightTemplateButton.addEventListener("click", () => {
      addLightTemplate();
    });
  }

  templatePickerCloseElements.forEach((element) => {
    element.addEventListener("click", () => closeTemplatePicker());
  });

  if (templatePickerEl) {
    templatePickerEl.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeTemplatePicker();
      }
    });
  }

  if (templatePickerSearch) {
    templatePickerSearch.addEventListener("input", () => {
      renderTemplatePickerResults(templatePickerSearch.value || "");
    });
  }

  lightTemplates = loadLightTemplatesFromLocalStorage();
  renderLightTemplates();

  lightTemplates = await loadLightTemplates();
  renderLightTemplates();
}

function renderLightTemplates(options = {}) {
  if (!lightTemplatesContainer) return;

  const focusDescriptor =
    options.preserveFocus || describeFocusedTemplateField(document.activeElement);

  lightTemplatesContainer.innerHTML = "";

  if (!lightTemplates.length) {
    const empty = document.createElement("p");
    empty.className = "template-library__empty";
    empty.textContent = "No templates yet. Use “New Template” to create one.";
    lightTemplatesContainer.append(empty);
  } else {
    lightTemplates.forEach((template) => {
      const card = renderLightTemplateCard(template);
      lightTemplatesContainer.append(card);
    });
  }

  const query = templatePickerSearch ? templatePickerSearch.value || "" : "";
  renderTemplatePickerResults(query);

  if (options.focusTemplateId) {
    const card = lightTemplatesContainer.querySelector(
      `.template-card[data-template-id="${options.focusTemplateId}"]`,
    );
    if (card) {
      const input = card.querySelector('[data-field="template-name"]');
      if (input instanceof HTMLElement) {
        try {
          input.focus({ preventScroll: true });
        } catch (error) {
          input.focus();
        }
      }
    }
  } else if (focusDescriptor) {
    focusTemplateField(focusDescriptor);
  }
}

function describeFocusedTemplateField(element) {
  if (!element || !(element instanceof HTMLElement)) return null;
  const { templateId, rowId, field } = element.dataset || {};
  if (!templateId || !field) return null;
  const descriptor = { templateId, field };
  if (rowId) {
    descriptor.rowId = rowId;
  }
  if (
    typeof element.selectionStart === "number" &&
    typeof element.selectionEnd === "number"
  ) {
    descriptor.selectionStart = element.selectionStart;
    descriptor.selectionEnd = element.selectionEnd;
  }
  return descriptor;
}

function focusTemplateField(descriptor) {
  if (!descriptor || !lightTemplatesContainer) return;
  const parts = [
    `.template-card [data-template-id="${descriptor.templateId}"]`,
    `[data-field="${descriptor.field}"]`,
  ];
  if (descriptor.rowId) {
    parts.push(`[data-row-id="${descriptor.rowId}"]`);
  }
  const selector = parts.join("");
  const target = lightTemplatesContainer.querySelector(selector);
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
      // Ignore selection errors for unsupported inputs.
    }
  }
}

function renderLightTemplateCard(template) {
  const card = document.createElement("article");
  card.className = "template-card";
  card.dataset.templateId = template.id;

  const header = document.createElement("header");
  header.className = "template-card__header";

  const titleGroup = document.createElement("div");
  titleGroup.className = "template-card__title-group";

  const title = document.createElement("h3");
  title.className = "template-card__title";
  title.textContent = formatLightTemplateTitle(template);
  titleGroup.append(title);

  const actionsEl = document.createElement("div");
  actionsEl.className = "template-card__actions";

  const duplicateButton = document.createElement("button");
  duplicateButton.type = "button";
  duplicateButton.className = "secondary";
  duplicateButton.textContent = "Duplicate";
  duplicateButton.addEventListener("click", () => duplicateLightTemplate(template.id));

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "secondary";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", () => removeLightTemplate(template.id));

  actionsEl.append(duplicateButton, deleteButton);
  header.append(titleGroup, actionsEl);

  const body = document.createElement("div");
  body.className = "template-card__body";

  const nameField = document.createElement("label");
  nameField.className = "template-field";

  const nameLabel = document.createElement("span");
  nameLabel.textContent = "Name";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = template.name || "";
  nameInput.placeholder = "Front light strobe white";
  nameInput.dataset.templateId = template.id;
  nameInput.dataset.field = "template-name";
  nameInput.addEventListener("input", (event) => handleTemplateNameInput(template.id, event));

  nameField.append(nameLabel, nameInput);
  body.append(nameField);

  const table = createTemplateRowsTable(template);
  body.append(table);

  const footer = document.createElement("div");
  footer.className = "template-card__footer";

  const addRowButton = document.createElement("button");
  addRowButton.type = "button";
  addRowButton.className = "secondary";
  addRowButton.textContent = "Add Row";
  addRowButton.addEventListener("click", () => addRowToLightTemplate(template.id));

  footer.append(addRowButton);
  body.append(footer);

  card.append(header, body);
  return card;
}

function updateLightTemplateCardTitle(card, template) {
  if (!card) return;
  const title = card.querySelector(".template-card__title");
  if (title) {
    title.textContent = formatLightTemplateTitle(template);
  }
}

function formatLightTemplateTitle(template) {
  if (template.name) {
    return template.name;
  }
  return "Untitled Template";
}

function createTemplateRowsTable(template) {
  const table = document.createElement("table");
  table.className = "template-card__table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["Row", "Channel", "Value", "Fade (s)", "Tools"].forEach((label) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = label;
    headRow.append(th);
  });
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  if (!template.rows.length) {
    const emptyRow = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "template-card__empty";
    cell.textContent = "No rows yet. Add channels to this template.";
    emptyRow.append(cell);
    tbody.append(emptyRow);
  } else {
    template.rows.forEach((row, index) => {
      const rowElement = createTemplateRowElement(template, row, index);
      tbody.append(rowElement);
    });
  }

  table.append(tbody);
  return table;
}

function createTemplateRowElement(template, row, index) {
  const baseRow = templateRowTemplate?.content?.firstElementChild
    ? templateRowTemplate.content.firstElementChild.cloneNode(true)
    : document.createElement("tr");

  baseRow.dataset.templateId = template.id;
  baseRow.dataset.rowId = row.id;
  baseRow.classList.add("template-row");

  const nameCell =
    baseRow.querySelector('[data-template-column="name"]') || document.createElement("td");
  nameCell.textContent = formatTemplateRowLabel(template, row, index);
  baseRow.append(nameCell);

  const channelCell =
    baseRow.querySelector('[data-template-column="channel"]') || document.createElement("td");
  channelCell.innerHTML = "";
  const channelField = createTemplateChannelField(template.id, row);
  channelCell.append(channelField);
  baseRow.append(channelCell);

  const valueCell =
    baseRow.querySelector('[data-template-column="value"]') || document.createElement("td");
  valueCell.innerHTML = "";
  valueCell.append(createTemplateValueField(template.id, row));
  baseRow.append(valueCell);

  const fadeCell =
    baseRow.querySelector('[data-template-column="fade"]') || document.createElement("td");
  fadeCell.innerHTML = "";
  const fadeInput = createInput({ type: "number", value: row.fade, min: 0, step: 0.1 });
  fadeInput.dataset.templateId = template.id;
  fadeInput.dataset.rowId = row.id;
  fadeInput.dataset.field = "template-fade";
  fadeInput.addEventListener("change", (event) =>
    handleTemplateRowFadeChange(template.id, row.id, event),
  );
  fadeCell.append(fadeInput);
  baseRow.append(fadeCell);

  const toolsCell =
    baseRow.querySelector('[data-template-column="tools"]') || document.createElement("td");
  toolsCell.innerHTML = "";
  const tools = document.createElement("div");
  tools.className = "template-row__tools";

  const duplicateButton = document.createElement("button");
  duplicateButton.type = "button";
  duplicateButton.className = "secondary";
  duplicateButton.textContent = "Duplicate";
  duplicateButton.addEventListener("click", () => duplicateTemplateRow(template.id, row.id));

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "secondary";
  removeButton.textContent = "Delete";
  removeButton.addEventListener("click", () => removeTemplateRow(template.id, row.id));

  tools.append(duplicateButton, removeButton);
  toolsCell.append(tools);
  baseRow.append(toolsCell);

  return baseRow;
}

function formatTemplateRowLabel(template, row, index) {
  if (row.channelPresetId) {
    const preset = getChannelPreset(row.channelPresetId);
    if (preset) {
      if (preset.name) {
        return preset.name;
      }
      if (Number.isFinite(preset.channel)) {
        return `Channel ${preset.channel}`;
      }
    }
  }
  return `Row ${index + 1}`;
}

function createTemplateChannelField(templateId, row) {
  const wrapper = document.createElement("div");
  wrapper.className = "preset-select";

  const select = document.createElement("select");
  select.dataset.templateId = templateId;
  select.dataset.rowId = row.id;
  select.dataset.field = "template-channel-preset";
  select.addEventListener("change", (event) =>
    handleTemplateRowChannelPresetChange(templateId, row.id, event),
  );

  const customOption = document.createElement("option");
  customOption.value = "";
  customOption.textContent = "Custom…";
  select.append(customOption);

  const presets = getSortedChannelPresets();
  let selectedPreset = null;
  presets.forEach((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.dataset.channelPresetId = preset.id;
    option.textContent = formatChannelPresetLabel(preset);
    select.append(option);
    if (preset.id === row.channelPresetId) {
      selectedPreset = preset;
    }
  });

  if (selectedPreset) {
    select.value = selectedPreset.id;
  } else {
    select.value = "";
  }

  const input = createInput({ type: "number", value: row.channel, min: 1, max: 512, step: 1 });
  input.dataset.templateId = templateId;
  input.dataset.rowId = row.id;
  input.dataset.field = "template-channel";
  input.addEventListener("change", (event) =>
    handleTemplateRowChannelInput(templateId, row.id, event),
  );

  if (selectedPreset && Number.isFinite(selectedPreset.channel)) {
    input.value = clamp(Number.parseInt(selectedPreset.channel, 10) || 1, 1, 512);
    input.disabled = true;
    input.title = "Channel is set by preset";
  } else {
    input.disabled = false;
    input.title = "";
  }

  wrapper.append(select, input);
  return wrapper;
}

function createTemplateValueField(templateId, row) {
  const wrapper = document.createElement("div");
  wrapper.className = "preset-select";

  const select = document.createElement("select");
  select.dataset.templateId = templateId;
  select.dataset.rowId = row.id;
  select.dataset.field = "template-value-preset";
  select.addEventListener("change", (event) =>
    handleTemplateRowValuePresetChange(templateId, row.id, event),
  );

  const customOption = document.createElement("option");
  customOption.value = "custom";
  customOption.textContent = "Custom…";
  select.append(customOption);

  let channelPreset = null;
  if (row.channelPresetId) {
    channelPreset = getChannelPreset(row.channelPresetId);
    if (!channelPreset) {
      row.channelPresetId = null;
      row.valuePresetId = null;
    }
  }

  let selectedValuePreset = null;
  const valuePresets = channelPreset ? channelPreset.values || [] : [];
  valuePresets.forEach((valuePreset) => {
    const option = document.createElement("option");
    option.value = valuePreset.id;
    option.dataset.valuePresetId = valuePreset.id;
    option.textContent = formatValuePresetLabel(valuePreset);
    select.append(option);
    if (valuePreset.id === row.valuePresetId) {
      selectedValuePreset = valuePreset;
    }
  });

  if (selectedValuePreset) {
    select.value = selectedValuePreset.id;
  } else {
    select.value = "custom";
  }

  const slider = createInput({ type: "range", value: row.value, min: 0, max: 255, step: 1 });
  slider.classList.add("value-slider");
  slider.dataset.templateId = templateId;
  slider.dataset.rowId = row.id;
  slider.dataset.field = "template-value-slider";

  const input = createInput({ type: "number", value: row.value, min: 0, max: 255, step: 1 });
  input.dataset.templateId = templateId;
  input.dataset.rowId = row.id;
  input.dataset.field = "template-value";
  input.addEventListener("change", (event) => {
    handleTemplateRowValueChange(templateId, row.id, event);
    slider.value = event.target.value;
  });

  slider.addEventListener("input", () => {
    if (input.disabled) {
      slider.value = input.value || "0";
      return;
    }
    const numericValue = clamp(Number.parseInt(slider.value, 10) || 0, 0, 255);
    row.value = numericValue;
    row.valuePresetId = null;
    input.value = String(numericValue);
    syncTemplateInstances(templateId);
  });

  slider.addEventListener("change", () => {
    saveLightTemplates();
  });

  if (selectedValuePreset) {
    const numericValue = Number.parseInt(selectedValuePreset.value, 10);
    if (Number.isFinite(numericValue)) {
      const clamped = clamp(numericValue, 0, 255);
      input.value = clamped;
      slider.value = clamped;
      input.disabled = true;
      slider.disabled = true;
    }
  } else {
    input.disabled = false;
    slider.disabled = false;
  }

  wrapper.append(select, slider, input);
  return wrapper;
}

function handleTemplateNameInput(templateId, event) {
  const template = getLightTemplate(templateId);
  if (!template) return;
  template.name = event.target.value;
  saveLightTemplates();
  updateLightTemplateCardTitle(event.target.closest(".template-card"), template);
  const query = templatePickerSearch ? templatePickerSearch.value || "" : "";
  renderTemplatePickerResults(query);
}

function addLightTemplate() {
  const template = createLightTemplateDefaults();
  lightTemplates.push(template);
  saveLightTemplates();
  renderLightTemplates({ focusTemplateId: template.id });
  setActiveTab("templates");
}

function duplicateLightTemplate(templateId) {
  const template = getLightTemplate(templateId);
  if (!template) return;
  const clonedRows = (template.rows || []).map((row) =>
    createTemplateRowDefaults({
      channel: row.channel,
      value: row.value,
      fade: row.fade,
      channelPresetId: row.channelPresetId,
      valuePresetId: row.valuePresetId,
    }),
  );
  const duplicateName = template.name ? `${template.name} Copy` : "Untitled Template Copy";
  const duplicate = createLightTemplateDefaults({ name: duplicateName, rows: clonedRows });
  lightTemplates.push(duplicate);
  saveLightTemplates();
  renderLightTemplates({ focusTemplateId: duplicate.id });
}

function removeLightTemplate(templateId) {
  const index = lightTemplates.findIndex((template) => template.id === templateId);
  if (index === -1) return;
  lightTemplates.splice(index, 1);
  saveLightTemplates();
  renderLightTemplates();
  removeTemplateInstances(templateId);
}

function removeTemplateInstances(templateId) {
  const originalLength = actions.length;
  actions = actions.filter((action) => action.templateId !== templateId);
  if (actions.length !== originalLength) {
    renderActions();
    queuePreviewSync();
  }
}

function addRowToLightTemplate(templateId) {
  const template = getLightTemplate(templateId);
  if (!template) return;
  if (!Array.isArray(template.rows)) {
    template.rows = [];
  }
  const newRow = createTemplateRowDefaults();
  template.rows.push(newRow);
  saveLightTemplates();
  renderLightTemplates({
    preserveFocus: { templateId, rowId: newRow.id, field: "template-channel" },
  });
  syncTemplateInstances(templateId);
}

function duplicateTemplateRow(templateId, rowId) {
  const template = getLightTemplate(templateId);
  if (!template || !Array.isArray(template.rows)) return;
  const index = template.rows.findIndex((row) => row.id === rowId);
  if (index === -1) return;
  const source = template.rows[index];
  const clone = createTemplateRowDefaults({
    channel: source.channel,
    value: source.value,
    fade: source.fade,
    channelPresetId: source.channelPresetId,
    valuePresetId: source.valuePresetId,
  });
  template.rows.splice(index + 1, 0, clone);
  saveLightTemplates();
  renderLightTemplates({
    preserveFocus: { templateId, rowId: clone.id, field: "template-channel" },
  });
  syncTemplateInstances(templateId);
}

function removeTemplateRow(templateId, rowId) {
  const template = getLightTemplate(templateId);
  if (!template || !Array.isArray(template.rows)) return;
  const index = template.rows.findIndex((row) => row.id === rowId);
  if (index === -1) return;
  template.rows.splice(index, 1);
  saveLightTemplates();
  renderLightTemplates({ preserveFocus: { templateId } });
  syncTemplateInstances(templateId);
}

function handleTemplateRowChannelPresetChange(templateId, rowId, event) {
  const template = getLightTemplate(templateId);
  if (!template) return;
  const row = getTemplateRow(templateId, rowId);
  if (!row) return;
  const selectedId = event.target.value;
  if (selectedId) {
    row.channelPresetId = selectedId;
    const preset = getChannelPreset(selectedId);
    if (preset) {
      const channelNumber = Number.parseInt(preset.channel, 10);
      if (Number.isFinite(channelNumber)) {
        row.channel = clamp(channelNumber, 1, 512);
      }
      if (!Array.isArray(preset.values) || !preset.values.some((value) => value.id === row.valuePresetId)) {
        row.valuePresetId = null;
      }
    }
  } else {
    row.channelPresetId = null;
  }
  const focusDescriptor = describeFocusedTemplateField(event.target);
  saveLightTemplates();
  renderLightTemplates({ preserveFocus: focusDescriptor });
  syncTemplateInstances(templateId);
}

function handleTemplateRowChannelInput(templateId, rowId, event) {
  const template = getLightTemplate(templateId);
  if (!template) return;
  const row = getTemplateRow(templateId, rowId);
  if (!row) return;
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
  row.channel = clamped;
  row.channelPresetId = null;
  saveLightTemplates();
  syncTemplateInstances(templateId);
}

function handleTemplateRowValuePresetChange(templateId, rowId, event) {
  const template = getLightTemplate(templateId);
  if (!template) return;
  const row = getTemplateRow(templateId, rowId);
  if (!row) return;
  const selectedId = event.target.value;
  const focusDescriptor = describeFocusedTemplateField(event.target);
  if (selectedId && selectedId !== "custom" && row.channelPresetId) {
    const preset = getChannelPreset(row.channelPresetId);
    const presetValues = preset && Array.isArray(preset.values) ? preset.values : [];
    const valuePreset = presetValues.find((value) => value.id === selectedId) || null;
    if (valuePreset) {
      row.valuePresetId = valuePreset.id;
      const numericValue = Number.parseInt(valuePreset.value, 10);
      if (Number.isFinite(numericValue)) {
        row.value = clamp(numericValue, 0, 255);
      }
      saveLightTemplates();
      renderLightTemplates({ preserveFocus: focusDescriptor });
      syncTemplateInstances(templateId);
      return;
    }
  }
  row.valuePresetId = null;
  saveLightTemplates();
  renderLightTemplates({ preserveFocus: focusDescriptor });
  syncTemplateInstances(templateId);
}

function handleTemplateRowValueChange(templateId, rowId, event) {
  const template = getLightTemplate(templateId);
  if (!template) return;
  const row = getTemplateRow(templateId, rowId);
  if (!row) return;
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
  row.value = clamped;
  row.valuePresetId = null;
  saveLightTemplates();
  syncTemplateInstances(templateId);
}

function handleTemplateRowFadeChange(templateId, rowId, event) {
  const template = getLightTemplate(templateId);
  if (!template) return;
  const row = getTemplateRow(templateId, rowId);
  if (!row) return;
  const raw = Number.parseFloat(event.target.value);
  const normalized = Number.isFinite(raw) ? Math.max(0, raw) : 0;
  row.fade = Number(normalized.toFixed(3));
  event.target.value = row.fade;
  saveLightTemplates();
  syncTemplateInstances(templateId);
}

function syncTemplateInstances(templateId, options = {}) {
  if (!templateId) return;
  const template = getLightTemplate(templateId);
  if (!template) return;
  const instances = new Map();

  actions.forEach((action, index) => {
    if (action.templateId !== templateId || !action.templateInstanceId) {
      return;
    }
    const instanceId = action.templateInstanceId;
    let group = instances.get(instanceId);
    if (!group) {
      group = {
        instanceId,
        indices: [],
        stepId: getActionStepId(action),
        time: action.time || DEFAULT_ACTION.time,
      };
      instances.set(instanceId, group);
    }
    group.indices.push(index);
  });

  if (!instances.size) {
    return;
  }

  const groups = Array.from(instances.values()).map((group) => {
    group.indices.sort((a, b) => a - b);
    group.firstIndex = group.indices.length ? group.indices[0] : actions.length;
    return group;
  });

  groups.sort((a, b) => a.firstIndex - b.firstIndex);

  let removedBefore = 0;
  groups.forEach((group) => {
    group.removedBefore = removedBefore;
    removedBefore += group.indices.length;
  });

  const removalIndices = groups
    .flatMap((group) => group.indices)
    .sort((a, b) => b - a);

  removalIndices.forEach((index) => {
    actions.splice(index, 1);
  });

  let insertedSoFar = 0;
  groups.forEach((group) => {
    const { stepId, time, instanceId, removedBefore: beforeCount = 0 } = group;
    const timeValue = time || DEFAULT_ACTION.time;
    const newActions = createActionsFromTemplate(template, stepId, timeValue, instanceId);
    if (!newActions.length) {
      return;
    }

    const baseIndex = group.firstIndex - beforeCount;
    let insertionIndex = baseIndex + insertedSoFar;
    if (insertionIndex < 0) insertionIndex = 0;
    if (insertionIndex > actions.length) insertionIndex = actions.length;

    actions.splice(insertionIndex, 0, ...newActions);
    insertedSoFar += newActions.length;
  });

  if (options.render !== false) {
    renderActions({ preserveFocus: describeFocusedActionField(document.activeElement) });
    queuePreviewSync();
  }
}

function createActionsFromTemplate(template, stepId, time, instanceId) {
  const rows = Array.isArray(template.rows) ? template.rows : [];
  const seconds = parseTimeString(time) ?? parseTimeString(DEFAULT_ACTION.time) ?? 0;
  const timecode = secondsToTimecode(seconds);
  return rows.map((row) => {
    const action = {
      ...DEFAULT_ACTION,
      time: timecode,
      channel: clamp(Number.parseInt(row.channel, 10) || 1, 1, 512),
      value: clamp(Number.parseInt(row.value, 10) || 0, 0, 255),
      fade: Math.max(0, Number.parseFloat(row.fade) || 0),
      channelPresetId:
        typeof row.channelPresetId === "string" && row.channelPresetId ? row.channelPresetId : null,
      valuePresetId:
        typeof row.valuePresetId === "string" && row.valuePresetId ? row.valuePresetId : null,
      templateId: template.id,
      templateInstanceId: instanceId,
      templateRowId: row.id,
    };
    ensureActionLocalId(action);
    setActionStepId(action, stepId);
    return action;
  });
}

function generateTemplateInstanceId() {
  templateInstanceCounter += 1;
  return `template-instance-${templateInstanceCounter}`;
}

function applyTemplateToStep(stepId, templateId, options = {}) {
  const template = getLightTemplate(templateId);
  if (!template) return;
  const groupInfo = stepInfoById.get(stepId);
  const baseTime = options.time || groupInfo?.time || DEFAULT_ACTION.time;
  let insertionIndex;
  if (Number.isInteger(options.insertIndex)) {
    insertionIndex = options.insertIndex;
  } else if (groupInfo && Array.isArray(groupInfo.indices) && groupInfo.indices.length) {
    insertionIndex = groupInfo.indices[groupInfo.indices.length - 1] + 1;
  } else {
    insertionIndex = actions.length;
  }
  if (!Number.isInteger(insertionIndex)) {
    insertionIndex = actions.length;
  }

  const instanceId = generateTemplateInstanceId();
  const newActions = createActionsFromTemplate(template, stepId, baseTime, instanceId);
  if (!newActions.length) {
    showStatus("Selected template has no rows to add.", "info");
    return;
  }
  let targetIndex = insertionIndex;
  if (targetIndex < 0) targetIndex = 0;
  if (targetIndex > actions.length) targetIndex = actions.length;

  newActions.forEach((action, index) => {
    actions.splice(targetIndex + index, 0, action);
  });

  renderActions();
  queuePreviewSync();
}

function openTemplatePicker(stepId) {
  if (!templatePickerEl) return;
  templatePickerStepId = stepId;
  templatePickerEl.hidden = false;
  templatePickerEl.setAttribute("aria-hidden", "false");
  templatePickerEl.classList.add("is-visible");
  const query = templatePickerSearch ? templatePickerSearch.value || "" : "";
  renderTemplatePickerResults(query);
  focusTemplatePickerSearch();
}

function closeTemplatePicker() {
  if (!templatePickerEl) return;
  templatePickerEl.hidden = true;
  templatePickerEl.setAttribute("aria-hidden", "true");
  templatePickerEl.classList.remove("is-visible");
  templatePickerStepId = null;
  if (templatePickerSearch) {
    templatePickerSearch.value = "";
  }
}

function isTemplatePickerOpen() {
  return Boolean(templatePickerEl && !templatePickerEl.hidden);
}

function focusTemplatePickerSearch() {
  if (!templatePickerSearch) return;
  try {
    templatePickerSearch.focus({ preventScroll: true });
  } catch (error) {
    templatePickerSearch.focus();
  }
  templatePickerSearch.select();
}

function renderTemplatePickerResults(query) {
  if (!templatePickerResults) return;
  templatePickerResults.innerHTML = "";
  const normalized = (query || "").trim().toLowerCase();
  const items = normalized
    ? lightTemplates.filter((template) =>
        (template.name || "").toLowerCase().includes(normalized),
      )
    : [...lightTemplates];

  if (!items.length) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "template-picker__empty";
    emptyItem.textContent = "No templates match your search.";
    templatePickerResults.append(emptyItem);
    return;
  }

  items.forEach((template) => {
    const item = document.createElement("li");
    item.className = "template-picker__item";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "template-picker__option";
    button.textContent = formatLightTemplateTitle(template);
    button.dataset.templateId = template.id;
    button.addEventListener("click", () => handleTemplatePickerSelection(template.id));
    item.append(button);
    templatePickerResults.append(item);
  });
}

function handleTemplatePickerSelection(templateId) {
  if (!templatePickerStepId) {
    closeTemplatePicker();
    return;
  }
  applyTemplateToStep(templatePickerStepId, templateId);
  closeTemplatePicker();
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
    const entry = {
      time: secondsToTimecode(seconds),
      channel,
      value,
      fade: Number(fade.toFixed(3)),
    };
    if (action.channelPresetId) {
      entry.channelPresetId = action.channelPresetId;
    }
    if (action.valuePresetId) {
      entry.valuePresetId = action.valuePresetId;
    }
    if (action.templateId) {
      entry.templateId = action.templateId;
    }
    if (action.templateInstanceId) {
      entry.templateInstanceId = action.templateInstanceId;
    }
    if (action.templateRowId) {
      entry.templateRowId = action.templateRowId;
    }
    prepared.push(entry);
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
