/**
 * Google Flow content script — DOM automation for image generation.
 */
(function () {
  if (window.__FLOW_AUTOMATOR_LOADED__) return;
  window.__FLOW_AUTOMATOR_LOADED__ = true;

  const FLOW_HOST_PATTERN = /labs\.google/;
  const GENERATION_TIMEOUT_MS = 180000;
  const POLL_INTERVAL_MS = 1500;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      style.opacity !== "0"
    );
  }

  function findElementByText(text, tags = ["button", "span", "div", "a", "li"]) {
    const needle = text.toLowerCase();
    for (const tag of tags) {
      for (const el of document.querySelectorAll(tag)) {
        if (!isVisible(el)) continue;
        const content = (el.textContent || "").toLowerCase().trim();
        const aria = (el.getAttribute("aria-label") || "").toLowerCase();
        if (content === needle || content.includes(needle) || aria.includes(needle)) {
          return el;
        }
      }
    }
    return null;
  }

  async function clickElement(element) {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(200);
    element.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true, cancelable: true })
    );
    await sleep(50);
    element.click();
    await sleep(300);
  }

  async function typeText(element, text, clearFirst = true) {
    element.focus();
    await sleep(100);

    if (clearFirst) {
      if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") {
        element.select();
      } else {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      document.execCommand("delete", false, null);
      await sleep(80);
    }

    const pasted = document.execCommand("insertText", false, text);
    if (!pasted) {
      if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") {
        element.value = text;
      } else {
        element.textContent = text;
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await sleep(200);
  }

  function isOnFlowPage() {
    return FLOW_HOST_PATTERN.test(window.location.hostname) &&
      window.location.pathname.includes("/flow");
  }

  function findAgentToggleButton() {
    return Array.from(document.querySelectorAll("button")).find((btn) => {
      if (!isVisible(btn)) return false;
      const text = (btn.textContent || "").trim().toLowerCase();
      const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
      return text === "agent" || aria === "agent" || aria.includes("agent mode");
    }) || null;
  }

  function isAgentModeOn() {
    const agentButtons = Array.from(document.querySelectorAll("button")).filter((btn) => {
      const text = (btn.textContent || "").trim().toLowerCase();
      const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
      return text === "agent" || aria === "agent" || aria.includes("agent mode");
    });

    for (const btn of agentButtons) {
      if (!isVisible(btn)) continue;
      const pressed = btn.getAttribute("aria-pressed");
      const state = btn.getAttribute("data-state");
      const selected = btn.getAttribute("aria-selected");
      if (pressed === "true" || state === "on" || selected === "true") {
        return true;
      }
      const className = (btn.className || "").toLowerCase();
      if (className.includes("active") || className.includes("selected")) {
        return true;
      }
    }

    const agentPanel = document.querySelector(
      '[class*="agent" i][class*="panel" i], [data-testid*="agent" i]'
    );
    if (agentPanel && isVisible(agentPanel)) {
      return true;
    }

    const composer = document.querySelector(
      '[contenteditable="true"], textarea#PINHOLE_TEXT_AREA_ELEMENT_ID'
    );
    if (composer) {
      const placeholder = (composer.getAttribute("placeholder") || "").toLowerCase();
      if (placeholder.includes("agent") || placeholder.includes("chat")) {
        return true;
      }
    }

    return false;
  }

  async function ensureAgentModeOff() {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (!isAgentModeOn()) {
        return { agentModeOn: false };
      }

      const toggle = findAgentToggleButton();
      if (!toggle) {
        throw new Error("Agent mode is on but the Agent toggle could not be found");
      }

      await clickElement(toggle);
      await sleep(700);
    }

    if (isAgentModeOn()) {
      throw new Error("Could not turn Agent mode off — click Agent manually in Google Flow");
    }

    return { agentModeOn: false };
  }

  function getPromptInput() {
    return (
      document.querySelector("#PINHOLE_TEXT_AREA_ELEMENT_ID") ||
      document.querySelector('textarea[placeholder*="Generate" i]') ||
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector("textarea:not([disabled])")
    );
  }

  function isGenerating() {
    const busy = document.querySelector(
      '[role="progressbar"], [aria-busy="true"], [class*="loading" i], [class*="spinner" i], [class*="generating" i]'
    );
    if (busy && isVisible(busy)) return true;

    const statusText = findElementByText("generating", ["span", "div", "p"]);
    if (statusText) return true;

    return false;
  }

  function collectGeneratedImages() {
    const urls = new Set();
    const selectors = [
      'img[src*="googleusercontent"]',
      'img[src*="blob:"]',
      'img[src^="https://"]',
    ];

    for (const selector of selectors) {
      for (const img of document.querySelectorAll(selector)) {
        if (!isVisible(img)) continue;
        const src = img.currentSrc || img.src;
        if (!src || src.length < 20) continue;
        if (src.includes("data:image/svg") || src.includes("favicon")) continue;
        const rect = img.getBoundingClientRect();
        if (rect.width < 80 || rect.height < 80) continue;
        urls.add(src);
      }
    }
    return Array.from(urls);
  }

  async function clickGenerate() {
    await sleep(300);
    const avoid = ["expand", "edit", "settings", "more", "menu", "copy", "download", "tune", "agent"];

    const shouldAvoid = (btn) => {
      const text = (btn.textContent || "").toLowerCase();
      const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
      return avoid.some((word) => text.includes(word) || aria.includes(word));
    };

    const buttons = Array.from(document.querySelectorAll("button:not([disabled])"));

    for (const btn of buttons) {
      if (!isVisible(btn) || shouldAvoid(btn)) continue;
      const html = btn.innerHTML || "";
      const text = (btn.textContent || "").toLowerCase();
      if (html.includes("arrow_forward") && text.includes("create")) {
        await clickElement(btn);
        return true;
      }
    }

    for (const btn of buttons) {
      if (!isVisible(btn) || shouldAvoid(btn)) continue;
      const text = (btn.textContent || "").toLowerCase().trim();
      if (text === "create" || text === "generate") {
        await clickElement(btn);
        return true;
      }
    }

    for (const btn of buttons) {
      if (!isVisible(btn) || shouldAvoid(btn)) continue;
      if ((btn.innerHTML || "").includes("arrow_forward")) {
        await clickElement(btn);
        return true;
      }
    }

    throw new Error("Could not find the Create / Generate button");
  }

  async function clickDownloadButtons() {
    let count = 0;
    const downloadButtons = document.querySelectorAll(
      'button[aria-label*="download" i], button[aria-label*="save" i], a[download]'
    );

    for (const btn of downloadButtons) {
      if (!isVisible(btn) || btn.disabled) continue;
      await clickElement(btn);
      count += 1;
      await sleep(800);
    }
    return count;
  }

  async function downloadViaMenu() {
    let count = 0;
    const menuButtons = document.querySelectorAll(
      'button[aria-label*="more" i], button[aria-label*="menu" i]'
    );

    for (const menuBtn of menuButtons) {
      const container = menuBtn.closest('[class*="clip" i], [class*="card" i], [class*="image" i]');
      if (!container || !container.querySelector("img")) continue;
      await clickElement(menuBtn);
      await sleep(400);
      const downloadOption = findElementByText("download", ["button", "div", "span", "li", "a"]);
      if (downloadOption) {
        await clickElement(downloadOption);
        count += 1;
        await sleep(800);
      } else {
        document.body.click();
        await sleep(200);
      }
    }
    return count;
  }

  async function waitForGenerationComplete(baselineImages, signal) {
    const start = Date.now();
    let sawGenerating = false;

    while (Date.now() - start < GENERATION_TIMEOUT_MS) {
      if (signal?.aborted) throw new Error("Stopped by user");

      if (isGenerating()) {
        sawGenerating = true;
      }

      const currentImages = collectGeneratedImages();
      const newImages = currentImages.filter((url) => !baselineImages.includes(url));

      if (sawGenerating && newImages.length > 0 && !isGenerating()) {
        await sleep(1200);
        return collectGeneratedImages().filter((url) => !baselineImages.includes(url));
      }

      if (!sawGenerating && newImages.length > 0 && Date.now() - start > 8000) {
        await sleep(1200);
        return collectGeneratedImages().filter((url) => !baselineImages.includes(url));
      }

      await sleep(POLL_INTERVAL_MS);
    }

    throw new Error("Timed out waiting for image generation to finish");
  }

  async function getPageStatus() {
    return {
      onFlowPage: isOnFlowPage(),
      agentModeOn: isAgentModeOn(),
      hasPromptInput: Boolean(getPromptInput()),
      url: window.location.href,
    };
  }

  async function resolveImageForDownload(url) {
    if (!url.startsWith("blob:")) {
      return { url, mimeType: "image/png" };
    }

    const response = await fetch(url);
    const blob = await response.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Failed to read generated image"));
      reader.readAsDataURL(blob);
    });
    return { url: dataUrl, mimeType: blob.type || "image/png" };
  }

  async function generateImage(prompt, options = {}) {
    const { signal } = options;

    if (!isOnFlowPage()) {
      throw new Error("Open Google Flow (labs.google/fx/tools/flow) in this tab first");
    }

    await ensureAgentModeOff();

    const input = getPromptInput();
    if (!input) {
      throw new Error("Could not find the prompt input on Google Flow");
    }

    const baselineImages = collectGeneratedImages();
    await typeText(input, prompt, true);
    if (signal?.aborted) throw new Error("Stopped by user");

    await ensureAgentModeOff();
    await clickGenerate();
    const newImageUrls = await waitForGenerationComplete(baselineImages, signal);
    if (!newImageUrls.length) {
      throw new Error("Generation finished but no new image was detected");
    }

    const images = [];
    for (const imageUrl of newImageUrls) {
      images.push(await resolveImageForDownload(imageUrl));
    }

    return { images };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const handler = async () => {
      switch (message.type) {
        case "PING":
          return { success: true, loaded: true };
        case "GET_STATUS":
          return { success: true, data: await getPageStatus() };
        case "ENSURE_AGENT_OFF":
          return { success: true, data: await ensureAgentModeOff() };
        case "GENERATE_IMAGE":
          return {
            success: true,
            data: await generateImage(message.prompt, { signal: message.signal }),
          };
        case "DOWNLOAD_LATEST": {
          const clicked = (await clickDownloadButtons()) + (await downloadViaMenu());
          return { success: true, data: { clicked } };
        }
        default:
          return { success: false, error: `Unknown message type: ${message.type}` };
      }
    };

    handler()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  });
})();
