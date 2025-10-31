const template = document.getElementById("video-card-template");
const listEl = document.getElementById("video-list");
const toastEl = document.getElementById("toast");
const playerBar = document.getElementById("player-bar");
const playerStatusEl = document.querySelector(".player-status");
const playerTitleEl = document.querySelector(".player-title");
const playerArtworkEl = document.querySelector(".player-artwork");
const playerProgressEl = document.querySelector(".player-progress");
const progressFillEl = document.querySelector(".player-progress-fill");
const currentTimeEl = document.querySelector(".player-time-current");
const totalTimeEl = document.querySelector(".player-time-total");
const volumeSlider = document.getElementById("volume-slider");
const playerStopButton = document.getElementById("player-stop-button");
const smokeButton = document.getElementById("smoke-button");
const snowMachineButton = document.getElementById("snow-machine-button");
const adminUtilityBar = document.getElementById("admin-utility-bar");
const adminStageCodeValue = document.getElementById("admin-stage-code-value");
const reloadCodeButton = document.getElementById("player-reload-code-button");
const rebootButton = document.getElementById("player-reboot-button");
const accessSection = document.getElementById("access-section");
const codeForm = document.getElementById("code-form");
const codeInput = document.getElementById("code-input");
const codeSubmitButton = codeForm
  ? codeForm.querySelector('button[type="submit"]')
  : null;
const codeErrorEl = document.getElementById("code-error");
const queueSection = document.getElementById("queue-section");
const queueHeading = document.getElementById("queue-heading");
const queuePositionEl = document.getElementById("queue-position");
const queueEtaEl = document.getElementById("queue-eta");
const queueMessageEl = document.getElementById("queue-message");
const queueCountdownEl = document.getElementById("queue-countdown");
const queueLeaveButton = document.getElementById("queue-leave-button");
const regenerateCodeContainer = document.getElementById("regenerate-code-container");
const regenerateCodeButton = document.getElementById("regenerate-code-button");
const regenerateCodeStatusEl = document.getElementById("regenerate-code-status");
const expiredNotice = document.getElementById("expired-notice");
const expiredNoticeMessage = document.getElementById("expired-notice-message");
const performerForm = document.getElementById("queue-performer-form");
const performerInput = document.getElementById("queue-performer-input");
const performerStatusEl = document.getElementById("queue-performer-status");
const performerHelperEl = document.getElementById("queue-performer-helper");
const playerSection = document.getElementById("player-section");
const playerOverlay = document.getElementById("player-playing-overlay");
const stageNameModal = document.getElementById("stage-name-modal");
const stageNameModalInput = document.getElementById("stage-name-modal-input");
const stageNameModalForm = document.getElementById("stage-name-modal-form");
const stageNameModalSkipButton = document.getElementById("stage-name-modal-skip");
const stageNameModalBackdrop = stageNameModal
  ? stageNameModal.querySelector(".stage-name-modal__backdrop")
  : null;
const stageNameModalSkipDefaultLabel = stageNameModalSkipButton
  ? stageNameModalSkipButton.textContent.trim()
  : "Skip";
const searchParams = new URLSearchParams(window.location.search);
const adminParam = (searchParams.get("admin") || "").toLowerCase();
const isAdmin = ["1", "true", "yes", "on"].includes(adminParam);
const reloadCodeButtonDefaultLabel = reloadCodeButton
  ? reloadCodeButton.textContent.trim()
  : "Reload code";
const rebootButtonDefaultLabel = rebootButton ? rebootButton.textContent.trim() : "Restart Pi";
const CODE_DRAFT_STORAGE_KEY = "kpop_stage_code_draft";
const PERFORMER_NAME_MAX_LENGTH = performerInput
  ? Number.parseInt(performerInput.getAttribute("maxlength") || "40", 10)
  : 40;
const PERFORMER_UPDATE_DEBOUNCE_MS = 600;

let userKey = null;
let codeDraftValue = "";
const videoCards = new Map();

let isFetchingStatus = false;
let statusPollTimer = null;
let isVolumeInteracting = false;
let volumeUpdateTimer = null;
let pendingVolumeValue = null;
let latestStatus = null;
let isTriggeringSmoke = false;
let isTogglingSnowMachine = false;
let isSendingReboot = false;
let isReloadingStageCode = false;
let queuePollTimer = null;
let queueCountdownTimer = null;
let queueReadyExpiresAt = null;
let lastQueueState = null;
let currentQueueState = null;
let isJoiningQueue = false;
let isRegeneratingStageCode = false;
let toastHideTimer = null;
let toastHideTimerContext = null;
let activeToastContext = null;
let currentQueueEntryId = null;
let performerUpdateTimer = null;
let performerLastKnownValue = "";
let performerLastSubmittedValue = "";
let performerStatusTimer = null;
let performerStatusKind = null;
let performerIsSaving = false;
let performerInputDirty = false;
let pendingPlayRequest = null;
let isStageNameModalOpen = false;
let stageNameModalLastFocused = null;
let latestQueueSize = 0;
let latestQueueEntry = null;

function getQueueRemainingSeconds() {
  if (queueReadyExpiresAt === null) {
    return null;
  }
  const remainingMs = queueReadyExpiresAt - Date.now();
  if (!Number.isFinite(remainingMs)) {
    return null;
  }
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  if (!Number.isFinite(remainingSeconds)) {
    return null;
  }
  return Math.max(0, remainingSeconds);
}

function getStageNameModalSkipDisplaySeconds(remainingSeconds = null) {
  if (!Number.isFinite(remainingSeconds)) {
    return null;
  }
  return Math.max(0, Math.floor(remainingSeconds) - 1);
}

function updateStageNameModalSkipLabel(remainingSeconds = null) {
  if (!stageNameModalSkipButton) {
    return;
  }

  const displaySeconds = getStageNameModalSkipDisplaySeconds(remainingSeconds);
  if (!isStageNameModalOpen || displaySeconds === null) {
    stageNameModalSkipButton.textContent = stageNameModalSkipDefaultLabel;
    return;
  }

  stageNameModalSkipButton.textContent = `${stageNameModalSkipDefaultLabel} (${displaySeconds}s)`;
}

function setRegenerateCodeStatus(message = "", options = {}) {
  if (!regenerateCodeStatusEl) {
    return;
  }

  const { isError = false } = options;

  const text = typeof message === "string" ? message.trim() : "";
  regenerateCodeStatusEl.textContent = text;
  regenerateCodeStatusEl.classList.toggle("is-error", Boolean(isError && text));
  regenerateCodeStatusEl.hidden = !text;
}

function isDefaultLoopActive(status = null) {
  const snapshot = status && typeof status === "object" ? status : latestStatus;
  if (!snapshot || typeof snapshot !== "object") {
    return false;
  }

  if (snapshot.mode === "video") {
    const controls =
      snapshot.controls && typeof snapshot.controls === "object" ? snapshot.controls : null;
    if (controls && Object.prototype.hasOwnProperty.call(controls, "has_active_owner")) {
      return !controls.has_active_owner;
    }
    return false;
  }

  return true;
}

function updateRegenerateCodeVisibility(queueSize = 0, entry = latestQueueEntry) {
  if (!regenerateCodeContainer || !regenerateCodeButton || isAdmin) {
    return;
  }

  const activeEntry = Boolean(entry && typeof entry === "object");
  const count = Number.isFinite(queueSize) ? Math.max(0, queueSize) : 0;
  const defaultLoopActive = isDefaultLoopActive();
  const shouldShow = defaultLoopActive && !activeEntry && count === 0;

  regenerateCodeContainer.hidden = !shouldShow;
  regenerateCodeButton.disabled = !shouldShow || isRegeneratingStageCode;

  if (!shouldShow) {
    setRegenerateCodeStatus("");
  }
}

