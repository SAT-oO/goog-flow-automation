/**
 * UI idle watcher — MutationObserver + polling hybrid.
 *
 * Prevents race conditions by blocking the next queue item until:
 *   • no active spinners / progress indicators
 *   • no Stop button (generation in flight)
 *   • Generate/Create button is enabled and ready
 */
(function initUiIdle(ns) {
  const { DOM, Targeting } = ns;
  const UiIdle = {};

  const SPINNER_SELECTORS = [
    '[role="progressbar"]',
    '[aria-busy="true"]',
    '[class*="loading" i]',
    '[class*="spinner" i]',
    '[class*="generating" i]',
  ];

  UiIdle.hasActiveSpinner = () => {
    for (const selector of SPINNER_SELECTORS) {
      const el = DOM.queryDeep(selector);
      if (el && DOM.isVisible(el)) return true;
    }

    const generatingText = DOM.findByText("generating", ["span", "div", "p"]);
    return Boolean(generatingText);
  };

  UiIdle.isGenerationActive = () => Boolean(Targeting.findStopButton()) || UiIdle.hasActiveSpinner();

  UiIdle.isSubmitReady = () => {
    const btn = Targeting.findSubmitButton();
    return Boolean(btn && !btn.disabled);
  };

  /** Between queue items: no generation in flight, no spinners. */
  UiIdle.isCycleIdle = () => !UiIdle.isGenerationActive() && !UiIdle.hasActiveSpinner();

  /** Fully ready to accept the next prompt (cycle idle + submit enabled). */
  UiIdle.isUiIdle = () => UiIdle.isCycleIdle() && UiIdle.isSubmitReady();

  /**
   * Wait until the composer is ready for the next prompt.
   * Between items we only require the previous generation cycle to have ended.
   */
  UiIdle.waitForCycleIdle = (timeoutMs = 180000) =>
    UiIdle._waitForCondition(() => UiIdle.isCycleIdle(), timeoutMs);

  /** Wait until submit is enabled after text has been inserted. */
  UiIdle.waitForSubmitEnabled = (timeoutMs = 12000) =>
    UiIdle._waitForCondition(() => UiIdle.isSubmitReady(), timeoutMs, "Generate button stayed disabled after prompt insertion");

  UiIdle.waitForUiIdle = (timeoutMs = 180000) =>
    UiIdle._waitForCondition(() => UiIdle.isUiIdle(), timeoutMs);

  UiIdle._waitForCondition = (predicate, timeoutMs, errorMessage) =>
    new Promise((resolve, reject) => {
      if (predicate()) {
        resolve();
        return;
      }

      const started = Date.now();
      let settled = false;

      const evaluate = () => {
        if (settled) return;

        if (predicate()) {
          settled = true;
          cleanup();
          resolve();
          return;
        }

        if (Date.now() - started > timeoutMs) {
          settled = true;
          cleanup();
          reject(
            new Error(errorMessage || "Timed out waiting for Google Flow UI to become idle")
          );
        }
      };

      const observer = new MutationObserver(evaluate);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["disabled", "aria-busy", "aria-disabled", "class", "data-state"],
      });

      const pollId = setInterval(evaluate, 250);
      evaluate();

      function cleanup() {
        observer.disconnect();
        clearInterval(pollId);
      }
    });

  ns.UiIdle = UiIdle;
})(window.FlowAutomator);
