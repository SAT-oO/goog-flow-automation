import { parsePrompts, sanitizeFolderName } from "../lib/parse-prompts.js";

const els = {
  statusBar: document.getElementById("statusBar"),
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
  agentAlert: document.getElementById("agentAlert"),
  promptInput: document.getElementById("promptInput"),
  fileInput: document.getElementById("fileInput"),
  parseBtn: document.getElementById("parseBtn"),
  folderInput: document.getElementById("folderInput"),
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

let prompts = [];
let itemStatuses = {};
let running = false;

function setStatus(level, text) {
  els.statusDot.className = `status-dot ${level}`;
  els.statusText.textContent = text;
}

function renderQueue() {
  els.queueList.innerHTML = "";
  prompts.forEach((prompt, index) => {
    const li = document.createElement("li");
    const status = itemStatuses[index]?.status;
    if (status) li.classList.add(status);
    const preview = prompt.length > 120 ? `${prompt.slice(0, 120)}…` : prompt;
    li.textContent = `${index + 1}. ${preview}`;
    els.queueList.appendChild(li);
  });

  const hasPrompts = prompts.length > 0;
  els.emptyQueue.classList.toggle("hidden", hasPrompts);
  els.queueList.classList.toggle("hidden", !hasPrompts);
  els.queueCount.textContent = `${prompts.length} prompt${prompts.length === 1 ? "" : "s"}`;
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
    setStatus("warn", "Connected — Agent mode is ON");
    els.agentAlert.classList.remove("hidden");
    els.startBtn.disabled = true;
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

els.parseBtn.addEventListener("click", refreshPromptsFromInput);
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
    updateProgress(
      idx,
      prompts.length,
      data.itemStatus.status === "done"
        ? `Finished prompt ${idx + 1} of ${prompts.length}`
        : `Generating prompt ${idx + 1} of ${prompts.length}…`
    );
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
  if (response?.data?.running) {
    running = true;
    els.startBtn.disabled = true;
    els.stopBtn.disabled = false;
    els.progressSection.classList.remove("hidden");
  }
});

checkConnection();
setInterval(checkConnection, 4000);
