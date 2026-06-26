import { parsePrompts, sanitizeFolderName } from "../lib/parse-prompts.js";

const els = {
  statusBar: document.getElementById("statusBar"),
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
  agentModeBar: document.getElementById("agentModeBar"),
  agentModeFill: document.getElementById("agentModeFill"),
  agentModeLabel: document.getElementById("agentModeLabel"),
  agentModeDetail: document.getElementById("agentModeDetail"),
  agentAlert: document.getElementById("agentAlert"),
  versionLabel: document.getElementById("versionLabel"),
  scrollViewport: document.getElementById("scrollViewport"),
  scrollRail: document.getElementById("scrollRail"),
  scrollThumb: document.getElementById("scrollThumb"),
  appContent: document.getElementById("appContent"),
  promptInput: document.getElementById("promptInput"),
  fileInput: document.getElementById("fileInput"),
  parseBtn: document.getElementById("parseBtn"),
  clearBtn: document.getElementById("clearBtn"),
  folderInput: document.getElementById("folderInput"),
  previewSection: document.getElementById("previewSection"),
  previewStatus: document.getElementById("previewStatus"),
  queueList: document.getElementById("queueList"),
  queueCount: document.getElementById("queueCount"),
  emptyQueue: document.getElementById("emptyQueue"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  progressSection: document.getElementById("progressSection"),
  progressText: document.getElementById("progressText"),
  progressFill: document.getElementById("progressFill"),
  delayLabel: document.getElementById("delayLabel"),
  retryAttemptsLabel: document.getElementById("retryAttemptsLabel"),
};

const PARSE_BTN_LABEL = "Refresh preview";
let previewFeedbackTimer = null;
let maxGenerationAttempts = 3;

let prompts = [];
let itemStatuses = {};
let running = false;

function setStatus(level, text) {
  els.statusDot.className = `status-dot ${level}`;
  els.statusText.textContent = text;
}

function setAgentModeBar(state, detail = "") {
  els.agentModeBar.classList.remove("hidden", "agent-off", "agent-on", "agent-unknown");
  els.agentModeBar.classList.add(`agent-${state}`);
  els.agentModeFill.style.width = state === "on" ? "100%" : state === "off" ? "100%" : "0%";

  if (state === "off") {
    els.agentModeLabel.textContent = "Agent mode OFF";
    els.agentModeDetail.textContent = detail || "Image generation mode is active — automation ready";
  } else if (state === "on") {
    els.agentModeLabel.textContent = "Agent mode ON";
    els.agentModeDetail.textContent = detail || "Will be turned off automatically when generation starts";
  } else {
    els.agentModeLabel.textContent = "Agent mode";
    els.agentModeDetail.textContent = detail || "Connect to Google Flow to check status";
  }
}

function createRetryMeter(item) {
  const maxAttempts = item?.maxAttempts || maxGenerationAttempts;
  const attempt = item?.attempt || 1;
  const status = item?.status;
  const meter = document.createElement("div");
  meter.className = "retry-meter";
  meter.setAttribute("aria-label", `Attempt ${attempt} of ${maxAttempts}`);

  for (let i = 1; i <= maxAttempts; i += 1) {
    const segment = document.createElement("span");
    segment.className = "retry-meter-segment";

    if (status === "retrying") {
      if (i <= attempt) segment.classList.add("done");
      else if (i === (item?.nextAttempt || attempt + 1)) segment.classList.add("waiting");
    } else if (status === "error") {
      if (i < maxAttempts) segment.classList.add("done");
      else segment.classList.add("failed");
    } else if (status === "generating") {
      if (i < attempt) segment.classList.add("done");
      else if (i === attempt) segment.classList.add("active");
    }

    meter.appendChild(segment);
  }

  return meter;
}

function queueStatusLabel(status, item) {
  const maxAttempts = item?.maxAttempts || maxGenerationAttempts;
  if (status === "retrying") {
    const next = item?.nextAttempt || (item?.attempt || 1) + 1;
    const seconds = item?.retryInMs ? Math.round(item.retryInMs / 1000) : "?";
    return `(attempt ${item?.attempt || 1}/${maxAttempts} failed — retry ${next}/${maxAttempts} in ${seconds}s)`;
  }
  if (status === "generating" && item?.attempt > 1) {
    return `(attempt ${item.attempt}/${maxAttempts})`;
  }
  if (status === "generating") return `(generating — attempt ${item?.attempt || 1}/${maxAttempts})`;
  if (status === "done") return "(done)";
  if (status === "error") {
    return `(failed after ${item?.attempt || maxAttempts}/${maxAttempts} attempts)`;
  }
  return "";
}

function renderQueue() {
  els.queueList.innerHTML = "";
  const indexDigits = Math.max(1, String(prompts.length || 1).length);
  els.queueList.style.setProperty("--queue-index-width", `${indexDigits + 0.5}ch`);

  prompts.forEach((prompt, index) => {
    const li = document.createElement("li");
    const item = itemStatuses[index];
    const status = item?.status;
    if (status) li.classList.add(status);

    const indexEl = document.createElement("span");
    indexEl.className = "queue-item-index";
    indexEl.textContent = String(index + 1);

    const bodyEl = document.createElement("span");
    bodyEl.className = "queue-item-body";

    const statusLabel = queueStatusLabel(status, item);
    if (statusLabel || status === "retrying" || status === "generating" || status === "error") {
      const statusRow = document.createElement("div");
      statusRow.className = "queue-item-status-row";

      if (status === "retrying" || status === "generating" || status === "error") {
        statusRow.appendChild(createRetryMeter(item));
      }

      if (statusLabel) {
        const statusEl = document.createElement("span");
        statusEl.className = "queue-item-status";
        statusEl.textContent = statusLabel;
        statusRow.appendChild(statusEl);
      }

      bodyEl.appendChild(statusRow);
    }

    const preview = prompt.length > 140 ? `${prompt.slice(0, 140)}…` : prompt;
    const previewEl = document.createElement("span");
    previewEl.className = "queue-item-preview";
    previewEl.textContent = preview;
    bodyEl.appendChild(previewEl);

    li.append(indexEl, bodyEl);
    els.queueList.appendChild(li);
  });

  const hasPrompts = prompts.length > 0;
  els.emptyQueue.classList.toggle("hidden", hasPrompts);
  els.queueList.classList.toggle("hidden", !hasPrompts);
  els.queueCount.textContent = `${prompts.length} prompt${prompts.length === 1 ? "" : "s"}`;
  if (els.scrollViewport) {
    requestAnimationFrame(() => {
      els.scrollViewport.dispatchEvent(new Event("scroll"));
    });
  }
}

function showPreviewRefreshFeedback() {
  const count = prompts.length;
  const message =
    count === 0
      ? "Preview refreshed — no prompts found in the text above."
      : `Preview refreshed — ${count} prompt${count === 1 ? "" : "s"} in queue.`;

  if (previewFeedbackTimer) clearTimeout(previewFeedbackTimer);

  els.previewSection.classList.remove("preview-flash");
  void els.previewSection.offsetWidth;
  els.previewSection.classList.add("preview-flash");
  els.queueCount.classList.add("badge-updated");
  els.previewStatus.textContent = message;
  els.previewStatus.classList.remove("hidden");
  els.parseBtn.textContent = count > 0 ? `Refreshed (${count})` : "Refreshed";
  els.parseBtn.classList.add("refreshed");

  previewFeedbackTimer = setTimeout(() => {
    els.previewSection.classList.remove("preview-flash");
    els.queueCount.classList.remove("badge-updated");
    els.previewStatus.classList.add("hidden");
    els.parseBtn.textContent = PARSE_BTN_LABEL;
    els.parseBtn.classList.remove("refreshed");
    previewFeedbackTimer = null;
  }, 2200);
}

function updateClearButtonState() {
  if (!els.clearBtn) return;
  const hasText = Boolean(els.promptInput.value.trim());
  els.clearBtn.disabled = running || !hasText;
}

function showPromptsClearedFeedback() {
  els.previewSection.classList.remove("preview-flash");
  void els.previewSection.offsetWidth;
  els.previewSection.classList.add("preview-flash");
  els.previewStatus.textContent = "All prompts cleared.";
  els.previewStatus.classList.remove("hidden");

  if (previewFeedbackTimer) clearTimeout(previewFeedbackTimer);
  previewFeedbackTimer = setTimeout(() => {
    els.previewSection.classList.remove("preview-flash");
    els.previewStatus.classList.add("hidden");
    previewFeedbackTimer = null;
  }, 1800);
}

function clearPrompts() {
  if (running || !els.promptInput.value.trim()) return;

  els.promptInput.value = "";
  refreshPromptsFromInput();
  showPromptsClearedFeedback();
  checkConnection();
  els.promptInput.focus();
}

function refreshPromptsFromInput() {
  prompts = parsePrompts(els.promptInput.value);
  itemStatuses = {};
  renderQueue();
  updateClearButtonState();
  chrome.storage.local.set({
    savedPromptText: els.promptInput.value,
    savedFolder: els.folderInput.value,
  });
}

async function checkConnection() {
  const response = await chrome.runtime.sendMessage({ type: "CHECK_FLOW_TAB" });
  const data = response?.data || {};

  if (!data.connected) {
    setStatus("err", "Google Flow not detected — open labs.google/fx/tools/flow");
    els.agentModeBar.classList.add("hidden");
    els.agentAlert.classList.add("hidden");
    els.startBtn.disabled = true;
    return;
  }

  els.agentModeBar.classList.remove("hidden");

  if (data.agentModeOn) {
    setStatus("warn", "Connected — Agent mode is ON (will auto-disable on start)");
    setAgentModeBar("on");
    els.agentAlert.classList.remove("hidden");
    els.startBtn.disabled = running || prompts.length === 0;
    return;
  }

  setAgentModeBar("off");

  if (!data.hasPromptInput) {
    setStatus("warn", "Connected — open a Flow project with the prompt box visible");
    els.agentAlert.classList.add("hidden");
    els.startBtn.disabled = running || prompts.length === 0;
    return;
  }

  setStatus("ok", "Connected to Google Flow — ready");
  els.agentAlert.classList.add("hidden");
  els.startBtn.disabled = running || prompts.length === 0;
}

function updateProgress(currentIndex, total, label) {
  els.progressSection.classList.remove("hidden");
  const pct = total > 0 ? Math.round(((currentIndex + 1) / total) * 100) : 0;
  els.progressFill.style.width = `${pct}%`;
  els.progressText.textContent = label;
}

async function startGeneration() {
  refreshPromptsFromInput();
  if (!prompts.length) return;

  const folder = sanitizeFolderName(els.folderInput.value);
  els.folderInput.value = folder;

  running = true;
  els.startBtn.disabled = true;
  els.stopBtn.disabled = false;
  updateClearButtonState();
  itemStatuses = {};
  renderQueue();

  const response = await chrome.runtime.sendMessage({
    type: "START_QUEUE",
    data: { prompts, folder },
  });

  if (!response?.success) {
    running = false;
    els.startBtn.disabled = false;
    els.stopBtn.disabled = true;
    updateClearButtonState();
    updateProgress(0, prompts.length, response?.error || "Failed to start");
    setStatus("err", response?.error || "Failed to start");
  } else {
    updateProgress(0, prompts.length, "Starting…");
  }
}

async function stopGeneration() {
  await chrome.runtime.sendMessage({ type: "STOP_QUEUE" });
  els.stopBtn.disabled = true;
  updateProgress(
    Object.keys(itemStatuses).length,
    prompts.length,
    "Stopping after current step…"
  );
}

els.parseBtn.addEventListener("click", () => {
  refreshPromptsFromInput();
  showPreviewRefreshFeedback();
});
els.clearBtn.addEventListener("click", clearPrompts);
els.promptInput.addEventListener("input", () => {
  refreshPromptsFromInput();
  checkConnection();
});

els.fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  els.promptInput.value = text;
  refreshPromptsFromInput();
  event.target.value = "";
});

