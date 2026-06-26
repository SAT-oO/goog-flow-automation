/**
 * Flow Image Automator — background service worker.
 * Orchestrates sequential prompt processing and downloads.
 */

/** Content script modules — load order matters (shared FlowAutomator namespace). */
const CONTENT_SCRIPT_FILES = [
  "content/lib/dom.js",
  "content/lib/targeting.js",
  "content/lib/input-sync.js",
  "content/lib/submitter.js",
  "content/lib/ui-idle.js",
  "content/lib/agent.js",
  "content/lib/images.js",
  "content/lib/lifecycle.js",
  "content/flow.js",
];

const FLOW_URL_PATTERNS = [
  "https://labs.google/fx/tools/flow*",
  "https://labs.google/flow*",
];

/** Delay between completed generations (ms). */
const INTER_REQUEST_DELAY_MS = 2500;

/** Retry backoff: doubles each failure, capped at 30 s. */
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;
/** Total generation attempts per prompt (initial try + retries). */
const MAX_GENERATION_ATTEMPTS = 3;

const state = {
  running: false,
  paused: false,
  stopRequested: false,
  /** User clicked Restart — halt now; wait for Start generation before re-running. */
  restartPending: false,
  currentIndex: 0,
  prompts: [],
  folder: "flow-images",
  flowTabId: null,
};

const MAX_ERROR_LOGS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sleep in small chunks so pause/stop/restart can interrupt retry delays. */
async function interruptibleSleep(ms) {
  const chunk = 200;
  let remaining = ms;
  while (remaining > 0) {
    if (state.stopRequested) {
      throw new Error("Stopped by user");
    }
    await waitIfPaused();
    const step = Math.min(chunk, remaining);
    await sleep(step);
    remaining -= step;
  }
}

async function waitIfPaused() {
  while (state.paused && !state.stopRequested) {
    await sleep(250);
  }
  if (state.stopRequested) {
    throw new Error("Stopped by user");
  }
}

async function appendErrorLog(entry) {
  const logEntry = {
    id: `${Date.now()}-${entry.index}-${entry.attempt}`,
    timestamp: Date.now(),
    ...entry,
  };

  const result = await chrome.storage.local.get(["errorLogs"]);
  const logs = result.errorLogs || [];
  logs.unshift(logEntry);
  if (logs.length > MAX_ERROR_LOGS) logs.length = MAX_ERROR_LOGS;
  await chrome.storage.local.set({ errorLogs: logs });

  broadcast({ type: "ERROR_LOG_UPDATE", data: { log: logEntry, total: logs.length } });
  return logEntry;
}

function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

function updateQueueStatus(patch) {
  broadcast({ type: "QUEUE_UPDATE", data: patch });
}

async function saveState() {
  await chrome.storage.local.set({
    queueState: {
      running: state.running,
      paused: state.paused,
      restartPending: state.restartPending,
      currentIndex: state.currentIndex,
      prompts: state.prompts,
      folder: state.folder,
    },
  });
}

async function findFlowTab() {
  for (const pattern of FLOW_URL_PATTERNS) {
    const tabs = await chrome.tabs.query({ url: pattern });
    if (tabs.length > 0) return tabs[0];
  }
  const tabs = await chrome.tabs.query({ url: "https://labs.google/*" });
  return tabs.find((tab) => (tab.url || "").includes("flow")) || tabs[0] || null;
}

async function ensureContentScript(tabId) {
  try {
    const response = await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: "PING" }),
      sleep(2000).then(() => {
        throw new Error("ping timeout");
      }),
    ]);
    if (response?.success) return;
  } catch {
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: CONTENT_SCRIPT_FILES,
  });
  await sleep(500);
}

async function sendToContent(tabId, message) {
  await ensureContentScript(tabId);
  const response = await chrome.tabs.sendMessage(tabId, message);
  if (!response?.success) {
    throw new Error(response?.error || "Content script request failed");
  }
  return response.data;
}

