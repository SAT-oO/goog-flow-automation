import { parsePrompts, sanitizeFolderName, getPromptBlockSpans } from "../lib/parse-prompts.js";

const els = {
  statusBar: document.getElementById("statusBar"),
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
  agentModeBar: document.getElementById("agentModeBar"),
  agentModeDot: document.getElementById("agentModeDot"),
  agentModeText: document.getElementById("agentModeText"),
  versionLabel: document.getElementById("versionLabel"),
  panelShell: document.getElementById("panelShell"),
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
  pauseBtn: document.getElementById("pauseBtn"),
  restartBtn: document.getElementById("restartBtn"),
  stopBtn: document.getElementById("stopBtn"),
  tabRun: document.getElementById("tabRun"),
  tabErrors: document.getElementById("tabErrors"),
  runPanel: document.getElementById("runPanel"),
  errorPanel: document.getElementById("errorPanel"),
  errorBadge: document.getElementById("errorBadge"),
  errorLogList: document.getElementById("errorLogList"),
  errorLogCount: document.getElementById("errorLogCount"),
  emptyErrorLog: document.getElementById("emptyErrorLog"),
  clearErrorsBtn: document.getElementById("clearErrorsBtn"),
  queueProgress: document.getElementById("queueProgress"),
  queueProgressDetail: document.getElementById("queueProgressDetail"),
  delayLabel: document.getElementById("delayLabel"),
  retryAttemptsLabel: document.getElementById("retryAttemptsLabel"),
};

const PARSE_BTN_LABEL = "Refresh preview";
let previewFeedbackTimer = null;
let maxGenerationAttempts = 3;

let prompts = [];
let itemStatuses = {};
let running = false;
let paused = false;
let restartPending = false;
let currentQueueIndex = -1;
let errorLogs = [];
let highlightedErrorLogId = null;
let queueItemClickTimer = null;

function formatRetryWaitLabel(item) {
  const maxAttempts = item?.maxAttempts || maxGenerationAttempts;
  const attempt = item?.attempt || 1;
  const nextAttempt = item?.nextAttempt ?? attempt + 1;

  if (nextAttempt > maxAttempts || attempt >= maxAttempts) {
    return `(attempt ${attempt}/${maxAttempts} failed — retrying…)`;
  }

  const delayMs = item?.retryInMs;
  if (typeof delayMs === "number" && delayMs > 0) {
    const seconds = Math.max(1, Math.round(delayMs / 1000));
    return `(attempt ${attempt}/${maxAttempts} failed — retry ${nextAttempt}/${maxAttempts} in ${seconds}s)`;
  }

  return `(attempt ${attempt}/${maxAttempts} failed — retrying…)`;
}

function formatRetryProgressLabel(idx, item) {
  const maxAttempts = item.maxAttempts || maxGenerationAttempts;
  const attempt = item.attempt || 1;
  const nextAttempt = item.nextAttempt ?? attempt + 1;

  if (nextAttempt > maxAttempts || attempt >= maxAttempts) {
    return `Prompt ${idx + 1} — attempt ${attempt}/${maxAttempts} failed, retrying…`;
  }

  const delayMs = item.retryInMs;
  if (typeof delayMs === "number" && delayMs > 0) {
    const seconds = Math.max(1, Math.round(delayMs / 1000));
    return `Prompt ${idx + 1} — attempt ${attempt}/${maxAttempts} failed, retry ${nextAttempt}/${maxAttempts} in ${seconds}s`;
  }

  return `Prompt ${idx + 1} — attempt ${attempt}/${maxAttempts} failed, retrying…`;
}

function applyStatusBar(barEl, dotEl, textEl, state, text) {
  barEl.classList.remove("pass", "fail", "null");
  if (state === "pass") barEl.classList.add("pass");
  else if (state === "fail") barEl.classList.add("fail");
  else barEl.classList.add("null");

  dotEl.className = "status-dot";
  if (state === "pass") dotEl.classList.add("ok");
  else if (state === "fail") dotEl.classList.add("err");
  else dotEl.classList.add("null");

  textEl.textContent = text;
}

function setConnectionBar(state, text) {
  applyStatusBar(els.statusBar, els.statusDot, els.statusText, state, text);
}

function setAgentModeBar(state, text) {
  els.agentModeBar.classList.remove("hidden");
  applyStatusBar(els.agentModeBar, els.agentModeDot, els.agentModeText, state, text);
}