function hideToast(context = null) {
  if (!toastEl) {
    return;
  }
  if (context && activeToastContext && activeToastContext !== context) {
    return;
  }
  toastEl.classList.remove("visible", "error");
  if (!context || activeToastContext === context) {
    activeToastContext = null;
  }
  if (!context || !toastHideTimerContext || toastHideTimerContext === context) {
    if (toastHideTimer) {
      clearTimeout(toastHideTimer);
      toastHideTimer = null;
      toastHideTimerContext = null;
    }
  }
}

function showToast(message, options = {}) {
  if (!toastEl) {
    return;
  }

  let type = "info";
  let duration = 2400;
  let persist = false;
  let context = null;

  if (typeof options === "string") {
    type = options;
  } else if (options && typeof options === "object") {
    ({ type = "info", duration = 2400, persist = false, context = null } = options);
  }

  if (toastHideTimer) {
    clearTimeout(toastHideTimer);
    toastHideTimer = null;
    toastHideTimerContext = null;
  }

  toastEl.textContent = message;
  toastEl.classList.toggle("error", type === "error");
  toastEl.classList.add("visible");
  activeToastContext = context;

  if (persist) {
    return;
  }

  const timeout = Number.isFinite(duration) ? Math.max(0, duration) : 2400;
  if (timeout <= 0) {
    hideToast(context);
    return;
  }

  toastHideTimerContext = context;
  toastHideTimer = setTimeout(() => {
    hideToast(context);
  }, timeout);
}

function showExpiredNotice(message) {
  if (expiredNotice) {
    expiredNotice.hidden = false;
  }
  if (expiredNoticeMessage && typeof message === "string") {
    expiredNoticeMessage.textContent = message;
  }
}

function hideExpiredNotice() {
  if (expiredNotice) {
    expiredNotice.hidden = true;
  }
}

function setPlayerSectionLocked(locked) {
  if (!playerSection) {
    return;
  }
  playerSection.classList.toggle("is-locked", Boolean(locked));
}

function setBodyQueueState(state) {
  const states = ["queue-waiting", "queue-ready", "queue-playing"];
  document.body.classList.remove(...states);
  currentQueueState = state;
  if (state) {
    document.body.classList.add(state);
  } else {
    currentQueueState = null;
  }
}

function openStageNameModal(initialValue = "") {
  if (!stageNameModal) {
    return false;
  }

  const activeElement = document.activeElement;
  stageNameModalLastFocused =
    activeElement && typeof activeElement.focus === "function" ? activeElement : null;

  isStageNameModalOpen = true;
  stageNameModal.hidden = false;

  if (document.body) {
    document.body.classList.add("has-modal");
  }

  if (stageNameModalInput) {
    const sanitized = sanitizePerformerNameInput(initialValue || "");
    stageNameModalInput.value = sanitized;
    stageNameModalInput.focus();
    stageNameModalInput.select();
  }

  updateStageNameModalSkipLabel(getQueueRemainingSeconds());

  return true;
}

function closeStageNameModal() {
  if (!stageNameModal) {
    return;
  }

  stageNameModal.hidden = true;
  isStageNameModalOpen = false;

  if (document.body) {
    document.body.classList.remove("has-modal");
  }

  if (stageNameModalInput) {
    stageNameModalInput.value = "";
  }

  updateStageNameModalSkipLabel(null);

  const lastFocused = stageNameModalLastFocused;
  stageNameModalLastFocused = null;

  if (lastFocused && typeof lastFocused.focus === "function") {
    try {
      if (document.contains(lastFocused)) {
        lastFocused.focus();
      }
    } catch (err) {
      console.warn("Unable to restore focus after closing modal", err);
    }
  }
}

function cancelStageNameModal() {
  pendingPlayRequest = null;
  closeStageNameModal();
}

async function handleStageNameModalSubmit(event) {
  if (event) {
    event.preventDefault();
  }

  if (!pendingPlayRequest) {
    closeStageNameModal();
    return;
  }

  const { id, name } = pendingPlayRequest;
  pendingPlayRequest = null;

  const normalized = stageNameModalInput
    ? sanitizePerformerNameInput(stageNameModalInput.value)
    : "";

  closeStageNameModal();

  if (stageNameModalInput) {
    stageNameModalInput.value = "";
  }

  if (performerInput) {
    performerInput.value = normalized;
    performerInputDirty = false;
  }

  try {
    await submitPerformerName(normalized);
  } catch (err) {
    console.error("Unable to save stage name before playback", err);
  }

  playVideo(id, name);
}

function handleStageNameModalSkip(event) {
  if (event) {
    event.preventDefault();
  }

  if (!pendingPlayRequest) {
    cancelStageNameModal();
    return;
  }

  const { id, name } = pendingPlayRequest;
  pendingPlayRequest = null;
  closeStageNameModal();
  playVideo(id, name);
}

function showReadyToast(remainingSeconds = null) {
  if (!toastEl) {
    return;
  }
  let seconds = Number.isFinite(remainingSeconds) ? remainingSeconds : null;
  if (!Number.isFinite(seconds) && queueReadyExpiresAt !== null) {
    const diff = queueReadyExpiresAt - Date.now();
    seconds = Math.max(0, Math.ceil(diff / 1000));
  }
  let message = "You're up!";
  if (Number.isFinite(seconds)) {
    if (seconds > 0) {
      message = `${message} You have ${seconds}s to pick a song.`;
    } else {
      message = `${message} Time's up!`;
    }
  }
  if (activeToastContext === "queue-ready" && toastEl.innerHTML === message) {
    return;
  }
  showToast(message, { persist: true, context: "queue-ready" });
}

function clearQueueCountdown() {
  if (queueCountdownTimer) {
    clearInterval(queueCountdownTimer);
    queueCountdownTimer = null;
  }
  queueReadyExpiresAt = null;
  if (queueCountdownEl) {
    queueCountdownEl.hidden = true;
    queueCountdownEl.textContent = "";
  }
  updateStageNameModalSkipLabel(null);
  hideToast("queue-ready");
}

function updateQueueCountdown() {
  if (!queueCountdownEl || queueReadyExpiresAt === null) {
    return;
  }
  const remainingMs = queueReadyExpiresAt - Date.now();
  const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  queueCountdownEl.textContent = formatTime(remainingSeconds);
  if (isStageNameModalOpen) {
    updateStageNameModalSkipLabel(remainingSeconds);
    const skipDisplaySeconds = getStageNameModalSkipDisplaySeconds(remainingSeconds);
    if (pendingPlayRequest && skipDisplaySeconds !== null && skipDisplaySeconds <= 0) {
      handleStageNameModalSkip();
      return;
    }
  }
  if (currentQueueState === "queue-ready") {
    showReadyToast(remainingSeconds);
  }
  if (remainingSeconds <= 0 && queueCountdownTimer) {
    clearInterval(queueCountdownTimer);
    queueCountdownTimer = null;
  }
}

function startQueueCountdown(seconds) {
  if (!queueCountdownEl) {
    return;
  }
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  queueReadyExpiresAt = Date.now() + safeSeconds * 1000;
  queueCountdownEl.hidden = false;
  updateQueueCountdown();
  if (queueCountdownTimer) {
    clearInterval(queueCountdownTimer);
  }
  queueCountdownTimer = setInterval(updateQueueCountdown, 500);
  if (isStageNameModalOpen) {
    updateStageNameModalSkipLabel(getQueueRemainingSeconds());
  }
}

