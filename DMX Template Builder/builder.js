const videoSelect = document.getElementById("video-select");
const addStepButton = document.getElementById("add-step");
const saveButton = document.getElementById("save-template");
const exportButton = document.getElementById("export-template");
const statusEl = document.getElementById("status-message");
const actionsBody = document.getElementById("actions-body");
const actionsTableWrapper = document.querySelector("#timeline-panel .table-wrapper");
const templateInfoEl = document.getElementById("template-info");
const videoEl = document.getElementById("preview-video");
const rowTemplate = document.getElementById("action-row-template");
const channelPresetsContainer = document.getElementById("channel-presets");
const stageVisualizerEl = document.getElementById("stage-visualizer");
const stageStatusEl = stageVisualizerEl ? stageVisualizerEl.querySelector(".stage-status") : null;
const stageLightConfig = stageVisualizerEl ? buildStageLightConfig(stageVisualizerEl) : null;
const moverStageConfig = stageVisualizerEl ? buildMoverStageConfig(stageVisualizerEl) : null;
const stageRotationState = {
  mover: moverStageConfig ? moverStageConfig.baseRotation : 0,
  beams: moverStageConfig ? moverStageConfig.beams.map((beam) => beam.baseAngle) : [],
};
const addChannelPresetButton = document.getElementById("add-channel-preset");
const channelPresetsSection = document.querySelector(".preset-settings");
const builderLayout = document.querySelector(".builder-layout");
const tabButtons = Array.from(document.querySelectorAll(".builder-tab"));
const tabPanels = Array.from(document.querySelectorAll("[data-tab-panel]"));
const timelinePanel = document.getElementById("timeline-panel");
const presetsPanel = document.getElementById("presets-panel");
const templatesPanel = document.getElementById("templates-panel");
const colorPresetsPanel = document.getElementById("color-presets-panel");
const colorPresetsList = document.getElementById("color-presets");
const addColorPresetButton = document.getElementById("add-color-preset");
const resetColorPresetsButton = document.getElementById("reset-color-presets");
const timelineEmptyState = document.getElementById("timeline-empty-state");
const lightTemplatesContainer = document.getElementById("light-templates");
const templateDetailContainer = document.getElementById("template-detail");
const addLightTemplateButton = document.getElementById("add-light-template");
const lightTemplateFilterInput = document.getElementById("light-template-filter");
const templatePickerEl = document.getElementById("template-picker");
const templatePickerSearch = document.getElementById("template-picker-search");
const templatePickerResults = document.getElementById("template-picker-results");
const templatePickerCloseElements = Array.from(
  document.querySelectorAll("[data-template-picker-close]"),
);
const templateRowTemplate = document.getElementById("template-row-template");
const systemUpdateButton = document.getElementById("system-update");
const systemRestartButton = document.getElementById("system-restart");
const systemShutdownButton = document.getElementById("system-shutdown");
const channelFilterContainer = document.getElementById("channel-filter");
const channelFilterButton = document.getElementById("channel-filter-button");
const channelFilterDropdown = document.getElementById("channel-filter-dropdown");
const channelFilterGroupsContainer = document.getElementById("channel-filter-groups");
const channelFilterCountEl = document.getElementById("channel-filter-count");
const channelFilterClearButton = document.getElementById("channel-filter-clear");

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
let colorPresets = [];
let activeTab = "timeline";
const collapsedChannelPresetIds = new Set();
const collapsedStepIds = new Set();
let actionGroupIds = [];
let stepInfoById = new Map();
let draggingActionId = null;
let draggingTemplateInstanceId = null;
let draggingTemplateRow = null;
let lastKnownTimelineSeconds = 0;
let lightTemplates = [];
let activeLightTemplateId = null;
let templatePickerStepId = null;
let templateInstanceCounter = 0;
let lightTemplateFilterQuery = "";
let channelFilterOpen = false;
const activeChannelFilterIds = new Set();
const channelFilterGroupMap = new Map();

const CHANNEL_COMPONENTS = Object.freeze({
  NONE: "",
  RED: "red",
  GREEN: "green",
  BLUE: "blue",
  WHITE: "white",
  BRIGHTNESS: "brightness",
});

const CHANNEL_COMPONENT_SUGGESTIONS = Object.freeze([
  CHANNEL_COMPONENTS.NONE,
  CHANNEL_COMPONENTS.RED,
  CHANNEL_COMPONENTS.GREEN,
  CHANNEL_COMPONENTS.BLUE,
  CHANNEL_COMPONENTS.WHITE,
  CHANNEL_COMPONENTS.BRIGHTNESS,
]);

const CHANNEL_COMPONENT_TYPES = Object.freeze({
  COLOR: "color",
  SLIDER: "slider",
  DROPDOWN: "dropdown",
});

const CHANNEL_COMPONENT_TYPE_VALUES = new Set(Object.values(CHANNEL_COMPONENT_TYPES));

const CHANNEL_COMPONENT_DEFAULT_NAMES = Object.freeze({
  [CHANNEL_COMPONENTS.RED]: "Red",
  [CHANNEL_COMPONENTS.GREEN]: "Green",
  [CHANNEL_COMPONENTS.BLUE]: "Blue",
  [CHANNEL_COMPONENTS.WHITE]: "White",
  [CHANNEL_COMPONENTS.BRIGHTNESS]: "Brightness",
});

const COLOR_COMPONENT_KEYS = new Set([
  CHANNEL_COMPONENTS.RED,
  CHANNEL_COMPONENTS.GREEN,
  CHANNEL_COMPONENTS.BLUE,
]);

const DEFAULT_SLIDER_VALUES = Object.freeze({
  [CHANNEL_COMPONENTS.BRIGHTNESS]: 255,
  [CHANNEL_COMPONENTS.WHITE]: 0,
});

const CHANNEL_COMPONENT_DEFAULT_TYPE = CHANNEL_COMPONENT_TYPES.SLIDER;

const CHANNEL_MASTER_PREFIX = "master:";

const DEFAULT_COLOR_PRESETS = Object.freeze([
  { id: "color_red", name: "Red", iconColor: "#ff3b30", red: 255, green: 0, blue: 0 },
  { id: "color_orange", name: "Orange", iconColor: "#ff9500", red: 255, green: 87, blue: 0 },
  { id: "color_amber", name: "Amber", iconColor: "#ffcc00", red: 255, green: 170, blue: 0 },
  { id: "color_yellow", name: "Yellow", iconColor: "#ffd60a", red: 255, green: 214, blue: 10 },
  { id: "color_green", name: "Green", iconColor: "#34c759", red: 0, green: 255, blue: 0 },
  { id: "color_teal", name: "Teal", iconColor: "#30d158", red: 0, green: 209, blue: 88 },
  { id: "color_cyan", name: "Cyan", iconColor: "#32ade6", red: 0, green: 173, blue: 230 },
  { id: "color_blue", name: "Blue", iconColor: "#007aff", red: 0, green: 122, blue: 255 },
  { id: "color_purple", name: "Purple", iconColor: "#af52de", red: 175, green: 82, blue: 222 },
  { id: "color_pink", name: "Pink", iconColor: "#ff2d55", red: 255, green: 45, blue: 85 },
  { id: "color_white", name: "White", iconColor: "#ffffff", red: 255, green: 255, blue: 255 },
]);

let channelMasters = [];
const channelMasterMap = new Map();
const DEFAULT_MASTER_COLOR = "#ffffff";

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

const COLOR_PRESET_STORAGE_KEY = "dmxTemplateBuilder.colorPresets";

const LIGHT_TEMPLATE_STORAGE_KEY = "dmxTemplateBuilder.lightTemplates";

const DEFAULT_ACTION = Object.freeze({
  time: "00:00:00",
  channel: 1,
  value: 0,
  fade: 0,
  stepTitle: "",
  channelPresetId: null,
  valuePresetId: null,
  channelMasterId: null,
  master: null,
  templateId: null,
  templateInstanceId: null,
  templateRowId: null,
  templateLoop: null,
});

const TEMPLATE_ROW_TYPES = Object.freeze({
  ACTION: "action",
  DELAY: "delay",
});

const TEMPLATE_LOOP_DEFAULTS = Object.freeze({
  enabled: false,
  count: 1,
  infinite: false,
  mode: "forward",
  duration: 0,
});

const ICON_SVGS = {
  delete: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><path d="M232.7 69.9L224 96L128 96C110.3 96 96 110.3 96 128C96 145.7 110.3 160 128 160L512 160C529.7 160 544 145.7 544 128C544 110.3 529.7 96 512 96L416 96L407.3 69.9C402.9 56.8 390.7 48 376.9 48L263.1 48C249.3 48 237.1 56.8 232.7 69.9zM512 208L128 208L149.1 531.1C150.7 556.4 171.7 576 197 576L443 576C468.3 576 489.3 556.4 490.9 531.1L512 208z"/></svg>`,
  duplicate: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><path d="M352 512L128 512L128 288L176 288L176 224L128 224C92.7 224 64 252.7 64 288L64 512C64 547.3 92.7 576 128 576L352 576C387.3 576 416 547.3 416 512L416 464L352 464L352 512zM288 416L512 416C547.3 416 576 387.3 576 352L576 128C576 92.7 547.3 64 512 64L288 64C252.7 64 224 92.7 224 128L224 352C224 387.3 252.7 416 288 416z"/></svg>`,
  go: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><path d="M187.2 100.9C174.8 94.1 159.8 94.4 147.6 101.6C135.4 108.8 128 121.9 128 136L128 504C128 518.1 135.5 531.2 147.6 538.4C159.7 545.6 174.8 545.9 187.2 539.1L523.2 355.1C536 348.1 544 334.6 544 320C544 305.4 536 291.9 523.2 284.9L187.2 100.9z"/></svg>`,
  edit: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><path d="M535.6 85.7C513.7 63.8 478.3 63.8 456.4 85.7L432 110.1L529.9 208L554.3 183.6C576.2 161.7 576.2 126.3 554.3 104.4L535.6 85.7zM236.4 305.7C230.3 311.8 225.6 319.3 222.9 327.6L193.3 416.4C190.4 425 192.7 434.5 199.1 441C205.5 447.5 215 449.7 223.7 446.8L312.5 417.2C320.7 414.5 328.2 409.8 334.4 403.7L496 241.9L398.1 144L236.4 305.7zM160 128C107 128 64 171 64 224L64 480C64 533 107 576 160 576L416 576C469 576 512 533 512 480L512 384C512 366.3 497.7 352 480 352C462.3 352 448 366.3 448 384L448 480C448 497.7 433.7 512 416 512L160 512C142.3 512 128 497.7 128 480L128 224C128 206.3 142.3 192 160 192L256 192C273.7 192 288 177.7 288 160C288 142.3 273.7 128 256 128L160 128z"/></svg>`,
};

function createIconElement(type) {
  const svg = ICON_SVGS[type];
  if (!svg) {
    return null;
  }
  const wrapper = document.createElement("span");
  wrapper.className = `icon icon--${type}`;
  wrapper.setAttribute("aria-hidden", "true");
  wrapper.innerHTML = svg.trim();
  return wrapper;
}

function applyIconButton(button, type, label) {
  if (!button) return;
  const icon = createIconElement(type);
  if (!icon) return;
  button.classList.add("icon-button");
  if (label) {
    button.setAttribute("aria-label", label);
    button.title = label;
  }
  button.textContent = "";
  button.append(icon);
  if (label) {
    const srText = document.createElement("span");
    srText.className = "visually-hidden";
    srText.textContent = label;
    button.append(srText);
  }
}

function slugifyComponentKey(value) {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
}

function normalizeChannelComponent(value) {
  if (typeof value !== "string") {
    return CHANNEL_COMPONENTS.NONE;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return CHANNEL_COMPONENTS.NONE;
  }
  if (trimmed.toLowerCase() === "none") {
    return CHANNEL_COMPONENTS.NONE;
  }
  return slugifyComponentKey(trimmed);
}

function normalizeChannelComponentType(value) {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().toLowerCase();
  return CHANNEL_COMPONENT_TYPE_VALUES.has(normalized) ? normalized : "";
}

function getPresetComponentType(preset) {
  if (!preset || typeof preset !== "object") {
    return "";
  }
  const rawType = normalizeChannelComponentType(preset.componentType);
  if (rawType) {
    return rawType;
  }
  const componentKey = getChannelPresetComponent(preset);
  if (COLOR_COMPONENT_KEYS.has(componentKey)) {
    return CHANNEL_COMPONENT_TYPES.COLOR;
  }
  if (componentKey === CHANNEL_COMPONENTS.BRIGHTNESS || componentKey === CHANNEL_COMPONENTS.WHITE) {
    return CHANNEL_COMPONENT_TYPES.SLIDER;
  }
  if (Array.isArray(preset.values) && preset.values.length) {
    return CHANNEL_COMPONENT_TYPES.DROPDOWN;
  }
  return CHANNEL_COMPONENT_DEFAULT_TYPE;
}

function titleizeComponentKey(key) {
  if (!key) {
    return "";
  }
  return key
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getPresetComponentName(preset) {
  if (!preset || typeof preset !== "object") {
    return "";
  }
  if (typeof preset.componentName === "string" && preset.componentName.trim()) {
    return preset.componentName.trim();
  }
  const componentKey = getChannelPresetComponent(preset);
  if (componentKey && CHANNEL_COMPONENT_DEFAULT_NAMES[componentKey]) {
    return CHANNEL_COMPONENT_DEFAULT_NAMES[componentKey];
  }
  const type = getPresetComponentType(preset);
  if (type === CHANNEL_COMPONENT_TYPES.DROPDOWN) {
    return "Mode";
  }
  if (type === CHANNEL_COMPONENT_TYPES.SLIDER) {
    return titleizeComponentKey(componentKey) || "Level";
  }
  return titleizeComponentKey(componentKey);
}

function getChannelPresetComponent(preset) {
  if (!preset || typeof preset !== "object") {
    return CHANNEL_COMPONENTS.NONE;
  }
  return normalizeChannelComponent(preset.component);
}

function getPresetGroupName(preset) {
  if (!preset || typeof preset !== "object") {
    return "";
  }
  return typeof preset.group === "string" ? preset.group.trim() : "";
}

function getPresetGroupKey(preset) {
  const groupName = getPresetGroupName(preset);
  if (groupName) {
    return groupName.toLowerCase();
  }
  if (preset && typeof preset.id === "string" && preset.id) {
    return `preset-${preset.id}`;
  }
  return null;
}

function getMasterIdForGroup(groupName, fallback = "master") {
  const base = groupName ? slugify(groupName) : slugify(fallback);
  return `${CHANNEL_MASTER_PREFIX}${base || fallback}`;
}

function refreshChannelMasters() {
  const groups = new Map();

  channelPresets.forEach((preset) => {
    const component = getChannelPresetComponent(preset);
    if (component === CHANNEL_COMPONENTS.NONE) {
      return;
    }
    const groupKey = getPresetGroupKey(preset);
    if (!groupKey) {
      return;
    }
    let entry = groups.get(groupKey);
    if (!entry) {
      const groupName = getPresetGroupName(preset) || "";
      entry = {
        id: getMasterIdForGroup(groupName || preset.id || groupKey, groupKey),
        key: groupKey,
        name: groupName,
        presets: {},
        componentMeta: new Map(),
        componentOrder: [],
      };
      groups.set(groupKey, entry);
    }
    const componentType = getPresetComponentType(preset);
    const componentName = getPresetComponentName(preset);
    entry.presets[component] = preset;
    entry.componentMeta.set(component, {
      key: component,
      type: componentType,
      name: componentName,
      preset,
    });
    if (!entry.componentOrder.includes(component)) {
      entry.componentOrder.push(component);
    }
  });

  const masters = [];
  groups.forEach((entry) => {
    const components = entry.presets;
    const meta = entry.componentMeta || new Map();
    const componentKeys = Array.isArray(entry.componentOrder)
      ? entry.componentOrder.slice()
      : Object.keys(components);
    const componentCount = componentKeys.length;
    if (!componentCount) {
      return;
    }
    const hasColor = COLOR_COMPONENT_KEYS.size
      ? [...COLOR_COMPONENT_KEYS].every((key) => components[key])
      : false;
    const sliderComponents = [];
    const dropdownComponents = [];
    const colorComponents = [];

    componentKeys.forEach((key) => {
      const info = meta.get(key);
      if (!info) {
        return;
      }
      if (info.type === CHANNEL_COMPONENT_TYPES.COLOR) {
        colorComponents.push({ ...info });
      } else if (info.type === CHANNEL_COMPONENT_TYPES.SLIDER) {
        sliderComponents.push({
          ...info,
          defaultValue:
            Number.isFinite(DEFAULT_SLIDER_VALUES[info.key])
              ? DEFAULT_SLIDER_VALUES[info.key]
              : 0,
        });
      } else if (info.type === CHANNEL_COMPONENT_TYPES.DROPDOWN) {
        const options = Array.isArray(info.preset?.values) ? info.preset.values : [];
        dropdownComponents.push({ ...info, options });
      }
    });

    const channels = Object.values(components)
      .map((preset) => Number.parseInt(preset.channel, 10))
      .filter((channel) => Number.isFinite(channel))
      .sort((a, b) => a - b);
    masters.push({
      id: entry.id,
      key: entry.key,
      name: entry.name,
      label: entry.name ? `${entry.name} (MASTER)` : "Master",
      presets: components,
      channels,
      hasColor,
      hasWhite: sliderComponents.some((item) => item.key === CHANNEL_COMPONENTS.WHITE),
      hasBrightness: sliderComponents.some((item) => item.key === CHANNEL_COMPONENTS.BRIGHTNESS),
      componentMeta: meta,
      componentOrder: componentKeys,
      sliderComponents,
      dropdownComponents,
      colorComponents,
    });
  });

  masters.sort((a, b) => {
    if (a.name && b.name) {
      const compare = a.name.localeCompare(b.name, undefined, {
        sensitivity: "base",
        numeric: true,
      });
      if (compare !== 0) {
        return compare;
      }
    }
    return a.id.localeCompare(b.id);
  });

  channelMasters = masters;
  channelMasterMap.clear();
  masters.forEach((master) => {
    channelMasterMap.set(master.id, master);
  });

  const validMasterIds = new Set(masters.map((entry) => entry.id));
  actions.forEach((action) => {
    if (action.channelMasterId && !validMasterIds.has(action.channelMasterId)) {
      action.channelMasterId = null;
      action.master = null;
    }
  });
}

function getChannelMaster(masterId) {
  if (!masterId) {
    return null;
  }
  return channelMasterMap.get(masterId) || null;
}

function getMasterPrimaryChannel(master) {
  if (!master) {
    return 1;
  }
  const brightnessChannel = master.presets[CHANNEL_COMPONENTS.BRIGHTNESS];
  if (brightnessChannel) {
    const channelNumber = Number.parseInt(brightnessChannel.channel, 10);
    if (Number.isFinite(channelNumber)) {
      return clamp(channelNumber, 1, 512);
    }
  }
  if (Array.isArray(master.channels) && master.channels.length) {
    return clamp(master.channels[0], 1, 512);
  }
  return 1;
}

function clampChannelValue(value) {
  const numeric = Number.parseInt(value, 10);
  if (Number.isNaN(numeric)) {
    return 0;
  }
  return clamp(numeric, 0, 255);
}

function normalizeHexColor(value) {
  if (typeof value !== "string") {
    return DEFAULT_MASTER_COLOR;
  }
  const trimmed = value.trim().toLowerCase();
  const hex = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-f]{6}$/.test(hex)) {
    return `#${hex}`;
  }
  return DEFAULT_MASTER_COLOR;
}

