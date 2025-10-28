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
const expiredNotice = document.getElementById("expired-notice");
const expiredNoticeMessage = document.getElementById("expired-notice-message");
const playerSection = document.getElementById("player-section");
const playerOverlay = document.getElementById("player-playing-overlay");
const searchParams = new URLSearchParams(window.location.search);
const adminParam = (searchParams.get("admin") || "").toLowerCase();
const isAdmin = ["1", "true", "yes", "on"].includes(adminParam);
const rebootButtonDefaultLabel = rebootButton ? rebootButton.textContent.trim() : "Restart Pi";
const CODE_DRAFT_STORAGE_KEY = "kpop_stage_code_draft";

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
let queuePollTimer = null;
let queueCountdownTimer = null;
let queueReadyExpiresAt = null;
let lastQueueState = null;
let currentQueueState = null;
let isJoiningQueue = false;
let toastHideTimer = null;
let toastHideTimerContext = null;
let activeToastContext = null;

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
  hideToast("queue-ready");
}

function updateQueueCountdown() {
  if (!queueCountdownEl || queueReadyExpiresAt === null) {
    return;
  }
  const remainingMs = queueReadyExpiresAt - Date.now();
  const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  queueCountdownEl.textContent = formatTime(remainingSeconds);
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
  return String(value || "").replace(/\D/g, "").slice(0, 5);
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
  const canSubmit = code.length === 5 && !isJoiningQueue;
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
}

function updateQueueUI(payload) {
  if (!payload || typeof payload !== "object") {
    return;
  }

  const entry = payload.entry && typeof payload.entry === "object" ? payload.entry : null;
  if (!entry) {
    if (!isAdmin) {
      const shouldPreserveCode = Boolean(codeDraftValue);
      resetQueueUiForIdle({ preserveCodeInput: shouldPreserveCode });
    }
    return;
  }

  const state = entry.state;
  const previousState = lastQueueState;
  lastQueueState = state;

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
    const response = await fetch("/api/queue/join", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
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
    const response = await fetch("/api/videos");
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
        playVideo(video.id, video.name);
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
    if (normalized.length === 5 && !isJoiningQueue && codeForm) {
      codeForm.requestSubmit();
    }
  });
}

if (codeForm && !isAdmin) {
  codeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = normalizeCodeInput(codeInput ? codeInput.value : "");
    if (!code || code.length < 5) {
      if (codeErrorEl) {
        codeErrorEl.hidden = false;
        codeErrorEl.textContent = "Enter the 5-digit code shown on the stage.";
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