async function registerUser() {
  try {
    const response = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ admin: isAdmin }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Registration failed (${response.status})`);
    }
    const payload = await response.json();
    if (payload && payload.key) {
      userKey = payload.key;
    } else {
      throw new Error("Registration response missing key");
    }
  } catch (err) {
    console.error(err);
    showToast("Unable to join controller session", "error");
  }
}

function applyAdminVisibility() {
  if (adminUtilityBar) {
    adminUtilityBar.hidden = !isAdmin;
  }
  if (reloadCodeButton) {
    reloadCodeButton.hidden = !isAdmin;
    reloadCodeButton.disabled = false;
    if (!isAdmin) {
      reloadCodeButton.textContent = reloadCodeButtonDefaultLabel;
      isReloadingStageCode = false;
    }
  }
  if (volumeSlider) {
    volumeSlider.hidden = !isAdmin;
  }
  if (smokeButton && !isAdmin) {
    smokeButton.hidden = true;
  }
  if (snowMachineButton && !isAdmin) {
    snowMachineButton.hidden = true;
  }
  if (rebootButton) {
    rebootButton.hidden = !isAdmin;
  }
  if (isAdmin) {
    if (accessSection) {
      accessSection.hidden = true;
    }
    if (queueSection) {
      queueSection.hidden = true;
    }
    if (playerSection) {
      playerSection.hidden = false;
    }
  }
}

function setAdminStageCodeValue(code) {
  if (!adminStageCodeValue) {
    return;
  }
  const nextValue = typeof code === "string" && code.trim() ? code.trim() : "—";
  adminStageCodeValue.textContent = nextValue;
}

async function refreshStageCode(options = {}) {
  if (!isAdmin) {
    return;
  }

  const { rotate = false, silent = false } = options;

  if (rotate && (!reloadCodeButton || isReloadingStageCode)) {
    return;
  }

  if (!userKey) {
    if (rotate && !silent) {
      showToast("Unable to reload stage code right now", "error");
    }
    return;
  }

  const fetchOptions = { method: rotate ? "POST" : "GET" };
  let url = "/api/queue/code";

  if (rotate) {
    fetchOptions.headers = { "Content-Type": "application/json" };
    fetchOptions.body = JSON.stringify({ key: userKey });
  } else {
    const params = new URLSearchParams({ key: userKey });
    url = `${url}?${params.toString()}`;
  }

  if (rotate && reloadCodeButton) {
    isReloadingStageCode = true;
    reloadCodeButton.disabled = true;
    reloadCodeButton.textContent = "Reloading…";
  }

  try {
    const response = await fetch(url, fetchOptions);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        payload.error ||
        `Unable to ${rotate ? "reload" : "load"} stage code (${response.status})`;
      throw new Error(message);
    }

    const newCode = typeof payload.code === "string" ? payload.code.trim() : "";
    if (!newCode) {
      throw new Error(payload.error || "Stage code unavailable");
    }

    setAdminStageCodeValue(newCode);
    if (adminUtilityBar) {
      adminUtilityBar.hidden = false;
    }

    if (rotate) {
      const message = payload.message || `Stage code reloaded: ${newCode}`;
      showToast(message);
    }
  } catch (err) {
    console.error(err);
    if (!silent) {
      showToast(err.message || "Unable to load stage code", "error");
    }
  } finally {
    if (rotate && reloadCodeButton) {
      reloadCodeButton.disabled = false;
      reloadCodeButton.textContent = reloadCodeButtonDefaultLabel;
      isReloadingStageCode = false;
    }
  }
}

function formatEstimatedWaitDuration(seconds, fallbackMinutes = 3) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return `${fallbackMinutes}min remaining.`;
  }
  if (seconds < 60) {
    const secs = Math.max(1, Math.ceil(seconds));
    return `${secs}sec remaining.`;
  }
  const exactMinutes = seconds / 60;
  const floorMinutes = Math.floor(exactMinutes);
  const ceilMinutes = Math.ceil(exactMinutes);
  if (!Number.isFinite(exactMinutes) || ceilMinutes <= 0) {
    return `${fallbackMinutes}min remaining.`;
  }
  if (Number.isInteger(exactMinutes)) {
    return `${exactMinutes}min remaining.`;
  }
  if (ceilMinutes - exactMinutes <= 0.5) {
    return `less than ${ceilMinutes}min remaining.`;
  }
  return `${Math.max(1, floorMinutes)}min remaining.`;
}

function describeEstimatedWait(seconds) {
  return `<b>Estimated wait:</b> ${formatEstimatedWaitDuration(seconds)}`;
}

function normalizeCodeInput(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function loadStoredCodeDraft() {
  if (typeof localStorage === "undefined") {
    return "";
  }
  try {
    const raw = localStorage.getItem(CODE_DRAFT_STORAGE_KEY) || "";
    return normalizeCodeInput(raw);
  } catch (err) {
    console.warn("Unable to load stored code draft", err);
    return "";
  }
}

function storeCodeDraft(value) {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    const normalized = normalizeCodeInput(value);
    if (normalized) {
      localStorage.setItem(CODE_DRAFT_STORAGE_KEY, normalized);
    } else {
      localStorage.removeItem(CODE_DRAFT_STORAGE_KEY);
    }
  } catch (err) {
    console.warn("Unable to store code draft", err);
  }
}

function clearStoredCodeDraft() {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.removeItem(CODE_DRAFT_STORAGE_KEY);
  } catch (err) {
    console.warn("Unable to clear stored code draft", err);
  }
}

function sanitizePerformerNameInput(value) {
  if (typeof value !== "string") {
    return "";
  }
  const cleaned = value.replace(/\r\n/g, " ").replace(/[\r\n]/g, " ");
  const collapsed = cleaned.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return "";
  }
  const limit = Number.isFinite(PERFORMER_NAME_MAX_LENGTH)
    ? Math.max(1, PERFORMER_NAME_MAX_LENGTH)
    : 40;
  if (collapsed.length <= limit) {
    return collapsed;
  }
  return collapsed.slice(0, limit).trimEnd();
}

function getCurrentPerformerNameDraft() {
  if (performerInput) {
    const fromInput = sanitizePerformerNameInput(performerInput.value);
    if (fromInput) {
      return fromInput;
    }
  }

  const fromSubmitted = sanitizePerformerNameInput(performerLastSubmittedValue || "");
  if (fromSubmitted) {
    return fromSubmitted;
  }

  const fromKnown = sanitizePerformerNameInput(performerLastKnownValue || "");
  if (fromKnown) {
    return fromKnown;
  }

  return "";
}

function setPerformerStatus(message, type = "info") {
  if (!performerStatusEl) {
    return;
  }
  if (performerStatusTimer) {
    clearTimeout(performerStatusTimer);
    performerStatusTimer = null;
  }

  if (!message) {
    performerStatusEl.hidden = true;
    performerStatusEl.textContent = "";
    performerStatusEl.classList.remove("is-error", "is-pending", "is-success");
    performerStatusKind = null;
    return;
  }

  performerStatusKind = type;
  performerStatusEl.hidden = false;
  performerStatusEl.textContent = message;
  performerStatusEl.classList.toggle("is-error", type === "error");
  performerStatusEl.classList.toggle("is-pending", type === "pending");
  performerStatusEl.classList.toggle("is-success", type === "success");

  if (type === "pending") {
    return;
  }

  performerStatusTimer = setTimeout(() => {
    if (performerStatusKind !== "pending") {
      setPerformerStatus("", "info");
    }
  }, 2500);
}

function clearPerformerUi() {
  currentQueueEntryId = null;
  performerLastKnownValue = "";
  performerLastSubmittedValue = "";
  performerInputDirty = false;
  if (performerForm) {
    performerForm.hidden = true;
  }
  if (performerHelperEl) {
    performerHelperEl.hidden = true;
  }
  if (performerInput) {
    performerInput.value = "";
    performerInput.disabled = true;
  }
  setPerformerStatus("", "info");
}

function syncPerformerUi(entry, state) {
  const entryId = entry && typeof entry.id === "string" ? entry.id : null;
  const serverName = entry && typeof entry.performer_name === "string" ? entry.performer_name : "";
  currentQueueEntryId = entryId;
  performerLastKnownValue = serverName;
  performerLastSubmittedValue = serverName;

  const canEdit = Boolean(entryId && (state === "waiting" || state === "ready"));

  if (performerForm) {
    performerForm.hidden = !canEdit;
  }
  if (performerHelperEl) {
    performerHelperEl.hidden = !canEdit;
  }
  if (performerInput) {
    performerInput.disabled = !canEdit;
    const normalizedCurrent = sanitizePerformerNameInput(performerInput.value);
    if (!performerInputDirty || normalizedCurrent === serverName || !canEdit) {
      performerInput.value = serverName;
    }
    if (!canEdit) {
      performerInputDirty = false;
    }
  }

  if (!canEdit) {
    setPerformerStatus("", "info");
  }
}

function schedulePerformerUpdate(force = false) {
  if (!performerInput || !currentQueueEntryId) {
    return;
  }

  const normalized = sanitizePerformerNameInput(performerInput.value);

  if (!force) {
    if (
      normalized === performerLastKnownValue &&
      normalized === performerLastSubmittedValue &&
      !performerIsSaving
    ) {
      return;
    }
  }

  if (performerUpdateTimer) {
    clearTimeout(performerUpdateTimer);
    performerUpdateTimer = null;
  }

  const submit = () => {
    performerUpdateTimer = null;
    submitPerformerName(normalized);
  };

  if (force) {
    submit();
  } else {
    performerUpdateTimer = setTimeout(submit, PERFORMER_UPDATE_DEBOUNCE_MS);
  }
}

async function submitPerformerName(normalizedValue) {
  if (!performerInput || !currentQueueEntryId) {
    return;
  }

  const payloadValue = normalizedValue || "";
  if (
    !performerIsSaving &&
    payloadValue === performerLastKnownValue &&
    payloadValue === performerLastSubmittedValue
  ) {
    return;
  }

  performerIsSaving = true;
  performerLastSubmittedValue = payloadValue;
  setPerformerStatus("Saving…", "pending");

  try {
    const response = await fetch("/api/queue/performer", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: payloadValue || null,
        entry_id: currentQueueEntryId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to save performer name (${response.status})`);
    }

    const payload = await response.json().catch(() => ({}));
    performerIsSaving = false;

    if (payload && typeof payload === "object" && payload.entry) {
      updateQueueUI(payload);
    }

    if (payloadValue) {
      setPerformerStatus("Performer saved!", "success");
    } else {
      setPerformerStatus("Performer cleared", "success");
    }
  } catch (err) {
    performerIsSaving = false;
    console.error(err);
    setPerformerStatus("Couldn't save the name", "error");
  }
}