function updateStartButton(connectionPass, agentPass) {
  const ready = connectionPass === true && agentPass === true;
  els.startBtn.disabled = running || !ready || prompts.length === 0;
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
      const nextSlot = Math.min(item?.nextAttempt ?? attempt + 1, maxAttempts);
      if (i <= attempt) segment.classList.add("done");
      else if (nextSlot <= maxAttempts && i === nextSlot) segment.classList.add("waiting");
    } else if (status === "skipped") {
      segment.classList.add("failed");
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
    return formatRetryWaitLabel(item);
  }
  if (status === "generating" && item?.attempt > 1) {
    return `(attempt ${item.attempt}/${maxAttempts})`;
  }
  if (status === "generating") return `(generating — attempt ${item?.attempt || 1}/${maxAttempts})`;
  if (status === "done") return "(done)";
  if (status === "pending") return "(waiting)";
  if (status === "paused") return "(paused)";
  if (status === "skipped") {
    return `(skipped after ${item?.attempt || maxAttempts}/${maxAttempts} attempts)`;
  }
  if (status === "error") {
    return `(failed after ${item?.attempt || maxAttempts}/${maxAttempts} attempts)`;
  }
  return "";
}

function restoreItemStatuses(saved, promptList) {
  if (!saved || typeof saved !== "object") return {};

  const restored = {};
  for (const [key, item] of Object.entries(saved)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= promptList.length) continue;
    if (item?.prompt && item.prompt !== promptList[index]) continue;
    restored[index] = item;
  }
  return restored;
}

function promptsListChanged(nextPrompts) {
  if (nextPrompts.length !== prompts.length) return true;
  return nextPrompts.some((prompt, index) => prompt !== prompts[index]);
}

function resolveItemStatus(index) {
  const existing = itemStatuses[index];
  if (existing?.status) return existing;

  if (running && index > currentQueueIndex && currentQueueIndex >= 0) {
    return { status: "pending", prompt: prompts[index] };
  }

  return existing;
}

function isFailedQueueStatus(status) {
  return status === "error" || status === "skipped" || status === "retrying";
}

