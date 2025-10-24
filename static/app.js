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
const searchParams = new URLSearchParams(window.location.search);
const adminParam = (searchParams.get("admin") || "").toLowerCase();
const isAdmin = ["1", "true", "yes", "on"].includes(adminParam);

let userKey = null;
const videoButtons = new Map();

let isFetchingStatus = false;
let statusPollTimer = null;
let isVolumeInteracting = false;
let volumeUpdateTimer = null;
let pendingVolumeValue = null;
let latestStatus = null;
let isTriggeringSmoke = false;
let isTogglingSnowMachine = false;

function showToast(message, type = "info") {
  toastEl.textContent = message;
  toastEl.className = type === "error" ? "visible error" : "visible";
  setTimeout(() => {
    toastEl.classList.remove("visible", "error");
  }, 2400);
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
}

function updatePlayButtons(status) {
  const isVideoActive = Boolean(status && status.mode === "video");
  const disable = !isAdmin && isVideoActive;
  for (const button of videoButtons.values()) {
    if (!button) {
      continue;
    }
    button.disabled = disable;
    if (disable) {
      button.setAttribute("aria-disabled", "true");
    } else {
      button.removeAttribute("aria-disabled");
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
  videoButtons.clear();
  for (const video of videos) {
    const node = template.content.cloneNode(true);
    const card = node.querySelector(".video-card");
    const poster = node.querySelector(".video-poster");
    const title = node.querySelector(".video-title");
    const button = node.querySelector(".play-button");

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
    button.dataset.videoId = videoKey;
    videoButtons.set(videoKey, button);
    const shouldDisable = !isAdmin && latestStatus && latestStatus.mode === "video";
    button.disabled = shouldDisable;
    if (shouldDisable) {
      button.setAttribute("aria-disabled", "true");
    } else {
      button.removeAttribute("aria-disabled");
    }
    button.addEventListener("click", () => playVideo(video.id, video.name));

    fragment.appendChild(node);
  }

  listEl.appendChild(fragment);
  updatePlayButtons(latestStatus);
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

    showToast("Returning to default loop");
    fetchStatus();
  } catch (err) {
    console.error(err);
    showToast(err.message, "error");
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
    ? "Snow Machine…"
    : `Snow Machine: ${active ? "On" : "Off"}`;
}

function updatePlayerUI(status) {
  if (status && typeof status === "object") {
    latestStatus = status;
  }
  updateSmokeButton(status);
  updateSnowMachineButton(status);
  updatePlayButtons(status);

  const controls =
    status && typeof status === "object" && status.controls && typeof status.controls === "object"
      ? status.controls
      : {};
  const canStop = Boolean(controls.can_stop);

  if (playerStopButton) {
    playerStopButton.hidden = !canStop;
    playerStopButton.disabled = !canStop;
  }

  if (!playerBar || !status) {
    return;
  }

  const isVideo = status.mode === "video" && status.video;
  playerBar.classList.toggle("is-default", !isVideo);

  if (playerStatusEl) {
    playerStatusEl.textContent = isVideo ? "Now playing" : "Default loop active";
  }

  if (playerTitleEl) {
    if (isVideo) {
      playerTitleEl.textContent = status.video.name || "Playing";
    } else {
      playerTitleEl.textContent = "Stage screen is showing the loop.";
    }
  }

  if (playerArtworkEl) {
    if (isVideo && status.video.poster) {
      playerArtworkEl.style.backgroundImage = `url(${status.video.poster})`;
      playerArtworkEl.classList.remove("is-placeholder");
    } else if (isVideo) {
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
    volumeSlider.disabled = !isVideo;
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

async function initializeController() {
  await registerUser();
  applyAdminVisibility();
  await fetchVideos();
  await fetchStatus();
  scheduleStatusPolling();
}

initializeController().catch((err) => {
  console.error(err);
  showToast("Unable to initialize controller", "error");
});