if (performerForm) {
  performerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!performerInput) {
      return;
    }
    const normalized = sanitizePerformerNameInput(performerInput.value);
    if (performerInput.value !== normalized) {
      performerInput.value = normalized;
    }
    schedulePerformerUpdate(true);
  });
}

if (performerInput) {
  performerInput.addEventListener("input", () => {
    performerInputDirty = true;
    schedulePerformerUpdate(false);
  });
  performerInput.addEventListener("focus", () => {
    performerInputDirty = true;
  });
  performerInput.addEventListener("blur", () => {
    performerInputDirty = false;
    const normalized = sanitizePerformerNameInput(performerInput.value);
    if (performerInput.value !== normalized) {
      performerInput.value = normalized;
    }
    schedulePerformerUpdate(true);
  });
}

if (stageNameModalForm) {
  stageNameModalForm.addEventListener("submit", handleStageNameModalSubmit);
}

if (stageNameModalSkipButton) {
  stageNameModalSkipButton.addEventListener("click", handleStageNameModalSkip);
}

if (stageNameModalBackdrop) {
  stageNameModalBackdrop.addEventListener("click", () => {
    cancelStageNameModal();
  });
}

if (stageNameModal) {
  stageNameModal.addEventListener("click", (event) => {
    if (event.target === stageNameModal) {
      cancelStageNameModal();
    }
  });
}

if (regenerateCodeButton && !isAdmin) {
  regenerateCodeButton.addEventListener("click", (event) => {
    event.preventDefault();
    regenerateStageCode();
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isStageNameModalOpen) {
    event.preventDefault();
    cancelStageNameModal();
  }
});

if (codeInput && !isAdmin) {
  const storedDraft = loadStoredCodeDraft();
  if (storedDraft) {
    codeDraftValue = storedDraft;
    codeInput.value = storedDraft;
  }
}

function updateCodeSubmitState() {
  if (!codeSubmitButton) {
    return;
  }
  const code = normalizeCodeInput(codeInput ? codeInput.value : "");
  const canSubmit = code.length === 4 && !isJoiningQueue;
  codeSubmitButton.disabled = !canSubmit;
}

function resetQueueUiForIdle(options = {}) {
  const { preserveCodeInput = false, clearCodeInput = false } = options;
  setBodyQueueState(null);
  clearQueueCountdown();
  hideExpiredNotice();
  document.body.classList.remove("is-playing");
  if (playerOverlay) {
    playerOverlay.hidden = true;
  }
  if (queueSection) {
    queueSection.hidden = true;
  }
  if (queueHeading) {
    queueHeading.textContent = "";
  }
  if (queuePositionEl) {
    queuePositionEl.textContent = "";
  }
  if (queueEtaEl) {
    queueEtaEl.textContent = "";
  }
  if (queueMessageEl) {
    queueMessageEl.textContent = "";
  }
  if (queueLeaveButton) {
    queueLeaveButton.hidden = true;
    queueLeaveButton.disabled = false;
  }
  clearPerformerUi();
  if (!isAdmin) {
    if (accessSection) {
      accessSection.hidden = false;
    }
    if (playerSection) {
      playerSection.hidden = true;
    }
    setPlayerSectionLocked(true);
    if (codeInput) {
      if (clearCodeInput) {
        codeDraftValue = "";
        codeInput.value = "";
        clearStoredCodeDraft();
      } else if (preserveCodeInput) {
        codeInput.value = codeDraftValue;
      } else {
        const normalizedCurrent = normalizeCodeInput(codeInput.value);
        if (codeInput.value !== normalizedCurrent) {
          codeInput.value = normalizedCurrent;
        }
        if (codeDraftValue !== normalizedCurrent) {
          codeDraftValue = normalizedCurrent;
          storeCodeDraft(normalizedCurrent);
        }
      }
    }
    updateCodeSubmitState();
    userKey = null;
  }
  lastQueueState = null;
  latestQueueEntry = null;
  updateRegenerateCodeVisibility(latestQueueSize, null);
}

