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
      const proto =
        element.tagName === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : element.tagName === "INPUT"
            ? window.HTMLInputElement.prototype
            : null;
      const setter = proto
        ? Object.getOwnPropertyDescriptor(proto, "value")?.set
        : null;

      if (setter) {
        setter.call(element, text);
      } else if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") {
        element.value = text;
      } else {
        element.textContent = text;
      }
      element.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })
      );
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await sleep(200);
  }

  function getSlateEditor() {
    const inputDiv = document.querySelector('[data-slate-editor="true"]');
    if (!inputDiv) return null;

    const fiberKey = Object.keys(inputDiv).find(
      (key) => key.startsWith("__reactFiber") || key.startsWith("__reactInternalInstance")
    );
    if (!fiberKey) return null;

    let current = inputDiv[fiberKey];
    for (let depth = 0; depth < 40 && current; depth += 1) {
      if (current.memoizedProps?.editor?.children) {
        return { editor: current.memoizedProps.editor, element: inputDiv };
      }
      current = current.return;
    }
    return null;
  }

  async function typeIntoSlate(text) {
    const slate = getSlateEditor();
    if (!slate) return false;

    const { editor, element } = slate;
    element.focus();
    await sleep(120);

    try {
      const currentText = editor.children[0]?.children[0]?.text || "";
      editor.select({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: currentText.length },
      });
      if (currentText.length > 0) {
        editor.deleteFragment();
      }
      editor.insertText(text);
      if (typeof editor.onChange === "function") {
        editor.onChange();
      }
      await sleep(350);
      return true;
    } catch (error) {
      console.warn("Flow Automator: Slate insert failed", error);
      return false;
    }
  }

  function getComposerRoot() {
    const slate = document.querySelector('[data-slate-editor="true"]');
    if (slate) {
      return (
        slate.closest("form") ||
        slate.closest('[class*="composer" i]') ||
        slate.closest('[class*="prompt" i]') ||
        slate.parentElement?.parentElement?.parentElement ||
        document.body
      );
    }

    const textarea = document.querySelector("#PINHOLE_TEXT_AREA_ELEMENT_ID");
    if (textarea) {
      return textarea.closest("form") || textarea.parentElement?.parentElement || document.body;
    }

    return document.body;
  }

  function buttonHasArrowForward(btn) {
    const icon = btn.querySelector("i.google-symbols, i.material-icons, span.google-symbols");
    const iconText = (icon?.textContent || "").trim();
    const btnText = (btn.textContent || "").trim();
    return iconText === "arrow_forward" || btnText.includes("arrow_forward");
  }

  function isSubmitLabel(text) {
    const normalized = (text || "").toLowerCase();
    return ["create", "generate", "criar", "créer", "erstellen", "作成", "生成", "만들기"].some(
      (label) => normalized.includes(label)
    );
  }

  function findSubmitButton(searchRoot = getComposerRoot()) {
    const avoid = [
      "expand",
      "edit",
      "settings",
      "more",
      "menu",
      "copy",
      "download",
      "tune",
      "agent",
      "clear",
      "restart",
    ];

    const shouldAvoid = (btn) => {
      const text = (btn.textContent || "").toLowerCase();
      const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
      return avoid.some((word) => text.includes(word) || aria.includes(word));
    };

    const buttons = Array.from(searchRoot.querySelectorAll("button"));
    const candidates = buttons.filter(
      (btn) => isVisible(btn) && !shouldAvoid(btn) && buttonHasArrowForward(btn)
    );

    for (const btn of candidates) {
      if (!btn.disabled && isSubmitLabel(btn.textContent || "")) return btn;
    }
    for (const btn of candidates) {
      if (!btn.disabled) return btn;
    }
    return candidates[0] || null;
  }

  async function waitForSubmitEnabled(timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const btn = findSubmitButton();
      if (btn && !btn.disabled) return btn;
      await sleep(200);
    }
    throw new Error("Create button stayed disabled after entering the prompt");
  }

  async function typePrompt(prompt) {
    if (await typeIntoSlate(prompt)) {
      await waitForSubmitEnabled();
      return getSlateEditor()?.element || document.querySelector('[data-slate-editor="true"]');
    }

    const input = getPromptInput();
    if (!input) {
      throw new Error("Could not find the prompt input on Google Flow");
    }

    if (input.tagName === "TEXTAREA" || input.tagName === "INPUT") {
      await typeText(input, prompt, true);
    } else {
      await typeText(input, prompt, true);
    }

    await waitForSubmitEnabled();
    return input;
  }

  async function clickSubmitButton(btn) {
    btn.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(200);

    const rect = btn.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const eventInit = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };

    btn.dispatchEvent(new PointerEvent("pointerover", eventInit));
    btn.dispatchEvent(new MouseEvent("mouseover", eventInit));
    btn.dispatchEvent(new PointerEvent("pointerdown", eventInit));
    btn.dispatchEvent(new MouseEvent("mousedown", eventInit));
    btn.dispatchEvent(new PointerEvent("pointerup", eventInit));
    btn.dispatchEvent(new MouseEvent("mouseup", eventInit));
    btn.dispatchEvent(new MouseEvent("click", eventInit));
    btn.click();
    await sleep(400);
  }

  async function submitViaKeyboard(target) {
    if (!target) return false;
    target.focus();
    await sleep(120);

    const combos = [
      { key: "Enter", code: "Enter", keyCode: 13 },
      { key: "Enter", code: "Enter", keyCode: 13, metaKey: true },
    ];

    for (const combo of combos) {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...combo })
      );
      target.dispatchEvent(
        new KeyboardEvent("keyup", { bubbles: true, cancelable: true, ...combo })
      );
      await sleep(400);
      if (isGenerating()) return true;
    }
    return false;
  }

  function hasGenerationStarted() {
    return isGenerating() || Boolean(findStopButton());
  }

  function findStopButton() {
    return Array.from(document.querySelectorAll("button")).find((btn) => {
      if (!isVisible(btn)) return false;
      const text = (btn.textContent || "").toLowerCase();
      const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
      return text.includes("stop") || aria.includes("stop");
    });
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
      document.querySelector('[data-slate-editor="true"]') ||
      document.querySelector("#PINHOLE_TEXT_AREA_ELEMENT_ID") ||
      document.querySelector('textarea[placeholder*="Generate" i]') ||
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector("textarea:not([disabled])")
    );
  }

  function isGenerating() {
    if (findStopButton()) return true;

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

  async function clickGenerate(promptInput) {
    await sleep(400);

    let btn = findSubmitButton();
    if (!btn || btn.disabled) {
      btn = await waitForSubmitEnabled();
    }

    if (btn && !btn.disabled) {
      await clickSubmitButton(btn);
      await sleep(600);
      if (hasGenerationStarted()) return true;
    }

    if (await submitViaKeyboard(promptInput)) return true;

    btn =
      findSubmitButton(document.body) ||
      Array.from(document.querySelectorAll("button")).find(
        (candidate) => isVisible(candidate) && buttonHasArrowForward(candidate) && !candidate.disabled
      );

    if (btn) {
      await clickSubmitButton(btn);
      await sleep(600);
      if (hasGenerationStarted()) return true;
    }

    throw new Error("Could not submit prompt — the Create button did not start generation");
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

    const baselineImages = collectGeneratedImages();
    const promptInput = await typePrompt(prompt);
    if (signal?.aborted) throw new Error("Stopped by user");

    await ensureAgentModeOff();
    await clickGenerate(promptInput);
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
