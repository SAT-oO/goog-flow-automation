/**
 * Flow Image Automator — content script entry point.
 */
(function initContentScript() {
  if (window.__FLOW_AUTOMATOR_LOADED__) return;
  window.__FLOW_AUTOMATOR_LOADED__ = true;

  const ns = window.FlowAutomator;
  if (!ns?.Composer) {
    console.error("[FlowAutomator] Composer module failed to load");
    return;
  }

  const { Targeting, Agent, Images, Composer } = ns;
  let abortRequested = false;
  let busy = false;

  async function getPageStatus() {
    return {
      onFlowPage: Targeting.isOnFlowPage(),
      agentModeOn: Agent.isOn(),
      hasPromptInput: Boolean(Targeting.getPromptInput()),
      busy,
      url: window.location.href,
    };
  }

  async function generateImage(prompt) {
    abortRequested = false;
    busy = true;

    try {
      if (!Targeting.isOnFlowPage()) {
        throw new Error("Open Google Flow (labs.google/fx/tools/flow) in this tab first");
      }

      const baselineImages = Images.collect();
      const { method } = await Composer.fillAndSubmit(prompt, () => abortRequested);

      const imageUrls = await Composer.waitForNewImages(baselineImages, () => abortRequested);
      if (!imageUrls.length) {
        throw new Error("Generation finished but no new image was detected");
      }

      const images = [];
      for (const url of imageUrls) {
        images.push(await Images.resolveForDownload(url));
      }

      await Composer.waitForCycleIdle();
      return { images, submitMethod: method };
    } finally {
      busy = false;
    }
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
          if (message.stop) abortRequested = true;
          const result = await generateImage(message.prompt);
          return { success: true, data: result };
        }

        case "STOP_GENERATION":
          abortRequested = true;
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

  console.log("[FlowAutomator] content script ready");
})();