function updateQueueUI(payload) {
  if (!payload || typeof payload !== "object") {
    return;
  }

  const queueSizeValue = Number.isFinite(payload.queue_size)
    ? Math.max(0, Math.floor(payload.queue_size))
    : 0;
  latestQueueSize = queueSizeValue;

  const entry = payload.entry && typeof payload.entry === "object" ? payload.entry : null;
  latestQueueEntry = entry;
  updateRegenerateCodeVisibility(queueSizeValue, entry);
  if (!entry) {
    clearPerformerUi();
    if (!isAdmin) {
      const shouldPreserveCode = Boolean(codeDraftValue);
      resetQueueUiForIdle({ preserveCodeInput: shouldPreserveCode });
    }
    return;
  }

  const state = entry.state;
  const previousState = lastQueueState;
  lastQueueState = state;

  syncPerformerUi(entry, state);

  if (state !== "expired") {
    hideExpiredNotice();
  }

  if (accessSection) {
    accessSection.hidden = true;
  }
  if (queueSection) {
    queueSection.hidden = false;
  }

  if (queueLeaveButton) {
    queueLeaveButton.hidden = false;
    queueLeaveButton.disabled = false;
  }

  if (queuePositionEl) {
    queuePositionEl.textContent = "";
  }
  if (queueEtaEl) {
    queueEtaEl.textContent = "";
  }
  if (queueMessageEl) {
    queueMessageEl.textContent = "";
  }

  switch (state) {
    case "waiting": {
      setBodyQueueState("queue-waiting");
      clearQueueCountdown();
      const rawPosition = Number.isFinite(entry.position)
        ? Math.floor(entry.position)
        : null;
      const rawWaitingPosition = Number.isFinite(entry.waiting_position)
        ? Math.floor(entry.waiting_position)
        : null;
      const position = rawPosition !== null ? Math.max(rawPosition, 0) : null;
      const waitingPosition = rawWaitingPosition !== null ? Math.max(rawWaitingPosition, 1) : null;
      const displayPosition = waitingPosition || (position && position > 0 ? position : null);
      const aheadTotal = position && position > 0 ? position - 1 : 0;
      const aheadWaiting = waitingPosition ? waitingPosition - 1 : aheadTotal;
      const isNext = waitingPosition ? aheadWaiting === 0 : aheadTotal === 0 && Boolean(position);
      if (queueHeading) {
        if (isNext) {
          queueHeading.textContent = "You're NEXT in line";
        } else if (displayPosition === 1) {
          queueHeading.textContent = "You're almost up";
        } else {
          queueHeading.textContent = "You're in line";
        }
      }
      if (queuePositionEl) {
        if (isNext) {
          queuePositionEl.textContent = "";
        } else if (displayPosition) {
          queuePositionEl.textContent = `You are #${displayPosition} in line.`;
        } else {
          queuePositionEl.textContent = "You have a spot in line.";
        }
      }
      if (queueEtaEl) {
        if (isNext && Number.isFinite(entry.estimated_wait_seconds)) {
          const remainingSeconds = Math.max(
            0,
            Math.ceil(Number(entry.estimated_wait_seconds))
          );
          if (remainingSeconds <= 0) {
            queueEtaEl.innerHTML = "<b>Estimated wait:</b> Any moment now.";
          } else {
            queueEtaEl.innerHTML = `<b>Estimated wait:</b> ${formatEstimatedWaitDuration(
              remainingSeconds,
              0
            )}`;
          }
        } else {
          queueEtaEl.innerHTML = describeEstimatedWait(entry.estimated_wait_seconds);
        }
      }
      if (queueMessageEl) {
        if (aheadWaiting > 1) {
          queueMessageEl.textContent = `${aheadWaiting} people are ahead of you.`;
        } else if (aheadWaiting === 1) {
          queueMessageEl.textContent =
            "Get ready. You'll have 30s to select your song when the stage opens.";
        } else {
          queueMessageEl.textContent = "You'll be invited to pick a song soon.";
        }
      }
      if (!isAdmin && playerSection) {
        playerSection.hidden = true;
        setPlayerSectionLocked(true);
        userKey = null;
        if (playerOverlay) {
          playerOverlay.hidden = true;
        }
        document.body.classList.remove("is-playing");
      }
      break;
    }
    case "ready": {
      setBodyQueueState("queue-ready");
      const expiresIn = Number.isFinite(entry.ready_expires_in)
        ? entry.ready_expires_in
        : payload.selection_timeout;
      startQueueCountdown(expiresIn || 30);
      if (queueHeading) {
        queueHeading.textContent = "It's your turn!";
      }
      if (queuePositionEl) {
        queuePositionEl.textContent = "Head to the player below.";
      }
      if (queueEtaEl) {
        queueEtaEl.textContent = "Select a song within 30 seconds.";
      }
      if (queueMessageEl) {
        queueMessageEl.textContent = "";
      }
      if (!isAdmin && playerSection) {
        playerSection.hidden = false;
        setPlayerSectionLocked(false);
      }
      if (playerOverlay) {
        playerOverlay.hidden = true;
      }
      document.body.classList.remove("is-playing");
      if (entry.user_key) {
        userKey = entry.user_key;
      }
      showReadyToast();
      if (!isAdmin && playerSection && previousState !== "ready") {
        playerSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      break;
    }
    case "playing": {
      setBodyQueueState("queue-playing");
      clearQueueCountdown();
      if (queueHeading) {
        queueHeading.textContent = "Enjoy the show!";
      }
      if (queuePositionEl) {
        queuePositionEl.innerHTML = `Your song is live on the stage. Don't forget to capture this moment and share it. <a class="ig-link" href="instagram-stories://share"><img class="icon" src="/static/ig_logo.png" /> Open Instagram</a>`;
      }
      if (queueMessageEl) {
        queueMessageEl.textContent = "";
      }
      if (queueLeaveButton) {
        queueLeaveButton.hidden = true;
      }
      if (!isAdmin && playerSection) {
        playerSection.hidden = true;
        setPlayerSectionLocked(true);
      }
      if (playerOverlay) {
        playerOverlay.hidden = true;
      }
      if (entry.user_key) {
        userKey = entry.user_key;
      }
      break;
    }
    case "expired": {
      resetQueueUiForIdle();
      showExpiredNotice("Your spot expired. Enter the new code to rejoin.");
      break;
    }
    case "cancelled": {
      resetQueueUiForIdle();
      if (queueSection) {
        queueSection.hidden = false;
      }
      if (queuePositionEl) {
        queuePositionEl.textContent = "";
      }
      if (queueLeaveButton) {
        queueLeaveButton.hidden = true;
      }
      if (queueHeading) {
        queueHeading.textContent = "You left the line";
      }
      if (queueMessageEl) {
        queueMessageEl.textContent = "Re-enter the current code any time to join again.";
      }
      break;
    }
    case "finished": {
      resetQueueUiForIdle();
      if (queueSection) {
        queueSection.hidden = false;
      }
      if (queuePositionEl) {
        queuePositionEl.textContent = "";
      }
      if (queueLeaveButton) {
        queueLeaveButton.hidden = true;
      }
      if (queueHeading) {
        queueHeading.textContent = "Hope you enjoyed the show!";
      }
      if (queueMessageEl) {
        queueMessageEl.innerHTML = 'Please make sure to share and tag @tyrsen in any posts or videos. <a href="https://instagram.com/tyrsen" class="ig-link"><img class="icon" src="/static/ig_logo.png" /> @tyrsen</a>';
      }
      break;
    }
    default: {
      resetQueueUiForIdle();
      break;
    }
  }
}

async function fetchQueueStatus(showErrors = false) {
  try {
    const response = await fetch("/api/queue/status", { credentials: "include" });
    if (!response.ok) {
      throw new Error(`Queue status failed (${response.status})`);
    }
    const payload = await response.json();
    updateQueueUI(payload);
  } catch (err) {
    console.error(err);
    if (showErrors) {
      showToast("Unable to sync the queue", "error");
    }
  }
}

async function regenerateStageCode() {
  if (!regenerateCodeButton || isRegeneratingStageCode || isAdmin) {
    return;
  }

  isRegeneratingStageCode = true;
  regenerateCodeButton.disabled = true;
  setRegenerateCodeStatus("Refreshing the stage screen…");

  try {
    const response = await fetch("/api/queue/regenerate-code", { method: "POST" });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = payload.error || `Unable to refresh the code (${response.status})`;
      setRegenerateCodeStatus(message, { isError: true });
      throw new Error(message);
    }

    const message = payload.message || "Stage code refreshed.";
    setRegenerateCodeStatus(message);
    showToast(message);
    await fetchQueueStatus();
  } catch (err) {
    console.error(err);
    showToast(err.message || "Unable to refresh the code", "error");
  } finally {
    isRegeneratingStageCode = false;
    if (regenerateCodeButton) {
      regenerateCodeButton.disabled = regenerateCodeContainer
        ? regenerateCodeContainer.hidden
        : false;
    }
  }
}

