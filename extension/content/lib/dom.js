/**
 * DOM utilities — visibility checks, timing, and Shadow DOM traversal.
 *
 * Architecture: all element discovery in this extension flows through
 * queryDeep / queryAllDeep so encapsulated Google Flow widgets remain reachable.
 */
(function initDomLib(ns) {
  const DOM = {};

  DOM.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  DOM.isVisible = (el) => {
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
  };

  /**
   * Walk every shadow root under `root`, invoking `visit` on each scope
   * (document, shadowRoot, nested shadowRoot, …).
   */
  DOM.walkShadowTree = (root, visit) => {
    if (!root) return;
    visit(root);

    const elements = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (const el of elements) {
      if (el.shadowRoot) {
        DOM.walkShadowTree(el.shadowRoot, visit);
      }
    }
  };

  /** querySelector that pierces open shadow roots. */
  DOM.queryDeep = (selector, root = document) => {
    let match = null;

    DOM.walkShadowTree(root, (scope) => {
      if (match) return;
      const found = scope.querySelector?.(selector);
      if (found) match = found;
    });

    return match;
  };

  /** querySelectorAll that pierces open shadow roots. */
  DOM.queryAllDeep = (selector, root = document) => {
    const results = [];

    DOM.walkShadowTree(root, (scope) => {
      scope.querySelectorAll?.(selector).forEach((el) => {
        if (!results.includes(el)) results.push(el);
      });
    });

    return results;
  };

  DOM.findByText = (text, tags = ["button", "span", "div", "a", "li"], root = document) => {
    const needle = text.toLowerCase();

    for (const tag of tags) {
      for (const el of DOM.queryAllDeep(tag, root)) {
        if (!DOM.isVisible(el)) continue;
        const content = (el.textContent || "").toLowerCase().trim();
        const aria = (el.getAttribute("aria-label") || "").toLowerCase();
        if (content === needle || content.includes(needle) || aria.includes(needle)) {
          return el;
        }
      }
    }

    return null;
  };

  ns.DOM = DOM;
})(window.FlowAutomator = window.FlowAutomator || {});
