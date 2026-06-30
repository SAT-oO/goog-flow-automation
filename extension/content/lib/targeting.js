/**
 * Locate Google Flow prompt input and Generate/Submit controls.
 * Prefers stable semantic hooks (aria-label, visible text, iconography) over class names.
 */
(function initTargeting(ns) {
  const { DOM } = ns;
  const Targeting = {};

  const SUBMIT_LABELS = [
    "generate",
    "create",
    "send",
    "submit",
    "criar",
    "créer",
    "erstellen",
    "作成",
    "生成",
    "만들기",
  ];

  const SUBMIT_ARIA = [
    "generate",
    "create",
    "send",
    "submit prompt",
    "submit",
    "criar",
    "créer",
    "erstellen",
  ];

  const SUBMIT_AVOID = [
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
    "close",
    "cancel",
    "attach",
    "attachment",
    "upload",
    "file",
    "media",
    "ingredient",
  ];

  const ATTACH_ICONS = new Set([
    "attach_file",
    "add",
    "add_circle",
    "upload",
    "file_upload",
    "image",
    "perm_media",
    "add_photo_alternate",
    "collections",
  ]);

  const PROMPT_SELECTORS = [
    "#PINHOLE_TEXT_AREA_ELEMENT_ID",
    '[data-slate-editor="true"]',
    'textarea[aria-label*="prompt" i]',
    'textarea[placeholder*="generate" i]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
    "textarea:not([disabled])",
  ];

  Targeting.isOnFlowPage = () =>
    /labs\.google/.test(window.location.hostname) &&
    window.location.pathname.includes("/flow");

  Targeting.getPromptInput = () => {
    for (const selector of PROMPT_SELECTORS) {
      const el = DOM.queryDeep(selector);
      if (el && DOM.isVisible(el)) return el;
    }
    return null;
  };

  Targeting.getComposerRoot = () => {
    const prompt = Targeting.getPromptInput();
    if (!prompt) return document.body;

    return (
      prompt.closest("form") ||
      prompt.closest('[class*="composer" i]') ||
      prompt.closest('[class*="prompt" i]') ||
      prompt.parentElement?.parentElement?.parentElement ||
      document.body
    );
  };

  Targeting.normalizedLabel = (el) => {
    const text = (el.textContent || "").trim().toLowerCase();
    const aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
    return { text, aria };
  };

  Targeting.getButtonIconName = (btn) => {
    const icon = btn.querySelector("i.google-symbols, i.material-icons, span.google-symbols");
    return (icon?.textContent || "").trim();
  };

  Targeting.shouldAvoidSubmitButton = (btn) => {
    const { text, aria } = Targeting.normalizedLabel(btn);
    return SUBMIT_AVOID.some((word) => text.includes(word) || aria.includes(word));
  };

  Targeting.isAttachmentButton = (btn) => {
    const { text, aria } = Targeting.normalizedLabel(btn);
    const icon = Targeting.getButtonIconName(btn);
    if (ATTACH_ICONS.has(icon)) return true;
    return (
      aria.includes("attach") ||
      aria.includes("upload") ||
      aria.includes("add image") ||
      text.includes("attach") ||
      text.includes("upload")
    );
  };

  Targeting.matchesSubmitLabel = (el) => {
    const { text, aria } = Targeting.normalizedLabel(el);
    return (
      SUBMIT_LABELS.some((label) => text.includes(label)) ||
      SUBMIT_ARIA.some((label) => aria.includes(label))
    );
  };

  Targeting.isGenerateButton = (btn) => {
    if (!DOM.isVisible(btn) || btn.disabled) return false;
    if (Targeting.shouldAvoidSubmitButton(btn)) return false;
    if (Targeting.isAttachmentButton(btn)) return false;
    return (
      Targeting.matchesSubmitLabel(btn) || Targeting.getButtonIconName(btn) === "arrow_forward"
    );
  };

  Targeting.findSubmitButtonInComposer = () => {
    const prompt = Targeting.getPromptInput();
    if (!prompt) return null;

    const scopes = [];
    let el = prompt.parentElement;
    for (let depth = 0; depth < 8 && el; depth += 1) {
      scopes.push(el);
      el = el.parentElement;
    }

    const seen = new Set();
    let candidates = [];

    for (const scope of scopes) {
      candidates = [];
      for (const btn of DOM.queryAllDeep("button", scope)) {
        if (seen.has(btn)) continue;
        seen.add(btn);
        if (Targeting.isGenerateButton(btn)) candidates.push(btn);
      }
      if (candidates.length > 0) break;
    }

    if (!candidates.length) return null;

    const labeled = candidates.find((btn) => Targeting.matchesSubmitLabel(btn));
    if (labeled) return labeled;

    const arrow = candidates.find((btn) => Targeting.getButtonIconName(btn) === "arrow_forward");
    if (arrow) return arrow;

    return candidates[candidates.length - 1];
  };

  Targeting.findSubmitButtonByAria = () => {
    for (const btn of DOM.queryAllDeep("button", Targeting.getComposerRoot())) {
      if (!Targeting.isGenerateButton(btn)) continue;
      const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
      if (SUBMIT_ARIA.some((label) => aria.includes(label))) return btn;
    }
    return null;
  };

  Targeting.findSubmitButtonByText = () => {
    for (const btn of DOM.queryAllDeep("button", Targeting.getComposerRoot())) {
      if (!Targeting.isGenerateButton(btn)) continue;
      const text = (btn.textContent || "").trim().toLowerCase();
      if (SUBMIT_LABELS.some((label) => text === label || text.includes(label))) return btn;
    }
    return null;
  };

  Targeting.findSubmitButton = () =>
    Targeting.findSubmitButtonInComposer() ||
    Targeting.findSubmitButtonByAria() ||
    Targeting.findSubmitButtonByText();

  Targeting.findStopButton = () =>
    DOM.queryAllDeep("button").find((btn) => {
      if (!DOM.isVisible(btn)) return false;
      const text = (btn.textContent || "").toLowerCase();
      const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
      return text.includes("stop") || aria.includes("stop");
    }) || null;

  Targeting.readPromptText = () => {
    const input = Targeting.getPromptInput();
    if (!input) return "";
    if (input.tagName === "TEXTAREA" || input.tagName === "INPUT") {
      return input.value || "";
    }
    return (input.textContent || "").trim();
  };

  ns.Targeting = Targeting;
})(window.FlowAutomator);
