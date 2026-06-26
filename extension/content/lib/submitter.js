/**
 * Submission engine — primary native .click(), keyboard Enter fallback.
 *
 * Architecture: always attempt the visual Send/Generate button first;
 * synthetic keyboard events are a last resort when click does not transition UI.
 */
(function initSubmitter(ns) {
  const { DOM, Targeting } = ns;
  const Submitter = {};

  Submitter.ENTER_EVENT = {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
  };

  Submitter.scrollIntoView = async (element) => {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    await DOM.sleep(200);
  };

  /** Primary path: native HTMLElement.click() on the submit control. */
  Submitter.clickNative = async (button) => {
    await Submitter.scrollIntoView(button);
    button.click();
    await DOM.sleep(500);
  };

  /** Fallback: fully populated Enter keydown on the prompt input. */
  Submitter.submitViaEnter = async (input) => {
    if (!input) return false;
    input.focus();
    await DOM.sleep(120);

    input.dispatchEvent(new KeyboardEvent("keydown", Submitter.ENTER_EVENT));
    input.dispatchEvent(
      new KeyboardEvent("keyup", {
        ...Submitter.ENTER_EVENT,
        bubbles: true,
        cancelable: true,
      })
    );
    await DOM.sleep(500);
    return true;
  };

  Submitter.findBestSubmitButton = () => {
    const scoped = Targeting.findSubmitButton();
    if (scoped && !scoped.disabled) return scoped;

    const global = DOM.queryAllDeep("button").find(
      (btn) =>
        DOM.isVisible(btn) &&
        !btn.disabled &&
        Targeting.buttonHasArrowForward(btn) &&
        !Targeting.shouldAvoidSubmitButton(btn)
    );

    return global || scoped;
  };

  /**
   * Submit the current prompt.
   * @param {HTMLElement} promptInput - element that holds the typed prompt
   * @param {() => boolean} hasSubmissionStarted - post-condition probe
   */
  Submitter.submit = async (promptInput, hasSubmissionStarted) => {
    const button = Submitter.findBestSubmitButton();

    if (button && !button.disabled) {
      await Submitter.clickNative(button);
      if (hasSubmissionStarted()) return { method: "click" };
    }

    await Submitter.submitViaEnter(promptInput);
    if (hasSubmissionStarted()) return { method: "enter" };

    const retryButton = Submitter.findBestSubmitButton();
    if (retryButton && !retryButton.disabled) {
      await Submitter.clickNative(retryButton);
      if (hasSubmissionStarted()) return { method: "click-retry" };
    }

    throw new Error("Submit did not start generation — Create/Generate button click had no effect");
  };

  ns.Submitter = Submitter;
})(window.FlowAutomator);
