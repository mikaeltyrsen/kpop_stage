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
const searchParams = new URLSearchParams(window.location.search);
const adminParam = (searchParams.get("admin") || "").toLowerCase();
const isAdmin = ["1", "true", "yes", "on"].includes(adminParam);

function makeBarElement(id) {
  const element = document.getElementById(id);
  return {
    element,
    white: element ? element.querySelector(".white-color") : null,
  };
}

function makeBeamElement(id, baseRotation) {
  const element = document.getElementById(id);
  return {
    element,
    white: element ? element.querySelector(".white-color") : null,
    baseRotation,
    currentAngle: baseRotation,
    currentHeight: 500,
  };
}

const stageElements = {
  bars: {
    front: makeBarElement("light-bar-1"),
    back: makeBarElement("light-bar-2"),
    left: makeBarElement("light-bar-3"),
    right: makeBarElement("light-bar-4"),
  },
  mover: document.getElementById("mover-light"),
  beams: [
    makeBeamElement("beam-1", 225),
    makeBeamElement("beam-2", 315),
    makeBeamElement("beam-3", 315),
    makeBeamElement("beam-4", 225),
  ],
  lasers: {
    red: document.getElementById("red-laser"),
    green: document.getElementById("green-laser"),
  },
  ledStrip: document.getElementById("led-strip"),
};

const DMX_CHANNEL_MAP = {
  bars: {
    front: { brightness: 30, red: 31, green: 32, blue: 33, white: 34, strobe: 35 },
    back: { brightness: 20, red: 21, green: 22, blue: 23, white: 24, strobe: 25 },
    left: { brightness: 1, red: 2, green: 3, blue: 4, white: 5, strobe: 6 },
    right: { brightness: 10, red: 11, green: 12, blue: 13, white: 14, strobe: 15 },
  },
  mover: {
    rotation: 40,
    rotationSpeed: 41,
    beamRotation: [43, 44, 45, 46],
    brightness: 47,
    strobe: 48,
    red: 49,
    green: 50,
    blue: 51,
    white: 52,
    laserRed: 54,
    laserGreen: 55,
  },
};

const LIGHT_BAR_SHADOWS = {
  front: {
    outer: ["0px -20px 20px", "0px -20px 50px", "0px -3px 0px"],
    white: ["0px -20px 20px", "0px -20px 50px", "0px -3px 0px"],
  },
  back: {
    outer: ["0px 0px 40px"],
    white: ["0px 0px 40px"],
  },
  left: {
    outer: ["0px 20px 20px", "0px 20px 50px", "0px 3px 0px"],
    white: ["0px 20px 20px", "0px 20px 50px", "0px 3px 0px"],
  },
  right: {
    outer: ["0px 20px 20px", "0px 20px 50px", "0px 3px 0px"],
    white: ["0px 20px 20px", "0px 20px 50px", "0px 3px 0px"],
  },
};

const strobeControllers = new WeakMap();
const MOVER_BASE_ANGLE = 45;
const stageState = {
  moverAngle: MOVER_BASE_ANGLE,
  hasData: false,
};

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  if (numeric <= 0) {
    return 0;
  }
  if (numeric >= 1) {
    return 1;
  }
  return numeric;
}

function toRgba(r, g, b, alpha) {
  const a = clamp01(alpha);
  return `rgba(${Math.max(0, Math.min(255, Math.round(r)))}, ${Math.max(
    0,
    Math.min(255, Math.round(g))
  )}, ${Math.max(0, Math.min(255, Math.round(b)))}, ${a.toFixed(3)})`;
}

function getDMXLevel(levels, channel) {
  if (!Array.isArray(levels)) {
    return 0;
  }
  const index = Number(channel) - 1;
  if (!Number.isFinite(index) || index < 0 || index >= levels.length) {
    return 0;
  }
  const raw = Number(levels[index]);
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return Math.max(0, Math.min(255, Math.round(raw)));
}

function buildShadow(offsets, color) {
  return offsets.map((offset) => `${offset} ${color}`).join(", ");
}

class StrobeController {
  constructor(element) {
    this.element = element;
    this.timer = null;
    this.active = false;
    this.onDuration = 0;
    this.offDuration = 0;
    this.visible = true;
    this.value = 0;
  }

