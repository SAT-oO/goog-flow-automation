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
  ];

  const PROMPT_SELECTORS = [
    'textarea[aria-label*="prompt" i]',
    '[data-slate-editor="true"]',
    "#PINHOLE_TEXT_AREA_ELEMENT_ID",
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

  Targeting.shouldAvoidSubmitButton = (btn) => {
    const { text, aria } = Targeting.normalizedLabel(btn);
    return SUBMIT_AVOID.some((word) => text.includes(word) || aria.includes(word));
  };

  Targeting.matchesSubmitLabel = (el) => {
    const { text, aria } = Targeting.normalizedLabel(el);
    return (
      SUBMIT_LABELS.some((label) => text.includes(label)) ||
      SUBMIT_ARIA.some((label) => aria.includes(label))
    );
  };

  Targeting.buttonHasArrowForward = (btn) => {
    const icon = btn.querySelector("i.google-symbols, i.material-icons, span.google-symbols");
    const iconText = (icon?.textContent || "").trim();
    const btnText = (btn.textContent || "").trim();
    if (iconText === "arrow_forward" || btnText.includes("arrow_forward")) return true;

    const svg = btn.querySelector("svg");
    if (!svg) return false;
    const paths = svg.querySelectorAll("path");
    for (const path of paths) {
      const d = path.getAttribute("d") || "";
      if (/M.*L.*|arrow|send/i.test(d) && d.length > 12) return true;
    }
    return false;
  };

  Targeting.findSubmitButtonByAria = () => {
    for (const btn of DOM.queryAllDeep("button")) {
      if (!DOM.isVisible(btn) || btn.disabled || Targeting.shouldAvoidSubmitButton(btn)) continue;
      const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
      if (SUBMIT_ARIA.some((label) => aria.includes(label))) return btn;
    }
    return null;
  };

  Targeting.findSubmitButtonByText = () => {
    for (const btn of DOM.queryAllDeep("button")) {
      if (!DOM.isVisible(btn) || btn.disabled || Targeting.shouldAvoidSubmitButton(btn)) continue;
      const text = (btn.textContent || "").trim().toLowerCase();
      if (SUBMIT_LABELS.some((label) => text === label || text.includes(label))) return btn;
    }
    return null;
  };

  Targeting.findSubmitButtonByIcon = () => {
    const root = Targeting.getComposerRoot();
    const buttons = DOM.queryAllDeep("button", root);
    const candidates = buttons.filter(
      (btn) =>
        DOM.isVisible(btn) &&
        !btn.disabled &&
        !Targeting.shouldAvoidSubmitButton(btn) &&
        Targeting.buttonHasArrowForward(btn)
    );
    return candidates[0] || null;
  };

  Targeting.findSubmitButton = () =>
    Targeting.findSubmitButtonByAria() ||
    Targeting.findSubmitButtonByText() ||
    Targeting.findSubmitButtonByIcon();

  Targeting.findStopButton = () =>
    DOM.queryAllDeep("button").find((btn) => {
      if (!DOM.isVisible(btn)) return false;
      const text = (btn.textContent || "").toLowerCase();
      const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
      return text.includes("stop") || aria.includes("stop");
    }) || null;

  ns.Targeting = Targeting;
})(window.FlowAutomator);