async function joinQueue(code) {
  if (!code || isJoiningQueue) {
    return;
  }
  if (codeErrorEl) {
    codeErrorEl.hidden = true;
    codeErrorEl.textContent = "";
  }
  isJoiningQueue = true;
  updateCodeSubmitState();
  try {
    const requestBody = { code };
    if (performerInput) {
      const performerNameDraft = sanitizePerformerNameInput(performerInput.value);
      requestBody.performer_name = performerNameDraft ? performerNameDraft : null;
    }
    const response = await fetch("/api/queue/join", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload.error || "Invalid access code.";
      clearStoredCodeDraft();
      codeDraftValue = "";
      if (codeInput) {
        codeInput.value = "";
      }
      updateCodeSubmitState();
      if (codeErrorEl) {
        codeErrorEl.hidden = false;
        codeErrorEl.textContent = message;
      }
      throw new Error(message);
    }
    if (codeInput) {
      codeInput.value = "";
    }
    codeDraftValue = "";
    clearStoredCodeDraft();
    updateQueueUI(payload);
  } catch (err) {
    console.error(err);
    if (!codeErrorEl || codeErrorEl.hidden) {
      showToast(err.message || "Unable to join the queue", "error");
    }
  } finally {
    isJoiningQueue = false;
    updateCodeSubmitState();
  }
}

async function leaveQueue() {
  try {
    if (queueLeaveButton) {
      queueLeaveButton.disabled = true;
    }
    const response = await fetch("/api/queue/leave", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Unable to leave queue (${response.status})`);
    }
  } catch (err) {
    console.error(err);
    showToast(err.message || "Unable to leave the line", "error");
  } finally {
    if (queueLeaveButton) {
      queueLeaveButton.disabled = false;
    }
    fetchQueueStatus();
  }
}

function startQueuePolling() {
  if (queuePollTimer) {
    clearInterval(queuePollTimer);
  }
  queuePollTimer = setInterval(() => {
    fetchQueueStatus();
  }, 5000);
}

function stopQueuePolling() {
  if (queuePollTimer) {
    clearInterval(queuePollTimer);
    queuePollTimer = null;
  }
}

function updateVideoCards(status) {
  const isVideoActive = Boolean(status && status.mode === "video");
  const disable = !isAdmin && isVideoActive;
  for (const card of videoCards.values()) {
    if (!card) {
      continue;
    }
    card.classList.toggle("is-disabled", disable);
    if (disable) {
      card.setAttribute("aria-disabled", "true");
      card.tabIndex = -1;
    } else {
      card.removeAttribute("aria-disabled");
      card.tabIndex = 0;
    }
  }
}

async function fetchVideos() {
  try {
    let url = "/api/videos";
    if (userKey) {
      const params = new URLSearchParams();
      params.set("key", userKey);
      url = `${url}?${params.toString()}`;
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }

    const data = await response.json();
    renderVideos(data.videos || []);
  } catch (err) {
    console.error(err);
    listEl.innerHTML = "<p class=\"error-message\">Unable to load videos.</p>";
    showToast("Unable to load videos", "error");
  }
}

function renderVideos(videos) {
  listEl.innerHTML = "";
  if (!videos.length) {
    listEl.innerHTML = "<p class=\"empty-message\">No videos configured yet.</p>";
    return;
  }

  const fragment = document.createDocumentFragment();
  videoCards.clear();
  for (const video of videos) {
    const node = template.content.cloneNode(true);
    const card = node.querySelector(".video-card");
    const poster = node.querySelector(".video-poster");
    const title = node.querySelector(".video-title");

    if (video.poster) {
      poster.src = video.poster;
      poster.alt = `${video.name} poster`;
    } else {
      poster.removeAttribute("src");
      poster.remove();
      const placeholder = document.createElement("div");
      placeholder.className = "poster-placeholder";
      placeholder.textContent = "Artwork coming soon";
      placeholder.setAttribute("aria-hidden", "true");
      card.prepend(placeholder);
    }
    title.textContent = video.name;
    const videoKey = video.id || title.textContent || "";
    if (card) {
      const hasName = typeof video.name === "string" && video.name.trim().length > 0;
      card.dataset.videoId = videoKey;
      if (hasName) {
        card.setAttribute("aria-label", `Play ${video.name}`);
      } else {
        card.setAttribute("aria-label", "Play video");
      }
      const handleSelect = () => {
        if (card.classList.contains("is-disabled")) {
          return;
        }
        requestPlayVideo(video.id, video.name);
      };
      card.addEventListener("click", handleSelect);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
          event.preventDefault();
          handleSelect();
        }
      });
      videoCards.set(videoKey, card);
    }

    fragment.appendChild(node);
  }

  listEl.appendChild(fragment);
  updateVideoCards(latestStatus);
}

function requestPlayVideo(id, name) {
  if (!userKey) {
    showToast("Unable to select a video right now", "error");
    return;
  }

  const performerDraft = getCurrentPerformerNameDraft();

  if (!stageNameModal || performerDraft || !currentQueueEntryId) {
    playVideo(id, name);
    return;
  }

  pendingPlayRequest = { id, name };

  if (isStageNameModalOpen) {
    if (stageNameModalInput) {
      stageNameModalInput.value = performerDraft;
      stageNameModalInput.focus();
      stageNameModalInput.select();
    }
    return;
  }

  const opened = openStageNameModal(performerDraft);
  if (!opened) {
    playVideo(id, name);
  }
}

async function playVideo(id, name) {
  if (!userKey) {
    showToast("Unable to select a video right now", "error");
    return;
  }
  try {
    const response = await fetch("/api/play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, key: userKey }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Unable to play video (${response.status})`);
    }

    showToast(`Playing ${name}`);
    fetchStatus();
  } catch (err) {
    console.error(err);
    showToast(err.message, "error");
  }
}