els.folderInput.addEventListener("change", () => {
  els.folderInput.value = sanitizeFolderName(els.folderInput.value);
  chrome.storage.local.set({ savedFolder: els.folderInput.value });
});

els.startBtn.addEventListener("click", startGeneration);
els.stopBtn.addEventListener("click", stopGeneration);

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "QUEUE_UPDATE") return;
  const data = message.data || {};

  if (data.itemStatus) {
    itemStatuses[data.itemStatus.index] = data.itemStatus;
    renderQueue();
    const idx = data.itemStatus.index;
    const item = data.itemStatus;
    let label = `Generating prompt ${idx + 1} of ${prompts.length}…`;
    if (item.status === "done") {
      label = `Finished prompt ${idx + 1} of ${prompts.length}`;
    } else if (item.status === "retrying") {
      const maxAttempts = item.maxAttempts || maxGenerationAttempts;
      const next = item.nextAttempt || (item.attempt || 1) + 1;
      const seconds = item.retryInMs ? Math.round(item.retryInMs / 1000) : "?";
      label = `Prompt ${idx + 1} — attempt ${item.attempt || 1}/${maxAttempts} failed, retry ${next}/${maxAttempts} in ${seconds}s`;
    } else if (item.status === "error") {
      const maxAttempts = item.maxAttempts || maxGenerationAttempts;
      label = `Prompt ${idx + 1} failed after ${item.attempt || maxAttempts}/${maxAttempts} attempts`;
    } else if (item.status === "generating") {
      const maxAttempts = item.maxAttempts || maxGenerationAttempts;
      label = `Generating prompt ${idx + 1} of ${prompts.length} (attempt ${item.attempt || 1}/${maxAttempts})…`;
    }
    updateProgress(idx, prompts.length, label);
  }

  if (data.running === false) {
    running = false;
    els.startBtn.disabled = prompts.length === 0;
    els.stopBtn.disabled = true;
    updateClearButtonState();

    if (data.error) {
      setStatus("err", data.error);
      updateProgress(data.currentIndex || 0, prompts.length, data.error);
    } else if (data.stopped) {
      setStatus("warn", "Stopped by user");
      updateProgress(data.currentIndex || 0, prompts.length, "Stopped");
    } else if (data.finished) {
      setStatus("ok", "All prompts completed");
      updateProgress(prompts.length - 1, prompts.length, "All done");
    }
    checkConnection();
  }
});

