/**
 * Agent mode guard — Google Flow Agent UI blocks classic composer automation.
 */
(function initAgent(ns) {
  const { DOM } = ns;
  const Agent = {};

  Agent.findToggle = () =>
    DOM.queryAllDeep("button").find((btn) => {
      if (!DOM.isVisible(btn)) return false;
      const text = (btn.textContent || "").trim().toLowerCase();
      const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
      return text === "agent" || aria === "agent" || aria.includes("agent mode");
    }) || null;

  Agent.isOn = () => {
    for (const btn of DOM.queryAllDeep("button")) {
      const text = (btn.textContent || "").trim().toLowerCase();
      const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
      if (text !== "agent" && aria !== "agent" && !aria.includes("agent mode")) continue;
      if (!DOM.isVisible(btn)) continue;

      const pressed = btn.getAttribute("aria-pressed");
      const state = btn.getAttribute("data-state");
      const selected = btn.getAttribute("aria-selected");
      if (pressed === "true" || state === "on" || selected === "true") return true;

      const className = (btn.className || "").toLowerCase();
      if (className.includes("active") || className.includes("selected")) return true;
    }

    const panel = DOM.queryDeep('[class*="agent" i][class*="panel" i], [data-testid*="agent" i]');
    if (panel && DOM.isVisible(panel)) return true;

    const composer = DOM.queryDeep(
      '[contenteditable="true"], textarea#PINHOLE_TEXT_AREA_ELEMENT_ID, [data-slate-editor="true"]'
    );
    if (composer) {
      const placeholder = (composer.getAttribute("placeholder") || "").toLowerCase();
      if (placeholder.includes("agent") || placeholder.includes("chat")) return true;
    }

    return false;
  };

  Agent.ensureOff = async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (!Agent.isOn()) return { agentModeOn: false };

      const toggle = Agent.findToggle();
      if (!toggle) {
        throw new Error("Agent mode is on but the Agent toggle could not be found");
      }

      toggle.click();
      await DOM.sleep(700);
    }

    if (Agent.isOn()) {
      throw new Error("Could not turn Agent mode off — disable it manually in Google Flow");
    }

    return { agentModeOn: false };
  };

  ns.Agent = Agent;
})(window.FlowAutomator);
