/**
 * Targeting engine — locates Google Flow prompt input and submit controls.
 *
 * Selectors are evaluated through the Shadow-DOM-aware query layer so
 * composer widgets remain discoverable after encapsulation changes.
 */
(function initTargeting(ns) {
  const { DOM } = ns;
  const Targeting = {};

  const SUBMIT_LABELS = [
    "create",
    "generate",
    "send",
    "criar",
    "créer",
    "erstellen",
    "作成",
    "生成",
    "만들기",
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
  ];

  const PROMPT_SELECTORS = [
    '[data-slate-editor="true"]',
    "#PINHOLE_TEXT_AREA_ELEMENT_ID",
    'textarea[placeholder*="Generate" i]',
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

  Targeting.buttonHasArrowForward = (btn) => {
    const icon = btn.querySelector("i.google-symbols, i.material-icons, span.google-symbols");
    const iconText = (icon?.textContent || "").trim();
    const btnText = (btn.textContent || "").trim();
    return iconText === "arrow_forward" || btnText.includes("arrow_forward");
  };

  Targeting.isSubmitLabel = (text) => {
    const normalized = (text || "").toLowerCase();
    return SUBMIT_LABELS.some((label) => normalized.includes(label));
  };

  Targeting.shouldAvoidSubmitButton = (btn) => {
    const text = (btn.textContent || "").toLowerCase();
    const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
    return SUBMIT_AVOID.some((word) => text.includes(word) || aria.includes(word));
  };

  Targeting.findSubmitButton = (searchRoot = Targeting.getComposerRoot()) => {
    const buttons = DOM.queryAllDeep("button", searchRoot);
    const candidates = buttons.filter(
      (btn) =>
        DOM.isVisible(btn) &&
        !Targeting.shouldAvoidSubmitButton(btn) &&
        Targeting.buttonHasArrowForward(btn)
    );

    for (const btn of candidates) {
      if (!btn.disabled && Targeting.isSubmitLabel(btn.textContent || "")) return btn;
    }
    for (const btn of candidates) {
      if (!btn.disabled) return btn;
    }
    return candidates[0] || null;
  };

  Targeting.findStopButton = () =>
    DOM.queryAllDeep("button").find((btn) => {
      if (!DOM.isVisible(btn)) return false;
      const text = (btn.textContent || "").toLowerCase();
      const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
      return text.includes("stop") || aria.includes("stop");
    }) || null;

  ns.Targeting = Targeting;
})(window.FlowAutomator);