chrome.storage.local.get(["savedPromptText", "savedFolder", "queueState"], (result) => {
  if (result.savedPromptText) els.promptInput.value = result.savedPromptText;
  if (result.savedFolder) els.folderInput.value = result.savedFolder;
  refreshPromptsFromInput();
});

chrome.runtime.sendMessage({ type: "GET_QUEUE_STATE" }).then((response) => {
  const delay = response?.data?.interRequestDelayMs;
  if (delay) els.delayLabel.textContent = String(delay);
  if (response?.data?.maxGenerationAttempts) {
    maxGenerationAttempts = response.data.maxGenerationAttempts;
    if (els.retryAttemptsLabel) {
      els.retryAttemptsLabel.textContent = String(maxGenerationAttempts);
    }
  }
  if (response?.data?.maxRetryDelayMs) {
    const retryNote = document.querySelector(".footer p:nth-child(2)");
    if (retryNote) {
      retryNote.innerHTML =
        `Failed generations retry up to <strong>${maxGenerationAttempts}</strong> times with exponential backoff (up to <strong>${Math.round(response.data.maxRetryDelayMs / 1000)} s</strong> between attempts).`;
    }
  }
  if (response?.data?.running) {
    running = true;
    els.startBtn.disabled = true;
    els.stopBtn.disabled = false;
    updateClearButtonState();
    els.progressSection.classList.remove("hidden");
  }
});

