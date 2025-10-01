const template = document.getElementById("video-card-template");
const listEl = document.getElementById("video-list");
const toastEl = document.getElementById("toast");

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
  } catch (err) {
    console.error(err);
    showToast(err.message, "error");
  }
}

fetchVideos();