  clearTimer() {
    if (this.timer) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  stop() {
    this.active = false;
     this.value = 0;
    this.clearTimer();
    if (this.element) {
      this.element.style.visibility = "";
    }
  }

  scheduleToggle(duration) {
    this.clearTimer();
    if (!this.active || !this.element) {
      return;
    }
    this.timer = window.setTimeout(() => this.toggle(), duration * 1000);
  }

  startCycle() {
    if (!this.element) {
      return;
    }
    this.visible = true;
    this.element.style.visibility = "";
    this.scheduleToggle(this.onDuration);
  }

  toggle() {
    if (!this.active || !this.element) {
      return;
    }
    this.visible = !this.visible;
    this.element.style.visibility = this.visible ? "" : "hidden";
    const nextDuration = this.visible ? this.onDuration : this.offDuration;
    this.scheduleToggle(nextDuration);
  }

  update(value, enabled) {
    if (!enabled || !Number.isFinite(value) || value <= 0) {
      this.stop();
      return;
    }
    const numeric = Math.max(1, Math.min(255, Math.round(value)));
    if (this.active && numeric === this.value) {
      return;
    }
    const frameDuration = 2 / 30;
    const cycleDuration = Math.max(2 / numeric, frameDuration + 0.01);
    this.onDuration = frameDuration;
    this.offDuration = Math.max(cycleDuration - frameDuration, 0.01);
    this.active = true;
    this.value = numeric;
    this.startCycle();
  }
}

function applyStrobe(element, value, enabled) {
  if (!element) {
    return;
  }
  let controller = strobeControllers.get(element);
  if (!controller) {
    controller = new StrobeController(element);
    strobeControllers.set(element, controller);
  }
  controller.update(value, enabled);
}

function computeRotationDuration(speed, deltaAngle) {
  const absDelta = Math.abs(deltaAngle);
  if (absDelta < 0.01 || !Number.isFinite(absDelta)) {
    return 0;
  }
  if (!Number.isFinite(speed) || speed <= 0) {
    return 0;
  }
  const normalized = Math.max(1, Math.min(255, Math.round(speed)));
  const baseDuration = 10 - ((normalized - 1) / 254) * 9;
  const ratio = Math.min(absDelta / 520, 1);
  return Math.max(baseDuration * ratio, 0.05);
}

function computeBeamDuration(speed, deltaAngle) {
  const absDelta = Math.abs(deltaAngle);
  if (absDelta < 0.01 || !Number.isFinite(absDelta)) {
    return 0;
  }
  if (!Number.isFinite(speed) || speed <= 0) {
    return 0;
  }
  const normalized = Math.max(1, Math.min(255, Math.round(speed)));
  const baseDuration = 3 - ((normalized - 1) / 254) * 2.5;
  const ratio = Math.min(absDelta / 180, 1);
  return Math.max(baseDuration * ratio, 0.05);
}

function computeBeamHeight(angleDegrees) {
  if (!Number.isFinite(angleDegrees)) {
    return 500;
  }
  const clamped = Math.max(0, Math.min(180, angleDegrees));
  if (clamped <= 90) {
    const ratio = clamped / 90;
    return 500 - ratio * (500 - 50);
  }
  const ratio = (clamped - 90) / 90;
  return 50 + ratio * (500 - 50);
}

function updateLightBar(name, levels) {
  const config = DMX_CHANNEL_MAP.bars[name];
  const bar = stageElements.bars[name];
  if (!config || !bar || !bar.element) {
    return;
  }
  const brightness = getDMXLevel(levels, config.brightness);
  const red = getDMXLevel(levels, config.red);
  const green = getDMXLevel(levels, config.green);
  const blue = getDMXLevel(levels, config.blue);
  const white = getDMXLevel(levels, config.white);
  const strobe = getDMXLevel(levels, config.strobe);
  const brightnessAlpha = brightness / 255;
  if (brightnessAlpha > 0) {
    const color = toRgba(red, green, blue, brightnessAlpha);
    const offsets = LIGHT_BAR_SHADOWS[name]?.outer || [];
    bar.element.style.boxShadow = offsets.length ? buildShadow(offsets, color) : "none";
  } else {
    bar.element.style.boxShadow = "none";
  }
  if (bar.white) {
    const whiteAlpha = white / 255;
    const whiteOffsets = LIGHT_BAR_SHADOWS[name]?.white || [];
    bar.white.style.boxShadow = whiteAlpha > 0 && whiteOffsets.length
      ? buildShadow(whiteOffsets, toRgba(255, 255, 255, whiteAlpha))
      : "none";
  }
  applyStrobe(bar.element, strobe, brightnessAlpha > 0);
}

function updateLightBars(levels) {
  updateLightBar("front", levels);
  updateLightBar("back", levels);
  updateLightBar("left", levels);
  updateLightBar("right", levels);
}

function updateMover(levels) {
  const mover = stageElements.mover;
  if (!mover) {
    return;
  }
  const brightness = getDMXLevel(levels, DMX_CHANNEL_MAP.mover.brightness);
  const brightnessAlpha = clamp01(brightness / 255);
  mover.style.opacity = brightnessAlpha > 0 ? brightnessAlpha.toFixed(3) : "0";

  const strobe = getDMXLevel(levels, DMX_CHANNEL_MAP.mover.strobe);
  applyStrobe(mover, strobe, brightnessAlpha > 0);

  const rotationValue = getDMXLevel(levels, DMX_CHANNEL_MAP.mover.rotation);
  const rotationSpeed = getDMXLevel(levels, DMX_CHANNEL_MAP.mover.rotationSpeed);
  const targetAngle = MOVER_BASE_ANGLE + (rotationValue / 255) * 520;
  const deltaAngle = targetAngle - stageState.moverAngle;
  const duration = computeRotationDuration(rotationSpeed, deltaAngle);
  mover.style.transition = duration > 0 ? `transform ${duration.toFixed(3)}s linear` : "";
  mover.style.transform = `rotate(${targetAngle}deg)`;
  stageState.moverAngle = targetAngle;

  const red = getDMXLevel(levels, DMX_CHANNEL_MAP.mover.red);
  const green = getDMXLevel(levels, DMX_CHANNEL_MAP.mover.green);
  const blue = getDMXLevel(levels, DMX_CHANNEL_MAP.mover.blue);
  const beamColor = toRgba(red, green, blue, brightnessAlpha);
  const whiteValue = getDMXLevel(levels, DMX_CHANNEL_MAP.mover.white);
  const whiteAlpha = clamp01(whiteValue / 255);

  const beamRotationChannels = DMX_CHANNEL_MAP.mover.beamRotation;
  stageElements.beams.forEach((beam, index) => {
    if (!beam.element) {
      return;
    }
    const channel = beamRotationChannels[index] || 0;
    const rotationLevel = getDMXLevel(levels, channel);
    const angleDegrees = (rotationLevel / 255) * 180;
    const actualAngle = beam.baseRotation - angleDegrees;
    const delta = actualAngle - beam.currentAngle;
    const durationSeconds = computeBeamDuration(rotationSpeed, delta);
    beam.element.style.transition =
      durationSeconds > 0
        ? `transform ${durationSeconds.toFixed(3)}s linear, height ${durationSeconds.toFixed(3)}s linear`
        : "";
    beam.element.style.transform = `rotate(${actualAngle}deg)`;
    const height = computeBeamHeight(angleDegrees);
    beam.element.style.setProperty("height", `${height}%`, "important");
    beam.element.style.background = beamColor;
    if (beam.white) {
      beam.white.style.opacity = whiteAlpha > 0 ? whiteAlpha.toFixed(3) : "0";
    }
    beam.currentAngle = actualAngle;
    beam.currentHeight = height;
  });

  const redLaser = stageElements.lasers.red;
  if (redLaser) {
    const value = getDMXLevel(levels, DMX_CHANNEL_MAP.mover.laserRed);
    redLaser.style.opacity = clamp01(value / 255).toFixed(3);
  }
  const greenLaser = stageElements.lasers.green;
  if (greenLaser) {
    const value = getDMXLevel(levels, DMX_CHANNEL_MAP.mover.laserGreen);
    greenLaser.style.opacity = clamp01(value / 255).toFixed(3);
  }

  if (stageElements.ledStrip) {
    const stripOpacity = brightnessAlpha > 0 ? Math.max(0.35, brightnessAlpha) : 0;
    stageElements.ledStrip.style.opacity = stripOpacity.toFixed(3);
    const outlineAlpha = brightnessAlpha > 0 ? Math.max(0.35, brightnessAlpha) : 0;
    stageElements.ledStrip.style.outlineColor = toRgba(red, green, blue, outlineAlpha);
  }
}

function resetStageVisualizer() {
  Object.values(stageElements.bars).forEach((bar) => {
    if (!bar || !bar.element) {
      return;
    }
    bar.element.style.boxShadow = "none";
    if (bar.white) {
      bar.white.style.boxShadow = "none";
    }
    applyStrobe(bar.element, 0, false);
  });
  if (stageElements.mover) {
    stageElements.mover.style.transition = "";
    stageElements.mover.style.transform = `rotate(${MOVER_BASE_ANGLE}deg)`;
    stageElements.mover.style.opacity = "0";
    applyStrobe(stageElements.mover, 0, false);
  }
  stageElements.beams.forEach((beam) => {
    if (!beam.element) {
      return;
    }
    beam.element.style.transition = "";
    beam.element.style.transform = `rotate(${beam.baseRotation}deg)`;
    beam.element.style.setProperty("height", "500%", "important");
    beam.element.style.background = "rgba(0, 0, 0, 0.85)";
    if (beam.white) {
      beam.white.style.opacity = "0";
    }
    beam.currentAngle = beam.baseRotation;
    beam.currentHeight = 500;
  });
  if (stageElements.lasers.red) {
    stageElements.lasers.red.style.opacity = "0";
  }
  if (stageElements.lasers.green) {
    stageElements.lasers.green.style.opacity = "0";
  }
  if (stageElements.ledStrip) {
    stageElements.ledStrip.style.opacity = "0";
    stageElements.ledStrip.style.outlineColor = "rgba(255, 0, 255, 0.2)";
  }
  stageState.moverAngle = MOVER_BASE_ANGLE;
  stageState.hasData = false;
}

function updateStageVisualizer(status) {
  const levels = status && status.dmx && Array.isArray(status.dmx.levels) ? status.dmx.levels : null;
  if (!levels || levels.length === 0) {
    if (stageState.hasData) {
      resetStageVisualizer();
    }
    return;
  }
  updateLightBars(levels);
  updateMover(levels);
  stageState.hasData = true;
}

let userKey = null;
const videoButtons = new Map();

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

function updatePlayerUI(status) {
  if (status && typeof status === "object") {
    latestStatus = status;
  }
  updateSmokeButton(status);
  updatePlayButtons(status);
  updateStageVisualizer(status);

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