function hexToRgb(color) {
  const normalized = normalizeHexColor(color);
  const hex = normalized.slice(1);
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function rgbToHex(r, g, b) {
  const toHex = (value) => clampChannelValue(value).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function createDefaultMasterState(master, previous = null) {
  if (!master) {
    return null;
  }
  const hasPrevious = previous && previous.id === master.id;
  const state = hasPrevious ? previous : { id: master.id };
  state.id = master.id;

  if (master.hasColor) {
    const baseColor = hasPrevious ? previous.color : state.color;
    state.color = normalizeHexColor(baseColor || DEFAULT_MASTER_COLOR);
  } else if (Object.prototype.hasOwnProperty.call(state, "color")) {
    delete state.color;
  }

  const previousSliders =
    hasPrevious && previous.sliders && typeof previous.sliders === "object"
      ? previous.sliders
      : null;
  const sliderState = {};
  if (Array.isArray(master.sliderComponents)) {
    master.sliderComponents.forEach((component) => {
      if (!component || !component.key) {
        return;
      }
      let fallback =
        previousSliders && typeof previousSliders[component.key] === "number"
          ? previousSliders[component.key]
          : null;
      if (fallback === null || fallback === undefined) {
        if (
          component.key === CHANNEL_COMPONENTS.BRIGHTNESS &&
          hasPrevious &&
          typeof previous.brightness === "number"
        ) {
          fallback = previous.brightness;
        } else if (
          component.key === CHANNEL_COMPONENTS.WHITE &&
          hasPrevious &&
          typeof previous.white === "number"
        ) {
          fallback = previous.white;
        } else if (typeof component.defaultValue === "number") {
          fallback = component.defaultValue;
        }
      }
      const value = clampChannelValue(
        fallback === null || fallback === undefined ? component.defaultValue ?? 0 : fallback,
      );
      sliderState[component.key] = value;
      if (component.key === CHANNEL_COMPONENTS.BRIGHTNESS) {
        state.brightness = value;
      }
      if (component.key === CHANNEL_COMPONENTS.WHITE) {
        state.white = value;
      }
    });
  }

  if (Object.keys(sliderState).length) {
    state.sliders = sliderState;
  } else if (Object.prototype.hasOwnProperty.call(state, "sliders")) {
    delete state.sliders;
  }

  if (!master.hasBrightness && Object.prototype.hasOwnProperty.call(state, "brightness")) {
    delete state.brightness;
  }
  if (!master.hasWhite && Object.prototype.hasOwnProperty.call(state, "white")) {
    delete state.white;
  }

  const previousDropdowns =
    hasPrevious && previous.dropdownSelections && typeof previous.dropdownSelections === "object"
      ? previous.dropdownSelections
      : null;
  const dropdownState = {};
  if (Array.isArray(master.dropdownComponents)) {
    master.dropdownComponents.forEach((component) => {
      if (!component || !component.key) {
        return;
      }
      const options = Array.isArray(component.options) ? component.options : [];
      if (!options.length) {
        return;
      }
      let selection =
        previousDropdowns && typeof previousDropdowns[component.key] === "string"
          ? previousDropdowns[component.key]
          : null;
      if (!selection || !options.some((option) => option.id === selection)) {
        selection = options[0].id;
      }
      if (selection) {
        dropdownState[component.key] = selection;
      }
    });
  }

  if (Object.keys(dropdownState).length) {
    state.dropdownSelections = dropdownState;
  } else if (Object.prototype.hasOwnProperty.call(state, "dropdownSelections")) {
    delete state.dropdownSelections;
  }

  return state;
}

function ensureMasterState(action, master) {
  if (!action || !master) {
    return null;
  }
  const state = createDefaultMasterState(master, action.master);
  action.master = state;
  action.channelMasterId = master.id;
  action.channelPresetId = null;
  action.valuePresetId = null;
  action.channel = getMasterPrimaryChannel(master);
  if (master.hasBrightness && typeof state.brightness === "number") {
    action.value = clampChannelValue(state.brightness);
  } else if (Array.isArray(master.sliderComponents) && master.sliderComponents.length) {
    const firstSlider = master.sliderComponents[0];
    const sliders = state.sliders || {};
    const sliderValue = sliders[firstSlider.key];
    if (typeof sliderValue === "number") {
      action.value = clampChannelValue(sliderValue);
    }
  }
  return state;
}

function buildMasterChannelValues(master, state) {
  const values = {};
  if (master.hasColor) {
    const rgb = hexToRgb(state?.color);
    values[CHANNEL_COMPONENTS.RED] = rgb.r;
    values[CHANNEL_COMPONENTS.GREEN] = rgb.g;
    values[CHANNEL_COMPONENTS.BLUE] = rgb.b;
  }
  if (Array.isArray(master.sliderComponents)) {
    const sliders = state?.sliders || {};
    master.sliderComponents.forEach((component) => {
      if (!component || !component.key) {
        return;
      }
      const rawValue = sliders[component.key];
      const fallback =
        rawValue === null || rawValue === undefined ? component.defaultValue ?? 0 : rawValue;
      values[component.key] = clampChannelValue(fallback);
    });
  }
  if (Array.isArray(master.dropdownComponents)) {
    const selections = state?.dropdownSelections || {};
    master.dropdownComponents.forEach((component) => {
      if (!component || !component.key) {
        return;
      }
      const options = Array.isArray(component.options) ? component.options : [];
      if (!options.length) {
        return;
      }
      const selectedId = selections[component.key];
      const option = options.find((entry) => entry.id === selectedId) || options[0];
      if (option) {
        values[component.key] = clampChannelValue(option.value);
      }
    });
  }
  return values;
}

function expandMasterAction(action, master, seconds, fade) {
  const state = ensureMasterState(action, master);
  if (!state) {
    return [];
  }
  const componentValues = buildMasterChannelValues(master, state);
  const baseFade = Number(Number.isFinite(fade) ? Number(fade.toFixed(3)) : 0);
  const baseTime = secondsToTimecode(seconds);
  const entries = [];

  const appendEntry = (componentKey) => {
    const preset = master.presets[componentKey];
    if (!preset) {
      return;
    }
    const channelNumber = Number.parseInt(preset.channel, 10);
    if (!Number.isFinite(channelNumber)) {
      return;
    }
    const entry = {
      time: baseTime,
      channel: clamp(channelNumber, 1, 512),
      value: clampChannelValue(componentValues[componentKey] ?? 0),
      fade: baseFade,
      channelPresetId: preset.id,
      channelMasterId: master.id,
    };
    if (typeof action.stepTitle === "string" && action.stepTitle) {
      entry.stepTitle = action.stepTitle;
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
    if (action.templateLoop) {
      const loopSettings = sanitizeTemplateLoop(action.templateLoop);
      if (loopSettings && shouldSerializeTemplateLoop(loopSettings)) {
        entry.templateLoop = loopSettings;
      }
    }
    entries.push(entry);
  };

  const componentKeys = Array.isArray(master.componentOrder)
    ? master.componentOrder
    : Object.keys(master.presets || {});
  componentKeys.forEach((componentKey) => {
    appendEntry(componentKey);
  });

  return entries;
}

function deriveMasterStateFromActions(componentActions, master) {
  if (!master) {
    return null;
  }
  const state = createDefaultMasterState(master);
  if (!state) {
    return null;
  }
  const colorValues = {};
  const sliderValues = {};
  const dropdownSelections = {};
  componentActions.forEach((action) => {
    if (!action || typeof action !== "object") {
      return;
    }
    const presetId = action.channelPresetId;
    if (!presetId) {
      return;
    }
    const preset = getChannelPreset(presetId);
    const component = getChannelPresetComponent(preset);
    if (component === CHANNEL_COMPONENTS.NONE) {
      return;
    }
    const type = getPresetComponentType(preset);
    const value = clampChannelValue(action.value);
    if (type === CHANNEL_COMPONENT_TYPES.COLOR) {
      colorValues[component] = value;
    } else if (type === CHANNEL_COMPONENT_TYPES.SLIDER) {
      sliderValues[component] = value;
    } else if (type === CHANNEL_COMPONENT_TYPES.DROPDOWN) {
      const options = Array.isArray(preset.values) ? preset.values : [];
      const matching = options.find((option) => clampChannelValue(option.value) === value);
      if (matching) {
        dropdownSelections[component] = matching.id;
      }
    }
  });

  if (master.hasColor) {
    const red = colorValues[CHANNEL_COMPONENTS.RED] ?? 0;
    const green = colorValues[CHANNEL_COMPONENTS.GREEN] ?? 0;
    const blue = colorValues[CHANNEL_COMPONENTS.BLUE] ?? 0;
    state.color = rgbToHex(red, green, blue);
  }
  if (Array.isArray(master.sliderComponents)) {
    state.sliders = state.sliders || {};
    master.sliderComponents.forEach((component) => {
      const value = sliderValues[component.key];
      if (typeof value === "number") {
        state.sliders[component.key] = clampChannelValue(value);
        if (component.key === CHANNEL_COMPONENTS.BRIGHTNESS) {
          state.brightness = state.sliders[component.key];
        }
        if (component.key === CHANNEL_COMPONENTS.WHITE) {
          state.white = state.sliders[component.key];
        }
      }
    });
  }
  if (Array.isArray(master.dropdownComponents)) {
    state.dropdownSelections = state.dropdownSelections || {};
    master.dropdownComponents.forEach((component) => {
      const selection = dropdownSelections[component.key];
      const options = Array.isArray(component.options) ? component.options : [];
      if (selection && options.some((option) => option.id === selection)) {
        state.dropdownSelections[component.key] = selection;
      }
    });
  }
  return state;
}

function getChannelSelectionOptions() {
  const options = [];
  const masters = Array.isArray(channelMasters) ? [...channelMasters] : [];
  masters.forEach((master) => {
    options.push({
      type: "master",
      id: master.id,
      label: master.label,
      master,
    });
  });

  const sortedPresets = getSortedChannelPresets();
  sortedPresets.forEach((preset) => {
    options.push({
      type: "preset",
      id: preset.id,
      label: formatChannelPresetLabel(preset),
      preset,
    });
  });

  return options;
}

function collapseMasterActions(list) {
  if (!Array.isArray(list) || !list.length) {
    return list;
  }
  refreshChannelMasters();
  const grouped = new Map();
  const remaining = [];

  list.forEach((action) => {
    if (!action || typeof action !== "object" || !action.channelMasterId) {
      remaining.push(action);
      return;
    }
    const master = getChannelMaster(action.channelMasterId);
    if (!master) {
      remaining.push(action);
      return;
    }
    const timeKey = typeof action.time === "string" && action.time ? action.time : DEFAULT_ACTION.time;
    const templateInstance = action.templateInstanceId || "";
    const templateRow = action.templateRowId || "";
    const templateId = action.templateId || "";
    const key = [timeKey, action.channelMasterId, templateInstance, templateRow, templateId].join("|");
    let group = grouped.get(key);
    if (!group) {
      group = {
        master,
        time: timeKey,
        fade: Number.parseFloat(action.fade) || 0,
        templateId: action.templateId || null,
        templateInstanceId: action.templateInstanceId || null,
        templateRowId: action.templateRowId || null,
        templateLoop: action.templateLoop ? normalizeTemplateLoop(action.templateLoop) : null,
        stepTitle: typeof action.stepTitle === "string" ? action.stepTitle : "",
        actions: [],
      };
      grouped.set(key, group);
    }
    if (!group.stepTitle && typeof action.stepTitle === "string" && action.stepTitle) {
      group.stepTitle = action.stepTitle;
    }
    group.actions.push(action);
  });

  const collapsed = [];
  grouped.forEach((group) => {
    const masterAction = { ...DEFAULT_ACTION };
    masterAction.time = group.time;
    masterAction.fade = group.fade;
    masterAction.templateId = group.templateId;
    masterAction.templateInstanceId = group.templateInstanceId;
    masterAction.templateRowId = group.templateRowId;
    masterAction.stepTitle = group.stepTitle || "";
    if (group.templateLoop) {
      masterAction.templateLoop = group.templateLoop;
    }
    masterAction.channelMasterId = group.master.id;
    ensureMasterState(masterAction, group.master);
    const derivedState =
      deriveMasterStateFromActions(group.actions, group.master) || masterAction.master || null;
    if (derivedState) {
      masterAction.master = derivedState;
      if (group.master.hasBrightness && typeof derivedState.brightness === "number") {
        masterAction.value = clampChannelValue(derivedState.brightness);
      }
      if (group.master.hasWhite && typeof derivedState.white === "number") {
        masterAction.master.white = clampChannelValue(derivedState.white);
      }
    }
    masterAction.channel = getMasterPrimaryChannel(group.master);
    collapsed.push(masterAction);
  });

  return [...remaining, ...collapsed];
}

function normalizeTemplateLoop(raw) {
  const normalized = { ...TEMPLATE_LOOP_DEFAULTS };
  if (!raw || typeof raw !== "object") {
    return normalized;
  }
  if (raw.enabled === true) {
    normalized.enabled = true;
  }
  if (raw.infinite === true) {
    normalized.infinite = true;
  }
  const countValue = Number.parseInt(raw.count, 10);
  if (Number.isFinite(countValue)) {
    normalized.count = clamp(countValue, 1, 9999);
  }
  const durationValue = Number.parseFloat(raw.duration);
  if (Number.isFinite(durationValue)) {
    normalized.duration = Math.max(0, Number(durationValue.toFixed(6)));
  }
  const modeValue = typeof raw.mode === "string" ? raw.mode.toLowerCase() : "";
  if (modeValue === "pingpong" || modeValue === "ping-pong") {
    normalized.mode = "pingpong";
  }
  if (Array.isArray(raw.channels)) {
    const unique = new Set();
    raw.channels.forEach((value) => {
      const numeric = Number.parseInt(value, 10);
      if (Number.isFinite(numeric)) {
        unique.add(clamp(numeric, 1, 512));
      }
    });
    if (unique.size) {
      normalized.channels = Array.from(unique).sort((a, b) => a - b);
    }
  }
  return normalized;
}

function sanitizeTemplateLoop(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return normalizeTemplateLoop(raw);
}

function cloneTemplateLoopSettings(loop) {
  if (!loop) return null;
  const normalized = normalizeTemplateLoop(loop);
  return { ...normalized };
}

function shouldSerializeTemplateLoop(loop) {
  if (!loop) return false;
  const normalized = normalizeTemplateLoop(loop);
  if (normalized.duration <= 0) {
    return false;
  }
  return Boolean(normalized.enabled || normalized.infinite);
}

function initChannelFilterUI() {
  if (channelFilterButton instanceof HTMLButtonElement) {
    channelFilterButton.addEventListener("click", () => {
      toggleChannelFilter();
    });
    channelFilterButton.addEventListener("pointerenter", (event) => {
      if (
        event &&
        typeof event.pointerType === "string" &&
        event.pointerType === "mouse" &&
        !channelFilterOpen
      ) {
        openChannelFilter();
      }
    });
  }

  if (channelFilterClearButton instanceof HTMLButtonElement) {
    channelFilterClearButton.addEventListener("click", () => {
      clearChannelFilter();
    });
  }

  document.addEventListener("pointerdown", handleChannelFilterPointerDown);
  document.addEventListener("keydown", handleChannelFilterKeydown);
  renderChannelFilterControls();
}

function openChannelFilter() {
  if (channelFilterOpen) {
    return;
  }
  channelFilterOpen = true;
  renderChannelFilterControls();
  if (channelFilterDropdown instanceof HTMLElement) {
    channelFilterDropdown.hidden = false;
    channelFilterDropdown.setAttribute("aria-hidden", "false");
  }
  if (channelFilterButton instanceof HTMLButtonElement) {
    channelFilterButton.setAttribute("aria-expanded", "true");
  }
  if (channelFilterContainer instanceof HTMLElement) {
    channelFilterContainer.classList.add("is-open");
  }
}

function closeChannelFilter() {
  if (!channelFilterOpen) {
    return;
  }
  channelFilterOpen = false;
  if (channelFilterDropdown instanceof HTMLElement) {
    channelFilterDropdown.hidden = true;
    channelFilterDropdown.setAttribute("aria-hidden", "true");
  }
  if (channelFilterButton instanceof HTMLButtonElement) {
    channelFilterButton.setAttribute("aria-expanded", "false");
  }
  if (channelFilterContainer instanceof HTMLElement) {
    channelFilterContainer.classList.remove("is-open");
  }
}

function toggleChannelFilter(forceOpen) {
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : !channelFilterOpen;
  if (shouldOpen) {
    openChannelFilter();
  } else {
    closeChannelFilter();
  }
}

function handleChannelFilterPointerDown(event) {
  if (!channelFilterOpen) {
    return;
  }
  if (!(channelFilterContainer instanceof HTMLElement)) {
    return;
  }
  const target = event?.target;
  if (target instanceof Node && channelFilterContainer.contains(target)) {
    return;
  }
  closeChannelFilter();
}

function handleChannelFilterKeydown(event) {
  if (!channelFilterOpen) {
    return;
  }
  if (!event || event.key !== "Escape") {
    return;
  }
  closeChannelFilter();
  if (channelFilterButton instanceof HTMLButtonElement) {
    try {
      channelFilterButton.focus({ preventScroll: true });
    } catch (error) {
      channelFilterButton.focus();
    }
  }
}

init();

async function init() {
  initTabs();
  initSystemControls();
  initChannelFilterUI();
  try {
    await initColorPresetsUI();
  } catch (error) {
    console.error("Unable to initialize color presets", error);
  }
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

function initSystemControls() {
  const configs = [
    {
      button: systemUpdateButton,
      endpoint: "/system/update",
      confirmMessage: "Pull the latest updates and restart now?",
      pendingMessage: "Updating application…",
      successMessage: "Update applied. The app will restart shortly.",
      errorMessage: "Unable to update the application.",
      disableOnSuccess: true,
    },
    {
      button: systemRestartButton,
      endpoint: "/system/restart",
      confirmMessage: "Restart the Raspberry Pi now?",
      pendingMessage: "Sending restart command…",
      successMessage: "Restart scheduled. The Raspberry Pi will reboot shortly.",
      errorMessage: "Unable to restart the Raspberry Pi.",
      disableOnSuccess: true,
    },
    {
      button: systemShutdownButton,
      endpoint: "/system/shutdown",
      confirmMessage: "Shut down the Raspberry Pi now?",
      pendingMessage: "Sending shutdown command…",
      successMessage: "Shutdown scheduled. The Raspberry Pi will power off shortly.",
      errorMessage: "Unable to shut down the Raspberry Pi.",
      disableOnSuccess: true,
    },
  ];

  configs.forEach((config) => {
    const { button } = config;
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    button.addEventListener("click", () => {
      requestSystemAction(button, config);
    });
  });
}

async function requestSystemAction(button, options = {}) {
  if (!options.endpoint) {
    return;
  }
  if (options.confirmMessage && !window.confirm(options.confirmMessage)) {
    return;
  }

  if (button instanceof HTMLButtonElement) {
    button.disabled = true;
  }

  if (options.pendingMessage) {
    showStatus(options.pendingMessage, "info");
  }

  try {
    const response = await fetchApi(options.endpoint, { method: "POST" });
    let payload = {};
    try {
      payload = await response.json();
    } catch (error) {
      payload = {};
    }
    if (!response.ok) {
      const message = payload.error || options.errorMessage || "Unable to perform action.";
      throw new Error(message);
    }
    const message = payload.message || options.successMessage || "Action scheduled.";
    showStatus(message, "success");
    if (button instanceof HTMLButtonElement && !options.disableOnSuccess) {
      button.disabled = false;
    }
  } catch (error) {
    console.error(error);
    const fallback = error?.message || options.errorMessage || "Unable to perform action.";
    showStatus(fallback, "error");
    if (button instanceof HTMLButtonElement) {
      button.disabled = false;
    }
  }
}

function setActiveTab(tab) {
  const normalized = tab || "timeline";
  if (normalized === activeTab) {
    return;
  }
  const previousTab = activeTab;
  activeTab = normalized;
  if (previousTab === "templates" && normalized !== "templates" && activeLightTemplateId) {
    activeLightTemplateId = null;
    renderLightTemplates();
  }
  updateTabSelection();
  updateWorkspaceVisibility();
  queuePreviewSync();
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

function scrollStepIntoView(stepId, options = {}) {
  if (!stepId || !actionsBody) {
    return;
  }

  const target = actionsBody.querySelector(`[data-group-id="${stepId}"]`);
  if (!target) {
    return;
  }

  const containerOption = options.container;
  let container = null;
  if (containerOption instanceof HTMLElement) {
    container = containerOption;
  } else if (actionsTableWrapper instanceof HTMLElement) {
    container = actionsTableWrapper;
  }

  const behavior = options.behavior || "smooth";

  if (container) {
    const containerRect =
      typeof container.getBoundingClientRect === "function"
        ? container.getBoundingClientRect()
        : null;
    const targetRect =
      typeof target.getBoundingClientRect === "function" ? target.getBoundingClientRect() : null;

    if (containerRect && targetRect) {
      const margin =
        typeof options.margin === "number" && Number.isFinite(options.margin)
          ? options.margin
          : 16;
      const topDelta = targetRect.top - containerRect.top - margin;
      const bottomDelta = targetRect.bottom - containerRect.bottom + margin;

      if (topDelta < 0) {
        if (typeof container.scrollBy === "function") {
          container.scrollBy({ top: topDelta, behavior });
        } else {
          container.scrollTop += topDelta;
        }
        return;
      }

      if (bottomDelta > 0) {
        if (typeof container.scrollBy === "function") {
          container.scrollBy({ top: bottomDelta, behavior });
        } else {
          container.scrollTop += bottomDelta;
        }
        return;
      }

      return;
    }
  }

  try {
    target.scrollIntoView({
      behavior,
      block: options.block || "nearest",
      inline: "nearest",
    });
  } catch (error) {
    target.scrollIntoView();
  }
}

function handleAddStep() {
  const time = getCurrentVideoTimecode();
  const stepId = generateStepId();
  collapsedStepIds.delete(stepId);
  const result = addAction(
    { time },
    {
      stepId,
      focusDescriptor: { kind: "group", groupId: stepId, field: "step-time" },
    },
  );
  if (result && result.stepId) {
    window.requestAnimationFrame(() => {
      scrollStepIntoView(result.stepId, { behavior: "smooth" });
    });
  }
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
  const shouldResumeVideo = Boolean(videoEl && !videoEl.paused);
  previewActivationPromise = (async () => {
    try {
      await syncPreview({ force: true, showError: true });
      if (!currentVideo || currentVideo.id !== targetVideoId) {
        return false;
      }
      previewMode = true;
      if (shouldResumeVideo) {
        playVideoSilently();
      }
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
    if (shouldPreviewActiveTemplateOnly()) {
      prepared = prepareTemplatePreviewActions(activeLightTemplateId);
    } else {
      prepared = prepareActionsForSave();
    }
  } catch (error) {
    if (options.showError) {
      showStatus(error.message || "Unable to update preview.", "error");
    }
    throw error;
  }
  const blackoutChannels = collectChannelsForBlackout({
    templateId: shouldPreviewActiveTemplateOnly() ? activeLightTemplateId : null,
  });
  const preparedWithBlackout = prependBlackoutActions(prepared, blackoutChannels);
  try {
    await sendPreview(preparedWithBlackout);
  } catch (error) {
    if (options.showError) {
      showStatus(error.message || "Unable to update preview.", "error");
    }
    throw error;
  }
}

function shouldPreviewActiveTemplateOnly() {
  return activeTab === "templates" && Boolean(activeLightTemplateId);
}

function prepareTemplatePreviewActions(templateId) {
  if (!templateId) {
    return [];
  }
  const template = getLightTemplate(templateId);
  if (!template) {
    return [];
  }
  const { entries, totalDuration } = buildTemplateTimeline(template);
  if (!entries.length) {
    return [];
  }

  const previewActions = [];
  const duration = Number.isFinite(totalDuration) ? Number(totalDuration) : 0;
  const hasDuration = duration > 0;
  let loopCount = 1;
  if (hasDuration) {
    const targetSeconds = 12;
    const maxLoops = 6;
    loopCount = Math.max(2, Math.min(maxLoops, Math.ceil(targetSeconds / duration)));
  }

  for (let iteration = 0; iteration < loopCount; iteration += 1) {
    const baseOffset = hasDuration ? duration * iteration : 0;
    entries.forEach(({ row, offset }) => {
      if (!row || row.type === TEMPLATE_ROW_TYPES.DELAY) {
        return;
      }
      const channelValue = Number.parseInt(row.channel, 10);
      const valueValue = Number.parseInt(row.value, 10);
      const fadeValue = Number.parseFloat(row.fade);
      const channel = clamp(Number.isFinite(channelValue) ? channelValue : 1, 1, 512);
      const value = clamp(Number.isFinite(valueValue) ? valueValue : 0, 0, 255);
      const normalizedFade = Number.isFinite(fadeValue) ? Math.max(0, fadeValue) : 0;
      const seconds = Number(((baseOffset + offset) || 0).toFixed(6));
      previewActions.push({
        time: secondsToTimecode(seconds),
        channel,
        value,
        fade: Number(normalizedFade.toFixed(3)),
      });
    });
  }

  return sortActions(previewActions);
}

function collectChannelsForBlackout(options = {}) {
  const unique = new Set();

  if (Array.isArray(channelPresets)) {
    channelPresets.forEach((preset) => {
      const channelNumber = Number.parseInt(preset?.channel, 10);
      if (Number.isFinite(channelNumber)) {
        unique.add(clamp(channelNumber, 1, 512));
      }
    });
  }

  if (Array.isArray(actions)) {
    actions.forEach((action) => {
      const channelNumber = Number.parseInt(action?.channel, 10);
      if (Number.isFinite(channelNumber)) {
        unique.add(clamp(channelNumber, 1, 512));
      }
    });
  }

  if (options.templateId) {
    const template = getLightTemplate(options.templateId);
    const templateChannels = collectTemplateChannels(template);
    templateChannels.forEach((channel) => {
      unique.add(clamp(channel, 1, 512));
    });
  }

  const channels = Array.from(unique).sort((a, b) => a - b);
  if (channels.length) {
    return channels;
  }

  const fallback = [];
  for (let channel = 1; channel <= 512; channel += 1) {
    fallback.push(channel);
  }
  return fallback;
}

function createBlackoutActionsForChannels(channels, timecode = DEFAULT_ACTION.time) {
  if (!Array.isArray(channels) || !channels.length) {
    return [];
  }
  const unique = [];
  const seen = new Set();
  channels.forEach((value) => {
    const channelNumber = Number.parseInt(value, 10);
    if (!Number.isFinite(channelNumber)) {
      return;
    }
    const clamped = clamp(channelNumber, 1, 512);
    if (!seen.has(clamped)) {
      seen.add(clamped);
      unique.push(clamped);
    }
  });
  if (!unique.length) {
    return [];
  }
  const normalizedTime = typeof timecode === "string" && timecode ? timecode : DEFAULT_ACTION.time;
  return unique.sort((a, b) => a - b).map((channel) => ({
    time: normalizedTime,
    channel,
    value: 0,
    fade: 0,
  }));
}

function prependBlackoutActions(actionsList, channels, timecode = DEFAULT_ACTION.time) {
  const source = Array.isArray(actionsList) ? [...actionsList] : [];
  const blackout = createBlackoutActionsForChannels(channels, timecode);
  if (!blackout.length) {
    return source;
  }
  return [...blackout, ...source];
}

async function sendPreview(preparedActions) {
  if (!currentVideo) {
    throw new Error("Select a song before using live preview.");
  }
  const hasVideo = videoEl && Number.isFinite(videoEl.currentTime);
  const startTime = hasVideo ? Math.max(0, videoEl.currentTime) : 0;
  const isPaused = videoEl ? Boolean(videoEl.paused) : true;
  const response = await fetchApi(`/dmx/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      video_id: currentVideo.id,
      actions: preparedActions,
      start_time: startTime,
      paused: isPaused,
      template_preview: shouldPreviewActiveTemplateOnly(),
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
  queuePreviewSync();
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
    actions = collapseMasterActions(actions);
    actions.forEach((action) => {
      if (action.templateLoop) {
        action.templateLoop = normalizeTemplateLoop(action.templateLoop);
      }
    });
    actions.forEach(ensureActionLocalId);
    seedTemplateInstanceCounter(actions);
    assignStepIdsForActions(actions);
    if (actions.length) {
      const seenStepIds = new Set();
      actions.forEach((action) => {
        const id = getActionStepId(action);
        if (id && !seenStepIds.has(id)) {
          collapsedStepIds.add(id);
          seenStepIds.add(id);
        }
      });
    }
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
    await setVideoSource(videoUrl);
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

    if (action.channelMasterId) {
      const master = getChannelMaster(action.channelMasterId);
      if (master) {
        ensureMasterState(action, master);
      } else {
        action.channelMasterId = null;
        action.master = null;
      }
      return;
    }

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
      preset = getSortedChannelPresets()[0] || null;
    }

    if (preset) {
      applyChannelPresetToAction(action, preset);
    } else {
      action.channelPresetId = null;
      action.valuePresetId = null;
    }
  });
}

function renderActions(options = {}) {
  const focusDescriptor =
    options.preserveFocus || describeFocusedActionField(document.activeElement);

  refreshChannelMasters();
  actions = sortActions(actions);
  if (!actionsBody) return;
  actionsBody.innerHTML = "";
  actionGroupIds = new Array(actions.length).fill(null);
  stepInfoById = new Map();

  if (!actions.length) {
    const emptyRow = document.createElement("div");
    emptyRow.className = "actions-grid__empty empty-state";
    emptyRow.textContent = "No steps yet. Use “Add Step” to begin.";
    actionsBody.append(emptyRow);
    collapsedStepIds.clear();
    updateActiveActionHighlight(lastKnownTimelineSeconds);
    return;
  }

  const channelLookup = buildChannelFilterLookup();
  const filterActive = isChannelFilterActive();

  const groupsInOrder = [];
  const groupLookup = new Map();

  actions.forEach((action, index) => {
    const stepId = getActionStepId(action);
    const timeValue = action.time || DEFAULT_ACTION.time;
    const actionTitle = typeof action.stepTitle === "string" ? action.stepTitle : "";
    actionGroupIds[index] = stepId;
    let group = groupLookup.get(stepId);
    if (!group) {
      group = { id: stepId, time: timeValue, title: actionTitle, items: [] };
      groupLookup.set(stepId, group);
      groupsInOrder.push(group);
    }
    if (!group.items.length) {
      group.time = timeValue;
    }
    if (!group.title && actionTitle) {
      group.title = actionTitle;
    }
    if (group.title && action.stepTitle !== group.title) {
      action.stepTitle = group.title;
    }
    group.items.push({ action, index });
  });

  groupsInOrder.forEach((group) => {
    const indices = group.items.map((item) => item.index);
    stepInfoById.set(group.id, {
      id: group.id,
      time: group.time,
      title: group.title || "",
      indices,
    });
  });

  const activeGroups = new Set();
  let displayedGroupCount = 0;

  groupsInOrder.forEach((group) => {
    activeGroups.add(group.id);
    const itemsToRender = filterActive
      ? group.items.filter(({ action }) => doesActionMatchChannelFilter(action, channelLookup))
      : group.items;

    if (filterActive && !itemsToRender.length) {
      return;
    }

    displayedGroupCount += 1;
    const collapsed = collapsedStepIds.has(group.id);
    const visibleCount = getGroupDisplayCount(itemsToRender);
    const headerRow = createGroupHeaderRow(group, collapsed, visibleCount, itemsToRender);
    actionsBody.append(headerRow);

    if (!collapsed) {
      const templateCounts = new Map();
      itemsToRender.forEach(({ action }) => {
        if (action.templateInstanceId) {
          const key = action.templateInstanceId;
          templateCounts.set(key, (templateCounts.get(key) || 0) + 1);
        }
      });

      const renderedTemplateInstances = new Set();
      itemsToRender.forEach(({ action, index }) => {
        if (action.templateId && action.templateInstanceId) {
          if (renderedTemplateInstances.has(action.templateInstanceId)) {
            return;
          }
          const templateRow = createTemplateInstanceRow(
            group,
            action,
            index,
            templateCounts.get(action.templateInstanceId) || 0,
          );
          actionsBody.append(templateRow);
          renderedTemplateInstances.add(action.templateInstanceId);
          return;
        }
        const row = createActionRow(action, index, group);
        actionsBody.append(row);
      });
    }
  });

  if (displayedGroupCount === 0 && actions.length) {
    const emptyRow = document.createElement("div");
    emptyRow.className = "actions-grid__empty empty-state channel-filter__no-results";
    const message = document.createElement("span");
    message.textContent = "No steps match the current channel filter.";
    emptyRow.append(message);
    if (filterActive) {
      const clearButton = document.createElement("button");
      clearButton.type = "button";
      clearButton.className = "secondary channel-filter__empty-button";
      clearButton.textContent = "Clear filter";
      clearButton.addEventListener("click", () => {
        clearChannelFilter();
      });
      emptyRow.append(clearButton);
    }
    actionsBody.append(emptyRow);
  }

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

function getGroupDisplayCount(items) {
  if (!Array.isArray(items)) {
    return 0;
  }
  const seenInstances = new Set();
  let total = 0;
  items.forEach(({ action }) => {
    if (action && action.templateId && action.templateInstanceId) {
      if (!seenInstances.has(action.templateInstanceId)) {
        seenInstances.add(action.templateInstanceId);
        total += 1;
      }
    } else {
      total += 1;
    }
  });
  return total;
}

function createGroupHeaderRow(group, collapsed, displayCount, itemsForHeader = group.items) {
  const row = document.createElement("div");
  row.className = "actions-grid__row action-group-header";
  row.setAttribute("role", "row");
  row.dataset.groupId = group.id;
  row.dataset.groupTime = group.time;

  const cell = document.createElement("div");
  cell.className = "actions-grid__cell";
  cell.dataset.column = "content";

  const content = document.createElement("div");
  content.className = "action-group-header__content";

  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "action-group-header__toggle";
  toggleButton.setAttribute("aria-expanded", String(!collapsed));
  toggleButton.dataset.groupId = group.id;
  const referenceItems = Array.isArray(itemsForHeader) && itemsForHeader.length
    ? itemsForHeader
    : group.items;

  toggleButton.addEventListener("click", () => toggleGroupCollapsed(group.id));
  toggleButton.addEventListener("focus", () => {
    const firstIndex = referenceItems[0]?.index;
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
    const firstIndex = referenceItems[0]?.index;
    if (Number.isInteger(firstIndex)) {
      setHighlightedAction(firstIndex);
    } else {
      setHighlightedStep(group.id);
    }
  });

  const titleInput = createInput({
    type: "text",
    value: group.title || "",
    placeholder: "Step title",
  });
  titleInput.classList.add("action-group-header__title-input");
  titleInput.dataset.groupId = group.id;
  titleInput.dataset.field = "step-title";
  titleInput.addEventListener("input", (event) => handleStepTitleInput(event, group.id));
  titleInput.addEventListener("blur", (event) => handleStepTitleBlur(event, group.id));
  titleInput.addEventListener("focus", () => {
    const firstIndex = referenceItems[0]?.index;
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
  const count = Number.isFinite(displayCount)
    ? displayCount
    : referenceItems.length;
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

  content.append(toggleButton, timeInput, titleInput, actionsContainer);
  cell.append(content);
  row.append(cell);

  row.addEventListener("dragover", (event) => handleGroupHeaderDragOver(event, group.id));
  row.addEventListener("dragleave", handleGroupHeaderDragLeave);
  row.addEventListener("drop", (event) => handleGroupHeaderDrop(event, group.id));

  return row;
}

function createTemplateLoopControls(instanceId, groupId, loop, options = {}) {
  const normalized = normalizeTemplateLoop(loop);
  const container = document.createElement("div");
  container.className = "template-loop-controls";
  container.dataset.role = "template-loop-controls";
  if (instanceId) {
    container.dataset.templateInstanceId = instanceId;
  }
  const allowLoop = options.allowLoop !== false;
  container.dataset.loopAllowed = allowLoop ? "true" : "false";
  const durationValue = Number.isFinite(options.duration)
    ? Math.max(0, Number(options.duration.toFixed(6)))
    : normalized.duration;
  if (Number.isFinite(durationValue)) {
    container.dataset.loopDuration = String(durationValue);
  }

  const toggleLabel = document.createElement("label");
  toggleLabel.className = "template-loop__toggle";

  const toggleInput = document.createElement("input");
  toggleInput.type = "checkbox";
  toggleInput.checked = normalized.enabled;
  toggleInput.dataset.templateInstanceId = instanceId || "";
  toggleInput.dataset.groupId = groupId;
  toggleInput.dataset.field = "template-loop-enabled";
  toggleInput.addEventListener("change", handleTemplateLoopToggle);

  const toggleText = document.createElement("span");
  toggleText.textContent = "Loop";

  toggleLabel.append(toggleInput, toggleText);

  const optionsContainer = document.createElement("div");
  optionsContainer.className = "template-loop__options";

  const countLabel = document.createElement("label");
  countLabel.className = "template-loop__count-label";

  const countText = document.createElement("span");
  countText.textContent = "Times";

  const countInput = createInput({ type: "number", value: normalized.count, min: 1, step: 1 });
  countInput.classList.add("template-loop__count");
  countInput.dataset.templateInstanceId = instanceId || "";
  countInput.dataset.groupId = groupId;
  countInput.dataset.field = "template-loop-count";
  countInput.addEventListener("change", handleTemplateLoopCountChange);

  countLabel.append(countText, countInput);

  const infiniteLabel = document.createElement("label");
  infiniteLabel.className = "template-loop__infinite";

  const infiniteInput = document.createElement("input");
  infiniteInput.type = "checkbox";
  infiniteInput.checked = normalized.infinite;
  infiniteInput.dataset.templateInstanceId = instanceId || "";
  infiniteInput.dataset.groupId = groupId;
  infiniteInput.dataset.field = "template-loop-infinite";
  infiniteInput.addEventListener("change", handleTemplateLoopInfiniteChange);

  const infiniteText = document.createElement("span");
  infiniteText.textContent = "Infinite";

  infiniteLabel.append(infiniteInput, infiniteText);

  const modeLabel = document.createElement("label");
  modeLabel.className = "template-loop__mode";

  const modeText = document.createElement("span");
  modeText.textContent = "Mode";

  const modeSelect = document.createElement("select");
  modeSelect.dataset.templateInstanceId = instanceId || "";
  modeSelect.dataset.groupId = groupId;
  modeSelect.dataset.field = "template-loop-mode";
  [
    { value: "forward", label: "Forward" },
    { value: "pingpong", label: "Ping-pong" },
  ].forEach((optionData) => {
    const option = document.createElement("option");
    option.value = optionData.value;
    option.textContent = optionData.label;
    modeSelect.append(option);
  });
  modeSelect.value = normalized.mode;
  modeSelect.addEventListener("change", handleTemplateLoopModeChange);

  modeLabel.append(modeText, modeSelect);

  optionsContainer.append(countLabel, infiniteLabel, modeLabel);

  container.append(toggleLabel, optionsContainer);
  updateTemplateLoopControlsState(container, normalized);
  return container;
}

function updateTemplateLoopControlsState(container, loop) {
  if (!container) return;
  const normalized = normalizeTemplateLoop(loop);
  const allowLoop = container.dataset.loopAllowed !== "false";
  const storedDuration = Number.parseFloat(container.dataset.loopDuration || "");
  if (Number.isFinite(storedDuration) && storedDuration > 0) {
    normalized.duration = storedDuration;
  }
  const loopsAvailable = allowLoop && normalized.duration > 0;
  const enabled = loopsAvailable && normalized.enabled;
  const infinite = loopsAvailable && normalized.infinite;
  const toggle = container.querySelector('[data-field="template-loop-enabled"]');
  const countInput = container.querySelector('[data-field="template-loop-count"]');
  const infiniteInput = container.querySelector('[data-field="template-loop-infinite"]');
  const modeSelect = container.querySelector('[data-field="template-loop-mode"]');
  if (toggle instanceof HTMLInputElement) {
    toggle.checked = enabled;
    toggle.disabled = !loopsAvailable;
    toggle.title = loopsAvailable ? "" : "Add a delay to enable looping";
  }
  if (countInput instanceof HTMLInputElement) {
    countInput.value = String(normalized.count);
    countInput.disabled = !enabled || infinite;
  }
  if (infiniteInput instanceof HTMLInputElement) {
    infiniteInput.checked = infinite;
    infiniteInput.disabled = !enabled;
  }
  if (modeSelect instanceof HTMLSelectElement) {
    modeSelect.value = normalized.mode;
    modeSelect.disabled = !enabled;
  }
  if (!loopsAvailable) {
    container.classList.add("template-loop-controls--disabled");
  } else {
    container.classList.remove("template-loop-controls--disabled");
  }
}

function updateTemplateLoopDisplays(instanceId, loop) {
  if (!instanceId || !actionsBody) return;
  const normalized = normalizeTemplateLoop(loop);
  const rows = actionsBody.querySelectorAll(
    `.action-group-template[data-template-instance-id="${instanceId}"]`,
  );
  rows.forEach((row) => {
    const summary = row.querySelector('[data-role="template-loop-summary"]');
    if (summary) {
      summary.textContent = formatTemplateLoopSummary(normalized);
    }
    const controls = row.querySelector('[data-role="template-loop-controls"]');
    if (controls instanceof HTMLElement) {
      if (Number.isFinite(normalized.duration)) {
        controls.dataset.loopDuration = String(normalized.duration);
      }
      updateTemplateLoopControlsState(controls, normalized);
    }
  });
}

function updateTemplateInstanceLoop(instanceId, updater) {
  if (!instanceId || typeof updater !== "function") return;
  const info = getTemplateInstanceInfo(instanceId);
  if (!info || !Array.isArray(info.indices) || !info.indices.length) return;
  const firstAction = actions[info.indices[0]];
  const current = normalizeTemplateLoop(firstAction?.templateLoop);
  const nextState = updater({ ...current });
  const normalized = normalizeTemplateLoop(nextState);
  const template = info.templateId ? getLightTemplate(info.templateId) : null;
  const timeline = template ? buildTemplateTimeline(template) : null;
  const totalDuration = timeline ? Number(timeline.totalDuration || 0) : 0;
  if (template) {
    const channels = collectTemplateChannels(template);
    if (channels.length) {
      normalized.channels = channels;
    } else {
      delete normalized.channels;
    }
  } else {
    delete normalized.channels;
  }
  if (totalDuration > 0) {
    normalized.duration = Number(totalDuration.toFixed(6));
  } else {
    normalized.duration = 0;
    normalized.enabled = false;
    normalized.infinite = false;
  }
  info.indices.forEach((actionIndex) => {
    if (!actions[actionIndex]) return;
    actions[actionIndex].templateLoop = { ...normalized };
  });
  updateTemplateLoopDisplays(instanceId, normalized);
  queuePreviewSync();
}

function handleTemplateLoopToggle(event) {
  const { templateInstanceId } = event.target.dataset || {};
  if (!templateInstanceId) return;
  const enabled = event.target.checked;
  updateTemplateInstanceLoop(templateInstanceId, (loop) => {
    loop.enabled = enabled;
    if (!enabled) {
      loop.infinite = false;
    }
    return loop;
  });
}

function handleTemplateLoopCountChange(event) {
  const { templateInstanceId } = event.target.dataset || {};
  if (!templateInstanceId) return;
  const rawValue = Number.parseInt(event.target.value, 10);
  updateTemplateInstanceLoop(templateInstanceId, (loop) => {
    const sanitized = Number.isFinite(rawValue) ? clamp(rawValue, 1, 9999) : 1;
    loop.count = sanitized;
    return loop;
  });
}

function handleTemplateLoopInfiniteChange(event) {
  const { templateInstanceId } = event.target.dataset || {};
  if (!templateInstanceId) return;
  const infinite = event.target.checked;
  updateTemplateInstanceLoop(templateInstanceId, (loop) => {
    loop.infinite = infinite;
    if (infinite && !loop.enabled) {
      loop.enabled = true;
    }
    return loop;
  });
}

function handleTemplateLoopModeChange(event) {
  const { templateInstanceId } = event.target.dataset || {};
  if (!templateInstanceId) return;
  const value = (event.target.value || "").toLowerCase();
  updateTemplateInstanceLoop(templateInstanceId, (loop) => {
    loop.mode = value === "pingpong" || value === "ping-pong" ? "pingpong" : "forward";
    return loop;
  });
}

function createTemplateInstanceRow(group, action, index, count) {
  const actionId = getActionLocalId(action);
  const row = document.createElement("div");
  row.className =
    "actions-grid__row action-group-item action-group-template action-group-item--template";
  row.setAttribute("role", "row");
  row.dataset.groupId = group.id;
  row.dataset.groupTime = group.time;
  row.dataset.actionIndex = String(index);
  row.dataset.templateId = action.templateId || "";
  if (action.templateInstanceId) {
    row.dataset.templateInstanceId = action.templateInstanceId;
  }

  row.addEventListener("focusin", () => {
    setHighlightedAction(index);
    seekToIndex(index);
  });
  row.addEventListener("dragover", handleRowDragOver);
  row.addEventListener("dragleave", handleRowDragLeave);
  row.addEventListener("drop", handleRowDrop);

  const handleCell = document.createElement("div");
  handleCell.className = "actions-grid__cell actions-grid__cell--handle";
  handleCell.dataset.column = "handle";
  const dragHandle = createDragHandle(row, index);
  handleCell.append(dragHandle);
  row.append(handleCell);

  const cell = document.createElement("div");
  cell.className = "actions-grid__cell actions-grid__cell--template";
  cell.dataset.column = "content";

  const content = document.createElement("div");
  content.className = "action-group-template__content";

  const details = document.createElement("div");
  details.className = "action-group-template__details";

  const title = document.createElement("span");
  title.className = "action-group-template__title";
  const template = getLightTemplate(action.templateId);
  title.textContent = template ? formatLightTemplateTitle(template) : "Template";

  const countEl = document.createElement("span");
  countEl.className = "action-group-template__count";
  if (template) {
    countEl.textContent = formatTemplateRowCount(template);
  } else {
    const total = Number.isFinite(count) ? count : group.items.length;
    countEl.textContent = `${total} row${total === 1 ? "" : "s"}`;
  }

  const loopSummary = document.createElement("span");
  loopSummary.className = "action-group-template__loop-summary";
  loopSummary.dataset.role = "template-loop-summary";
  const loop = normalizeTemplateLoop(action.templateLoop);
  const timeline = template ? buildTemplateTimeline(template) : null;
  const totalDuration = timeline ? Number(timeline.totalDuration || 0) : 0;
  if (totalDuration > 0) {
    loop.duration = Number(totalDuration.toFixed(6));
  } else {
    loop.duration = 0;
  }
  loopSummary.textContent = formatTemplateLoopSummary(loop);

  details.append(title, countEl, loopSummary);

  const tools = document.createElement("div");
  tools.className = "action-group-template__tools";

  const goButton = document.createElement("button");
  goButton.type = "button";
  setActionFieldMetadata(goButton, actionId, "template-go");
  goButton.addEventListener("click", () => seekToIndex(index));
  goButton.addEventListener("focus", () => setHighlightedAction(index));
  applyIconButton(goButton, "go", "Go to this template step");

  const duplicateButton = document.createElement("button");
  duplicateButton.type = "button";
  setActionFieldMetadata(duplicateButton, actionId, "template-duplicate");
  duplicateButton.addEventListener("click", () => duplicateTemplateInstance(action.templateInstanceId));
  duplicateButton.addEventListener("focus", () => setHighlightedAction(index));
  applyIconButton(duplicateButton, "duplicate", "Duplicate template instance");

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  setActionFieldMetadata(deleteButton, actionId, "template-delete");
  deleteButton.addEventListener("click", () => removeTemplateInstance(action.templateInstanceId));
  deleteButton.addEventListener("focus", () => setHighlightedAction(index));
  applyIconButton(deleteButton, "delete", "Delete template instance");

  const editButton = document.createElement("button");
  editButton.type = "button";
  setActionFieldMetadata(editButton, actionId, "template-edit");
  editButton.addEventListener("click", () => handleEditTemplateFromTimeline(action.templateId));
  editButton.addEventListener("focus", () => setHighlightedAction(index));
  applyIconButton(editButton, "edit", "Edit template");

  tools.append(goButton, duplicateButton, deleteButton, editButton);

  const loopControls = createTemplateLoopControls(
    action.templateInstanceId || "",
    group.id,
    loop,
    {
      allowLoop: totalDuration > 0,
      duration: totalDuration,
    },
  );

  content.append(details, loopControls, tools);
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

  row.addEventListener("focusin", () => {
    setHighlightedAction(index);
    seekToIndex(index);
  });
  row.addEventListener("dragover", handleRowDragOver);
  row.addEventListener("dragleave", handleRowDragLeave);
  row.addEventListener("drop", handleRowDrop);

  const dragHandle = createDragHandle(row, index);
  appendToColumn(row, "handle", dragHandle);

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
  fadeInput.classList.add("input--compact-number");
  setActionFieldMetadata(fadeInput, actionId, "fade");
  fadeInput.addEventListener("change", (event) => handleFadeChange(event, index));
  appendToColumn(row, "fade", fadeInput);

  const toolsCell = row.querySelector('[data-column="tools"]');
  const tools = document.createElement("div");
  tools.className = "row-tools";

  const duplicateButton = document.createElement("button");
  duplicateButton.type = "button";
  duplicateButton.addEventListener("click", () => duplicateAction(index));
  applyIconButton(duplicateButton, "duplicate", "Duplicate cue");

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.addEventListener("click", () => removeAction(index));
  applyIconButton(removeButton, "delete", "Delete cue");

  tools.append(duplicateButton, removeButton);
  if (toolsCell) {
    toolsCell.append(tools);
  }

  return row;
}

function createDragHandle(row, index) {
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "action-row__drag-handle";
  handle.title = "Drag to reorder";
  handle.setAttribute("aria-label", "Drag to reorder");
  handle.draggable = true;

  const icon = document.createElement("span");
  icon.className = "action-row__drag-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "⋮⋮";
  handle.append(icon);

  handle.addEventListener("dragstart", handleRowDragStart);
  handle.addEventListener("dragend", handleRowDragEnd);
  handle.addEventListener("focus", () => setHighlightedAction(index));

  return handle;
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
  if (!draggingActionId && !draggingTemplateInstanceId) return;
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
  if (!draggingActionId && !draggingTemplateInstanceId) return;
  event.preventDefault();
  const row = event.currentTarget;
  row.classList.remove("is-drop-target");
  const groupInfo = stepInfoById.get(stepId);
  const indices = groupInfo?.indices || [];
  const insertionIndex = indices.length ? indices[indices.length - 1] + 1 : actions.length;
  const targetTime = groupInfo?.time || DEFAULT_ACTION.time;
  collapsedStepIds.delete(stepId);
  clearAllDropIndicators();
  if (draggingTemplateInstanceId) {
    placeTemplateInstanceAt(draggingTemplateInstanceId, insertionIndex, {
      targetGroupId: stepId,
      targetTime,
    });
    draggingTemplateInstanceId = null;
    draggingActionId = null;
  } else if (draggingActionId) {
    placeActionAt(draggingActionId, insertionIndex, {
      targetGroupId: stepId,
      targetTime,
    });
    draggingActionId = null;
  }
}

function getDragEventRow(target) {
  if (target instanceof HTMLElement) {
    if (target.matches(".action-group-item")) {
      return target;
    }
    return target.closest(".action-group-item");
  }
  return null;
}

function handleRowDragStart(event) {
  const row = getDragEventRow(event.currentTarget);
  if (!row) return;
  const templateInstanceId = row.dataset.templateInstanceId;
  const actionId = row.dataset.actionId;
  if (templateInstanceId) {
    draggingTemplateInstanceId = templateInstanceId;
    draggingActionId = null;
  } else if (actionId) {
    draggingActionId = actionId;
    draggingTemplateInstanceId = null;
  } else {
    return;
  }
  row.classList.add("is-dragging");
  if (row.dataset.groupId) {
    setHighlightedStep(row.dataset.groupId);
  }
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    const rect = row.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    try {
      event.dataTransfer.setData(
        "text/plain",
        templateInstanceId ? templateInstanceId : actionId,
      );
      event.dataTransfer.setDragImage(row, offsetX, offsetY);
    } catch (error) {
      // Ignore data transfer errors from unsupported browsers.
    }
  }
}

function handleRowDragEnd(event) {
  const row = getDragEventRow(event.currentTarget);
  if (row instanceof HTMLElement) {
    row.classList.remove("is-dragging");
  }
  draggingActionId = null;
  draggingTemplateInstanceId = null;
  clearAllDropIndicators();
}

function handleRowDragOver(event) {
  if (!draggingActionId && !draggingTemplateInstanceId) return;
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
  if (!draggingActionId && !draggingTemplateInstanceId) return;
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
  if (draggingTemplateInstanceId) {
    placeTemplateInstanceAt(draggingTemplateInstanceId, insertionIndex, {
      targetGroupId: groupId,
      targetTime,
    });
    draggingTemplateInstanceId = null;
    draggingActionId = null;
  } else if (draggingActionId) {
    placeActionAt(draggingActionId, insertionIndex, {
      targetGroupId: groupId,
      targetTime,
    });
    draggingActionId = null;
  }
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

function getTemplateDragRow(target) {
  if (target instanceof HTMLElement) {
    if (target.matches(".template-row")) {
      return target;
    }
    return target.closest(".template-row");
  }
  return null;
}

function handleTemplateRowDragStart(event) {
  const row = getTemplateDragRow(event.currentTarget);
  if (!row) return;
  const templateId = row.dataset.templateId;
  const rowId = row.dataset.rowId;
  if (!templateId || !rowId) return;
  clearTemplateRowDropIndicators();
  draggingTemplateRow = { templateId, rowId };
  row.classList.add("is-dragging");
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    const rect = row.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    try {
      event.dataTransfer.setData("text/plain", rowId);
      event.dataTransfer.setDragImage(row, offsetX, offsetY);
    } catch (error) {
      // Ignore unsupported drag image operations.
    }
  }
}

function handleTemplateRowDragEnd(event) {
  const row = getTemplateDragRow(event.currentTarget);
  if (row) {
    row.classList.remove("is-dragging");
  }
  draggingTemplateRow = null;
  clearTemplateRowDropIndicators();
}

function handleTemplateRowDragOver(event) {
  if (!draggingTemplateRow) return;
  const row = event.currentTarget;
  if (!(row instanceof HTMLElement)) return;
  const templateId = row.dataset.templateId;
  const targetRowId = row.dataset.rowId;
  if (
    !templateId ||
    !targetRowId ||
    templateId !== draggingTemplateRow.templateId ||
    targetRowId === draggingTemplateRow.rowId
  ) {
    row.classList.remove("drop-before", "drop-after");
    return;
  }
  event.preventDefault();
  const rect = row.getBoundingClientRect();
  const before = event.clientY - rect.top < rect.height / 2;
  row.classList.toggle("drop-before", before);
  row.classList.toggle("drop-after", !before);
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
}

function handleTemplateRowDragLeave(event) {
  const row = event.currentTarget;
  if (!(row instanceof HTMLElement)) return;
  row.classList.remove("drop-before", "drop-after");
}

function handleTemplateRowDrop(event) {
  if (!draggingTemplateRow) return;
  const row = event.currentTarget;
  if (!(row instanceof HTMLElement)) return;
  const templateId = row.dataset.templateId;
  const targetRowId = row.dataset.rowId;
  if (!templateId || !targetRowId || templateId !== draggingTemplateRow.templateId) {
    return;
  }
  event.preventDefault();
  const sourceRowId = draggingTemplateRow.rowId;
  if (sourceRowId === targetRowId) {
    row.classList.remove("drop-before", "drop-after");
    draggingTemplateRow = null;
    clearTemplateRowDropIndicators();
    return;
  }
  const rect = row.getBoundingClientRect();
  const before = event.clientY - rect.top < rect.height / 2;
  const focusDescriptor = describeFocusedTemplateField(document.activeElement);
  const moved = reorderTemplateRow(templateId, sourceRowId, targetRowId, before);
  draggingTemplateRow = null;
  row.classList.remove("drop-before", "drop-after");
  clearTemplateRowDropIndicators();
  if (moved) {
    renderLightTemplates({ preserveFocus: focusDescriptor });
  }
}

function clearTemplateRowDropIndicators() {
  if (!templateDetailContainer) return;
  templateDetailContainer
    .querySelectorAll(".template-row.drop-before, .template-row.drop-after, .template-row.is-dragging")
    .forEach((element) => {
      element.classList.remove("drop-before", "drop-after", "is-dragging");
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

function placeTemplateInstanceAt(instanceId, insertionIndex, options = {}) {
  if (!instanceId) return;
  const info = getTemplateInstanceInfo(instanceId);
  if (!info) return;

  const removed = [];
  for (let i = info.indices.length - 1; i >= 0; i -= 1) {
    const idx = info.indices[i];
    const [removedAction] = actions.splice(idx, 1);
    if (removedAction) {
      removed.unshift(removedAction);
    }
  }

  if (!removed.length) {
    return;
  }

  let targetIndex = Number.isInteger(insertionIndex) ? insertionIndex : actions.length;
  if (info.firstIndex < targetIndex) {
    targetIndex -= removed.length;
  }
  if (targetIndex < 0) {
    targetIndex = 0;
  }
  if (targetIndex > actions.length) {
    targetIndex = actions.length;
  }

  const targetGroupId = options.targetGroupId || info.stepId;
  const timeCandidate = options.targetTime || info.time || DEFAULT_ACTION.time;
  const targetSeconds =
    parseTimeString(timeCandidate) ??
    parseTimeString(info.time) ??
    parseTimeString(DEFAULT_ACTION.time) ??
    0;
  const targetTimecode = secondsToTimecode(targetSeconds);

  removed.forEach((action) => {
    setActionStepId(action, targetGroupId);
    action.time = targetTimecode;
  });

  actions.splice(targetIndex, 0, ...removed);
  renderActions();
  const newIndex = actions.findIndex((action) => action.templateInstanceId === instanceId);
  if (newIndex !== -1) {
    setHighlightedAction(newIndex);
  } else if (targetGroupId) {
    setHighlightedStep(targetGroupId);
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
  if (!stageVisualizerEl) return;
  const channelStates = computeChannelStatesAtTime(seconds);
  updateStageVisualizer(channelStates);
}

function computeChannelStatesAtTime(targetSeconds) {
  if (!actions.length) return [];
  const epsilon = 0.001;
  const maxTime = targetSeconds + epsilon;
  const timeline = [];

  actions.forEach((action, index) => {
    const baseSeconds = parseTimeString(action.time);
    if (baseSeconds === null || baseSeconds > maxTime) {
      return;
    }

    const pushTimelineEntry = (seconds, iteration) => {
      if (seconds - targetSeconds > epsilon) {
        return;
      }
      timeline.push({ action, index, seconds, iteration });
    };

    pushTimelineEntry(baseSeconds, 0);

    const loop = action.templateLoop ? normalizeTemplateLoop(action.templateLoop) : null;
    const loopDuration = loop ? Number(loop.duration || 0) : 0;
    const loopActive = Boolean(
      loop && loopDuration > 0 && (loop.enabled || loop.infinite),
    );
    if (!loopActive) {
      return;
    }

    const totalIterations = loop.infinite ? Infinity : Math.max(loop.count || 0, 1);
    const maxIterationByTime = Math.floor((maxTime - baseSeconds) / loopDuration);
    const maxIteration = loop.infinite
      ? maxIterationByTime
      : Math.min(totalIterations - 1, maxIterationByTime);

    for (let iteration = 1; iteration <= maxIteration; iteration += 1) {
      const seconds = baseSeconds + iteration * loopDuration;
      pushTimelineEntry(seconds, iteration);
    }
  });

  timeline.sort((a, b) => {
    if (a.seconds === b.seconds) {
      if (a.iteration === b.iteration) {
        return a.index - b.index;
      }
      return a.iteration - b.iteration;
    }
    return a.seconds - b.seconds;
  });

  const channelStates = new Map();
  timeline.forEach(({ action, seconds }) => {
    const fadeDuration = normalizeFadeDuration(action.fade);
    if (action.channelMasterId) {
      const master = getChannelMaster(action.channelMasterId);
      if (!master) {
        return;
      }
      const masterState = ensureMasterState(action, master);
      if (!masterState) {
        return;
      }
      const values = buildMasterChannelValues(master, masterState);
      const componentOrder = Array.isArray(master.componentOrder)
        ? master.componentOrder
        : Object.keys(master.presets || {});
      componentOrder.forEach((componentKey) => {
        const preset = master.presets?.[componentKey];
        if (!preset) {
          return;
        }
        const channelNumber = Number.parseInt(preset.channel, 10);
        if (!Number.isFinite(channelNumber) || channelNumber < 1 || channelNumber > 512) {
          return;
        }
        const value = clampChannelValue(values[componentKey] ?? 0);
        applyChannelValueToState(channelStates, channelNumber, value, seconds, fadeDuration, {
          channelPresetId: preset.id,
        });
      });
      return;
    }

    const channelNumber = Number.parseInt(action.channel, 10);
    if (!Number.isFinite(channelNumber) || channelNumber < 1 || channelNumber > 512) {
      return;
    }
    const value = clampChannelValue(action.value);
    const channelPresetId =
      typeof action.channelPresetId === "string" && action.channelPresetId ? action.channelPresetId : null;
    const valuePresetId =
      typeof action.valuePresetId === "string" && action.valuePresetId ? action.valuePresetId : null;
    applyChannelValueToState(channelStates, channelNumber, value, seconds, fadeDuration, {
      channelPresetId,
      valuePresetId,
    });
  });

  const results = [];
  channelStates.forEach((state, channelNumber) => {
    const value = clamp(evaluateChannelStateValue(state, targetSeconds), 0, 255);
    if (value <= 0) {
      return;
    }
    results.push({
      channel: channelNumber,
      value,
      channelPresetId: state.channelPresetId || null,
      valuePresetId: state.valuePresetId || null,
    });
  });

  return results.sort((a, b) => a.channel - b.channel);
}

function normalizeFadeDuration(value) {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Math.max(0, numeric);
}

function ensureChannelState(channelStates, channelNumber) {
  let state = channelStates.get(channelNumber);
  if (!state) {
    state = {
      value: 0,
      fade: null,
      channelPresetId: null,
      valuePresetId: null,
    };
    channelStates.set(channelNumber, state);
  }
  return state;
}

function evaluateChannelStateValue(state, time) {
  if (!state) {
    return 0;
  }
  if (!state.fade) {
    return Number.isFinite(state.value) ? state.value : 0;
  }
  const fade = state.fade;
  if (!Number.isFinite(time)) {
    return fade.startValue;
  }
  if (time <= fade.start) {
    state.value = fade.startValue;
    return state.value;
  }
  if (fade.duration <= 0 || time >= fade.end) {
    state.fade = null;
    state.value = fade.endValue;
    return state.value;
  }
  const progress = clamp((time - fade.start) / fade.duration, 0, 1);
  const nextValue = fade.startValue + (fade.endValue - fade.startValue) * progress;
  state.value = nextValue;
  return nextValue;
}

function applyChannelValueToState(channelStates, channelNumber, targetValue, seconds, fadeDuration, metadata = {}) {
  const state = ensureChannelState(channelStates, channelNumber);
  const startValue = evaluateChannelStateValue(state, seconds);
  const endValue = clamp(targetValue, 0, 255);
  if (fadeDuration > 0 && Math.abs(endValue - startValue) > 0.0001) {
    state.fade = {
      start: seconds,
      duration: fadeDuration,
      startValue,
      endValue,
      end: seconds + fadeDuration,
    };
    state.value = startValue;
  } else {
    state.fade = null;
    state.value = endValue;
  }

  if (Object.prototype.hasOwnProperty.call(metadata, "channelPresetId")) {
    state.channelPresetId = metadata.channelPresetId || null;
  }
  if (Object.prototype.hasOwnProperty.call(metadata, "valuePresetId")) {
    state.valuePresetId = metadata.valuePresetId || null;
  }
}

function updateStageVisualizer(channelStates) {
  if (!stageVisualizerEl) return;
  const stateMap = buildStageStateMap(channelStates);
  let hasOutput = false;
  const activeFixtures = [];
  const inactiveFixtures = [];

  if (stageLightConfig) {
    Object.values(stageLightConfig).forEach((fixture) => {
      const isActive = applyLightBarState(fixture, stateMap);
      if (isActive) {
        hasOutput = true;
        if (fixture.label) {
          activeFixtures.push(fixture.label);
        }
      } else if (fixture.label) {
        inactiveFixtures.push(fixture.label);
      }
    });
  }

  if (moverStageConfig) {
    if (updateMoverStage(moverStageConfig, stateMap)) {
      hasOutput = true;
      if (moverStageConfig.label) {
        activeFixtures.push(moverStageConfig.label);
      }
    } else if (moverStageConfig.label) {
      inactiveFixtures.push(moverStageConfig.label);
    }
  }

  if (stageStatusEl) {
    if (hasOutput) {
      const activeSummary = activeFixtures.length
        ? `Active: ${formatFixtureList(activeFixtures)}`
        : "Fixtures active";
      const idleSummary = inactiveFixtures.length
        ? `Idle: ${formatFixtureList(inactiveFixtures)}`
        : "";
      stageStatusEl.textContent = idleSummary ? `${activeSummary} • ${idleSummary}` : activeSummary;
    } else {
      stageStatusEl.textContent = "All fixtures at blackout.";
    }
  }
  stageVisualizerEl.classList.toggle("is-inactive", !hasOutput);
}

function buildStageStateMap(channelStates) {
  const map = new Map();
  channelStates.forEach((state) => {
    if (!state) return;
    const numericValue = Number(state.value ?? 0);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return;
    }
    const normalizedValue = clamp(numericValue, 0, 255);
    if (typeof state.channelPresetId === "string" && state.channelPresetId) {
      map.set(state.channelPresetId, normalizedValue);
    }
    const channelKey = `channel-${state.channel}`;
    map.set(channelKey, normalizedValue);
  });
  return map;
}

function buildStageLightConfig(root) {
  const fixtures = [
    {
      key: "front",
      label: "Front Light",
      elementId: "light-bar-1",
      prefix: "front-light",
      strobe: "front-light-strobe",
      offsets: [
        { x: 0, y: -20, blur: 20 },
        { x: 0, y: -20, blur: 50 },
        { x: 0, y: -3, blur: 0 },
      ],
    },
    {
      key: "back",
      label: "Back Light",
      elementId: "light-bar-2",
      prefix: "back-light",
      strobe: "back-light-strobe",
      offsets: [{ x: 0, y: 0, blur: 40 }],
    },
    {
      key: "left",
      label: "Left Light",
      elementId: "light-bar-3",
      prefix: "left-light",
      strobe: "left-light-strobe",
      offsets: [
        { x: 0, y: 20, blur: 20 },
        { x: 0, y: 20, blur: 50 },
        { x: 0, y: 3, blur: 0 },
      ],
    },
    {
      key: "right",
      label: "Right Light",
      elementId: "light-bar-4",
      prefix: "right-light",
      strobe: "right-light-strobe",
      offsets: [
        { x: 0, y: 20, blur: 20 },
        { x: 0, y: 20, blur: 50 },
        { x: 0, y: 3, blur: 0 },
      ],
    },
  ];

  const config = {};
  fixtures.forEach((fixture) => {
    const element = root.querySelector(`#${fixture.elementId}`);
    if (!element) {
      return;
    }
    const whiteElement = element.querySelector(".white-color");
    config[fixture.key] = {
      element,
      whiteElement,
      shadow: createShadowBuilder(fixture.offsets),
      label: fixture.label || null,
      presets: {
        brightness: `${fixture.prefix}-dimmer`,
        red: `${fixture.prefix}-red`,
        green: `${fixture.prefix}-green`,
        blue: `${fixture.prefix}-blue`,
        white: `${fixture.prefix}-white`,
        strobe: fixture.strobe,
      },
      strobeRange: fixture.strobeRange || { min: 0.08, max: 2 },
    };
  });

  return Object.keys(config).length ? config : null;
}

function createShadowBuilder(offsets) {
  const entries = Array.isArray(offsets) ? offsets : [];
  return (color) =>
    entries
      .map((offset) => {
        const x = Number.isFinite(offset.x) ? offset.x : 0;
        const y = Number.isFinite(offset.y) ? offset.y : 0;
        const blur = Number.isFinite(offset.blur) ? offset.blur : 0;
        const spread = Number.isFinite(offset.spread) ? offset.spread : 0;
        const spreadPart = spread ? ` ${spread}px` : "";
        return `${x}px ${y}px ${blur}px${spreadPart} ${color}`;
      })
      .join(", ");
}

function applyLightBarState(config, stateMap) {
  if (!config || !config.element) {
    return false;
  }
  const red = getChannelValue(stateMap, config.presets.red);
  const green = getChannelValue(stateMap, config.presets.green);
  const blue = getChannelValue(stateMap, config.presets.blue);
  const whiteValue = getChannelValue(stateMap, config.presets.white);
  const whiteAlpha = clamp(whiteValue / 255, 0, 1);
  const hasColor = red > 0 || green > 0 || blue > 0;
  const brightnessValue = getOptionalChannelValue(stateMap, config.presets.brightness);
  const brightness =
    brightnessValue !== null ? clamp(brightnessValue / 255, 0, 1) : hasColor || whiteAlpha > 0 ? 1 : 0;

  if (brightness >= 1) {
    config.element.style.removeProperty("opacity");
  } else {
    const opacityValue = brightness <= 0 ? 0 : Math.round(brightness * 1000) / 1000;
    config.element.style.opacity = `${opacityValue}`;
  }

  const strobeValue = getChannelValue(stateMap, config.presets.strobe);
  const colorAlpha = hasColor ? 1 : 0;
  const colorShadow = config.shadow(createRgba(red, green, blue, colorAlpha));
  const colorShadowOff = config.shadow(createRgba(red, green, blue, 0));
  applyShadow(
    config.element,
    colorShadow,
    colorShadowOff,
    strobeValue,
    config.strobeRange,
    { preferOnState: brightness > 0 && hasColor }
  );

  if (config.whiteElement) {
    const whiteShadow = config.shadow(createRgba(255, 255, 255, whiteAlpha));
    const whiteShadowOff = config.shadow(createRgba(255, 255, 255, 0));
    applyShadow(
      config.whiteElement,
      whiteShadow,
      whiteShadowOff,
      strobeValue,
      config.strobeRange,
      { preferOnState: brightness > 0 && whiteAlpha > 0 }
    );
  }

  const isActive = brightness > 0 && (hasColor || whiteAlpha > 0);
  config.element.classList.toggle("is-active", isActive);
  return isActive;
}

function createRgba(red, green, blue, alpha) {
  const r = clampChannelValue(Math.round(Number.isFinite(red) ? red : 0));
  const g = clampChannelValue(Math.round(Number.isFinite(green) ? green : 0));
  const b = clampChannelValue(Math.round(Number.isFinite(blue) ? blue : 0));
  const a = clamp(Number.isFinite(alpha) ? alpha : 0, 0, 1);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function formatFixtureList(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    return "";
  }
  if (fixtures.length === 1) {
    return fixtures[0];
  }
  if (fixtures.length === 2) {
    return `${fixtures[0]} and ${fixtures[1]}`;
  }
  const allButLast = fixtures.slice(0, -1);
  const last = fixtures[fixtures.length - 1];
  return `${allButLast.join(", ")}, and ${last}`;
}

function getChannelValue(map, key, fallback = 0) {
  if (!key || !map.has(key)) {
    return fallback;
  }
  const numeric = Number(map.get(key));
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getOptionalChannelValue(map, key) {
  if (!key || !map.has(key)) {
    return null;
  }
  return getChannelValue(map, key, 0);
}

function applyShadow(element, onShadow, offShadow, strobeValue, range, options = {}) {
  if (!element) return;
  const preferOnState = options.preferOnState !== false;
  const duration = computeStrobeDuration(strobeValue, range);
  element.style.setProperty("--light-shadow-on", onShadow);
  element.style.setProperty("--light-shadow-off", offShadow);
  if (duration === null || onShadow === offShadow) {
    element.classList.remove("is-strobing");
    element.style.removeProperty("--strobe-duration");
    element.style.boxShadow = preferOnState ? onShadow : offShadow;
    return;
  }
  element.classList.add("is-strobing");
  element.style.setProperty("--strobe-duration", `${duration}s`);
}

function computeStrobeDuration(value, range = { min: 0.08, max: 2 }) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  const minDuration = Math.max(range.min ?? 0.05, 0.02);
  const maxDuration = Math.max(range.max ?? 2, minDuration);
  const clamped = Math.min(255, Math.max(1, numeric));
  const normalized = (clamped - 1) / 254;
  const inverse = 1 - normalized;
  return minDuration + (maxDuration - minDuration) * inverse;
}

function buildMoverStageConfig(root) {
  const container = root.querySelector("#mover-light");
  if (!container) {
    return null;
  }
  const beams = [
    {
      element: container.querySelector("#beam-1"),
      whiteElement: container.querySelector("#beam-1 .white-color"),
      baseAngle: 225,
    },
    {
      element: container.querySelector("#beam-2"),
      whiteElement: container.querySelector("#beam-2 .white-color"),
      baseAngle: 315,
    },
    {
      element: container.querySelector("#beam-3"),
      whiteElement: container.querySelector("#beam-3 .white-color"),
      baseAngle: 315,
    },
    {
      element: container.querySelector("#beam-4"),
      whiteElement: container.querySelector("#beam-4 .white-color"),
      baseAngle: 225,
    },
  ];

  const redLaser = root.querySelector("#red-laser");
  const greenLaser = root.querySelector("#green-laser");
  const redImage = redLaser ? redLaser.querySelector("img") : null;
  const greenImage = greenLaser ? greenLaser.querySelector("img") : null;
  if (redImage) {
    redImage.src = createLaserPlaceholderSvg("#ff4d4d");
    redImage.alt = redImage.alt || "";
  }
  if (greenImage) {
    greenImage.src = createLaserPlaceholderSvg("#6bff6b");
    greenImage.alt = greenImage.alt || "";
  }

  return {
    container,
    beams,
    lasers: { red: redLaser, green: greenLaser },
    ledStrip: container.querySelector("#led-strip"),
    label: "Mover Light",
    presets: {
      brightness: "mover-light-beam-brightness",
      red: "mover-light-beam-red",
      green: "mover-light-beam-green",
      blue: "mover-light-beam-blue",
      white: "mover-light-beam-white",
      strobe: "mover-light-strobe",
      rotation: "mover-light-rotation",
      rotationSpeed: "mover-light-rotation-speed",
      flash: "mover-light-white-flash",
      ledStrip: "mover-light-strip",
      beamRotationSpeed: "mover-light-beam-rotation-speed",
      laserRed: "mover-light-laser-red",
      laserGreen: "mover-light-laser-green",
    },
    beamRotationPresets: [
      "mover-light-beam1-rotation",
      "mover-light-beam2-rotation",
      "mover-light-beam3-rotation",
      "mover-light-beam4-rotation",
    ],
    baseRotation: 0,
  };
}

function createLaserPlaceholderSvg(color) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><defs><radialGradient id='g' cx='50%' cy='50%' r='50%'><stop offset='0%' stop-color='${color}' stop-opacity='0.85'/><stop offset='100%' stop-color='${color}' stop-opacity='0'/></radialGradient></defs><circle cx='100' cy='100' r='100' fill='url(#g)'/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function updateMoverStage(config, stateMap) {
  if (!config || !config.container) {
    return false;
  }
  const brightnessValue = getOptionalChannelValue(stateMap, config.presets.brightness);
  const brightness = brightnessValue !== null ? clamp(brightnessValue / 255, 0, 1) : 0;
  config.container.style.opacity = brightness;

  const red = getChannelValue(stateMap, config.presets.red);
  const green = getChannelValue(stateMap, config.presets.green);
  const blue = getChannelValue(stateMap, config.presets.blue);
  const beamColor = createRgba(red, green, blue, 1);
  const whiteValue = getChannelValue(stateMap, config.presets.white);
  const whiteAlpha = clamp(whiteValue / 255, 0, 1);
  const strobeValue = getChannelValue(stateMap, config.presets.strobe);
  const baseBeamSpeed = getOptionalChannelValue(stateMap, config.presets.beamRotationSpeed);

  let beamsActive = false;
  config.beams.forEach((beam, index) => {
    if (!beam || !beam.element) {
      return;
    }
    beam.element.style.backgroundColor = beamColor;
    if (beam.whiteElement) {
      beam.whiteElement.style.backgroundColor = createRgba(255, 255, 255, whiteAlpha);
    }
    applyBeamStrobe(beam.element, strobeValue);
    const rotationValue = getOptionalChannelValue(stateMap, config.beamRotationPresets[index]);
    const { angle, height } = calculateBeamOrientation(rotationValue, beam.baseAngle);
    beam.element.style.height = `${height}%`;
    const specificSpeed = getOptionalChannelValue(stateMap, `mover-light-beam${index + 1}-rotation-speed`);
    const speedValue = specificSpeed !== null ? specificSpeed : baseBeamSpeed;
    applyBeamRotation(beam.element, index, angle, speedValue);
    if (brightness > 0 || whiteAlpha > 0 || red > 0 || green > 0 || blue > 0) {
      beamsActive = true;
    }
  });

  const rotationValue = getOptionalChannelValue(stateMap, config.presets.rotation);
  const rotationSpeedValue = getOptionalChannelValue(stateMap, config.presets.rotationSpeed);
  const moverAngle = rotationValue !== null ? (rotationValue / 255) * 520 : stageRotationState.mover || 0;
  applyMoverRotation(config.container, moverAngle, rotationSpeedValue);

  const flashValue = getChannelValue(stateMap, config.presets.flash);
  const flashAlpha = clamp(flashValue / 255, 0, 1);
  const baseShadowColor = createRgba(255, 173, 0, brightness > 0 ? Math.max(brightness, 0.2) : 0);
  const flashShadowColor = createRgba(255, 255, 255, flashAlpha);
  applyShadow(
    config.container,
    createMoverShadow(flashShadowColor),
    createMoverShadow(baseShadowColor),
    flashValue,
    { min: 0.08, max: 2 },
    { preferOnState: false },
  );

  const lasersActive = updateLasers(config, stateMap, brightness);
  const ledActive = updateLedStrip(config, stateMap, brightness);

  return beamsActive || brightness > 0 || flashAlpha > 0 || lasersActive || ledActive;
}

function createMoverShadow(color) {
  return `0 0 40px ${color}, 0 0 60px ${color}, 0 0 90px ${color}`;
}

function applyMoverRotation(element, angle, speedValue) {
  if (!element) return;
  const previous = stageRotationState.mover ?? angle;
  const delta = Math.abs(angle - previous);
  stageRotationState.mover = angle;
  const duration = computeRotationDuration(speedValue, delta, 520, { min: 1, max: 10 });
  const baseTransition = "box-shadow 0.1s ease, opacity 0.1s ease";
  if (!duration) {
    element.style.transition = `transform 0s linear, ${baseTransition}`;
  } else {
    element.style.transition = `transform ${duration}s linear, ${baseTransition}`;
  }
  element.style.transform = `rotate(${angle}deg)`;
}

function computeRotationDuration(speedValue, deltaAngle, maxAngle, range) {
  const baseDuration = mapDmxToDuration(speedValue, range);
  const effectiveDuration = baseDuration === null ? range?.min ?? 0 : baseDuration;
  if (effectiveDuration <= 0 || deltaAngle <= 0) {
    return 0;
  }
  const travelRatio = maxAngle > 0 ? Math.min(deltaAngle / maxAngle, 1) : 0;
  const scaled = effectiveDuration * travelRatio;
  return Math.max(scaled, 0.05);
}

function mapDmxToDuration(value, range, options = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const minDuration = range?.min ?? 0.1;
  const maxDuration = range?.max ?? minDuration;
  if (numeric <= 0) {
    const fastest = Math.max(minDuration * 0.5, 0.05);
    return fastest;
  }
  let normalized = 0;
  if (numeric > 0) {
    const clamped = Math.min(255, Math.max(1, numeric));
    normalized = (clamped - 1) / 254;
  }
  const ratio = options.invert ? 1 - normalized : normalized;
  return minDuration + (maxDuration - minDuration) * ratio;
}

function calculateBeamOrientation(rawValue, baseAngle) {
  if (!Number.isFinite(rawValue)) {
    return { angle: baseAngle, height: 500 };
  }
  const value = clamp(rawValue, 0, 255);
  const midpoint = 127.5;
  if (value <= midpoint) {
    const ratio = value / midpoint;
    const height = 500 - ratio * 450;
    return { angle: baseAngle, height };
  }
  const ratio = (value - midpoint) / (255 - midpoint);
  const height = 50 + ratio * 450;
  const angle = baseAngle - 180 * ratio;
  return { angle, height };
}

function applyBeamRotation(element, index, angle, speedValue) {
  if (!element) return;
  const previousAngles = stageRotationState.beams || [];
  const previous = Number.isFinite(previousAngles[index]) ? previousAngles[index] : angle;
  const delta = Math.abs(angle - previous);
  const duration = computeRotationDuration(speedValue, delta, 180, { min: 0.3, max: 5 });
  const baseTransition = "opacity 0.1s ease, background-color 0.1s ease";
  if (!duration) {
    element.style.transition = `transform 0s ease, height 0s ease, ${baseTransition}`;
  } else {
    element.style.transition = `transform ${duration}s ease-in-out, height ${duration}s ease-in-out, ${baseTransition}`;
  }
  element.style.transform = `rotate(${angle}deg)`;
  stageRotationState.beams[index] = angle;
}

function applyBeamStrobe(element, strobeValue) {
  if (!element) return;
  const duration = computeStrobeDuration(strobeValue, { min: 0.08, max: 2 });
  if (duration === null) {
    element.classList.remove("is-strobing");
    element.style.removeProperty("--beam-strobe-duration");
    element.style.opacity = "1";
    return;
  }
  element.classList.add("is-strobing");
  element.style.setProperty("--beam-strobe-duration", `${duration}s`);
}

function updateLasers(config, stateMap, brightness) {
  let active = false;
  if (config.lasers?.red) {
    const redValue = getChannelValue(stateMap, config.presets.laserRed);
    const intensity = clamp(redValue / 255, 0, 1) * (brightness > 0 ? Math.max(brightness, 0.2) : 0);
    config.lasers.red.style.opacity = intensity;
    if (intensity > 0) {
      active = true;
    }
  }
  if (config.lasers?.green) {
    const greenValue = getChannelValue(stateMap, config.presets.laserGreen);
    const intensity = clamp(greenValue / 255, 0, 1) * (brightness > 0 ? Math.max(brightness, 0.2) : 0);
    config.lasers.green.style.opacity = intensity;
    if (intensity > 0) {
      active = true;
    }
  }
  return active;
}

function updateLedStrip(config, stateMap, brightness) {
  const ledStrip = config.ledStrip;
  if (!ledStrip) {
    return false;
  }
  const value = getChannelValue(stateMap, config.presets.ledStrip);
  const color = mapLedStripColor(value);
  if (!color) {
    ledStrip.style.outlineColor = "transparent";
    ledStrip.style.opacity = "0";
    return false;
  }
  ledStrip.style.outlineColor = color;
  ledStrip.style.opacity = brightness > 0 ? Math.max(brightness, 0.35) : 0.35;
  return true;
}

function mapLedStripColor(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (numeric < 15) return null;
  if (numeric <= 21) return "rgba(255, 0, 0, 1)";
  if (numeric <= 30) return "rgba(0, 255, 0, 1)";
  if (numeric <= 39) return "rgba(0, 0, 255, 1)";
  if (numeric <= 48) return "rgba(255, 255, 0, 1)";
  if (numeric <= 57) return "rgba(255, 0, 255, 1)";
  if (numeric <= 66) return "rgba(0, 255, 255, 1)";
  if (numeric <= 75) return "rgba(255, 255, 255, 1)";
  return null;
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
  wrapper.classList.add("preset-select--channel");

  const select = document.createElement("select");
  setActionFieldMetadata(select, actionId, "channelPreset");
  select.addEventListener("change", (event) => handleChannelPresetChange(event, index));

  const optionData = getChannelSelectionOptions();
  let selectedPreset = null;
  let selectedMaster = null;

  optionData.forEach((optionInfo) => {
    const option = document.createElement("option");
    option.value = optionInfo.id;
    option.textContent = optionInfo.label;
    if (optionInfo.type === "master") {
      option.dataset.channelOptionType = "master";
      option.dataset.channelMasterId = optionInfo.id;
      if (
        action.channelMasterId === optionInfo.id ||
        (action.master && action.master.id === optionInfo.id)
      ) {
        selectedMaster = optionInfo.master;
      }
    } else {
      option.dataset.channelOptionType = "preset";
      option.dataset.channelPresetId = optionInfo.id;
      if (optionInfo.preset.id === action.channelPresetId) {
        selectedPreset = optionInfo.preset;
      }
    }
    select.append(option);
  });

  if (selectedMaster) {
    ensureMasterState(action, selectedMaster);
    select.value = selectedMaster.id;
  } else if (selectedPreset) {
    select.value = selectedPreset.id;
  } else {
    const fallbackPreset = optionData.find((option) => option.type === "preset");
    if (fallbackPreset) {
      applyChannelPresetToAction(action, fallbackPreset.preset);
      select.value = fallbackPreset.id;
    } else {
      const fallbackMaster = optionData.find((option) => option.type === "master");
      if (fallbackMaster) {
        ensureMasterState(action, fallbackMaster.master);
        select.value = fallbackMaster.id;
      }
    }
  }

  wrapper.append(select);
  return wrapper;
}

function createValueField(action, index, actionId) {
  const wrapper = document.createElement("div");
  wrapper.className = "preset-select";

  const master = action.channelMasterId ? getChannelMaster(action.channelMasterId) : null;
  if (master) {
    return createMasterValueField(action, index, actionId, master);
  }

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
  input.classList.add("input--compact-number");
  setActionFieldMetadata(input, actionId, "value");
  input.addEventListener("change", (event) => {
    handleValueNumberChange(event, index);
    slider.value = event.target.value;
  });
  input.addEventListener("input", (event) => {
    handleValueNumberInput(event, index, slider);
  });

  slider.addEventListener("input", () => {
    if (input.disabled) {
      slider.value = input.value || "0";
      return;
    }
    input.value = slider.value;
    const syntheticEvent = new Event("input", { bubbles: true });
    input.dispatchEvent(syntheticEvent);
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

function createMasterValueField(action, index, actionId, master) {
  const wrapper = document.createElement("div");
  wrapper.className = "preset-select preset-select--master";
  const state = ensureMasterState(action, master) || {};

  if (master.hasColor) {
    const colorContainer = document.createElement("div");
    colorContainer.className = "master-color-picker";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = normalizeHexColor(state.color);
    colorInput.className = "preset-select__color";
    setActionFieldMetadata(colorInput, actionId, "masterColor");

    const swatchList = document.createElement("div");
    swatchList.className = "master-color-swatches";

    const updateSwatchSelection = (currentColor) => {
      const normalized = normalizeHexColor(currentColor);
      swatchList.querySelectorAll(".master-color-swatches__button").forEach((button) => {
        const buttonColor = button.dataset.color;
        if (buttonColor === normalized) {
          button.classList.add("is-active");
        } else {
          button.classList.remove("is-active");
        }
      });
    };

    getColorPresets().forEach((preset) => {
      const hexColor = normalizeHexColor(colorPresetToHex(preset));
      const iconColor = normalizeHexColor(colorPresetIconColor(preset));
      const button = document.createElement("button");
      button.type = "button";
      button.className = "master-color-swatches__button";
      button.style.color = iconColor;
      button.title = preset.name ? `${preset.name} (${hexColor.toUpperCase()})` : hexColor.toUpperCase();
      button.dataset.color = hexColor;
      button.dataset.colorPresetId = preset.id;
      button.addEventListener("click", () => {
        state.color = hexColor;
        colorInput.value = hexColor;
        updateSwatchSelection(hexColor);
        queuePreviewSync();
      });
      swatchList.append(button);
    });

    colorInput.addEventListener("input", (event) => {
      const newColor = normalizeHexColor(event.target.value);
      state.color = newColor;
      updateSwatchSelection(newColor);
      queuePreviewSync();
    });

    updateSwatchSelection(state.color);
    colorContainer.append(colorInput, swatchList);
    wrapper.append(colorContainer);
  }

  const createSliderRow = (component, value) => {
    const label = component.name || titleizeComponentKey(component.key) || "Level";
    const fieldKey = `master-${component.key}`;
    state.sliders = state.sliders || {};
    const row = document.createElement("div");
    row.className = "master-slider";

    const labelEl = document.createElement("span");
    labelEl.className = "master-slider__label";
    labelEl.textContent = label;

    const slider = createInput({
      type: "range",
      value,
      min: 0,
      max: 255,
      step: 1,
    });
    slider.classList.add("value-slider", "master-slider__range");
    setActionFieldMetadata(slider, actionId, `${fieldKey}-slider`);

    const numberInput = createInput({
      type: "number",
      value,
      min: 0,
      max: 255,
      step: 1,
    });
    numberInput.classList.add("input--compact-number", "master-slider__number");
    setActionFieldMetadata(numberInput, actionId, `${fieldKey}-number`);

    const updateValue = (newValue, shouldQueue = true) => {
      const clamped = clampChannelValue(newValue);
      slider.value = String(clamped);
      numberInput.value = String(clamped);
      state.sliders[component.key] = clamped;
      if (component.key === CHANNEL_COMPONENTS.BRIGHTNESS) {
        state.brightness = clamped;
        action.value = clamped;
      }
      if (component.key === CHANNEL_COMPONENTS.WHITE) {
        state.white = clamped;
      }
      if (shouldQueue) {
        queuePreviewSync();
      }
    };

    slider.addEventListener("input", (event) => {
      updateValue(event.target.value, false);
    });
    slider.addEventListener("change", (event) => {
      updateValue(event.target.value);
    });

    numberInput.addEventListener("input", (event) => {
      updateValue(event.target.value, false);
    });
    numberInput.addEventListener("change", (event) => {
      updateValue(event.target.value);
    });

    row.append(labelEl, slider, numberInput);
    return row;
  };

  if (Array.isArray(master.sliderComponents) && master.sliderComponents.length) {
    master.sliderComponents.forEach((component) => {
      if (!component || !component.key) {
        return;
      }
      const sliders = state.sliders || {};
      const initial = clampChannelValue(
        sliders[component.key] ?? component.defaultValue ?? 0,
      );
      state.sliders[component.key] = initial;
      const row = createSliderRow(component, initial);
      wrapper.append(row);
    });
  }

  if (Array.isArray(master.dropdownComponents) && master.dropdownComponents.length) {
    state.dropdownSelections = state.dropdownSelections || {};
    master.dropdownComponents.forEach((component) => {
      if (!component || !component.key) {
        return;
      }
      const options = Array.isArray(component.options) ? component.options : [];
      if (!options.length) {
        return;
      }
      const row = document.createElement("div");
      row.className = "master-dropdown";

      const labelEl = document.createElement("span");
      labelEl.className = "master-dropdown__label";
      labelEl.textContent = component.name || titleizeComponentKey(component.key) || "Mode";

      const select = document.createElement("select");
      select.className = "master-dropdown__select";
      setActionFieldMetadata(select, actionId, `masterDropdown-${component.key}`);

      const selections = state.dropdownSelections || {};
      let selectedId = selections[component.key];
      if (!selectedId || !options.some((option) => option.id === selectedId)) {
        selectedId = options[0].id;
      }

      options.forEach((optionPreset) => {
        const option = document.createElement("option");
        option.value = optionPreset.id;
        option.textContent = optionPreset.name || String(optionPreset.value);
        select.append(option);
      });

      select.value = selectedId;
      state.dropdownSelections[component.key] = selectedId;

      select.addEventListener("change", (event) => {
        const valueId = event.target.value;
        state.dropdownSelections[component.key] = valueId;
        queuePreviewSync();
      });

      row.append(labelEl, select);
      wrapper.append(row);
    });
  }

  return wrapper;
}

function appendToColumn(row, column, element) {
  const cell = row.querySelector(`[data-column="${column}"]`);
  if (cell) {
    cell.append(element);
  }
}

function updateStepTitleForGroup(stepId, value) {
  const normalized = typeof value === "string" ? value : "";
  actions.forEach((action) => {
    if (getActionStepId(action) === stepId) {
      action.stepTitle = normalized;
    }
  });
  const info = stepInfoById.get(stepId);
  if (info) {
    info.title = normalized;
  }
}

function handleStepTitleInput(event, stepId) {
  const input = event?.target;
  if (!input || typeof input.value !== "string") {
    return;
  }
  updateStepTitleForGroup(stepId, input.value);
}

function handleStepTitleBlur(event, stepId) {
  const input = event?.target;
  if (!input || typeof input.value !== "string") {
    return;
  }
  const trimmed = input.value.trim();
  if (trimmed !== input.value) {
    input.value = trimmed;
  }
  updateStepTitleForGroup(stepId, trimmed);
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

  const groupInfo = stepInfoById.get(stepId);
  const previousSeconds = groupInfo ? parseTimeString(groupInfo.time) : null;

  let updated = false;
  if (previousSeconds === null) {
    actions.forEach((action) => {
      if (getActionStepId(action) === stepId) {
        action.time = formatted;
        updated = true;
      }
    });
  } else {
    const delta = seconds - previousSeconds;
    actions.forEach((action) => {
      if (getActionStepId(action) !== stepId) {
        return;
      }
      const actionSeconds = parseTimeString(action.time);
      if (actionSeconds === null) {
        action.time = formatted;
        updated = true;
        return;
      }
      const shifted = Math.max(0, Number((actionSeconds + delta).toFixed(6)));
      action.time = secondsToTimecode(shifted);
      updated = true;
    });
  }

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
      focusField: "channelPreset",
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

function handleValueNumberInput(event, index, slider) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  if (target.disabled) {
    return;
  }
  const action = actions[index];
  if (!action) {
    return;
  }
  const raw = target.value;
  if (raw === "" || raw === "-" || raw === "+") {
    return;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return;
  }
  const clamped = clamp(parsed, 0, 255);
  if (clamped !== parsed) {
    target.value = String(clamped);
  }
  action.valuePresetId = null;
  action.value = clamped;
  target.classList.remove("invalid");
  target.setCustomValidity("");
  if (slider instanceof HTMLInputElement) {
    slider.value = String(clamped);
  }
  queuePreviewSync();
  updateActiveActionHighlight(lastKnownTimelineSeconds);
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

function applyChannelPresetToAction(action, preset) {
  if (!action || !preset) return;
  action.channelPresetId = preset.id;
  action.channelMasterId = null;
  action.master = null;
  const presetChannel = Number.parseInt(preset.channel, 10);
  if (Number.isFinite(presetChannel)) {
    action.channel = clamp(presetChannel, 1, 512);
  }

  if (Array.isArray(preset.values) && preset.values.length) {
    let selectedValue = preset.values.find((value) => value.id === action.valuePresetId) || null;
    if (!selectedValue) {
      const numeric = Number.parseInt(action.value, 10);
      if (Number.isFinite(numeric)) {
        selectedValue =
          preset.values.find((value) => Number.isFinite(value.value) && value.value === numeric) || null;
      }
    }
    const fallbackValue = selectedValue || preset.values[0];
    action.valuePresetId = fallbackValue.id;
    const valueNumber = Number.parseInt(fallbackValue.value, 10);
    if (Number.isFinite(valueNumber)) {
      action.value = clamp(valueNumber, 0, 255);
    }
  } else {
    action.valuePresetId = null;
  }
}

function applyChannelPresetToTemplateRow(row, preset) {
  if (!row || !preset || row.type === TEMPLATE_ROW_TYPES.DELAY) return;
  row.channelPresetId = preset.id;
  row.channelMasterId = null;
  row.master = null;
  const presetChannel = Number.parseInt(preset.channel, 10);
  if (Number.isFinite(presetChannel)) {
    row.channel = clamp(presetChannel, 1, 512);
  }

  if (Array.isArray(preset.values) && preset.values.length) {
    let selectedValue = preset.values.find((value) => value.id === row.valuePresetId) || null;
    if (!selectedValue) {
      const numeric = Number.parseInt(row.value, 10);
      if (Number.isFinite(numeric)) {
        selectedValue =
          preset.values.find((value) => Number.isFinite(value.value) && value.value === numeric) || null;
      }
    }
    const fallbackValue = selectedValue || preset.values[0];
    row.valuePresetId = fallbackValue.id;
    const valueNumber = Number.parseInt(fallbackValue.value, 10);
    if (Number.isFinite(valueNumber)) {
      row.value = clamp(valueNumber, 0, 255);
    }
  } else {
    row.valuePresetId = null;
  }
}

function handleChannelPresetChange(event, index) {
  const select = event.target;
  const action = actions[index];
  if (!action || !(select instanceof HTMLSelectElement)) return;

  const selectedOption = select.options[select.selectedIndex];
  const optionType = selectedOption?.dataset?.channelOptionType;
  if (optionType === "master") {
    const masterId = selectedOption?.dataset?.channelMasterId || select.value;
    const master = getChannelMaster(masterId);
    if (master) {
      ensureMasterState(action, master);
      renderActions();
      queuePreviewSync();
      return;
    }
    action.channelMasterId = null;
    action.master = null;
  }

  const selectedId = select.value;
  const preset = channelPresets.find((item) => item.id === selectedId);
  if (preset) {
    applyChannelPresetToAction(action, preset);
    renderActions();
    queuePreviewSync();
    return;
  }

  const fallback = getSortedChannelPresets()[0];
  if (fallback) {
    applyChannelPresetToAction(action, fallback);
  } else {
    action.channelPresetId = null;
    action.valuePresetId = null;
  }
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
  if (newAction.channelPresetId) {
    const preset = channelPresets.find((item) => item.id === newAction.channelPresetId);
    if (preset) {
      applyChannelPresetToAction(newAction, preset);
    }
  } else if (newAction.channelMasterId) {
    const master = getChannelMaster(newAction.channelMasterId);
    if (master) {
      ensureMasterState(newAction, master);
    } else {
      newAction.channelMasterId = null;
      newAction.master = null;
    }
  }
  if (!newAction.channelPresetId && !newAction.channelMasterId) {
    const optionsList = getChannelSelectionOptions();
    const fallbackPreset = optionsList.find((option) => option.type === "preset");
    if (fallbackPreset) {
      applyChannelPresetToAction(newAction, fallbackPreset.preset);
    } else {
      const fallbackMaster = optionsList.find((option) => option.type === "master");
      if (fallbackMaster) {
        ensureMasterState(newAction, fallbackMaster.master);
      }
    }
  }
  const actionId = getActionLocalId(newAction);
  const stepId = setActionStepId(newAction, options.stepId);
  let stepTitleValue = typeof newAction.stepTitle === "string" ? newAction.stepTitle : "";
  if (!stepTitleValue && stepId) {
    const existing = actions.find((item) => getActionStepId(item) === stepId);
    if (existing && typeof existing.stepTitle === "string") {
      stepTitleValue = existing.stepTitle;
    }
  }
  newAction.stepTitle = stepTitleValue || "";
  const insertIndex =
    Number.isInteger(options.insertIndex) && options.insertIndex >= 0
      ? Math.min(options.insertIndex, actions.length)
      : actions.length;
  actions.splice(insertIndex, 0, newAction);

  const focusDescriptor =
    options.focusDescriptor ||
    (options.focusField
      ? { kind: "action", actionId, field: options.focusField }
      : { kind: "action", actionId, field: "channelPreset" });

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
    channelMasterId: original.channelMasterId,
    master: original.master ? { ...original.master } : null,
    templateId: original.templateId,
    templateInstanceId: original.templateInstanceId,
    templateRowId: original.templateRowId,
    templateLoop: original.templateLoop ? { ...original.templateLoop } : null,
    stepTitle: typeof original.stepTitle === "string" ? original.stepTitle : "",
  };
  addAction(copy, { stepId, insertIndex: index + 1, focusField: "channelPreset" });
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

function formatVideoUrlForAssignment(urlObject) {
  if (!urlObject) return "";
  if (urlObject.origin === window.location.origin) {
    return `${urlObject.pathname}${urlObject.search}${urlObject.hash}` || urlObject.href;
  }
  return urlObject.href;
}

function buildProxyVideoUrl(url) {
  try {
    const original = new URL(url, window.location.href);
    const proxy = new URL(original.href);
    const pathname = original.pathname;
    const lastSlash = pathname.lastIndexOf("/");
    const lastDot = pathname.lastIndexOf(".");
    const hasExtension = lastDot > lastSlash;
    const proxyPath = hasExtension
      ? `${pathname.slice(0, lastDot)}_proxy${pathname.slice(lastDot)}`
      : `${pathname}_proxy`;
    proxy.pathname = proxyPath;
    return { original, proxy };
  } catch (error) {
    console.warn("Unable to parse video URL", error);
    return { original: null, proxy: null };
  }
}

async function checkVideoUrlExists(absoluteUrl) {
  try {
    const response = await fetch(absoluteUrl, { method: "HEAD" });
    return response.ok;
  } catch (error) {
    console.warn("Unable to verify video proxy", error);
    return false;
  }
}

async function resolveVideoSourceUrl(url) {
  if (!url) {
    return null;
  }
  const { original, proxy } = buildProxyVideoUrl(url);
  if (proxy && (await checkVideoUrlExists(proxy.href))) {
    return proxy;
  }
  if (original) {
    return original;
  }
  return null;
}

async function setVideoSource(url) {
  if (!url) {
    resetVideoPreview();
    return;
  }

  const resolvedUrl = await resolveVideoSourceUrl(url);
  if (resolvedUrl) {
    const absolute = resolvedUrl.href;
    if (videoEl && videoEl.src !== absolute) {
      videoEl.src = formatVideoUrlForAssignment(resolvedUrl);
      videoEl.load();
      lastKnownTimelineSeconds = 0;
      updateActiveActionHighlight(0);
    }
    return;
  }

  try {
    const fallbackAbsolute = new URL(url, window.location.href).href;
    if (videoEl && videoEl.src !== fallbackAbsolute) {
      videoEl.src = url;
      videoEl.load();
      lastKnownTimelineSeconds = 0;
      updateActiveActionHighlight(0);
    }
  } catch (error) {
    console.warn("Unable to set video source", error);
    resetVideoPreview();
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
  const filterChanged = renderChannelPresets();
  if (filterChanged && Array.isArray(actions) && actions.length) {
    renderActions({ preserveFocus: true });
  }
  if (addChannelPresetButton) {
    addChannelPresetButton.addEventListener("click", () => {
      addChannelPreset();
    });
  }
}

function renderChannelPresets() {
  if (!channelPresetsContainer) return false;

  refreshChannelMasters();
  const filterSelectionChanged = pruneChannelFilterSelection();

  pruneCollapsedChannelPresets();
  channelPresetsContainer.innerHTML = "";

  if (!channelPresets.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "preset-settings__empty";
    emptyState.textContent = "No channel presets yet. Use “Add Channel Preset” to create one.";
    channelPresetsContainer.append(emptyState);
    renderChannelFilterControls();
    return filterSelectionChanged;
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
    removeButton.addEventListener("click", () => removeChannelPreset(preset.id));
    applyIconButton(removeButton, "delete", "Remove channel preset");
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

    const groupField = document.createElement("label");
    groupField.className = "preset-field";
    const groupLabel = document.createElement("span");
    groupLabel.textContent = "Group";
    const groupInput = document.createElement("input");
    groupInput.type = "text";
    groupInput.placeholder = "Left Light";
    groupInput.value = preset.group || "";
    groupInput.addEventListener("input", (event) => handlePresetGroupInput(event, preset.id));
    groupField.append(groupLabel, groupInput);

    const componentField = document.createElement("label");
    componentField.className = "preset-field";
    const componentLabel = document.createElement("span");
    componentLabel.textContent = "Component key";
    const componentInput = document.createElement("input");
    componentInput.type = "text";
    componentInput.placeholder = "red, brightness, strobe";
    componentInput.value = getChannelPresetComponent(preset) || "";
    const datalistId = `component-suggestions-${preset.id}`;
    componentInput.setAttribute("list", datalistId);
    componentInput.addEventListener("change", (event) =>
      handlePresetComponentInput(event, preset.id),
    );
    const suggestionList = document.createElement("datalist");
    suggestionList.id = datalistId;
    CHANNEL_COMPONENT_SUGGESTIONS.forEach((suggestion) => {
      const option = document.createElement("option");
      option.value = suggestion;
      suggestionList.append(option);
    });
    componentField.append(componentLabel, componentInput, suggestionList);

    const componentTypeField = document.createElement("label");
    componentTypeField.className = "preset-field";
    const componentTypeLabel = document.createElement("span");
    componentTypeLabel.textContent = "Component type";
    const componentTypeSelect = document.createElement("select");
    const autoOption = document.createElement("option");
    autoOption.value = "";
    autoOption.textContent = "Auto";
    componentTypeSelect.append(autoOption);
    Object.values(CHANNEL_COMPONENT_TYPES).forEach((typeKey) => {
      const option = document.createElement("option");
      option.value = typeKey;
      option.textContent = titleizeComponentKey(typeKey);
      componentTypeSelect.append(option);
    });
    componentTypeSelect.value = normalizeChannelComponentType(preset.componentType) || "";
    componentTypeSelect.addEventListener("change", (event) =>
      handlePresetComponentTypeChange(event, preset.id),
    );
    componentTypeField.append(componentTypeLabel, componentTypeSelect);

    const componentNameField = document.createElement("label");
    componentNameField.className = "preset-field";
    const componentNameLabel = document.createElement("span");
    componentNameLabel.textContent = "Component name";
    const componentNameInput = document.createElement("input");
    componentNameInput.type = "text";
    componentNameInput.placeholder = "Brightness";
    componentNameInput.value =
      typeof preset.componentName === "string" ? preset.componentName : "";
    componentNameInput.addEventListener("input", (event) =>
      handlePresetComponentNameInput(event, preset.id),
    );
    componentNameField.append(componentNameLabel, componentNameInput);

    row.append(nameField, channelField, groupField, componentField, componentTypeField, componentNameField);
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
      removeValueButton.addEventListener("click", () => {
        removeChannelPresetValue(preset.id, valuePreset.id);
      });
      applyIconButton(removeValueButton, "delete", "Remove value preset");

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

  renderChannelFilterControls();
  return filterSelectionChanged;
}

function sanitizeColorComponent(value, fallback = 255) {
  if (value === null || value === undefined || value === "") {
    return clampChannelValue(fallback);
  }
  const numeric = Number.parseInt(value, 10);
  if (Number.isNaN(numeric)) {
    return clampChannelValue(fallback);
  }
  return clampChannelValue(numeric);
}

function normalizeColorPresetIcon(source, fallback) {
  if (typeof source !== "string") {
    return fallback;
  }
  const trimmed = source.trim();
  if (!trimmed) {
    return fallback;
  }
  const normalized = normalizeHexColor(trimmed);
  const lower = trimmed.toLowerCase();
  const isExplicitWhite = lower === "#ffffff" || lower === "ffffff" || lower === "#fff" || lower === "fff";
  if (!isExplicitWhite && normalized === DEFAULT_MASTER_COLOR && normalized !== normalizeHexColor(fallback)) {
    return fallback;
  }
  return normalized;
}

function sanitizeColorPreset(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const id = typeof raw.id === "string" && raw.id ? raw.id : generateId("color");
  const name = typeof raw.name === "string" ? raw.name : "";

  let red = sanitizeColorComponent(raw.red, 255);
  let green = sanitizeColorComponent(raw.green, 255);
  let blue = sanitizeColorComponent(raw.blue, 255);

  if (raw.rgb && typeof raw.rgb === "object") {
    red = sanitizeColorComponent(raw.rgb.r, red);
    green = sanitizeColorComponent(raw.rgb.g, green);
    blue = sanitizeColorComponent(raw.rgb.b, blue);
  }

  const fallbackHex = rgbToHex(red, green, blue);
  let iconColor = normalizeColorPresetIcon(raw.iconColor, fallbackHex);
  if (iconColor === fallbackHex) {
    iconColor = normalizeColorPresetIcon(raw.color, fallbackHex);
  }

  return { id, name, iconColor, red, green, blue };
}

function getDefaultColorPresets() {
  return DEFAULT_COLOR_PRESETS.map((preset) => sanitizeColorPreset(preset)).filter(Boolean);
}

function getColorPreset(presetId) {
  if (!presetId) {
    return null;
  }
  return colorPresets.find((preset) => preset.id === presetId) || null;
}

function getColorPresets() {
  if (Array.isArray(colorPresets) && colorPresets.length) {
    return colorPresets;
  }
  return getDefaultColorPresets();
}

function colorPresetToHex(preset) {
  if (!preset) {
    return DEFAULT_MASTER_COLOR;
  }
  return rgbToHex(preset.red, preset.green, preset.blue);
}

function colorPresetIconColor(preset) {
  if (!preset) {
    return DEFAULT_MASTER_COLOR;
  }
  return normalizeColorPresetIcon(preset.iconColor, colorPresetToHex(preset));
}

function formatColorPresetTitle(preset) {
  if (!preset) {
    return "Color Preset";
  }
  if (preset.name) {
    return preset.name;
  }
  return colorPresetToHex(preset).toUpperCase();
}

function updateColorPresetCardTitle(card, preset) {
  if (!card) return;
  const title = card.querySelector(".color-card__title");
  if (title) {
    title.textContent = formatColorPresetTitle(preset);
  }
}

function updateColorPresetPreview(card, preset) {
  if (!card) return;
  const preview = card.querySelector("[data-color-preset-preview]");
  if (!preview) return;
  const hex = colorPresetToHex(preset);
  preview.style.backgroundColor = hex;
  preview.title = `RGB ${preset.red}/${preset.green}/${preset.blue}`;
}

function renderColorPresets() {
  if (!colorPresetsList) return;

  const presets = getColorPresets();
  colorPresetsList.innerHTML = "";

  if (!presets.length) {
    const empty = document.createElement("p");
    empty.className = "color-settings__empty";
    empty.textContent = "No color presets yet. Use “Add Color Preset” to create one.";
    colorPresetsList.append(empty);
    return;
  }

  presets.forEach((preset) => {
    const card = document.createElement("article");
    card.className = "color-card";
    card.dataset.colorPresetId = preset.id;

    const header = document.createElement("div");
    header.className = "color-card__header";

    const title = document.createElement("h3");
    title.className = "color-card__title";
    title.textContent = formatColorPresetTitle(preset);
    header.append(title);

    const actionsEl = document.createElement("div");
    actionsEl.className = "color-card__actions";
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.addEventListener("click", () => removeColorPreset(preset.id));
    applyIconButton(removeButton, "delete", "Remove color preset");
    actionsEl.append(removeButton);
    header.append(actionsEl);

    const body = document.createElement("div");
    body.className = "color-card__body";

    const nameField = document.createElement("label");
    nameField.className = "color-field";
    const nameLabel = document.createElement("span");
    nameLabel.textContent = "Name";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "Warm Amber";
    nameInput.value = preset.name || "";
    nameInput.addEventListener("input", (event) => handleColorPresetNameInput(event, preset.id));
    nameField.append(nameLabel, nameInput);

    const swatchRow = document.createElement("div");
    swatchRow.className = "color-card__swatch";

    const iconField = document.createElement("label");
    iconField.className = "color-field color-field--icon";
    const iconLabel = document.createElement("span");
    iconLabel.textContent = "Icon color";
    const iconInput = document.createElement("input");
    iconInput.type = "color";
    iconInput.value = normalizeHexColor(colorPresetIconColor(preset));
    iconInput.addEventListener("input", (event) => handleColorPresetIconInput(event, preset.id));
    iconField.append(iconLabel, iconInput);

    const preview = document.createElement("div");
    preview.className = "color-card__preview";
    preview.dataset.colorPresetPreview = "";
    swatchRow.append(iconField, preview);

    const valuesRow = document.createElement("div");
    valuesRow.className = "color-card__values";

    [
      { key: "red", label: "Red" },
      { key: "green", label: "Green" },
      { key: "blue", label: "Blue" },
    ].forEach(({ key, label }) => {
      const valueField = document.createElement("label");
      valueField.className = "color-field color-field--value";
      const valueLabel = document.createElement("span");
      valueLabel.textContent = label;
      const valueInput = document.createElement("input");
      valueInput.type = "number";
      valueInput.min = 0;
      valueInput.max = 255;
      valueInput.step = 1;
      valueInput.value = preset[key];
      valueInput.addEventListener("input", (event) =>
        handleColorPresetValueInput(event, preset.id, key, { commit: false }),
      );
      valueInput.addEventListener("change", (event) =>
        handleColorPresetValueInput(event, preset.id, key, { commit: true }),
      );
      valueField.append(valueLabel, valueInput);
      valuesRow.append(valueField);
    });

    body.append(nameField, swatchRow, valuesRow);
    card.append(header, body);
    colorPresetsList.append(card);
    updateColorPresetPreview(card, preset);
  });
}

function handleColorPresetNameInput(event, presetId) {
  const preset = getColorPreset(presetId);
  if (!preset) return;
  preset.name = event.target.value;
  saveColorPresets();
  updateColorPresetCardTitle(event.target.closest(".color-card"), preset);
  notifyColorPresetChange();
}

function handleColorPresetIconInput(event, presetId) {
  const preset = getColorPreset(presetId);
  if (!preset) return;
  const value = normalizeHexColor(event.target.value);
  preset.iconColor = value;
  event.target.value = value;
  saveColorPresets();
  notifyColorPresetChange();
}

function handleColorPresetValueInput(event, presetId, channelKey, options = {}) {
  const preset = getColorPreset(presetId);
  if (!preset) return;
  const commit = Boolean(options.commit);
  const raw = Number.parseInt(event.target.value, 10);
  if (Number.isNaN(raw)) {
    event.target.classList.add("invalid");
    if (commit) {
      event.target.setCustomValidity("Value must be between 0 and 255.");
      event.target.reportValidity();
    }
    return;
  }
  const clamped = clampChannelValue(raw);
  event.target.value = String(clamped);
  event.target.classList.remove("invalid");
  event.target.setCustomValidity("");
  preset[channelKey] = clamped;
  const card = event.target.closest(".color-card");
  updateColorPresetPreview(card, preset);
  updateColorPresetCardTitle(card, preset);
  if (commit) {
    saveColorPresets();
    notifyColorPresetChange();
  }
}

function addColorPreset() {
  const preset = {
    id: generateId("color"),
    name: "",
    iconColor: "#ffffff",
    red: 255,
    green: 255,
    blue: 255,
  };
  colorPresets.push(preset);
  renderColorPresets();
  saveColorPresets();
  notifyColorPresetChange();
}

function removeColorPreset(presetId) {
  const index = colorPresets.findIndex((preset) => preset.id === presetId);
  if (index === -1) return;
  colorPresets.splice(index, 1);
  renderColorPresets();
  saveColorPresets();
  notifyColorPresetChange();
}

function resetColorPresetsToDefaults() {
  colorPresets = getDefaultColorPresets();
  renderColorPresets();
  saveColorPresets();
  notifyColorPresetChange();
}

function buildColorPresetPayload() {
  return getColorPresets().map((preset) => ({
    id: preset.id,
    name: preset.name || "",
    iconColor: colorPresetIconColor(preset),
    red: clampChannelValue(preset.red ?? 255),
    green: clampChannelValue(preset.green ?? 255),
    blue: clampChannelValue(preset.blue ?? 255),
  }));
}

function loadColorPresetsFromLocalStorage() {
  if (typeof window === "undefined" || !window.localStorage) {
    return getDefaultColorPresets();
  }
  try {
    const raw = window.localStorage.getItem(COLOR_PRESET_STORAGE_KEY);
    if (!raw) return getDefaultColorPresets();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return getDefaultColorPresets();
    const sanitized = parsed.map((item) => sanitizeColorPreset(item)).filter(Boolean);
    return sanitized.length ? sanitized : getDefaultColorPresets();
  } catch (error) {
    console.error("Unable to load color presets from local storage", error);
    return getDefaultColorPresets();
  }
}

function saveColorPresetsToLocalStorage(presets) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    const sanitized = presets.map((item) => sanitizeColorPreset(item)).filter(Boolean);
    window.localStorage.setItem(COLOR_PRESET_STORAGE_KEY, JSON.stringify(sanitized));
  } catch (error) {
    console.error("Unable to cache color presets locally", error);
  }
}

async function loadColorPresets() {
  const fallback = loadColorPresetsFromLocalStorage();
  try {
    const { payload } = await fetchFromApiCandidates("/color-presets");
    const presets = Array.isArray(payload?.presets) ? payload.presets : [];
    const sanitized = presets.map((item) => sanitizeColorPreset(item)).filter(Boolean);
    if (sanitized.length) {
      saveColorPresetsToLocalStorage(sanitized);
      return sanitized;
    }
    if (!presets.length) {
      saveColorPresetsToLocalStorage([]);
      return [];
    }
    return fallback;
  } catch (error) {
    console.error("Unable to load color presets from server", error);
    return fallback;
  }
}

async function persistColorPresets(presets) {
  const response = await fetchApi("/color-presets", {
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
      const sanitized = payload.presets.map((item) => sanitizeColorPreset(item)).filter(Boolean);
      saveColorPresetsToLocalStorage(sanitized);
    }
  } catch (error) {
    console.error("Unable to parse color preset save response", error);
  }
}

function saveColorPresets() {
  const payload = buildColorPresetPayload();
  saveColorPresetsToLocalStorage(payload);
  persistColorPresets(payload).catch((error) => {
    console.error("Unable to save color presets", error);
  });
}

function notifyColorPresetChange() {
  if (Array.isArray(actions) && actions.length) {
    renderActions({ preserveFocus: true });
  }
  renderLightTemplates({ preserveFocus: true });
  queuePreviewSync();
}

async function initColorPresetsUI() {
  if (!colorPresetsPanel) {
    colorPresets = getDefaultColorPresets();
    return;
  }

  colorPresets = await loadColorPresets();
  if (!colorPresets.length) {
    colorPresets = getDefaultColorPresets();
  }
  renderColorPresets();

  if (addColorPresetButton) {
    addColorPresetButton.addEventListener("click", () => addColorPreset());
  }
  if (resetColorPresetsButton) {
    resetColorPresetsButton.addEventListener("click", () => resetColorPresetsToDefaults());
  }

  notifyColorPresetChange();
}

function renderChannelFilterControls() {
  if (!(channelFilterGroupsContainer instanceof HTMLElement)) {
    return;
  }

  channelFilterGroupMap.clear();
  channelFilterGroupsContainer.innerHTML = "";

  const groups = buildChannelFilterGroups();
  if (!groups.length) {
    const empty = document.createElement("p");
    empty.className = "channel-filter__empty";
    empty.textContent = channelPresets.length
      ? "No channel presets available."
      : "No channel presets yet.";
    channelFilterGroupsContainer.append(empty);
  } else {
    groups.forEach((group) => {
      channelFilterGroupMap.set(
        group.datasetKey,
        group.presets.map((preset) => preset.id),
      );

      const groupEl = document.createElement("div");
      groupEl.className = "channel-filter__group";

      const groupLabel = document.createElement("label");
      groupLabel.className = "channel-filter__group-label";

      const groupCheckbox = document.createElement("input");
      groupCheckbox.type = "checkbox";
      groupCheckbox.className = "channel-filter__checkbox";
      groupCheckbox.dataset.filterGroupKey = group.datasetKey;
      const selectedCount = group.presets.filter((preset) =>
        activeChannelFilterIds.has(preset.id),
      ).length;
      if (activeChannelFilterIds.size > 0 && group.presets.length > 0) {
        groupCheckbox.checked = selectedCount === group.presets.length;
        groupCheckbox.indeterminate =
          selectedCount > 0 && selectedCount < group.presets.length;
      } else {
        groupCheckbox.checked = false;
        groupCheckbox.indeterminate = false;
      }
      groupCheckbox.addEventListener("change", handleChannelFilterGroupChange);

      const groupName = document.createElement("span");
      groupName.className = "channel-filter__group-name";
      groupName.textContent = group.name;

      groupLabel.append(groupCheckbox, groupName);
      groupEl.append(groupLabel);

      if (group.presets.length) {
        const list = document.createElement("ul");
        list.className = "channel-filter__options";
        group.presets.forEach((preset) => {
          const option = document.createElement("li");
          option.className = "channel-filter__option";

          const optionLabel = document.createElement("label");
          optionLabel.className = "channel-filter__option-label";

          const optionCheckbox = document.createElement("input");
          optionCheckbox.type = "checkbox";
          optionCheckbox.className = "channel-filter__checkbox";
          optionCheckbox.dataset.channelPresetId = preset.id;
          optionCheckbox.checked =
            activeChannelFilterIds.size > 0 && activeChannelFilterIds.has(preset.id);
          optionCheckbox.addEventListener("change", handleChannelFilterChannelChange);

          const optionName = document.createElement("span");
          optionName.className = "channel-filter__option-name";
          optionName.textContent = formatChannelFilterOptionLabel(preset, group);

          optionLabel.append(optionCheckbox, optionName);
          option.append(optionLabel);
          list.append(option);
        });
        groupEl.append(list);
      }

      channelFilterGroupsContainer.append(groupEl);
    });
  }

  updateChannelFilterButtonLabel();
  updateChannelFilterClearButtonState();
  updateChannelFilterActiveState();
}

function buildChannelFilterGroups() {
  const ordered = [];
  const map = new Map();
  const sorted = getSortedChannelPresets();
  sorted.forEach((preset) => {
    const rawGroup = typeof preset.group === "string" ? preset.group.trim() : "";
    const isUngrouped = rawGroup === "";
    const key = isUngrouped ? "__ungrouped__" : rawGroup.toLowerCase();
    let entry = map.get(key);
    if (!entry) {
      entry = {
        key,
        datasetKey: `group-${map.size}`,
        name: rawGroup || "Ungrouped",
        isUngrouped,
        presets: [],
      };
      map.set(key, entry);
      ordered.push(entry);
    }
    entry.presets.push(preset);
  });
  return ordered;
}

function formatChannelFilterOptionLabel(preset, group) {
  if (!preset) return "";
  let label = formatChannelPresetLabel(preset);
  const hyphenIndex = label.indexOf(" - ");
  if (hyphenIndex !== -1) {
    label = label.slice(hyphenIndex + 3);
  }
  const channelNumber = Number.isFinite(preset.channel)
    ? preset.channel
    : Number.parseInt(preset.channel, 10);
  if (Number.isFinite(channelNumber)) {
    label = `${label} (Ch ${channelNumber})`;
  }
  return label;
}

function updateChannelFilterButtonLabel() {
  if (!(channelFilterButton instanceof HTMLButtonElement)) {
    return;
  }
  const count = activeChannelFilterIds.size;
  if (channelFilterCountEl instanceof HTMLElement) {
    if (count > 0) {
      channelFilterCountEl.textContent = String(count);
      channelFilterCountEl.hidden = false;
    } else {
      channelFilterCountEl.textContent = "";
      channelFilterCountEl.hidden = true;
    }
  }
  channelFilterButton.classList.toggle("is-active", count > 0);
}

function updateChannelFilterClearButtonState() {
  if (!(channelFilterClearButton instanceof HTMLButtonElement)) {
    return;
  }
  channelFilterClearButton.disabled = activeChannelFilterIds.size === 0;
}

function updateChannelFilterActiveState() {
  if (!(channelFilterContainer instanceof HTMLElement)) {
    return;
  }
  channelFilterContainer.classList.toggle("is-active", activeChannelFilterIds.size > 0);
}

function clearChannelFilter() {
  if (!activeChannelFilterIds.size) {
    return;
  }
  activeChannelFilterIds.clear();
  renderChannelFilterControls();
  renderActions({ preserveFocus: true });
}

function handleChannelFilterGroupChange(event) {
  const target = event?.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  const { filterGroupKey } = target.dataset || {};
  if (!filterGroupKey) {
    return;
  }
  const presetIds = channelFilterGroupMap.get(filterGroupKey) || [];
  if (target.checked) {
    presetIds.forEach((id) => activeChannelFilterIds.add(id));
  } else {
    presetIds.forEach((id) => activeChannelFilterIds.delete(id));
  }
  renderChannelFilterControls();
  renderActions({ preserveFocus: true });
}

function handleChannelFilterChannelChange(event) {
  const target = event?.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  const { channelPresetId } = target.dataset || {};
  if (!channelPresetId) {
    return;
  }
  if (target.checked) {
    activeChannelFilterIds.add(channelPresetId);
  } else {
    activeChannelFilterIds.delete(channelPresetId);
  }
  renderChannelFilterControls();
  renderActions({ preserveFocus: true });
}

function isChannelFilterActive() {
  return activeChannelFilterIds.size > 0;
}

function buildChannelFilterLookup() {
  const lookup = new Map();
  channelPresets.forEach((preset) => {
    const channelNumber = Number.parseInt(preset.channel, 10);
    if (Number.isFinite(channelNumber) && !lookup.has(channelNumber)) {
      lookup.set(channelNumber, preset.id);
    }
  });
  return lookup;
}

function doesActionMatchChannelFilter(action, channelLookup) {
  if (!isChannelFilterActive()) {
    return true;
  }
  if (action.channelMasterId) {
    const master = getChannelMaster(action.channelMasterId);
    if (master) {
      const componentIds = Object.values(master.presets)
        .map((preset) => preset?.id)
        .filter(Boolean);
      if (componentIds.some((id) => activeChannelFilterIds.has(id))) {
        return true;
      }
    }
  }
  const presetId =
    typeof action.channelPresetId === "string" && action.channelPresetId
      ? action.channelPresetId
      : null;
  if (presetId && activeChannelFilterIds.has(presetId)) {
    return true;
  }
  const channelNumber = Number.parseInt(action.channel, 10);
  if (Number.isFinite(channelNumber)) {
    const lookupId = channelLookup.get(channelNumber);
    if (lookupId && activeChannelFilterIds.has(lookupId)) {
      return true;
    }
  }
  return false;
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

function pruneChannelFilterSelection() {
  if (!activeChannelFilterIds.size) {
    return false;
  }
  const validIds = new Set(channelPresets.map((preset) => preset.id));
  let changed = false;
  Array.from(activeChannelFilterIds).forEach((presetId) => {
    if (!validIds.has(presetId)) {
      activeChannelFilterIds.delete(presetId);
      changed = true;
    }
  });
  return changed;
}

function addChannelPreset() {
  const preset = {
    id: generateId("preset"),
    name: "",
    group: "",
    channel: findNextAvailableChannel(),
    component: CHANNEL_COMPONENTS.NONE,
    componentType: "",
    componentName: "",
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
  activeChannelFilterIds.delete(presetId);
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

function handlePresetGroupInput(event, presetId) {
  const preset = getChannelPreset(presetId);
  if (!preset) return;
  preset.group = event.target.value;
  saveChannelPresets();
  renderChannelFilterControls();
}

function handlePresetComponentInput(event, presetId) {
  const preset = getChannelPreset(presetId);
  if (!preset) return;
  const value = normalizeChannelComponent(event.target.value);
  preset.component = value === CHANNEL_COMPONENTS.NONE ? "" : value;
  event.target.value = preset.component;
  saveChannelPresets();
  renderChannelPresets();
  renderActions({ preserveFocus: true });
  queuePreviewSync();
}

function handlePresetComponentTypeChange(event, presetId) {
  const preset = getChannelPreset(presetId);
  if (!preset) return;
  const value = normalizeChannelComponentType(event.target.value);
  preset.componentType = value;
  saveChannelPresets();
  renderChannelPresets();
  renderActions({ preserveFocus: true });
  queuePreviewSync();
}

function handlePresetComponentNameInput(event, presetId) {
  const preset = getChannelPreset(presetId);
  if (!preset) return;
  preset.componentName = event.target.value;
  saveChannelPresets();
  renderActions({ preserveFocus: true });
  queuePreviewSync();
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
    group: typeof preset.group === "string" ? preset.group : "",
    channel: clamp(Number.parseInt(preset.channel, 10) || 1, 1, 512),
    component:
      normalizeChannelComponent(preset.component) === CHANNEL_COMPONENTS.NONE
        ? ""
        : normalizeChannelComponent(preset.component),
    componentType: normalizeChannelComponentType(preset.componentType || ""),
    componentName:
      typeof preset.componentName === "string" ? preset.componentName.trim() : "",
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
  const group = typeof raw.group === "string" ? raw.group : "";
  const channelNumber = Number.parseInt(raw.channel, 10);
  const channel = Number.isFinite(channelNumber) ? clamp(channelNumber, 1, 512) : 1;
  const componentValue = normalizeChannelComponent(raw.component);
  const componentTypeRaw = normalizeChannelComponentType(raw.componentType);
  const componentNameRaw =
    typeof raw.componentName === "string" ? raw.componentName.trim() : "";
  const values = Array.isArray(raw.values)
    ? raw.values.map((value) => sanitizeChannelValue(value)).filter(Boolean)
    : [];
  const sanitized = {
    id,
    name,
    group,
    channel,
    component: componentValue === CHANNEL_COMPONENTS.NONE ? "" : componentValue,
    componentType: componentTypeRaw,
    componentName: componentNameRaw,
    values,
  };
  if (sanitized.component) {
    if (!sanitized.componentType) {
      sanitized.componentType = getPresetComponentType(sanitized);
    }
    if (!sanitized.componentName) {
      sanitized.componentName = getPresetComponentName(sanitized);
    }
  } else {
    sanitized.componentType = "";
    sanitized.componentName = "";
  }
  return sanitized;
}

function sanitizeChannelValue(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" && raw.id ? raw.id : generateId("value");
  const name = typeof raw.name === "string" ? raw.name : "";
  const rawValue = Number.parseInt(raw.value, 10);
  const value = Number.isFinite(rawValue) ? clamp(rawValue, 0, 255) : 0;
  return { id, name, value };
}

function sanitizeTemplateMasterState(raw, channelMasterId) {
  if (typeof channelMasterId !== "string" || !channelMasterId) {
    return null;
  }

  const sanitized = {
    id: channelMasterId,
    color: DEFAULT_MASTER_COLOR,
  };

  const sliders = {};
  const dropdownSelections = {};

  if (raw && typeof raw === "object") {
    if (typeof raw.color === "string" && raw.color.trim()) {
      sanitized.color = normalizeHexColor(raw.color);
    }

    if (Object.prototype.hasOwnProperty.call(raw, "brightness")) {
      const numeric = Number.parseInt(raw.brightness, 10);
      if (Number.isFinite(numeric)) {
        sanitized.brightness = clampChannelValue(numeric);
        sliders[CHANNEL_COMPONENTS.BRIGHTNESS] = sanitized.brightness;
      }
    }

    if (Object.prototype.hasOwnProperty.call(raw, "white")) {
      const numeric = Number.parseInt(raw.white, 10);
      if (Number.isFinite(numeric)) {
        sanitized.white = clampChannelValue(numeric);
        sliders[CHANNEL_COMPONENTS.WHITE] = sanitized.white;
      }
    }

    if (raw.sliders && typeof raw.sliders === "object") {
      Object.entries(raw.sliders).forEach(([key, value]) => {
        if (!key) return;
        const numeric = Number.parseInt(value, 10);
        if (Number.isFinite(numeric)) {
          sliders[normalizeChannelComponent(key)] = clampChannelValue(numeric);
        }
      });
    }

    if (raw.dropdownSelections && typeof raw.dropdownSelections === "object") {
      Object.entries(raw.dropdownSelections).forEach(([key, value]) => {
        if (!key) return;
        if (typeof value === "string" && value.trim()) {
          dropdownSelections[normalizeChannelComponent(key)] = value.trim();
        }
      });
    }
  }

  sanitized.color = normalizeHexColor(sanitized.color);
  if (Object.keys(sliders).length) {
    sanitized.sliders = sliders;
  }
  if (Object.keys(dropdownSelections).length) {
    sanitized.dropdownSelections = dropdownSelections;
  }
  return sanitized;
}


function sanitizeLightTemplateRow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" && raw.id ? raw.id : generateId("templateRow");
  const type =
    raw.type === TEMPLATE_ROW_TYPES.DELAY ? TEMPLATE_ROW_TYPES.DELAY : TEMPLATE_ROW_TYPES.ACTION;

  if (type === TEMPLATE_ROW_TYPES.DELAY) {
    const durationNumber = Number.parseFloat(raw.duration);
    const duration = Number.isFinite(durationNumber)
      ? Math.max(0, Number(durationNumber.toFixed(3)))
      : 0;
    return { id, type, duration };
  }

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
  const channelMasterId =
    typeof raw.channelMasterId === "string" && raw.channelMasterId ? raw.channelMasterId : null;
  const master = sanitizeTemplateMasterState(raw.master, channelMasterId);
  return {
    id,
    type,
    channel,
    value,
    fade,
    channelPresetId: channelMasterId ? null : channelPresetId,
    valuePresetId: channelMasterId ? null : valuePresetId,
    channelMasterId,
    master,
  };
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
      ? template.rows
          .map((row) => sanitizeLightTemplateRow(row))
          .filter(Boolean)
          .map((row) => {
            if (row.type === TEMPLATE_ROW_TYPES.DELAY) {
              return {
                id: row.id,
                type: TEMPLATE_ROW_TYPES.DELAY,
                duration: row.duration,
              };
            }
            return {
              id: row.id,
              type: TEMPLATE_ROW_TYPES.ACTION,
              channel: row.channel,
              value: row.value,
              fade: row.fade,
              channelPresetId: row.channelPresetId,
              valuePresetId: row.valuePresetId,
              channelMasterId: row.channelMasterId,
              master: row.master,
            };
          })
      : [],
  }));
}

function getLightTemplateSortKey(template) {
  if (!template || typeof template !== "object") {
    return { hasName: false, name: "", id: "" };
  }
  const name = typeof template.name === "string" ? template.name.trim() : "";
  return {
    hasName: Boolean(name),
    name: name.toLowerCase(),
    exactName: name,
    id: typeof template.id === "string" ? template.id : "",
  };
}

function getSortedLightTemplates(list = lightTemplates) {
  const templates = Array.isArray(list) ? [...list] : [];
  return templates.sort((a, b) => {
    const aKey = getLightTemplateSortKey(a);
    const bKey = getLightTemplateSortKey(b);
    if (aKey.hasName && !bKey.hasName) {
      return -1;
    }
    if (!aKey.hasName && bKey.hasName) {
      return 1;
    }
    if (aKey.hasName && bKey.hasName) {
      const compare = aKey.name.localeCompare(bKey.name, undefined, {
        sensitivity: "base",
        numeric: true,
      });
      if (compare !== 0) {
        return compare;
      }
      const exactCompare = aKey.exactName.localeCompare(bKey.exactName, undefined, {
        numeric: true,
      });
      if (exactCompare !== 0) {
        return exactCompare;
      }
    }
    return aKey.id.localeCompare(bKey.id);
  });
}

function getLightTemplatesForList() {
  const sorted = getSortedLightTemplates();
  const query = (lightTemplateFilterQuery || "").trim().toLowerCase();
  if (!query) {
    return sorted;
  }
  return sorted.filter((template) =>
    formatLightTemplateTitle(template).toLowerCase().includes(query),
  );
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
  const type =
    overrides.type === TEMPLATE_ROW_TYPES.DELAY ? TEMPLATE_ROW_TYPES.DELAY : TEMPLATE_ROW_TYPES.ACTION;

  if (type === TEMPLATE_ROW_TYPES.DELAY) {
    const durationValue = Number.parseFloat(overrides.duration);
    const duration = Number.isFinite(durationValue) ? Math.max(0, Number(durationValue.toFixed(3))) : 1;
    return {
      id: overrides.id || generateId("templateRow"),
      type,
      duration,
    };
  }

  const row = {
    id: overrides.id || generateId("templateRow"),
    type,
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
    channelMasterId:
      typeof overrides.channelMasterId === "string" && overrides.channelMasterId
        ? overrides.channelMasterId
        : null,
    master:
      overrides.master && typeof overrides.master === "object"
        ? { ...overrides.master }
        : null,
  };

  if (row.channelPresetId) {
    const preset = getChannelPreset(row.channelPresetId);
    if (preset) {
      applyChannelPresetToTemplateRow(row, preset);
    }
  } else if (row.channelMasterId) {
    const master = getChannelMaster(row.channelMasterId);
    if (master) {
      ensureMasterState(row, master);
    } else {
      row.channelMasterId = null;
      row.master = null;
    }
  }

  if (!row.channelPresetId && !row.channelMasterId) {
    const optionsList = getChannelSelectionOptions();
    const fallbackPreset = optionsList.find((option) => option.type === "preset");
    if (fallbackPreset) {
      applyChannelPresetToTemplateRow(row, fallbackPreset.preset);
    } else {
      const fallbackMaster = optionsList.find((option) => option.type === "master");
      if (fallbackMaster) {
        ensureMasterState(row, fallbackMaster.master);
      }
    }
  }

  return row;
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

  if (lightTemplateFilterInput) {
    const handleFilterInput = () => {
      lightTemplateFilterQuery = lightTemplateFilterInput.value || "";
      renderLightTemplateList();
    };
    lightTemplateFilterQuery = lightTemplateFilterInput.value || "";
    lightTemplateFilterInput.addEventListener("input", handleFilterInput);
    lightTemplateFilterInput.addEventListener("search", handleFilterInput);
  } else {
    lightTemplateFilterQuery = "";
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
  if (!lightTemplatesContainer || !templateDetailContainer) return;

  const previousActiveTemplateId = activeLightTemplateId;
  const focusDescriptor =
    options.preserveFocus || describeFocusedTemplateField(document.activeElement);

  if (options.focusTemplateId) {
    activeLightTemplateId = options.focusTemplateId;
  }

  if (activeLightTemplateId && !getLightTemplate(activeLightTemplateId)) {
    activeLightTemplateId = null;
  }

  renderLightTemplateList();
  renderLightTemplateDetail();

  const query = templatePickerSearch ? templatePickerSearch.value || "" : "";
  renderTemplatePickerResults(query);

  if (options.focusTemplateId) {
    focusTemplateField({ templateId: options.focusTemplateId, field: "template-name" });
  } else if (focusDescriptor) {
    focusTemplateField(focusDescriptor);
  }

  if (previousActiveTemplateId !== activeLightTemplateId && activeTab === "templates") {
    queuePreviewSync();
  }
}

function renderLightTemplateList() {
  if (!lightTemplatesContainer) return;

  lightTemplatesContainer.innerHTML = "";

  if (!lightTemplates.length) {
    const empty = document.createElement("li");
    empty.className = "template-list__empty";
    empty.textContent = "No templates yet. Use “New Template” to create one.";
    empty.setAttribute("role", "presentation");
    lightTemplatesContainer.append(empty);
    return;
  }

  const templatesForList = getLightTemplatesForList();

  if (!templatesForList.length) {
    const empty = document.createElement("li");
    empty.className = "template-list__empty";
    empty.textContent = "No templates match your filter.";
    empty.setAttribute("role", "presentation");
    lightTemplatesContainer.append(empty);
    return;
  }

  templatesForList.forEach((template) => {
    const item = document.createElement("li");
    item.className = "template-list__item";
    item.dataset.templateId = template.id;
    if (template.id === activeLightTemplateId) {
      item.classList.add("is-active");
    }

    const summary = document.createElement("div");
    summary.className = "template-list__summary";

    const title = document.createElement("span");
    title.className = "template-list__title";
    title.textContent = formatLightTemplateTitle(template);

    const meta = document.createElement("span");
    meta.className = "template-list__meta";
    meta.textContent = formatTemplateRowCount(template);

    summary.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "template-list__actions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.addEventListener("click", () => {
      if (activeLightTemplateId !== template.id) {
        activeLightTemplateId = template.id;
      }
      renderLightTemplates({ focusTemplateId: template.id });
    });
    applyIconButton(editButton, "edit", "Edit template");

    const duplicateButton = document.createElement("button");
    duplicateButton.type = "button";
    duplicateButton.addEventListener("click", () => duplicateLightTemplate(template.id));
    applyIconButton(duplicateButton, "duplicate", "Duplicate template");

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", () => removeLightTemplate(template.id));
    applyIconButton(deleteButton, "delete", "Delete template");

    actions.append(editButton, duplicateButton, deleteButton);
    item.append(summary, actions);
    lightTemplatesContainer.append(item);
  });
}

function renderLightTemplateDetail() {
  if (!templateDetailContainer) return;

  templateDetailContainer.innerHTML = "";

  if (!activeLightTemplateId) {
    const empty = document.createElement("p");
    empty.className = "template-detail__empty";
    empty.textContent = "Select “Edit” on a template to start editing.";
    templateDetailContainer.append(empty);
    return;
  }

  const template = getLightTemplate(activeLightTemplateId);
  if (!template) {
    const missing = document.createElement("p");
    missing.className = "template-detail__empty";
    missing.textContent = "Template not found. Choose another template from the list.";
    templateDetailContainer.append(missing);
    return;
  }

  const card = createTemplateDetailCard(template);
  templateDetailContainer.append(card);
}

function describeFocusedTemplateField(element) {
  if (
    !element ||
    !(element instanceof HTMLElement) ||
    !templateDetailContainer ||
    !templateDetailContainer.contains(element)
  ) {
    return null;
  }
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
  if (!descriptor || !templateDetailContainer) return;
  const parts = [
    `[data-template-id="${descriptor.templateId}"]`,
    `[data-field="${descriptor.field}"]`,
  ];
  if (descriptor.rowId) {
    parts.push(`[data-row-id="${descriptor.rowId}"]`);
  }
  const selector = parts.join("");
  const target = templateDetailContainer.querySelector(selector);
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

function createTemplateDetailCard(template) {
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

  const meta = document.createElement("span");
  meta.className = "template-list__meta";
  meta.textContent = formatTemplateRowCount(template);
  titleGroup.append(meta);

  const actionsEl = document.createElement("div");
  actionsEl.className = "template-card__actions";

  const duplicateButton = document.createElement("button");
  duplicateButton.type = "button";
  duplicateButton.addEventListener("click", () => duplicateLightTemplate(template.id));
  applyIconButton(duplicateButton, "duplicate", "Duplicate template");

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.addEventListener("click", () => removeLightTemplate(template.id));
  applyIconButton(deleteButton, "delete", "Delete template");

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
  addRowButton.textContent = "Add Channel Row";
  addRowButton.addEventListener("click", () => addRowToLightTemplate(template.id));

  const addDelayButton = document.createElement("button");
  addDelayButton.type = "button";
  addDelayButton.className = "secondary";
  addDelayButton.textContent = "Add Delay";
  addDelayButton.addEventListener("click", () => addDelayRowToLightTemplate(template.id));

  footer.append(addRowButton, addDelayButton);
  body.append(footer);

  card.append(header, body);
  return card;
}

function formatLightTemplateTitle(template) {
  if (template.name) {
    return template.name;
  }
  return "Untitled Template";
}

function formatTemplateRowCount(template) {
  const rows = Array.isArray(template.rows) ? template.rows : [];
  const total = rows.length;
  const stepLabel = total === 1 ? "1 step" : `${total} steps`;
  const delayCount = rows.filter((row) => row.type === TEMPLATE_ROW_TYPES.DELAY).length;
  if (!delayCount) {
    return stepLabel;
  }
  const delayLabel = delayCount === 1 ? "1 delay" : `${delayCount} delays`;
  return `${stepLabel} • ${delayLabel}`;
}

function formatTemplateLoopSummary(loop) {
  const normalized = normalizeTemplateLoop(loop);
  if (normalized.duration <= 0) {
    return "Loop: Delay required";
  }
  if (!normalized.enabled && !normalized.infinite) {
    return "Loop: Off";
  }
  const modeLabel = normalized.mode === "pingpong" ? "Ping-pong" : "Forward";
  if (normalized.infinite) {
    return `Loop: Infinite (${modeLabel})`;
  }
  return `Loop: ${normalized.count}× ${modeLabel}`;
}

function collectTemplateChannels(template) {
  if (!template || !Array.isArray(template.rows)) return [];
  const unique = new Set();
  template.rows.forEach((row) => {
    if (row.type === TEMPLATE_ROW_TYPES.DELAY) return;
    const numeric = Number.parseInt(row.channel, 10);
    if (Number.isFinite(numeric)) {
      unique.add(clamp(numeric, 1, 512));
    }
  });
  return Array.from(unique).sort((a, b) => a - b);
}

function createTemplateRowsTable(template) {
  const table = document.createElement("table");
  table.className = "template-card__table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  [
    { label: "", srLabel: "Reorder" },
    { label: "Channel / Delay" },
    { label: "Value / Duration" },
    { label: "Fade (s)" },
    { label: "Tools" },
  ].forEach((column) => {
    const th = document.createElement("th");
    th.scope = "col";
    if (column.label) {
      th.textContent = column.label;
    } else if (column.srLabel) {
      const sr = document.createElement("span");
      sr.className = "visually-hidden";
      sr.textContent = column.srLabel;
      th.append(sr);
    }
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
  if (row.type === TEMPLATE_ROW_TYPES.DELAY) {
    baseRow.classList.add("template-row--delay");
  }

  baseRow.addEventListener("dragover", handleTemplateRowDragOver);
  baseRow.addEventListener("dragleave", handleTemplateRowDragLeave);
  baseRow.addEventListener("drop", handleTemplateRowDrop);

  const handleCell =
    baseRow.querySelector('[data-template-column="handle"]') || document.createElement("td");
  handleCell.innerHTML = "";
  const dragHandle = createTemplateRowDragHandle(template, row, index);
  handleCell.append(dragHandle);
  baseRow.append(handleCell);

  const channelCell =
    baseRow.querySelector('[data-template-column="channel"]') || document.createElement("td");
  channelCell.innerHTML = "";
  if (row.type === TEMPLATE_ROW_TYPES.DELAY) {
    const delayLabel = document.createElement("span");
    delayLabel.className = "template-row__delay-label";
    delayLabel.textContent = "Delay";
    channelCell.append(delayLabel);
  } else {
    const channelField = createTemplateChannelField(template.id, row);
    channelCell.append(channelField);
  }
  baseRow.append(channelCell);

  const valueCell =
    baseRow.querySelector('[data-template-column="value"]') || document.createElement("td");
  valueCell.innerHTML = "";
  if (row.type === TEMPLATE_ROW_TYPES.DELAY) {
    valueCell.append(createTemplateDelayField(template.id, row));
  } else {
    valueCell.append(createTemplateValueField(template.id, row));
  }
  baseRow.append(valueCell);

  const fadeCell =
    baseRow.querySelector('[data-template-column="fade"]') || document.createElement("td");
  fadeCell.innerHTML = "";
  if (row.type === TEMPLATE_ROW_TYPES.DELAY) {
    const dash = document.createElement("span");
    dash.className = "template-row__placeholder";
    dash.textContent = "—";
    fadeCell.append(dash);
  } else {
    const fadeInput = createInput({ type: "number", value: row.fade, min: 0, step: 0.1 });
    fadeInput.classList.add("input--compact-number");
    fadeInput.dataset.templateId = template.id;
    fadeInput.dataset.rowId = row.id;
    fadeInput.dataset.field = "template-fade";
    fadeInput.addEventListener("change", (event) =>
      handleTemplateRowFadeChange(template.id, row.id, event),
    );
    fadeCell.append(fadeInput);
  }
  baseRow.append(fadeCell);

  const toolsCell =
    baseRow.querySelector('[data-template-column="tools"]') || document.createElement("td");
  toolsCell.innerHTML = "";
  const tools = document.createElement("div");
  tools.className = "template-row__tools";

  const duplicateButton = document.createElement("button");
  duplicateButton.type = "button";
  duplicateButton.addEventListener("click", () => duplicateTemplateRow(template.id, row.id));
  applyIconButton(duplicateButton, "duplicate", "Duplicate row");

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.addEventListener("click", () => removeTemplateRow(template.id, row.id));
  applyIconButton(removeButton, "delete", "Delete row");

  tools.append(duplicateButton, removeButton);
  toolsCell.append(tools);
  baseRow.append(toolsCell);

  return baseRow;
}

function createTemplateRowDragHandle(template, row, index) {
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "action-row__drag-handle template-row__drag-handle";
  const label = formatTemplateRowLabel(template, row, index);
  const dragLabel = label ? `Drag to reorder ${label}` : "Drag to reorder row";
  handle.title = dragLabel;
  handle.setAttribute("aria-label", dragLabel);
  handle.draggable = true;
  handle.dataset.templateId = template.id;
  handle.dataset.rowId = row.id;
  handle.dataset.field = "template-row-handle";

  const icon = document.createElement("span");
  icon.className = "action-row__drag-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "⋮⋮";
  handle.append(icon);

  handle.addEventListener("dragstart", handleTemplateRowDragStart);
  handle.addEventListener("dragend", handleTemplateRowDragEnd);

  return handle;
}

function formatTemplateRowLabel(template, row, index) {
  if (row.type === TEMPLATE_ROW_TYPES.DELAY) {
    return `Delay ${index + 1}`;
  }
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
  wrapper.classList.add("preset-select--channel");

  const select = document.createElement("select");
  select.dataset.templateId = templateId;
  select.dataset.rowId = row.id;
  select.dataset.field = "template-channel-preset";
  select.addEventListener("change", (event) =>
    handleTemplateRowChannelPresetChange(templateId, row.id, event),
  );

  const optionData = getChannelSelectionOptions();
  let selectedPreset = null;
  let selectedMaster = null;

  optionData.forEach((optionInfo) => {
    const option = document.createElement("option");
    option.value = optionInfo.id;
    option.textContent = optionInfo.label;
    if (optionInfo.type === "master") {
      option.dataset.channelOptionType = "master";
      option.dataset.channelMasterId = optionInfo.id;
      if (
        row.channelMasterId === optionInfo.id ||
        (row.master && row.master.id === optionInfo.id)
      ) {
        selectedMaster = optionInfo.master;
      }
    } else {
      option.dataset.channelOptionType = "preset";
      option.dataset.channelPresetId = optionInfo.id;
      if (optionInfo.preset.id === row.channelPresetId) {
        selectedPreset = optionInfo.preset;
      }
    }
    select.append(option);
  });

  if (selectedMaster) {
    ensureMasterState(row, selectedMaster);
    select.value = selectedMaster.id;
  } else if (selectedPreset) {
    select.value = selectedPreset.id;
  } else {
    const fallbackPreset = optionData.find((option) => option.type === "preset");
    if (fallbackPreset) {
      applyChannelPresetToTemplateRow(row, fallbackPreset.preset);
      select.value = fallbackPreset.id;
    } else {
      const fallbackMaster = optionData.find((option) => option.type === "master");
      if (fallbackMaster) {
        ensureMasterState(row, fallbackMaster.master);
        select.value = fallbackMaster.id;
      }
    }
  }

  wrapper.append(select);
  return wrapper;
}

function createTemplateValueField(templateId, row) {
  const wrapper = document.createElement("div");
  wrapper.className = "preset-select";

  const master = row.channelMasterId ? getChannelMaster(row.channelMasterId) : null;
  if (master) {
    return createTemplateMasterValueField(templateId, row, master);
  }

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
  input.classList.add("input--compact-number");
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

function createTemplateMasterValueField(templateId, row, master) {
  const wrapper = document.createElement("div");
  wrapper.className = "preset-select preset-select--master";
  const state = ensureMasterState(row, master) || {};

  if (master.hasColor) {
    const colorContainer = document.createElement("div");
    colorContainer.className = "master-color-picker";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = normalizeHexColor(state.color);
    colorInput.className = "preset-select__color";
    colorInput.dataset.templateId = templateId;
    colorInput.dataset.rowId = row.id;
    colorInput.dataset.field = "template-master-color";

    const swatchList = document.createElement("div");
    swatchList.className = "master-color-swatches";

    const updateSwatchSelection = (currentColor) => {
      const normalized = normalizeHexColor(currentColor);
      swatchList.querySelectorAll(".master-color-swatches__button").forEach((button) => {
        const buttonColor = button.dataset.color;
        if (buttonColor === normalized) {
          button.classList.add("is-active");
        } else {
          button.classList.remove("is-active");
        }
      });
    };

    getColorPresets().forEach((preset) => {
      const hexColor = normalizeHexColor(colorPresetToHex(preset));
      const iconColor = normalizeHexColor(colorPresetIconColor(preset));
      const button = document.createElement("button");
      button.type = "button";
      button.className = "master-color-swatches__button";
      button.style.color = iconColor;
      button.title = preset.name ? `${preset.name} (${hexColor.toUpperCase()})` : hexColor.toUpperCase();
      button.dataset.color = hexColor;
      button.dataset.colorPresetId = preset.id;
      button.addEventListener("click", () => {
        state.color = hexColor;
        row.master = { ...(row.master || {}), id: master.id, color: hexColor };
        colorInput.value = hexColor;
        updateSwatchSelection(hexColor);
        syncTemplateInstances(templateId);
        saveLightTemplates();
      });
      swatchList.append(button);
    });

    colorInput.addEventListener("input", (event) => {
      const newColor = normalizeHexColor(event.target.value);
      state.color = newColor;
      row.master = { ...(row.master || {}), id: master.id, color: newColor };
      updateSwatchSelection(newColor);
      syncTemplateInstances(templateId);
      saveLightTemplates();
    });

    updateSwatchSelection(state.color);
    colorContainer.append(colorInput, swatchList);
    wrapper.append(colorContainer);
  }

  const ensureRowMaster = () => {
    if (!row.master || typeof row.master !== "object") {
      row.master = { id: master.id };
    } else if (!row.master.id) {
      row.master.id = master.id;
    }
  };

  const getRowSliderState = () => {
    ensureRowMaster();
    if (!row.master.sliders || typeof row.master.sliders !== "object") {
      row.master.sliders = {};
    }
    return row.master.sliders;
  };

  const getRowDropdownState = () => {
    ensureRowMaster();
    if (!row.master.dropdownSelections || typeof row.master.dropdownSelections !== "object") {
      row.master.dropdownSelections = {};
    }
    return row.master.dropdownSelections;
  };

  const createSliderRow = (component, value) => {
    const label = component.name || titleizeComponentKey(component.key) || "Level";
    const fieldKey = `template-master-${component.key}`;
    const rowEl = document.createElement("div");
    rowEl.className = "master-slider";

    const labelEl = document.createElement("span");
    labelEl.className = "master-slider__label";
    labelEl.textContent = label;

    const slider = createInput({ type: "range", value, min: 0, max: 255, step: 1 });
    slider.classList.add("value-slider", "master-slider__range");
    slider.dataset.templateId = templateId;
    slider.dataset.rowId = row.id;
    slider.dataset.field = `${fieldKey}-slider`;

    const numberInput = createInput({ type: "number", value, min: 0, max: 255, step: 1 });
    numberInput.classList.add("input--compact-number", "master-slider__number");
    numberInput.dataset.templateId = templateId;
    numberInput.dataset.rowId = row.id;
    numberInput.dataset.field = `${fieldKey}-number`;

    const updateValue = (newValue) => {
      const clamped = clampChannelValue(newValue);
      slider.value = String(clamped);
      numberInput.value = String(clamped);
      const sliders = getRowSliderState();
      sliders[component.key] = clamped;
      row.master = {
        ...(row.master || {}),
        id: master.id,
        sliders,
      };
      if (component.key === CHANNEL_COMPONENTS.BRIGHTNESS) {
        row.master.brightness = clamped;
      }
      if (component.key === CHANNEL_COMPONENTS.WHITE) {
        row.master.white = clamped;
      }
      syncTemplateInstances(templateId);
    };

    slider.addEventListener("input", (event) => {
      updateValue(event.target.value);
    });
    slider.addEventListener("change", () => {
      saveLightTemplates();
    });

    numberInput.addEventListener("input", (event) => {
      updateValue(event.target.value);
    });
    numberInput.addEventListener("change", () => {
      saveLightTemplates();
    });

    rowEl.append(labelEl, slider, numberInput);
    return rowEl;
  };

  if (Array.isArray(master.sliderComponents) && master.sliderComponents.length) {
    const sliders = getRowSliderState();
    master.sliderComponents.forEach((component) => {
      if (!component || !component.key) {
        return;
      }
      const initial = clampChannelValue(
        sliders[component.key] ?? component.defaultValue ?? 0,
      );
      sliders[component.key] = initial;
      row.master = {
        ...(row.master || {}),
        id: master.id,
        sliders,
      };
      if (component.key === CHANNEL_COMPONENTS.BRIGHTNESS) {
        row.master.brightness = initial;
      }
      if (component.key === CHANNEL_COMPONENTS.WHITE) {
        row.master.white = initial;
      }
      const sliderRow = createSliderRow(component, initial);
      wrapper.append(sliderRow);
    });
  }

  if (Array.isArray(master.dropdownComponents) && master.dropdownComponents.length) {
    const dropdownState = getRowDropdownState();
    master.dropdownComponents.forEach((component) => {
      if (!component || !component.key) {
        return;
      }
      const options = Array.isArray(component.options) ? component.options : [];
      if (!options.length) {
        return;
      }
      const rowEl = document.createElement("div");
      rowEl.className = "master-dropdown";

      const labelEl = document.createElement("span");
      labelEl.className = "master-dropdown__label";
      labelEl.textContent = component.name || titleizeComponentKey(component.key) || "Mode";

      const select = document.createElement("select");
      select.className = "master-dropdown__select";
      select.dataset.templateId = templateId;
      select.dataset.rowId = row.id;
      select.dataset.field = `template-master-dropdown-${component.key}`;

      let selectedId = dropdownState[component.key];
      if (!selectedId || !options.some((option) => option.id === selectedId)) {
        selectedId = options[0].id;
      }

      options.forEach((optionPreset) => {
        const option = document.createElement("option");
        option.value = optionPreset.id;
        option.textContent = optionPreset.name || String(optionPreset.value);
        select.append(option);
      });

      select.value = selectedId;
      dropdownState[component.key] = selectedId;
      row.master = {
        ...(row.master || {}),
        id: master.id,
        dropdownSelections: dropdownState,
      };

      select.addEventListener("change", (event) => {
        const valueId = event.target.value;
        dropdownState[component.key] = valueId;
        row.master = {
          ...(row.master || {}),
          id: master.id,
          dropdownSelections: dropdownState,
        };
        syncTemplateInstances(templateId);
        saveLightTemplates();
      });

      rowEl.append(labelEl, select);
      wrapper.append(rowEl);
    });
  }

  return wrapper;
}


function createTemplateDelayField(templateId, row) {
  const wrapper = document.createElement("div");
  wrapper.className = "template-delay-field";

  const input = createInput({
    type: "number",
    value: row.duration ?? 1,
    min: 0,
    step: 0.1,
  });
  input.classList.add("input--compact-number");
  input.dataset.templateId = templateId;
  input.dataset.rowId = row.id;
  input.dataset.field = "template-delay-duration";
  input.addEventListener("change", (event) =>
    handleTemplateRowDurationChange(templateId, row.id, event),
  );

  const suffix = document.createElement("span");
  suffix.className = "template-delay-field__unit";
  suffix.textContent = "s";

  wrapper.append(input, suffix);
  return wrapper;
}

function handleTemplateNameInput(templateId, event) {
  const template = getLightTemplate(templateId);
  if (!template) return;
  template.name = event.target.value;
  const focusDescriptor = describeFocusedTemplateField(event.target);
  saveLightTemplates();
  renderLightTemplates({ preserveFocus: focusDescriptor });
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
  const clonedRows = (template.rows || []).map((row) => {
    if (row.type === TEMPLATE_ROW_TYPES.DELAY) {
      return createTemplateRowDefaults({
        type: TEMPLATE_ROW_TYPES.DELAY,
        duration: row.duration,
      });
    }
    return createTemplateRowDefaults({
      type: TEMPLATE_ROW_TYPES.ACTION,
      channel: row.channel,
      value: row.value,
      fade: row.fade,
      channelPresetId: row.channelPresetId,
      valuePresetId: row.valuePresetId,
      channelMasterId: row.channelMasterId,
      master: row.master
        ? {
            ...row.master,
            sliders:
              row.master.sliders && typeof row.master.sliders === "object"
                ? { ...row.master.sliders }
                : undefined,
            dropdownSelections:
              row.master.dropdownSelections &&
              typeof row.master.dropdownSelections === "object"
                ? { ...row.master.dropdownSelections }
                : undefined,
          }
        : null,
    });
  });
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
  if (templateId === activeLightTemplateId) {
    activeLightTemplateId = null;
  }
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

function getTemplateInstanceInfo(instanceId) {
  if (!instanceId) return null;
  const indices = [];
  let templateId = null;
  let stepId = null;
  let time = null;
  actions.forEach((action, index) => {
    if (action.templateInstanceId !== instanceId) return;
    indices.push(index);
    if (!templateId && action.templateId) {
      templateId = action.templateId;
    }
    if (!stepId) {
      stepId = getActionStepId(action);
    }
    if (!time && action.time) {
      time = action.time;
    }
  });
  if (!indices.length) {
    return null;
  }
  return {
    instanceId,
    templateId,
    stepId,
    time: time || DEFAULT_ACTION.time,
    indices,
    firstIndex: indices[0],
    lastIndex: indices[indices.length - 1],
  };
}

function getTemplateInstanceLoopSettings(instanceId) {
  const info = getTemplateInstanceInfo(instanceId);
  if (!info || !Array.isArray(info.indices) || !info.indices.length) {
    return null;
  }
  const action = actions[info.indices[0]];
  if (!action) return null;
  return cloneTemplateLoopSettings(action.templateLoop);
}

function duplicateTemplateInstance(instanceId) {
  if (!instanceId) return;
  const info = getTemplateInstanceInfo(instanceId);
  if (!info || !info.templateId) return;
  const template = getLightTemplate(info.templateId);
  if (!template) return;
  const newInstanceId = generateTemplateInstanceId();
  let loopSettings = getTemplateInstanceLoopSettings(instanceId);
  if (loopSettings) {
    const channels = collectTemplateChannels(template);
    if (channels.length) {
      loopSettings.channels = channels;
    } else {
      delete loopSettings.channels;
    }
  }
  const newActions = createActionsFromTemplate(
    template,
    info.stepId,
    info.time,
    newInstanceId,
    { loopSettings },
  );
  if (!newActions.length) return;
  let insertionIndex = info.lastIndex + 1;
  if (!Number.isInteger(insertionIndex)) {
    insertionIndex = actions.length;
  }
  actions.splice(insertionIndex, 0, ...newActions);
  renderActions();
  const newIndex = actions.findIndex((action) => action.templateInstanceId === newInstanceId);
  if (newIndex !== -1) {
    setHighlightedAction(newIndex);
  }
  queuePreviewSync();
}

function removeTemplateInstance(instanceId) {
  if (!instanceId) return;
  const info = getTemplateInstanceInfo(instanceId);
  if (!info) return;
  for (let i = info.indices.length - 1; i >= 0; i -= 1) {
    actions.splice(info.indices[i], 1);
  }
  renderActions();
  if (info.stepId) {
    setHighlightedStep(info.stepId);
  }
  queuePreviewSync();
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
    preserveFocus: { templateId, rowId: newRow.id, field: "template-channel-preset" },
  });
  syncTemplateInstances(templateId);
}

function addDelayRowToLightTemplate(templateId) {
  const template = getLightTemplate(templateId);
  if (!template) return;
  if (!Array.isArray(template.rows)) {
    template.rows = [];
  }
  const newRow = createTemplateRowDefaults({ type: TEMPLATE_ROW_TYPES.DELAY, duration: 1 });
  template.rows.push(newRow);
  saveLightTemplates();
  renderLightTemplates({
    preserveFocus: { templateId, rowId: newRow.id, field: "template-delay-duration" },
  });
  syncTemplateInstances(templateId);
}

function duplicateTemplateRow(templateId, rowId) {
  const template = getLightTemplate(templateId);
  if (!template || !Array.isArray(template.rows)) return;
  const index = template.rows.findIndex((row) => row.id === rowId);
  if (index === -1) return;
  const source = template.rows[index];
  const clone =
    source.type === TEMPLATE_ROW_TYPES.DELAY
      ? createTemplateRowDefaults({
          type: TEMPLATE_ROW_TYPES.DELAY,
          duration: source.duration,
        })
      : createTemplateRowDefaults({
          type: TEMPLATE_ROW_TYPES.ACTION,
          channel: source.channel,
          value: source.value,
          fade: source.fade,
          channelPresetId: source.channelPresetId,
          valuePresetId: source.valuePresetId,
          channelMasterId: source.channelMasterId,
          master: source.master ? { ...source.master } : null,
        });
  template.rows.splice(index + 1, 0, clone);
  saveLightTemplates();
  renderLightTemplates({
    preserveFocus: {
      templateId,
      rowId: clone.id,
      field:
        clone.type === TEMPLATE_ROW_TYPES.DELAY
          ? "template-delay-duration"
          : "template-channel-preset",
    },
  });
  syncTemplateInstances(templateId);
}

function reorderTemplateRow(templateId, sourceRowId, targetRowId, placeBefore) {
  const template = getLightTemplate(templateId);
  if (!template || !Array.isArray(template.rows)) return false;
  if (sourceRowId === targetRowId) return false;

  const rows = template.rows;
  const sourceIndex = rows.findIndex((row) => row.id === sourceRowId);
  const targetIndex = rows.findIndex((row) => row.id === targetRowId);
  if (sourceIndex === -1 || targetIndex === -1) return false;

  const [moved] = rows.splice(sourceIndex, 1);
  let insertionIndex = rows.findIndex((row) => row.id === targetRowId);
  if (insertionIndex === -1) {
    rows.splice(sourceIndex, 0, moved);
    return false;
  }
  if (!placeBefore) {
    insertionIndex += 1;
  }
  rows.splice(insertionIndex, 0, moved);
  saveLightTemplates();
  syncTemplateInstances(templateId);
  return true;
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
  if (!row || row.type === TEMPLATE_ROW_TYPES.DELAY) return;
  const select = event.target;
  const selectedOption = select.options[select.selectedIndex];
  const optionType = selectedOption?.dataset?.channelOptionType;
  if (optionType === "master") {
    const masterId = selectedOption?.dataset?.channelMasterId || select.value;
    const master = getChannelMaster(masterId);
    if (master) {
      ensureMasterState(row, master);
      const focusDescriptor = describeFocusedTemplateField(select);
      saveLightTemplates();
      renderLightTemplates({ preserveFocus: focusDescriptor });
      syncTemplateInstances(templateId);
      return;
    }
    row.channelMasterId = null;
    row.master = null;
  }

  const selectedId = select.value;
  const preset = getChannelPreset(selectedId);
  if (preset) {
    applyChannelPresetToTemplateRow(row, preset);
  } else {
    const optionsList = getChannelSelectionOptions();
    const fallbackPreset = optionsList.find((option) => option.type === "preset");
    if (fallbackPreset) {
      applyChannelPresetToTemplateRow(row, fallbackPreset.preset);
    } else {
      const fallbackMaster = optionsList.find((option) => option.type === "master");
      if (fallbackMaster) {
        ensureMasterState(row, fallbackMaster.master);
      } else {
        row.channelPresetId = null;
        row.valuePresetId = null;
      }
    }
  }
  const focusDescriptor = describeFocusedTemplateField(select);
  saveLightTemplates();
  renderLightTemplates({ preserveFocus: focusDescriptor });
  syncTemplateInstances(templateId);
}

function handleTemplateRowValuePresetChange(templateId, rowId, event) {
  const template = getLightTemplate(templateId);
  if (!template) return;
  const row = getTemplateRow(templateId, rowId);
  if (!row || row.type === TEMPLATE_ROW_TYPES.DELAY) return;
  if (row.channelMasterId) {
    return;
  }
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
  if (!row || row.type === TEMPLATE_ROW_TYPES.DELAY) return;
  if (row.channelMasterId) {
    event.target.value = row.value;
    event.target.classList.remove("invalid");
    event.target.setCustomValidity("");
    return;
  }
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
  if (!row || row.type === TEMPLATE_ROW_TYPES.DELAY) return;
  const raw = Number.parseFloat(event.target.value);
  const normalized = Number.isFinite(raw) ? Math.max(0, raw) : 0;
  row.fade = Number(normalized.toFixed(3));
  event.target.value = row.fade;
  saveLightTemplates();
  syncTemplateInstances(templateId);
}

function handleTemplateRowDurationChange(templateId, rowId, event) {
  const template = getLightTemplate(templateId);
  if (!template) return;
  const row = getTemplateRow(templateId, rowId);
  if (!row || row.type !== TEMPLATE_ROW_TYPES.DELAY) return;
  const raw = Number.parseFloat(event.target.value);
  const normalized = Number.isFinite(raw) ? Math.max(0, raw) : 0;
  row.duration = Number(normalized.toFixed(3));
  event.target.value = row.duration;
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
    if (!Object.prototype.hasOwnProperty.call(group, "loop")) {
      group.loop = cloneTemplateLoopSettings(action.templateLoop);
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
    if (Object.prototype.hasOwnProperty.call(group, "loop") && group.loop && template) {
      const channels = collectTemplateChannels(template);
      if (channels.length) {
        group.loop.channels = channels;
      } else if (group.loop) {
        delete group.loop.channels;
      }
    }
    const loopOptions = Object.prototype.hasOwnProperty.call(group, "loop")
      ? { loopSettings: group.loop }
      : {};
    const newActions = createActionsFromTemplate(
      template,
      stepId,
      timeValue,
      instanceId,
      loopOptions,
    );
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

function buildTemplateTimeline(template) {
  const rows = Array.isArray(template?.rows) ? template.rows : [];
  const entries = [];
  let offset = 0;
  rows.forEach((row) => {
    if (!row) return;
    if (row.type === TEMPLATE_ROW_TYPES.DELAY) {
      const durationValue = Number.parseFloat(row.duration);
      const normalized = Number.isFinite(durationValue) ? Math.max(0, durationValue) : 0;
      if (normalized > 0) {
        offset = Number((offset + normalized).toFixed(6));
      }
      return;
    }
    entries.push({ row, offset });
  });
  return { entries, totalDuration: offset };
}

function createActionsFromTemplate(template, stepId, time, instanceId, options = {}) {
  const { entries, totalDuration } = buildTemplateTimeline(template);
  const baseSeconds = parseTimeString(time) ?? parseTimeString(DEFAULT_ACTION.time) ?? 0;
  const hasLoopSettings = Object.prototype.hasOwnProperty.call(options, "loopSettings");
  const loopSettings = hasLoopSettings
    ? options.loopSettings
      ? normalizeTemplateLoop(options.loopSettings)
      : null
    : null;
  const durationValue = Number.isFinite(totalDuration)
    ? Math.max(0, Number(totalDuration.toFixed(6)))
    : 0;

  const created = [];
  let stepTitle = "";
  if (stepId) {
    const info = stepInfoById.get(stepId);
    if (info && typeof info.title === "string") {
      stepTitle = info.title;
    } else {
      const existing = actions.find((item) => getActionStepId(item) === stepId);
      if (existing && typeof existing.stepTitle === "string") {
        stepTitle = existing.stepTitle;
      }
    }
  }
  entries.forEach(({ row, offset }) => {
    const absoluteSeconds = baseSeconds + offset;
    const timecode = secondsToTimecode(absoluteSeconds);
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
    if (stepTitle) {
      action.stepTitle = stepTitle;
    }
    if (loopSettings) {
      const mergedLoop = { ...loopSettings };
      if (durationValue > 0) {
        mergedLoop.duration = durationValue;
      } else {
        mergedLoop.duration = 0;
        mergedLoop.enabled = false;
        mergedLoop.infinite = false;
      }
      action.templateLoop = mergedLoop;
    } else if (hasLoopSettings) {
      action.templateLoop = null;
    }
    ensureActionLocalId(action);
    setActionStepId(action, stepId);
    created.push(action);
  });
  return created;
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
  const baseList = getSortedLightTemplates(lightTemplates);
  const items = normalized
    ? baseList.filter((template) =>
        (template.name || "").toLowerCase().includes(normalized),
      )
    : baseList;

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
    const fade = Number.parseFloat(action.fade) || 0;
    if (fade < 0) {
      throw new Error(`Row ${index + 1}: fade cannot be negative.`);
    }
    if (action.channelMasterId) {
      const master = getChannelMaster(action.channelMasterId);
      if (!master) {
        throw new Error(`Row ${index + 1}: master controller is no longer available.`);
      }
      const expanded = expandMasterAction(action, master, seconds, fade);
      if (!expanded.length) {
        throw new Error(`Row ${index + 1}: master controller has no valid channels.`);
      }
      expanded.forEach((entry) => prepared.push(entry));
      return;
    }
    const channel = Number.parseInt(action.channel, 10);
    if (Number.isNaN(channel) || channel < 1 || channel > 512) {
      throw new Error(`Row ${index + 1}: channel must be between 1 and 512.`);
    }
    const value = Number.parseInt(action.value, 10);
    if (Number.isNaN(value) || value < 0 || value > 255) {
      throw new Error(`Row ${index + 1}: value must be between 0 and 255.`);
    }
    const entry = {
      time: secondsToTimecode(seconds),
      channel,
      value,
      fade: Number(fade.toFixed(3)),
    };
    const stepTitle = typeof action.stepTitle === "string" ? action.stepTitle.trim() : "";
    if (stepTitle) {
      entry.stepTitle = stepTitle;
      if (stepTitle !== action.stepTitle) {
        action.stepTitle = stepTitle;
      }
    } else if (action.stepTitle) {
      action.stepTitle = "";
    }
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
    const loopSettings = sanitizeTemplateLoop(action.templateLoop);
    if (loopSettings && shouldSerializeTemplateLoop(loopSettings)) {
      entry.templateLoop = loopSettings;
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
