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

let isFetchingStatus = false;
let statusPollTimer = null;
let isVolumeInteracting = false;
let volumeUpdateTimer = null;
let pendingVolumeValue = null;
let latestStatus = null;
let isTriggeringSmoke = false;

function showToast(message, type = "info") {
  toastEl.textContent = message;
  toastEl.className = type === "error" ? "visible error" : "visible";
  setTimeout(() => {
    toastEl.classList.remove("visible", "error");
  }, 2400);
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
    button.addEventListener("click", () => playVideo(video.id, video.name));

    fragment.appendChild(node);
  }

  listEl.appendChild(fragment);
}

async function playVideo(id, name) {
  try {
    const response = await fetch("/api/play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
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
  try {
    const response = await fetch("/api/stop", { method: "POST" });

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

function updatePlayerUI(status) {
  if (status && typeof status === "object") {
    latestStatus = status;
  }
  updateSmokeButton(status);
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

  if (volumeSlider) {
    const volume = Number.isFinite(status.volume) ? Math.max(0, Math.min(100, status.volume)) : null;
    volumeSlider.disabled = !isVideo;
    if (volume !== null && !isVolumeInteracting) {
      volumeSlider.value = String(Math.round(volume));
    }
  }

  if (playerStopButton) {
    playerStopButton.disabled = !isVideo;
  }
}

async function fetchStatus() {
  if (isFetchingStatus) {
    return;
  }
  isFetchingStatus = true;
  try {
    const response = await fetch("/api/status");
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
  try {
    const response = await fetch("/api/volume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ volume: value }),
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
  isTriggeringSmoke = true;
  const interimStatus = {
    ...(latestStatus && typeof latestStatus === "object" ? latestStatus : {}),
    smoke_available: true,
    smoke_active: true,
  };
  latestStatus = interimStatus;
  updateSmokeButton(interimStatus);
  try {
    const response = await fetch("/api/dmx/smoke", { method: "POST" });
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

if (playerStopButton) {
  playerStopButton.addEventListener("click", stopPlayback);
}

if (volumeSlider) {
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
}

if (smokeButton) {
  smokeButton.addEventListener("click", triggerSmoke);
}

fetchVideos();
fetchStatus();
scheduleStatusPolling();
