/**
 * Fill the Flow prompt composer and click Generate — single linear pipeline.
 */
(function initComposer(ns) {
  const { DOM, Targeting, Agent, Images } = ns;
  const Composer = {};

  const SETTLE_MS = 350;
  const SUBMIT_SETTLE_MS = 500;
  const GENERATION_TIMEOUT_MS = 180000;
  const POLL_MS = 1500;

  const SPINNER_SELECTORS = [
    '[role="progressbar"]',
    '[aria-busy="true"]',
    '[class*="loading" i]',
    '[class*="spinner" i]',
    '[class*="generating" i]',
  ];

  Composer.isGenerationActive = () => {
    if (Targeting.findStopButton()) return true;
    for (const selector of SPINNER_SELECTORS) {
      const el = DOM.queryDeep(selector);
      if (el && DOM.isVisible(el)) return true;
    }
    return Boolean(DOM.findByText("generating", ["span", "div", "p"]));
  };

  Composer.isSubmitReady = () => {
    const btn = Targeting.findSubmitButton();
    return Boolean(btn && !btn.disabled);
  };

  Composer.waitFor = async (predicate, timeoutMs, errorMessage) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (predicate()) return;
      await DOM.sleep(200);
    }
    throw new Error(errorMessage || "Timed out waiting for Google Flow UI");
  };

  Composer.waitForCycleIdle = (timeoutMs = 180000) =>
    Composer.waitFor(
      () => !Composer.isGenerationActive(),
      timeoutMs,
      "Timed out waiting for previous generation to finish"
    );

  Composer.waitForSubmitEnabled = (timeoutMs = 15000) =>
    Composer.waitFor(
      () => Composer.isSubmitReady(),
      timeoutMs,
      "Generate button stayed disabled after prompt insertion"
    );

  Composer.dispatchFrameworkEvents = (element, text) => {
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text,
      })
    );
    element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };

  Composer.setNativeValue = (element, value) => {
    const proto =
      element.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : element.tagName === "INPUT"
          ? window.HTMLInputElement.prototype
          : null;
    const setter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : null;
    if (setter) setter.call(element, value);
    else element.value = value;
  };

  Composer.getSlateEditor = () => {
    const inputDiv = DOM.queryDeep('[data-slate-editor="true"]');
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
  };

  Composer.clearPrompt = async (element) => {
    element.focus();
    await DOM.sleep(80);

    if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") {
      Composer.setNativeValue(element, "");
      Composer.dispatchFrameworkEvents(element, "");
      return;
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("delete", false, null);
    Composer.dispatchFrameworkEvents(element, "");
  };

  Composer.writeSimple = async (element, text) => {
    element.focus();
    await DOM.sleep(80);
    await Composer.clearPrompt(element);

    const isSlate = element.getAttribute("data-slate-editor") === "true";

    if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") {
      Composer.setNativeValue(element, text);
      Composer.dispatchFrameworkEvents(element, text);
    } else if (!isSlate) {
      element.textContent = text;
      element.innerText = text;
      Composer.dispatchFrameworkEvents(element, text);
    }

    await DOM.sleep(SETTLE_MS);
  };

  Composer.writeSlate = async (text) => {
    const slate = Composer.getSlateEditor();
    if (!slate) return false;

    const { editor, element } = slate;
    element.focus();
    await DOM.sleep(120);

    try {
      const currentText = editor.children[0]?.children[0]?.text || "";
      editor.select({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: currentText.length },
      });
      if (currentText.length > 0) editor.deleteFragment();
      editor.insertText(text);
      if (typeof editor.onChange === "function") editor.onChange();
      Composer.dispatchFrameworkEvents(element, text);
      await DOM.sleep(SETTLE_MS);
      return true;
    } catch (error) {
      console.warn("[FlowAutomator] Slate write failed:", error);
      return false;
    }
  };

  Composer.fillPrompt = async (text) => {
    const input = Targeting.getPromptInput();
    if (!input) {
      throw new Error("Could not find the Google Flow prompt input");
    }

    const isSlate = input.getAttribute("data-slate-editor") === "true";

    if (!isSlate) {
      await Composer.writeSimple(input, text);
    }

    if (!Composer.isSubmitReady()) {
      await Composer.writeSlate(text);
    }

    if (!Composer.isSubmitReady()) {
      input.focus();
      await DOM.sleep(80);
      const pasted = document.execCommand("insertText", false, text);
      if (pasted) {
        Composer.dispatchFrameworkEvents(input, text);
        await DOM.sleep(SETTLE_MS);
      }
    }

    await Composer.waitForSubmitEnabled();
    return input;
  };

  Composer.clickGenerate = async () => {
    const button = Targeting.findSubmitButton();
    if (!button) {
      throw new Error("Generate button not found");
    }
    if (button.disabled) {
      throw new Error("Generate button is disabled");
    }

    button.scrollIntoView({ behavior: "smooth", block: "center" });
    await DOM.sleep(200);
    button.click();
    await DOM.sleep(SUBMIT_SETTLE_MS);
  };

  Composer.submitViaEnter = async (input) => {
    if (!input) return;
    input.focus();
    await DOM.sleep(120);

    const enter = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    };
    input.dispatchEvent(new KeyboardEvent("keydown", enter));
    input.dispatchEvent(new KeyboardEvent("keypress", enter));
    input.dispatchEvent(new KeyboardEvent("keyup", enter));
    await DOM.sleep(SUBMIT_SETTLE_MS);
  };

  Composer.fillAndSubmit = async (text, isAborted = () => false) => {
    if (isAborted()) throw new Error("Stopped by user");

    await Composer.waitForCycleIdle();
    await Agent.ensureOff();
    if (isAborted()) throw new Error("Stopped by user");

    const promptInput = await Composer.fillPrompt(text);
    if (isAborted()) throw new Error("Stopped by user");

    await Agent.ensureOff();
    await Composer.clickGenerate();

    if (!Composer.isGenerationActive()) {
      await Composer.submitViaEnter(promptInput);
    }

    if (!Composer.isGenerationActive()) {
      await Composer.clickGenerate();
    }

    if (!Composer.isGenerationActive()) {
      throw new Error("Submit did not start generation — Generate button click had no effect");
    }

    return { method: "click" };
  };

  Composer.waitForNewImages = async (baselineImages, isAborted = () => false) => {
    const started = Date.now();
    let sawGenerating = false;

    while (Date.now() - started < GENERATION_TIMEOUT_MS) {
      if (isAborted()) throw new Error("Stopped by user");

      if (Composer.isGenerationActive()) sawGenerating = true;

      const current = Images.collect();
      const fresh = current.filter((url) => !baselineImages.includes(url));

      if (sawGenerating && fresh.length > 0 && !Composer.isGenerationActive()) {
        await DOM.sleep(1200);
        return Images.collect().filter((url) => !baselineImages.includes(url));
      }

      if (!sawGenerating && fresh.length > 0 && Date.now() - started > 8000) {
        await DOM.sleep(1200);
        return Images.collect().filter((url) => !baselineImages.includes(url));
      }

      await DOM.sleep(POLL_MS);
    }

    throw new Error("Timed out waiting for image generation to finish");
  };

  ns.Composer = Composer;
})(window.FlowAutomator);
