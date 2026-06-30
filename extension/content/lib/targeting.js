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
    "reference",
    "pin",
    "image",
    "photo",
    "video",
    "audio",
  ];

  const SUBMIT_ICONS = new Set([
    "arrow_forward",
    "send",
    "north",
    "east",
    "navigate_next",
  ]);

  const ATTACH_ICONS = new Set([
    "attach_file",
    "add",
    "add_circle",
    "add_circle_outline",
    "upload",
    "file_upload",
    "image",
    "perm_media",
    "add_photo_alternate",
    "collections",
    "photo_library",
    "landscape",
    "control_point",
  ]);

  const ICON_SELECTORS = [
    "i.google-symbols",
    "i.material-icons",
    "i.material-symbols-outlined",
    "i.material-symbols-rounded",
    "span.google-symbols",
    "span.material-symbols-outlined",
    "span.material-symbols-rounded",
  ];

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

  Targeting.matchesSubmitLabel = (el) => {
    const { text, aria } = Targeting.normalizedLabel(el);
    return (
      SUBMIT_LABELS.some((label) => text.includes(label)) ||
      SUBMIT_ARIA.some((label) => aria.includes(label))
    );
  };

  Targeting.getButtonIconName = (btn) => {
    for (const selector of ICON_SELECTORS) {
      const icon = btn.querySelector(selector);
      const text = (icon?.textContent || "").trim();
      if (text) return text;
    }

    for (const child of btn.querySelectorAll("span, i")) {
      const text = (child.textContent || "").trim();
      if (text && text.length <= 32 && !/\s/.test(text)) return text;
    }

    return "";
  };

  Targeting.shouldAvoidSubmitButton = (btn) => {
    const { text, aria } = Targeting.normalizedLabel(btn);
    if (SUBMIT_AVOID.some((word) => text.includes(word) || aria.includes(word))) return true;

    const icon = Targeting.getButtonIconName(btn).toLowerCase();
    if (ATTACH_ICONS.has(icon)) return true;
    if (icon.startsWith("add")) return true;

    const testId = (btn.getAttribute("data-testid") || "").toLowerCase();
    if (/attach|upload|file|media|ingredient|reference|add[-_]?image/i.test(testId)) return true;

    return false;
  };

  Targeting.isAttachmentButton = (btn) => {
    if (Targeting.shouldAvoidSubmitButton(btn)) {
      const icon = Targeting.getButtonIconName(btn).toLowerCase();
      if (SUBMIT_ICONS.has(icon)) return false;
      if (Targeting.matchesSubmitLabel(btn)) return false;
      return true;
    }

    const { text, aria } = Targeting.normalizedLabel(btn);
    const icon = Targeting.getButtonIconName(btn).toLowerCase();

    if (ATTACH_ICONS.has(icon)) return true;
    if (icon.startsWith("add")) return true;

    return (
      aria === "add" ||
      aria.startsWith("add ") ||
      aria.includes("attach") ||
      aria.includes("upload") ||
      aria.includes("add image") ||
      aria.includes("ingredient") ||
      text.includes("attach") ||
      text.includes("upload")
    );
  };

  Targeting.hasSubmitIcon = (btn) => {
    const icon = Targeting.getButtonIconName(btn).toLowerCase();
    return SUBMIT_ICONS.has(icon);
  };

  Targeting.scoreSubmitButton = (btn, prompt) => {
    if (!DOM.isVisible(btn) || btn.disabled) return -1000;
    if (Targeting.isAttachmentButton(btn)) return -1000;
    if (Targeting.shouldAvoidSubmitButton(btn) && !Targeting.hasSubmitIcon(btn)) return -1000;

    let score = 0;
    const icon = Targeting.getButtonIconName(btn).toLowerCase();
    const btnRect = btn.getBoundingClientRect();
    const promptRect = prompt?.getBoundingClientRect();

    if (icon === "arrow_forward") score += 250;
    else if (SUBMIT_ICONS.has(icon)) score += 180;
    else if (ATTACH_ICONS.has(icon) || icon.startsWith("add")) return -1000;

    if (Targeting.matchesSubmitLabel(btn)) score += 120;

    if (btn.getAttribute("type") === "submit") score += 40;

    if (promptRect && btnRect.width > 0) {
      if (btnRect.left >= promptRect.right - 140) score += 90;
      else if (btnRect.left < promptRect.left + promptRect.width * 0.45) score -= 80;
    }

    if (btnRect.width > 0 && btnRect.height > 0 && btnRect.width <= 64 && btnRect.height <= 64) {
      score += 15;
    }

    return score;
  };

  Targeting.pickBestSubmitButton = (buttons, prompt) => {
    let best = null;
    let bestScore = 0;

    for (const btn of buttons) {
      const score = Targeting.scoreSubmitButton(btn, prompt);
      if (score > bestScore) {
        bestScore = score;
        best = btn;
      }
    }

    if (!best || bestScore < 80) return null;
    return best;
  };

  Targeting.collectComposerButtons = () => {
    const prompt = Targeting.getPromptInput();
    if (!prompt) return { prompt: null, buttons: [] };

    const root = Targeting.getComposerRoot();
    const seen = new Set();
    const buttons = [];

    for (const btn of DOM.queryAllDeep("button", root)) {
      if (seen.has(btn)) continue;
      seen.add(btn);
      buttons.push(btn);
    }

    return { prompt, buttons };
  };

  Targeting.isGenerateButton = (btn) => {
    if (!DOM.isVisible(btn) || btn.disabled) return false;
    if (Targeting.isAttachmentButton(btn)) return false;
    return Targeting.hasSubmitIcon(btn) || Targeting.matchesSubmitLabel(btn);
  };

  Targeting.findSubmitButtonInComposer = () => {
    const { prompt, buttons } = Targeting.collectComposerButtons();
    if (!prompt) return null;
    return Targeting.pickBestSubmitButton(buttons, prompt);
  };

  Targeting.findSubmitButtonByAria = () => {
    const { prompt, buttons } = Targeting.collectComposerButtons();
    const matches = buttons.filter((btn) => {
      if (!Targeting.isGenerateButton(btn)) return false;
      const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
      return SUBMIT_ARIA.some((label) => aria.includes(label));
    });
    return Targeting.pickBestSubmitButton(matches, prompt);
  };

  Targeting.findSubmitButtonByText = () => {
    const { prompt, buttons } = Targeting.collectComposerButtons();
    const matches = buttons.filter((btn) => {
      if (!Targeting.isGenerateButton(btn)) return false;
      const text = (btn.textContent || "").trim().toLowerCase();
      return SUBMIT_LABELS.some((label) => text === label || text.includes(label));
    });
    return Targeting.pickBestSubmitButton(matches, prompt);
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