async function stopPlayback() {
  if (!userKey) {
    showToast("Unable to stop playback right now", "error");
    return;
  }
  try {
    const response = await fetch("/api/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: userKey }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Unable to stop playback (${response.status})`);
    }

    showToast("Song Ended");
    fetchStatus();
  } catch (err) {
    console.error(err);
    showToast(err.message, "error");
  }
}

async function requestSystemReboot() {
  if (!rebootButton || isSendingReboot) {
    return;
  }
  const confirmed = window.confirm("Restart the Raspberry Pi now?");
  if (!confirmed) {
    return;
  }

  isSendingReboot = true;
  rebootButton.disabled = true;
  rebootButton.textContent = "Restarting…";

  try {
    const response = await fetch("/api/system/restart", { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload.error || `Unable to restart (${response.status})`;
      throw new Error(message);
    }
    const message =
      payload.message || "Restart command sent. The Raspberry Pi will reboot shortly.";
    showToast(message);
  } catch (err) {
    console.error(err);
    showToast(err.message || "Unable to restart the Raspberry Pi.", "error");
    rebootButton.disabled = false;
    rebootButton.textContent = rebootButtonDefaultLabel;
    isSendingReboot = false;
  }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

function updateSmokeButton(status) {
  if (!smokeButton) {
    return;
  }
  if (!isAdmin) {
    smokeButton.hidden = true;
    return;
  }
  let available = false;
  let active = false;
  if (status && typeof status === "object") {
    if (Object.prototype.hasOwnProperty.call(status, "smoke_available")) {
      available = Boolean(status.smoke_available);
    }
    if (Object.prototype.hasOwnProperty.call(status, "smoke_active")) {
      active = Boolean(status.smoke_active);
    }
  }
  if (!available && latestStatus && typeof latestStatus === "object") {
    if (Object.prototype.hasOwnProperty.call(latestStatus, "smoke_available")) {
      available = Boolean(latestStatus.smoke_available);
    }
    if (!active && Object.prototype.hasOwnProperty.call(latestStatus, "smoke_active")) {
      active = Boolean(latestStatus.smoke_active);
    }
  }
  smokeButton.hidden = !available;
  if (!available) {
    smokeButton.disabled = true;
    smokeButton.textContent = "Smoke";
    return;
  }
  const busy = active || isTriggeringSmoke;
  smokeButton.disabled = busy;
  smokeButton.textContent = busy ? "Smoking…" : "Smoke";
}

function updateSnowMachineButton(status) {
  if (!snowMachineButton) {
    return;
  }
  if (!isAdmin) {
    snowMachineButton.hidden = true;
    return;
  }

  let available = false;
  let active = false;

  if (status && typeof status === "object") {
    if (Object.prototype.hasOwnProperty.call(status, "snow_machine_available")) {
      available = Boolean(status.snow_machine_available);
    }
    if (Object.prototype.hasOwnProperty.call(status, "snow_machine_active")) {
      active = Boolean(status.snow_machine_active);
    }
  }

  if (!available && latestStatus && typeof latestStatus === "object") {
    if (Object.prototype.hasOwnProperty.call(latestStatus, "snow_machine_available")) {
      available = Boolean(latestStatus.snow_machine_available);
    }
    if (!active && Object.prototype.hasOwnProperty.call(latestStatus, "snow_machine_active")) {
      active = Boolean(latestStatus.snow_machine_active);
    }
  }

  snowMachineButton.hidden = !available;
  snowMachineButton.setAttribute("aria-pressed", active ? "true" : "false");

  if (!available) {
    snowMachineButton.disabled = true;
    snowMachineButton.textContent = "Snow Machine";
    return;
  }

  const busy = isTogglingSnowMachine;
  snowMachineButton.disabled = busy;
  snowMachineButton.textContent = busy
    ? "Snowing…"
    : `Snow ${active ? "ON" : "OFF"}`;
}

function updatePlayerUI(status) {
  if (status && typeof status === "object") {
    latestStatus = status;
  }
  updateSmokeButton(status);
  updateSnowMachineButton(status);
  updateVideoCards(status);
  updateRegenerateCodeVisibility(latestQueueSize);

  const controls =
    status && typeof status === "object" && status.controls && typeof status.controls === "object"
      ? status.controls
      : {};
  const canStop = Boolean(controls.can_stop);
  const hasActiveOwner = Boolean(controls.has_active_owner);
  const queueState = currentQueueState;
  const isQueueReady = queueState === "queue-ready";
  const isQueuePlaying = queueState === "queue-playing";

  if (playerStopButton) {
    playerStopButton.hidden = !canStop;
    playerStopButton.disabled = !canStop;
  }

  if (!playerBar || !status) {
    return;
  }

  const isVideoMode = status.mode === "video";
  const videoInfo = isVideoMode && status.video ? status.video : null;
  const isVideoActive = isVideoMode && hasActiveOwner;
  const shouldHideSelection =
    !isAdmin && !isQueueReady && ((isQueuePlaying && isVideoMode) || isVideoActive);
  document.body.classList.toggle("is-playing", shouldHideSelection);
  if (playerOverlay) {
    playerOverlay.hidden = !shouldHideSelection;
  }
  playerBar.hidden = false;
  playerBar.classList.toggle("is-default", !isVideoMode);

  if (playerStatusEl) {
    playerStatusEl.textContent = isVideoMode ? "Now playing" : "Default loop active";
  }

  if (playerTitleEl) {
    if (videoInfo && videoInfo.name) {
      playerTitleEl.textContent = videoInfo.name;
    } else if (isVideoMode) {
      playerTitleEl.textContent = "Playing";
    } else {
      playerTitleEl.textContent = "Stage screen is showing the loop.";
    }
  }

  if (playerArtworkEl) {
    if (videoInfo && videoInfo.poster) {
      playerArtworkEl.style.backgroundImage = `url(${videoInfo.poster})`;
      playerArtworkEl.classList.remove("is-placeholder");
    } else if (isVideoMode) {
      playerArtworkEl.style.backgroundImage = "";
      playerArtworkEl.classList.add("is-placeholder");
    } else {
      playerArtworkEl.style.backgroundImage = "";
      playerArtworkEl.classList.remove("is-placeholder");
    }
  }

  const duration = Number.isFinite(status.duration) ? status.duration : null;
  const position = Number.isFinite(status.position) ? Math.max(0, status.position) : 0;

  if (playerProgressEl) {
    const percent = duration && duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
    playerProgressEl.setAttribute("aria-valuenow", percent.toFixed(1));
    playerProgressEl.setAttribute(
      "aria-valuetext",
      duration ? `${formatTime(position)} of ${formatTime(duration)}` : ""
    );
    if (progressFillEl) {
      progressFillEl.style.width = `${percent}%`;
    }
  }

  if (currentTimeEl) {
    currentTimeEl.textContent = duration ? formatTime(position) : "0:00";
  }

  if (totalTimeEl) {
    totalTimeEl.textContent = duration ? formatTime(duration) : "0:00";
  }

  if (volumeSlider && isAdmin) {
    const volume = Number.isFinite(status.volume) ? Math.max(0, Math.min(100, status.volume)) : null;
    volumeSlider.disabled = !isVideoMode;
    if (volume !== null && !isVolumeInteracting) {
      volumeSlider.value = String(Math.round(volume));
    }
  }
}

async function fetchStatus() {
  if (isFetchingStatus) {
    return;
  }
  isFetchingStatus = true;
  try {
    const statusUrl = userKey ? `/api/status?key=${encodeURIComponent(userKey)}` : "/api/status";
    const response = await fetch(statusUrl);
    if (!response.ok) {
      throw new Error(`Status request failed (${response.status})`);
    }
    const payload = await response.json();
    updatePlayerUI(payload);
  } catch (err) {
    console.error(err);
  } finally {
    isFetchingStatus = false;
  }
}

function scheduleStatusPolling() {
  if (statusPollTimer) {
    clearInterval(statusPollTimer);
  }
  statusPollTimer = setInterval(fetchStatus, 1000);
}

function scheduleVolumeUpdate(value) {
  if (!isAdmin || !userKey) {
    return;
  }
  if (!volumeSlider || volumeSlider.disabled) {
    return;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return;
  }

  pendingVolumeValue = Math.max(0, Math.min(100, numeric));

  if (volumeUpdateTimer) {
    clearTimeout(volumeUpdateTimer);
  }

  volumeUpdateTimer = setTimeout(() => {
    volumeUpdateTimer = null;
    if (pendingVolumeValue === null) {
      return;
    }
    sendVolumeUpdate(pendingVolumeValue);
  }, 180);
}

async function sendVolumeUpdate(value) {
  pendingVolumeValue = null;
  if (!isAdmin || !userKey) {
    return;
  }
  try {
    const response = await fetch("/api/volume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ volume: value, key: userKey }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Unable to set volume (${response.status})`);
    }
    const returnedVolume = Number.isFinite(payload.volume) ? payload.volume : value;
    if (volumeSlider && !isVolumeInteracting) {
      volumeSlider.value = String(Math.round(Math.max(0, Math.min(100, returnedVolume))));
    }
  } catch (err) {
    console.error(err);
    showToast(err.message || "Unable to set volume", "error");
  } finally {
    fetchStatus();
  }
}

async function triggerSmoke() {
  if (isTriggeringSmoke) {
    return;
  }
  if (!isAdmin) {
    return;
  }
  if (!userKey) {
    showToast("Unable to trigger smoke right now", "error");
    return;
  }
  isTriggeringSmoke = true;
  const interimStatus = {
    ...(latestStatus && typeof latestStatus === "object" ? latestStatus : {}),
    smoke_available: true,
    smoke_active: true,
  };
  latestStatus = interimStatus;
  updateSmokeButton(interimStatus);
  try {
    const response = await fetch("/api/dmx/smoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: userKey }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Unable to trigger smoke (${response.status})`);
    }
    showToast("Smoke triggered");
  } catch (err) {
    console.error(err);
    showToast(err.message || "Unable to trigger smoke", "error");
  } finally {
    isTriggeringSmoke = false;
    updateSmokeButton(latestStatus);
    fetchStatus();
  }
}

async function toggleSnowMachine() {
  if (isTogglingSnowMachine) {
    return;
  }
  if (!isAdmin || !snowMachineButton) {
    return;
  }
  if (!userKey) {
    showToast("Unable to control snow machine right now", "error");
    return;
  }

  const currentActive =
    latestStatus && typeof latestStatus === "object" && Object.prototype.hasOwnProperty.call(latestStatus, "snow_machine_active")
      ? Boolean(latestStatus.snow_machine_active)
      : false;
  const desired = !currentActive;

  isTogglingSnowMachine = true;
  const previousStatus =
    latestStatus && typeof latestStatus === "object"
      ? { ...latestStatus }
      : latestStatus;
  const interimStatus = {
    ...(latestStatus && typeof latestStatus === "object" ? latestStatus : {}),
    snow_machine_available: true,
    snow_machine_active: desired,
  };
  latestStatus = interimStatus;
  updateSnowMachineButton(interimStatus);

  try {
    const response = await fetch("/api/relay/snow-machine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: userKey, active: desired }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Unable to toggle snow machine (${response.status})`);
    }
    const activeValue = Object.prototype.hasOwnProperty.call(payload, "active")
      ? Boolean(payload.active)
      : desired;
    latestStatus = {
      ...(latestStatus && typeof latestStatus === "object" ? latestStatus : {}),
      snow_machine_available: true,
      snow_machine_active: activeValue,
    };
    updateSnowMachineButton(latestStatus);
    const message = typeof payload.message === "string" && payload.message
      ? payload.message
      : `Snow machine turned ${activeValue ? "on" : "off"}`;
    showToast(message);
  } catch (err) {
    console.error(err);
    showToast(err.message || "Unable to control snow machine", "error");
    latestStatus = previousStatus;
    updateSnowMachineButton(previousStatus && typeof previousStatus === "object" ? previousStatus : null);
  } finally {
    isTogglingSnowMachine = false;
    updateSnowMachineButton(latestStatus);
    fetchStatus();
  }
}

if (playerStopButton) {
  playerStopButton.addEventListener("click", stopPlayback);
}

if (volumeSlider && isAdmin) {
  volumeSlider.addEventListener("input", (event) => {
    isVolumeInteracting = true;
    scheduleVolumeUpdate(event.target.value);
  });
  volumeSlider.addEventListener("change", (event) => {
    isVolumeInteracting = false;
    scheduleVolumeUpdate(event.target.value);
  });
  volumeSlider.addEventListener("blur", () => {
    isVolumeInteracting = false;
  });
} else if (volumeSlider) {
  volumeSlider.hidden = true;
}

if (smokeButton && isAdmin) {
  smokeButton.addEventListener("click", triggerSmoke);
} else if (smokeButton) {
  smokeButton.hidden = true;
}

if (snowMachineButton && isAdmin) {
  snowMachineButton.addEventListener("click", toggleSnowMachine);
} else if (snowMachineButton) {
  snowMachineButton.hidden = true;
}

if (reloadCodeButton && isAdmin) {
  reloadCodeButton.addEventListener("click", () => {
    refreshStageCode({ rotate: true });
  });
} else if (reloadCodeButton) {
  reloadCodeButton.hidden = true;
}

if (rebootButton && isAdmin) {
  rebootButton.addEventListener("click", requestSystemReboot);
} else if (rebootButton) {
  rebootButton.hidden = true;
}

if (codeInput && !isAdmin) {
  codeInput.addEventListener("input", () => {
    const normalized = normalizeCodeInput(codeInput.value);
    if (codeInput.value !== normalized) {
      codeInput.value = normalized;
    }
    codeDraftValue = normalized;
    storeCodeDraft(normalized);
    if (codeErrorEl && !codeErrorEl.hidden) {
      codeErrorEl.hidden = true;
      codeErrorEl.textContent = "";
    }
    updateCodeSubmitState();
    if (normalized.length === 4 && !isJoiningQueue && codeForm) {
      codeForm.requestSubmit();
    }
  });
}

if (codeForm && !isAdmin) {
  codeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = normalizeCodeInput(codeInput ? codeInput.value : "");
    if (!code || code.length < 4) {
      if (codeErrorEl) {
        codeErrorEl.hidden = false;
        codeErrorEl.textContent = "Enter the 4-digit code shown on the stage.";
      }
      return;
    }
    joinQueue(code);
  });
  updateCodeSubmitState();
}

if (queueLeaveButton && !isAdmin) {
  queueLeaveButton.addEventListener("click", leaveQueue);
}

async function initializeApp() {
  applyAdminVisibility();
  if (isAdmin) {
    await registerUser();
    await refreshStageCode({ silent: true });
  }
  await fetchVideos();
  await fetchStatus();
  scheduleStatusPolling();
  if (!isAdmin) {
    await fetchQueueStatus(true);
    startQueuePolling();
  }
}

initializeApp().catch((err) => {
  console.error(err);
  showToast("Unable to initialize controller", "error");
});
