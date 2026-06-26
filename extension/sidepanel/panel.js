import { parsePrompts, sanitizeFolderName } from "../lib/parse-prompts.js";

const els = {
  statusBar: document.getElementById("statusBar"),
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
  agentAlert: document.getElementById("agentAlert"),
  versionLabel: document.getElementById("versionLabel"),
  promptInput: document.getElementById("promptInput"),
  fileInput: document.getElementById("fileInput"),
  parseBtn: document.getElementById("parseBtn"),
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
};

const PARSE_BTN_LABEL = "Refresh preview";
let previewFeedbackTimer = null;

let prompts = [];
let itemStatuses = {};
let running = false;

function setStatus(level, text) {
  els.statusDot.className = `status-dot ${level}`;
  els.statusText.textContent = text;
}

function queueStatusLabel(status, item) {
  if (status === "retrying" && item?.attempt) return `(retry #${item.attempt})`;
  if (status === "generating") return "(generating)";
  if (status === "done") return "(done)";
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
    if (statusLabel) {
      const statusEl = document.createElement("span");
      statusEl.className = "queue-item-status";
      statusEl.textContent = statusLabel;
      bodyEl.appendChild(statusEl);
      bodyEl.append(" ");
    }

    const preview = prompt.length > 140 ? `${prompt.slice(0, 140)}…` : prompt;
    bodyEl.append(preview);

    li.append(indexEl, bodyEl);
    els.queueList.appendChild(li);
  });

  const hasPrompts = prompts.length > 0;
  els.emptyQueue.classList.toggle("hidden", hasPrompts);
  els.queueList.classList.toggle("hidden", !hasPrompts);
  els.queueCount.textContent = `${prompts.length} prompt${prompts.length === 1 ? "" : "s"}`;
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

function refreshPromptsFromInput() {
  prompts = parsePrompts(els.promptInput.value);
  itemStatuses = {};
  renderQueue();
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
    els.agentAlert.classList.add("hidden");
    els.startBtn.disabled = true;
    return;
  }

  if (data.agentModeOn) {
    setStatus("warn", "Connected — Agent mode is ON (will auto-disable on start)");
    els.agentAlert.classList.remove("hidden");
    els.startBtn.disabled = running || prompts.length === 0;
    return;
  }

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
      const seconds = item.retryInMs ? Math.round(item.retryInMs / 1000) : "?";
      label = `Prompt ${idx + 1} failed — retrying in ${seconds}s (attempt ${item.attempt || 1})`;
    }
    updateProgress(idx, prompts.length, label);
  }

  if (data.running === false) {
    running = false;
    els.startBtn.disabled = prompts.length === 0;
    els.stopBtn.disabled = true;

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
  if (response?.data?.maxRetryDelayMs) {
    const retryNote = document.querySelector(".footer p:nth-child(2)");
    if (retryNote) {
      retryNote.innerHTML =
        `Failed generations retry with exponential backoff (up to <strong>${Math.round(response.data.maxRetryDelayMs / 1000)} s</strong> between attempts).`;
    }
  }
  if (response?.data?.running) {
    running = true;
    els.startBtn.disabled = true;
    els.stopBtn.disabled = false;
    els.progressSection.classList.remove("hidden");
  }
});

const manifest = chrome.runtime.getManifest();
if (manifest?.version) {
  els.versionLabel.textContent = `v${manifest.version}`;
}

checkConnection();
setInterval(checkConnection, 4000);