function renderQueue() {
  els.queueList.innerHTML = "";
  const indexDigits = Math.max(1, String(prompts.length || 1).length);
  els.queueList.style.setProperty("--queue-index-width", `${indexDigits + 0.5}ch`);

  prompts.forEach((prompt, index) => {
    const li = document.createElement("li");
    li.dataset.index = String(index);
    const item = resolveItemStatus(index) || {};
    const status = item?.status;
    if (status) li.classList.add(status);
    if (running && index === currentQueueIndex) li.classList.add("current");

    if (isFailedQueueStatus(status)) {
      li.classList.add("queue-item-clickable");
      li.title = "Click to view error logs · double-click to edit prompt";
      li.addEventListener("click", () => {
        clearTimeout(queueItemClickTimer);
        queueItemClickTimer = setTimeout(() => navigateToErrorLogForPrompt(index), 250);
      });
    } else {
      li.title = "Double-click to jump to this prompt in the text box";
    }

    li.addEventListener("dblclick", (event) => {
      event.preventDefault();
      clearTimeout(queueItemClickTimer);
      navigateToPromptInInput(index);
    });

    const indexEl = document.createElement("span");
    indexEl.className = "queue-item-index";
    indexEl.textContent = String(index + 1);

    const bodyEl = document.createElement("span");
    bodyEl.className = "queue-item-body";

    const statusLabel = queueStatusLabel(status, item);
    if (statusLabel || ["retrying", "generating", "error", "skipped", "paused"].includes(status)) {
      const statusRow = document.createElement("div");
      statusRow.className = "queue-item-status-row";

      if (["retrying", "generating", "error", "skipped"].includes(status)) {
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
  scrollQueueToCurrent();
  if (els.scrollViewport) {
    requestAnimationFrame(() => {
      els.scrollViewport.dispatchEvent(new Event("scroll"));
    });
  }
}

function scrollQueueToCurrent() {
  if (!running || currentQueueIndex < 0 || !els.queueList) return;
  requestAnimationFrame(() => {
    const item = els.queueList.querySelector(`li[data-index="${currentQueueIndex}"]`);
    item?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

function countCompletedItems() {
  return Object.values(itemStatuses).filter((item) => item.status === "done" || item.status === "skipped").length;
}

function updateProgress(currentIndex, total, detailLabel) {
  const totalCount = total || prompts.length;
  const displayIndex = totalCount > 0 ? Math.min(currentIndex + 1, totalCount) : 0;
  const completed = countCompletedItems();
  const pct = totalCount > 0 ? Math.round((completed / totalCount) * 100) : 0;

  if (els.queueProgress) {
    if (running && totalCount > 0) {
      els.queueProgress.textContent = `${displayIndex} / ${totalCount}`;
      els.queueProgress.classList.remove("hidden");
    } else if (!running && completed > 0) {
      els.queueProgress.textContent = `${completed} / ${totalCount}`;
      els.queueProgress.classList.remove("hidden");
    } else {
      els.queueProgress.classList.add("hidden");
    }
  }

  if (els.queueProgressDetail) {
    if (detailLabel && running) {
      els.queueProgressDetail.textContent = detailLabel;
      els.queueProgressDetail.classList.remove("hidden");
    } else if (!running && detailLabel) {
      els.queueProgressDetail.textContent = detailLabel;
      els.queueProgressDetail.classList.remove("hidden");
    } else {
      els.queueProgressDetail.classList.add("hidden");
    }
  }

  if (els.queueProgress && running && totalCount > 0) {
    els.queueProgress.title = `${pct}% complete (${completed} finished)`;
  }
}

function formatLogTime(timestamp) {
  return new Date(timestamp).toLocaleString();
}

function updateErrorBadge() {
  const count = errorLogs.length;
  if (!els.errorBadge || !els.errorLogCount) return;

  els.errorLogCount.textContent = `${count} entr${count === 1 ? "y" : "ies"}`;
  if (count > 0) {
    els.errorBadge.textContent = String(count);
    els.errorBadge.classList.remove("hidden");
  } else {
    els.errorBadge.classList.add("hidden");
  }
}

function renderErrorLogs() {
  if (!els.errorLogList) return;

  els.errorLogList.innerHTML = "";
  errorLogs.forEach((entry) => {
    const li = document.createElement("li");
    li.id = `error-log-${entry.id}`;
    li.dataset.promptIndex = String(entry.index);
    if (entry.id === highlightedErrorLogId) {
      li.classList.add("highlighted");
    }

    const meta = document.createElement("div");
    meta.className = "error-meta";
    meta.innerHTML = `
      <span>Prompt #${entry.index + 1}</span>
      <span>Attempt ${entry.attempt}/${entry.maxAttempts || maxGenerationAttempts}</span>
      <span>${formatLogTime(entry.timestamp)}</span>
    `;

    const message = document.createElement("div");
    message.className = "error-message";
    message.textContent = entry.error;

    const prompt = document.createElement("div");
    prompt.className = "error-prompt";
    prompt.textContent = entry.promptPreview || entry.prompt || "";

    li.append(meta, message, prompt);
    els.errorLogList.appendChild(li);
  });

  const hasLogs = errorLogs.length > 0;
  els.emptyErrorLog?.classList.toggle("hidden", hasLogs);
  els.errorLogList.classList.toggle("hidden", !hasLogs);
  updateErrorBadge();

  if (els.scrollViewport) {
    requestAnimationFrame(() => {
      els.scrollViewport.dispatchEvent(new Event("scroll"));
    });
  }
}

async function loadErrorLogs() {
  const response = await chrome.runtime.sendMessage({ type: "GET_ERROR_LOGS" });
  errorLogs = response?.data?.logs || [];
  renderErrorLogs();
}

function switchTab(tabName, options = {}) {
  const isRun = tabName === "run";
  els.tabRun?.classList.toggle("active", isRun);
  els.tabErrors?.classList.toggle("active", !isRun);
  els.tabRun?.setAttribute("aria-selected", String(isRun));
  els.tabErrors?.setAttribute("aria-selected", String(!isRun));
  els.runPanel?.classList.toggle("hidden", !isRun);
  els.errorPanel?.classList.toggle("hidden", isRun);

  if (!isRun) {
    loadErrorLogs().then(() => {
      if (typeof options.highlightPromptIndex === "number") {
        scrollToErrorLogForPrompt(options.highlightPromptIndex);
      }
    });
  }

  if (els.scrollViewport) {
    requestAnimationFrame(() => {
      els.scrollViewport.dispatchEvent(new Event("scroll"));
    });
  }
}

function scrollToErrorLogForPrompt(promptIndex) {
  const match =
    errorLogs.find((entry) => entry.index === promptIndex) ||
    errorLogs.find((entry) => String(entry.index) === String(promptIndex));
  if (!match) return;

  highlightedErrorLogId = match.id;
  renderErrorLogs();

  requestAnimationFrame(() => {
    const el = document.getElementById(`error-log-${match.id}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => {
      if (highlightedErrorLogId === match.id) {
        highlightedErrorLogId = null;
        el?.classList.remove("highlighted");
      }
    }, 4000);
  });
}

function navigateToPromptInInput(promptIndex) {
  const spans = getPromptBlockSpans(els.promptInput.value);
  const span = spans[promptIndex];
  if (!span) return;

  switchTab("run");

  const textarea = els.promptInput;
  textarea.focus();
  textarea.setSelectionRange(span.start, span.end);

  const style = getComputedStyle(textarea);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.45;
  const linesBefore = textarea.value.slice(0, span.start).split("\n").length - 1;
  textarea.scrollTop = Math.max(0, linesBefore * lineHeight - textarea.clientHeight / 3);
  textarea.scrollIntoView({ block: "nearest", behavior: "smooth" });

  textarea.classList.remove("prompt-highlight");
  void textarea.offsetWidth;
  textarea.classList.add("prompt-highlight");
  setTimeout(() => textarea.classList.remove("prompt-highlight"), 2000);
}

function navigateToErrorLogForPrompt(promptIndex) {
  switchTab("errors", { highlightPromptIndex: promptIndex });
}

function updatePauseButton() {
  if (!els.pauseBtn) return;
  els.pauseBtn.disabled = !running;
  els.pauseBtn.textContent = paused ? "Resume" : "Pause";
  els.pauseBtn.classList.toggle("is-resume", paused);

  if (els.restartBtn) {
    els.restartBtn.classList.toggle("hidden", !running || !paused);
    els.restartBtn.disabled = !running || !paused;
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
  itemStatuses = {};
  chrome.runtime.sendMessage({ type: "CLEAR_QUEUE_ITEM_STATUSES" }).catch(() => {});
  refreshPromptsFromInput({ resetStatuses: false });
  showPromptsClearedFeedback();
  checkConnection();
  els.promptInput.focus();
}

function refreshPromptsFromInput({ resetStatuses = true } = {}) {
  const nextPrompts = parsePrompts(els.promptInput.value);
  const changed = resetStatuses && promptsListChanged(nextPrompts);
  prompts = nextPrompts;
  if (changed) {
    itemStatuses = {};
    chrome.runtime.sendMessage({ type: "CLEAR_QUEUE_ITEM_STATUSES" }).catch(() => {});
  }
  renderQueue();
  updateClearButtonState();
  chrome.storage.local.set({
    savedPromptText: els.promptInput.value,
    savedFolder: els.folderInput.value,
  });
}

async function checkConnection() {
  setConnectionBar("null", "Checking Google Flow connection…");
  setAgentModeBar("null", "Waiting for Google Flow connection…");

  const response = await chrome.runtime.sendMessage({ type: "CHECK_FLOW_TAB" });
  const data = response?.data || {};

  if (!data.connected) {
    setConnectionBar("fail", "Google Flow not detected — open labs.google/fx/tools/flow");
    setAgentModeBar("null", "Connect to Google Flow to check agent mode");
    updateStartButton(false, false);
    return;
  }

  const connectionPass = Boolean(data.hasPromptInput);
  if (connectionPass) {
    setConnectionBar("pass", "Connected to Google Flow — ready");
  } else {
    setConnectionBar("fail", "Open a Flow project with the prompt box visible");
  }

  const agentPass = !data.agentModeOn;
  if (agentPass) {
    setAgentModeBar("pass", "Agent mode OFF");
  } else {
    setAgentModeBar("fail", "Agent mode ON — turn off Agent in Google Flow");
  }

  updateStartButton(connectionPass, agentPass);
}

async function startGeneration() {
  refreshPromptsFromInput();
  if (!prompts.length) return;

  const folder = sanitizeFolderName(els.folderInput.value);
  els.folderInput.value = folder;

  running = true;
  paused = false;
  restartPending = false;
  currentQueueIndex = 0;
  els.startBtn.disabled = true;
  els.stopBtn.disabled = false;
  updatePauseButton();
  updateClearButtonState();
  itemStatuses = {};
  renderQueue();

  const response = await chrome.runtime.sendMessage({
    type: "START_QUEUE",
    data: { prompts, folder },
  });

  if (!response?.success) {
    running = false;
    paused = false;
    els.stopBtn.disabled = true;
    updatePauseButton();
    updateClearButtonState();
    updateProgress(0, prompts.length, response?.error || "Failed to start");
    checkConnection();
  } else {
    updateProgress(0, prompts.length, "Starting…");
  }
}

async function restartGeneration() {
  if (!running || !paused) return;

  const response = await chrome.runtime.sendMessage({ type: "RESTART_QUEUE" });
  if (!response?.success) {
    updateProgress(
      currentQueueIndex >= 0 ? currentQueueIndex : 0,
      prompts.length,
      response?.error || "Could not restart"
    );
    return;
  }

  updateProgress(0, prompts.length, "Stopping current step — press Start generation when ready…");
}

async function stopGeneration() {
  await chrome.runtime.sendMessage({ type: "STOP_QUEUE" });
  els.stopBtn.disabled = true;
  paused = false;
  updatePauseButton();
  updateProgress(
    currentQueueIndex >= 0 ? currentQueueIndex : 0,
    prompts.length,
    "Stopping after current step…"
  );
}

async function togglePause() {
  if (!running) return;

  if (paused) {
    const response = await chrome.runtime.sendMessage({ type: "RESUME_QUEUE" });
    if (response?.success) {
      paused = false;
      updatePauseButton();
      updateProgress(currentQueueIndex, prompts.length, "Resumed — continuing pipeline…");
    }
  } else {
    const response = await chrome.runtime.sendMessage({ type: "PAUSE_QUEUE" });
    if (response?.success) {
      paused = true;
      updatePauseButton();
      updateProgress(currentQueueIndex, prompts.length, "Paused — press Resume to continue");
    }
  }
}

async function clearErrorLogs() {
  await chrome.runtime.sendMessage({ type: "CLEAR_ERROR_LOGS" });
  errorLogs = [];
  renderErrorLogs();
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
  checkConnection();
  event.target.value = "";
});

els.folderInput.addEventListener("change", () => {
  els.folderInput.value = sanitizeFolderName(els.folderInput.value);
  chrome.storage.local.set({ savedFolder: els.folderInput.value });
});

els.startBtn.addEventListener("click", startGeneration);
els.pauseBtn?.addEventListener("click", togglePause);
els.restartBtn?.addEventListener("click", restartGeneration);
els.stopBtn.addEventListener("click", stopGeneration);
els.tabRun?.addEventListener("click", () => switchTab("run"));
els.tabErrors?.addEventListener("click", () => switchTab("errors"));
els.clearErrorsBtn?.addEventListener("click", clearErrorLogs);

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "ERROR_LOG_UPDATE") {
    if (message.data?.cleared) {
      errorLogs = [];
    } else if (message.data?.log) {
      errorLogs.unshift(message.data.log);
      if (errorLogs.length > 500) errorLogs.length = 500;
    }
    renderErrorLogs();
    return;
  }

  if (message.type !== "QUEUE_UPDATE") return;
  const data = message.data || {};

  if (data.restartPending || data.clearItemStatuses) {
    running = false;
    paused = false;
    restartPending = Boolean(data.restartPending);
    currentQueueIndex = 0;
    itemStatuses = {};
    els.stopBtn.disabled = true;
    updatePauseButton();
    updateClearButtonState();
    renderQueue();
    if (data.restartPending) {
      updateProgress(0, prompts.length, "Restart ready — press Start generation to run from prompt 1");
      checkConnection();
    }
    return;
  }

  if (typeof data.currentIndex === "number") {
    currentQueueIndex = data.currentIndex;
    scrollQueueToCurrent();
  }
  if (typeof data.paused === "boolean") {
    paused = data.paused;
    updatePauseButton();
  }

  if (data.itemStatus) {
    itemStatuses[data.itemStatus.index] = data.itemStatus;
    renderQueue();
    const idx = data.itemStatus.index;
    const item = data.itemStatus;
    let label = `Generating prompt ${idx + 1} of ${prompts.length}…`;
    if (paused) {
      label = `Paused at prompt ${idx + 1} of ${prompts.length}`;
    } else if (item.status === "done") {
      label = `Finished prompt ${idx + 1} of ${prompts.length}`;
    } else if (item.status === "skipped") {
      const maxAttempts = item.maxAttempts || maxGenerationAttempts;
      label = `Prompt ${idx + 1} skipped after ${item.attempt || maxAttempts}/${maxAttempts} failures — moving on`;
    } else if (item.status === "retrying") {
      label = formatRetryProgressLabel(idx, item);
    } else if (item.status === "error") {
      const maxAttempts = item.maxAttempts || maxGenerationAttempts;
      label = `Prompt ${idx + 1} failed after ${item.attempt || maxAttempts}/${maxAttempts} attempts`;
    } else if (item.status === "generating") {
      const maxAttempts = item.maxAttempts || maxGenerationAttempts;
      label = `Generating prompt ${idx + 1} of ${prompts.length} (attempt ${item.attempt || 1}/${maxAttempts})…`;
    }
    updateProgress(idx, prompts.length, label);
    scrollQueueToCurrent();
  }

  if (data.running === false) {
    running = false;
    paused = false;
    restartPending = false;
    els.stopBtn.disabled = true;
    updatePauseButton();
    updateClearButtonState();
    renderQueue();

    if (data.error) {
      updateProgress(data.currentIndex || 0, prompts.length, data.error);
    } else if (data.stopped) {
      updateProgress(data.currentIndex || 0, prompts.length, "Stopped");
    } else if (data.finished) {
      const skippedNote = data.skippedCount ? ` (${data.skippedCount} skipped)` : "";
      updateProgress(prompts.length - 1, prompts.length, `All done${skippedNote}`);
    }
    checkConnection();
  } else if (data.running === true) {
    running = true;
    restartPending = false;
    updatePauseButton();
    renderQueue();
  }
});

async function initPanel() {
  const [storage, response] = await Promise.all([
    chrome.storage.local.get(["savedPromptText", "savedFolder"]),
    chrome.runtime.sendMessage({ type: "GET_QUEUE_STATE" }),
  ]);

  if (storage.savedPromptText) els.promptInput.value = storage.savedPromptText;
  if (storage.savedFolder) els.folderInput.value = storage.savedFolder;
  refreshPromptsFromInput({ resetStatuses: false });

  const data = response?.data || {};

  if (!data.restartPending) {
    itemStatuses = restoreItemStatuses(data.itemStatuses, prompts);
    renderQueue();
  }

  const delay = data.interRequestDelayMs;
  if (delay) els.delayLabel.textContent = String(delay);
  if (data.maxGenerationAttempts) {
    maxGenerationAttempts = data.maxGenerationAttempts;
    if (els.retryAttemptsLabel) {
      els.retryAttemptsLabel.textContent = String(maxGenerationAttempts);
    }
  }
  if (data.maxRetryDelayMs) {
    const retryNote = document.querySelector(".footer p:nth-child(2)");
    if (retryNote) {
      retryNote.innerHTML =
        `Failed generations retry up to <strong>${maxGenerationAttempts}</strong> times with exponential backoff (up to <strong>${Math.round(data.maxRetryDelayMs / 1000)} s</strong> between attempts).`;
    }
  }
  if (data.restartPending) {
    restartPending = true;
    running = false;
    paused = false;
    currentQueueIndex = 0;
    itemStatuses = {};
    els.stopBtn.disabled = true;
    updatePauseButton();
    updateClearButtonState();
    renderQueue();
    updateProgress(0, prompts.length, "Restart ready — press Start generation to run from prompt 1");
    checkConnection();
  } else if (data.running) {
    running = true;
    paused = Boolean(data.paused);
    currentQueueIndex = data.currentIndex ?? -1;
    els.startBtn.disabled = true;
    els.stopBtn.disabled = false;
    updatePauseButton();
    updateClearButtonState();
    renderQueue();
    if (currentQueueIndex >= 0) {
      updateProgress(currentQueueIndex, data.prompts?.length || prompts.length, "");
    }
  }
}

initPanel();

loadErrorLogs();

updateClearButtonState();

const manifest = chrome.runtime.getManifest();
if (manifest?.version) {
  els.versionLabel.textContent = `v${manifest.version}`;
}

function syncPanelViewportHeight() {
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  if (!viewportHeight) return;

  document.documentElement.style.height = `${viewportHeight}px`;
  document.body.style.height = `${viewportHeight}px`;
  if (els.panelShell) {
    els.panelShell.style.height = `${viewportHeight}px`;
  }

  if (els.scrollViewport) {
    els.scrollViewport.dispatchEvent(new Event("scroll"));
  }
}

function initVerticalScrollRail() {
  const viewport = els.scrollViewport;
  const rail = els.scrollRail;
  const thumb = els.scrollThumb;
  if (!viewport || !rail || !thumb) return;

  let dragging = false;
  let dragStartY = 0;
  let dragStartScroll = 0;

  function readMetrics() {
    return {
      scrollHeight: viewport.scrollHeight,
      clientHeight: viewport.clientHeight,
      scrollTop: viewport.scrollTop,
    };
  }

  function updateThumb() {
    const { scrollHeight, clientHeight, scrollTop } = readMetrics();
    const canScroll = scrollHeight > clientHeight + 1;

    rail.classList.toggle("hidden", !canScroll);
    if (!canScroll) {
      thumb.style.height = "0px";
      thumb.style.transform = "translateY(0px)";
      return;
    }

    const trackHeight = viewport.clientHeight;
    const thumbHeight = Math.max(48, (clientHeight / scrollHeight) * trackHeight);
    const maxThumbTop = Math.max(trackHeight - thumbHeight, 0);
    const scrollRatio = scrollTop / Math.max(scrollHeight - clientHeight, 1);
    const thumbTop = maxThumbTop * scrollRatio;

    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translateY(${thumbTop}px)`;
  }

  function scrollToClientY(clientY) {
    const { scrollHeight, clientHeight } = readMetrics();
    const trackRect = rail.getBoundingClientRect();
    const trackHeight = viewport.clientHeight;
    const thumbHeight = thumb.offsetHeight;
    const maxThumbTop = Math.max(trackHeight - thumbHeight, 0);
    const relativeY = Math.min(Math.max(clientY - trackRect.top - thumbHeight / 2, 0), maxThumbTop);
    const ratio = maxThumbTop > 0 ? relativeY / maxThumbTop : 0;
    viewport.scrollTop = ratio * Math.max(scrollHeight - clientHeight, 0);
  }

  viewport.addEventListener("scroll", updateThumb, { passive: true });
  window.addEventListener("resize", updateThumb);

  rail.addEventListener("pointerdown", (event) => {
    if (event.target === thumb) return;
    scrollToClientY(event.clientY);
    updateThumb();
    event.preventDefault();
  });

  thumb.addEventListener("pointerdown", (event) => {
    dragging = true;
    dragStartY = event.clientY;
    dragStartScroll = viewport.scrollTop;
    thumb.classList.add("dragging");
    thumb.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  thumb.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const { scrollHeight, clientHeight } = readMetrics();
    const trackHeight = viewport.clientHeight;
    const thumbHeight = thumb.offsetHeight;
    const maxThumbTop = Math.max(trackHeight - thumbHeight, 0);
    const deltaY = event.clientY - dragStartY;
    const scrollRange = Math.max(scrollHeight - clientHeight, 0);
    const scrollDelta = maxThumbTop > 0 ? (deltaY / maxThumbTop) * scrollRange : 0;
    viewport.scrollTop = dragStartScroll + scrollDelta;
    event.preventDefault();
  });

  thumb.addEventListener("pointerup", (event) => {
    if (!dragging) return;
    dragging = false;
    thumb.classList.remove("dragging");
    if (thumb.hasPointerCapture(event.pointerId)) {
      thumb.releasePointerCapture(event.pointerId);
    }
  });

  thumb.addEventListener("pointercancel", () => {
    dragging = false;
    thumb.classList.remove("dragging");
  });

  const resizeObserver = new ResizeObserver(updateThumb);
  resizeObserver.observe(viewport);
  resizeObserver.observe(els.appContent);
  updateThumb();
}

initVerticalScrollRail();
syncPanelViewportHeight();
window.addEventListener("resize", syncPanelViewportHeight);

checkConnection();
setInterval(checkConnection, 4000);
