/**
 * Flow Image Automator — content script entry point.
 *
 * Loads modular subsystems (DOM → Targeting → InputSync → Submitter → UiIdle → Lifecycle)
 * and bridges messages from the background service worker.
 *
 * Message API:
 *   PING              — health check
 *   GET_STATUS        — page / agent / input availability
 *   ENSURE_AGENT_OFF  — disable Agent mode
 *   GENERATE_IMAGE    — run one prompt through the lifecycle state machine
 *   DOWNLOAD_LATEST   — click in-page download controls (fallback)
 */
(function initContentScript() {
  if (window.__FLOW_AUTOMATOR_LOADED__) return;
  window.__FLOW_AUTOMATOR_LOADED__ = true;

  const ns = window.FlowAutomator;
  if (!ns?.Lifecycle?.PromptLifecycle) {
    console.error("[FlowAutomator] Subsystem modules failed to load");
    return;
  }

  const { Targeting, Agent, Images, Lifecycle } = ns;
  const lifecycle = new Lifecycle.PromptLifecycle();

  async function getPageStatus() {
    return {
      onFlowPage: Targeting.isOnFlowPage(),
      agentModeOn: Agent.isOn(),
      hasPromptInput: Boolean(Targeting.getPromptInput()),
      lifecycleState: lifecycle.getState(),
      url: window.location.href,
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const handle = async () => {
      switch (message.type) {
        case "PING":
          return { success: true, loaded: true };

        case "GET_STATUS":
          return { success: true, data: await getPageStatus() };

        case "ENSURE_AGENT_OFF":
          return { success: true, data: await Agent.ensureOff() };

        case "GENERATE_IMAGE": {
          if (message.stop) {
            lifecycle.requestAbort();
          }
          const result = await lifecycle.runSinglePrompt(message.prompt);
          return { success: true, data: result };
        }

        case "STOP_GENERATION":
          lifecycle.requestAbort();
          return { success: true };

        case "DOWNLOAD_LATEST": {
          const clicked = (await Images.clickDownloadButtons()) + (await Images.downloadViaMenu());
          return { success: true, data: { clicked } };
        }

        default:
          return { success: false, error: `Unknown message type: ${message.type}` };
      }
    };

    handle()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true;
  });

  console.log("[FlowAutomator] content script ready — lifecycle state:", lifecycle.getState());
})();