async function downloadImage(url, folder, index, mimeType = "image/png") {
  const safeFolder = folder.replace(/[\\/:*?"<>|]/g, "_") || "flow-images";
  const ext = mimeType.includes("png")
    ? "png"
    : mimeType.includes("webp")
      ? "webp"
      : mimeType.includes("jpeg") || mimeType.includes("jpg")
        ? "jpg"
        : url.includes(".png")
          ? "png"
          : url.includes(".webp")
            ? "webp"
            : "jpg";
  const filename = `${safeFolder}/flow_${String(index + 1).padStart(3, "0")}_${Date.now()}.${ext}`;

  await chrome.downloads.download({
    url,
    filename,
    saveAs: false,
    conflictAction: "uniquify",
  });
}

async function generateWithRetry(tabId, prompt, index) {
  let delay = INITIAL_RETRY_DELAY_MS;

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
    await waitIfPaused();
    if (state.stopRequested) {
      throw new Error("Stopped by user");
    }

    try {
      await sendToContent(tabId, { type: "ENSURE_AGENT_OFF" });

      updateQueueStatus({
        running: true,
        paused: state.paused,
        currentIndex: index,
        itemStatus: {
          index,
          status: attempt > 1 ? "retrying" : "generating",
          prompt,
          attempt,
          maxAttempts: MAX_GENERATION_ATTEMPTS,
        },
      });

      const result = await sendToContent(tabId, {
        type: "GENERATE_IMAGE",
        prompt,
      });

      return result;
    } catch (error) {
      if (state.stopRequested) {
        throw error;
      }

      await appendErrorLog({
        index,
        promptPreview: prompt.slice(0, 120),
        prompt,
        attempt,
        maxAttempts: MAX_GENERATION_ATTEMPTS,
        error: error.message,
      });

      const isLastAttempt = attempt >= MAX_GENERATION_ATTEMPTS;
      if (isLastAttempt) {
        updateQueueStatus({
          running: true,
          paused: state.paused,
          currentIndex: index,
          itemStatus: {
            index,
            status: "skipped",
            prompt,
            attempt,
            maxAttempts: MAX_GENERATION_ATTEMPTS,
            error: error.message,
          },
        });
        return { skipped: true, error: error.message };
      }

      updateQueueStatus({
        running: true,
        paused: state.paused,
        currentIndex: index,
        itemStatus: {
          index,
          status: "retrying",
          prompt,
          attempt,
          maxAttempts: MAX_GENERATION_ATTEMPTS,
          nextAttempt: attempt + 1,
          error: error.message,
          retryInMs: delay,
        },
      });

      await interruptibleSleep(delay);
      delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
    }
  }

  return { skipped: true, error: `Prompt ${index + 1} failed after ${MAX_GENERATION_ATTEMPTS} attempts` };
}

async function downloadGeneratedImages(tabId, images, folder, index) {
  for (const image of images) {
    await downloadImage(image.url, folder, index, image.mimeType);
  }

  try {
    await sendToContent(tabId, { type: "DOWNLOAD_LATEST" });
  } catch {
    // UI download is a best-effort fallback
  }
}

async function processQueue() {
  if (state.running) return;
  state.running = true;
  state.stopRequested = false;
  state.paused = false;
  await saveState();
  updateQueueStatus({ running: true, paused: false, currentIndex: state.currentIndex });

  let skippedCount = 0;
  let successCount = 0;

  try {
    const tab = await findFlowTab();
    if (!tab?.id) {
      throw new Error("Open Google Flow (labs.google/fx/tools/flow) in Safari first");
    }
    state.flowTabId = tab.id;
    await chrome.tabs.update(tab.id, { active: true });

    await sendToContent(tab.id, { type: "ENSURE_AGENT_OFF" });

    const status = await sendToContent(tab.id, { type: "GET_STATUS" });
    if (!status.onFlowPage) {
      throw new Error("The active tab is not a Google Flow project page");
    }
    if (!status.hasPromptInput) {
      throw new Error("Could not find the prompt box — open a Flow project first");
    }

    for (let i = state.currentIndex; i < state.prompts.length; i += 1) {
      await waitIfPaused();
      if (state.stopRequested) break;

      const prompt = state.prompts[i];
      state.currentIndex = i;
      await saveState();

      if (state.paused) {
        updateQueueStatus({
          running: true,
          paused: true,
          currentIndex: i,
          itemStatus: { index: i, status: "paused", prompt, attempt: 1, maxAttempts: MAX_GENERATION_ATTEMPTS },
        });
        await waitIfPaused();
      }

      const result = await generateWithRetry(tab.id, prompt, i);

      if (state.stopRequested) break;

      if (result.skipped) {
        skippedCount += 1;
        if (i < state.prompts.length - 1 && !state.stopRequested) {
          await interruptibleSleep(INTER_REQUEST_DELAY_MS);
        }
        continue;
      }

      const images = result.images || [];
      if (!images.length) {
        await appendErrorLog({
          index: i,
          promptPreview: prompt.slice(0, 120),
          prompt,
          attempt: MAX_GENERATION_ATTEMPTS,
          maxAttempts: MAX_GENERATION_ATTEMPTS,
          error: "Generation finished without a downloadable image",
        });
        updateQueueStatus({
          running: true,
          paused: state.paused,
          currentIndex: i,
          itemStatus: {
            index: i,
            status: "skipped",
            prompt,
            attempt: MAX_GENERATION_ATTEMPTS,
            maxAttempts: MAX_GENERATION_ATTEMPTS,
            error: "No downloadable image detected",
          },
        });
        skippedCount += 1;
        if (i < state.prompts.length - 1 && !state.stopRequested) {
          await interruptibleSleep(INTER_REQUEST_DELAY_MS);
        }
        continue;
      }

      await downloadGeneratedImages(tab.id, images, state.folder, i);

      successCount += 1;
      updateQueueStatus({
        running: true,
        paused: state.paused,
        currentIndex: i,
        itemStatus: { index: i, status: "done", prompt, imageCount: images.length },
      });

      if (i < state.prompts.length - 1 && !state.stopRequested) {
        await interruptibleSleep(INTER_REQUEST_DELAY_MS);
      }
    }

    if (!state.restartPending) {
      const processedAll =
        !state.stopRequested && successCount + skippedCount === state.prompts.length;
      updateQueueStatus({
        running: false,
        paused: false,
        currentIndex: state.currentIndex,
        finished: processedAll,
        stopped: state.stopRequested,
        successCount,
        skippedCount,
      });
    }
  } catch (error) {
    const halted =
      state.restartPending || state.stopRequested || error.message === "Stopped by user";
    if (!halted) {
      updateQueueStatus({
        running: false,
        paused: false,
        error: error.message,
        currentIndex: state.currentIndex,
      });
    }
  } finally {
    const pendingRestart = state.restartPending;
    const wasStopped = state.stopRequested;
    state.running = false;
    state.stopRequested = false;

    if (pendingRestart) {
      state.paused = false;
      state.currentIndex = 0;
      await saveState();
      updateQueueStatus({
        running: false,
        paused: false,
        restartPending: true,
        currentIndex: 0,
        clearItemStatuses: true,
      });
      return;
    }

    state.paused = false;
    if (!wasStopped) {
      state.currentIndex = 0;
    }
    await saveState();
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!chrome.sidePanel?.open) return;
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch {
    // Side panel may be unavailable; user can open via Safari toolbar
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handle = async () => {
    switch (message.type) {
      case "START_QUEUE": {
        if (state.running) {
          return { success: false, error: "Generation is already running" };
        }
        const { prompts, folder, startIndex = 0 } = message.data || {};
        if (!Array.isArray(prompts) || prompts.length === 0) {
          return { success: false, error: "No prompts in queue" };
        }
        state.prompts = prompts;
        state.folder = folder || "flow-images";
        state.currentIndex = Math.max(0, startIndex);
        state.stopRequested = false;
        state.paused = false;
        state.restartPending = false;
        processQueue();
        return { success: true };
      }
      case "PAUSE_QUEUE": {
        if (!state.running) {
          return { success: false, error: "Nothing is running" };
        }
        state.paused = true;
        updateQueueStatus({
          running: true,
          paused: true,
          currentIndex: state.currentIndex,
          itemStatus: {
            index: state.currentIndex,
            status: "paused",
            prompt: state.prompts[state.currentIndex],
          },
        });
        return { success: true, data: { paused: true } };
      }
      case "RESUME_QUEUE": {
        if (!state.running) {
          return { success: false, error: "Nothing is running" };
        }
        state.paused = false;
        updateQueueStatus({ running: true, paused: false, currentIndex: state.currentIndex });
        return { success: true, data: { paused: false } };
      }
      case "RESTART_QUEUE": {
        if (!state.running) {
          return { success: false, error: "Nothing is running" };
        }
        if (!state.paused) {
          return { success: false, error: "Pause the pipeline before restarting" };
        }
        state.restartPending = true;
        state.stopRequested = true;
        state.paused = false;
        state.currentIndex = 0;
        if (state.flowTabId) {
          chrome.tabs.sendMessage(state.flowTabId, { type: "STOP_GENERATION" }).catch(() => {});
        }
        return { success: true };
      }
      case "STOP_QUEUE": {
        state.restartPending = false;
        state.stopRequested = true;
        if (state.flowTabId) {
          chrome.tabs.sendMessage(state.flowTabId, { type: "STOP_GENERATION" }).catch(() => {});
        }
        updateQueueStatus({ running: false, stopped: true, currentIndex: state.currentIndex });
        return { success: true };
      }
      case "GET_QUEUE_STATE":
        return {
          success: true,
          data: {
            running: state.running,
            paused: state.paused,
            restartPending: state.restartPending,
            currentIndex: state.currentIndex,
            prompts: state.prompts,
            folder: state.folder,
            interRequestDelayMs: INTER_REQUEST_DELAY_MS,
            maxRetryDelayMs: MAX_RETRY_DELAY_MS,
            initialRetryDelayMs: INITIAL_RETRY_DELAY_MS,
            maxGenerationAttempts: MAX_GENERATION_ATTEMPTS,
          },
        };
      case "GET_ERROR_LOGS": {
        const result = await chrome.storage.local.get(["errorLogs"]);
        return { success: true, data: { logs: result.errorLogs || [] } };
      }
      case "CLEAR_ERROR_LOGS": {
        await chrome.storage.local.set({ errorLogs: [] });
        broadcast({ type: "ERROR_LOG_UPDATE", data: { cleared: true, total: 0 } });
        return { success: true };
      }
      case "CHECK_FLOW_TAB": {
        const tab = await findFlowTab();
        if (!tab?.id) {
          return { success: true, data: { connected: false } };
        }
        try {
          const status = await sendToContent(tab.id, { type: "GET_STATUS" });
          return { success: true, data: { connected: true, tabId: tab.id, ...status } };
        } catch (error) {
          return {
            success: true,
            data: { connected: false, tabId: tab.id, error: error.message },
          };
        }
      }
      default:
        return { success: false, error: `Unknown message: ${message.type}` };
    }
  };

  handle()
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ success: false, error: error.message }));
  return true;
});

chrome.storage.local.get(["queueState"], (result) => {
  const saved = result.queueState;
  if (!saved) return;
  state.prompts = saved.prompts || [];
  state.folder = saved.folder || "flow-images";
  state.currentIndex = saved.currentIndex || 0;
});

console.log("Flow Image Automator background worker ready");