updateClearButtonState();

const manifest = chrome.runtime.getManifest();
if (manifest?.version) {
  els.versionLabel.textContent = `v${manifest.version}`;
}

function getScrollContainer() {
  const viewport = els.scrollViewport;
  if (!viewport) return document.documentElement;

  const viewportScrollable = viewport.scrollHeight > viewport.clientHeight + 1;
  if (viewportScrollable) return viewport;

  const docScrollable = document.documentElement.scrollHeight > window.innerHeight + 1;
  if (docScrollable) return document.documentElement;

  return viewport;
}

function initVerticalScrollRail() {
  const rail = els.scrollRail;
  const thumb = els.scrollThumb;
  if (!els.scrollViewport || !rail || !thumb) return;

  let dragging = false;
  let dragStartY = 0;
  let dragStartScroll = 0;
  let activeContainer = els.scrollViewport;

  function readScrollMetrics(container) {
    if (container === document.documentElement) {
      return {
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: window.innerHeight,
        scrollTop: window.scrollY,
      };
    }

    return {
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      scrollTop: container.scrollTop,
    };
  }

  function setScrollTop(container, value) {
    if (container === document.documentElement) {
      window.scrollTo(0, value);
      return;
    }
    container.scrollTop = value;
  }

  function updateThumb() {
    activeContainer = getScrollContainer();
    const { scrollHeight, clientHeight, scrollTop } = readScrollMetrics(activeContainer);
    const canScroll = scrollHeight > clientHeight + 1;

    rail.classList.toggle("hidden", !canScroll);
    if (!canScroll) return;

    const trackHeight = rail.clientHeight;
    const thumbHeight = Math.max(48, (clientHeight / scrollHeight) * trackHeight);
    const maxThumbTop = Math.max(trackHeight - thumbHeight, 0);
    const scrollRatio = scrollTop / Math.max(scrollHeight - clientHeight, 1);
    const thumbTop = maxThumbTop * scrollRatio;

    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translateY(${thumbTop}px)`;
  }

  function scrollFromThumb(clientY) {
    const { scrollHeight, clientHeight } = readScrollMetrics(activeContainer);
    const trackRect = rail.getBoundingClientRect();
    const trackHeight = rail.clientHeight;
    const thumbHeight = thumb.offsetHeight;
    const maxThumbTop = Math.max(trackHeight - thumbHeight, 0);
    const relativeY = Math.min(Math.max(clientY - trackRect.top - thumbHeight / 2, 0), maxThumbTop);
    const ratio = maxThumbTop > 0 ? relativeY / maxThumbTop : 0;
    setScrollTop(activeContainer, ratio * Math.max(scrollHeight - clientHeight, 0));
  }

  els.scrollViewport.addEventListener("scroll", updateThumb, { passive: true });
  window.addEventListener("scroll", updateThumb, { passive: true });
  window.addEventListener("resize", updateThumb);

  rail.addEventListener("mousedown", (event) => {
    if (event.target === thumb) return;
    activeContainer = getScrollContainer();
    scrollFromThumb(event.clientY);
    updateThumb();
  });

  thumb.addEventListener("mousedown", (event) => {
    activeContainer = getScrollContainer();
    dragging = true;
    dragStartY = event.clientY;
    dragStartScroll = readScrollMetrics(activeContainer).scrollTop;
    thumb.classList.add("dragging");
    event.preventDefault();
  });

  window.addEventListener("mousemove", (event) => {
    if (!dragging) return;
    const { scrollHeight, clientHeight } = readScrollMetrics(activeContainer);
    const trackHeight = rail.clientHeight;
    const thumbHeight = thumb.offsetHeight;
    const maxThumbTop = Math.max(trackHeight - thumbHeight, 0);
    const deltaY = event.clientY - dragStartY;
    const scrollRange = Math.max(scrollHeight - clientHeight, 0);
    const scrollDelta = maxThumbTop > 0 ? (deltaY / maxThumbTop) * scrollRange : 0;
    setScrollTop(activeContainer, dragStartScroll + scrollDelta);
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    thumb.classList.remove("dragging");
  });

  const resizeObserver = new ResizeObserver(updateThumb);
  resizeObserver.observe(els.scrollViewport);
  resizeObserver.observe(els.appContent);
  updateThumb();
}

initVerticalScrollRail();

checkConnection();
setInterval(checkConnection, 4000);
