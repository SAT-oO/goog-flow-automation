/**
 * Prompt queue lifecycle state machine.
 *
 * State flow per queue item:
 *   IDLE → WAIT_UI_IDLE → ENSURE_AGENT_OFF → INSERT_PROMPT →
 *   WAIT_SUBMIT_ENABLED → SUBMIT → WAIT_GENERATION → COLLECT → IDLE
 *
 * Concurrency: only one prompt runs at a time; the next item cannot begin
 * until waitForUiIdle() confirms the previous cycle fully concluded.
 */
(function initLifecycle(ns) {
  const { DOM, Targeting, InputSync, Submitter, UiIdle, Agent, Images } = ns;

  const State = Object.freeze({
    IDLE: "idle",
    WAIT_UI_IDLE: "wait_ui_idle",
    ENSURE_AGENT_OFF: "ensure_agent_off",
    INSERT_PROMPT: "insert_prompt",
    WAIT_SUBMIT_ENABLED: "wait_submit_enabled",
    SUBMIT: "submit",
    WAIT_GENERATION: "wait_generation",
    COLLECT: "collect",
    DONE: "done",
    ERROR: "error",
  });

  const GENERATION_TIMEOUT_MS = 180000;
  const POLL_INTERVAL_MS = 1500;

  class PromptLifecycle {
    constructor() {
      this.state = State.IDLE;
      this.abortRequested = false;
    }

    getState() {
      return this.state;
    }

    requestAbort() {
      this.abortRequested = true;
    }

    assertNotAborted() {
      if (this.abortRequested) {
        throw new Error("Stopped by user");
      }
    }

    transition(next) {
      this.state = next;
    }

    hasSubmissionStarted() {
      return UiIdle.isGenerationActive();
    }

    async waitForGenerationComplete(baselineImages) {
      const started = Date.now();
      let sawGenerating = false;

      while (Date.now() - started < GENERATION_TIMEOUT_MS) {
        this.assertNotAborted();

        if (UiIdle.isGenerationActive()) {
          sawGenerating = true;
        }

        const current = Images.collect();
        const fresh = current.filter((url) => !baselineImages.includes(url));

        if (sawGenerating && fresh.length > 0 && !UiIdle.isGenerationActive()) {
          await DOM.sleep(1200);
          return Images.collect().filter((url) => !baselineImages.includes(url));
        }

        if (!sawGenerating && fresh.length > 0 && Date.now() - started > 8000) {
          await DOM.sleep(1200);
          return Images.collect().filter((url) => !baselineImages.includes(url));
        }

        await DOM.sleep(POLL_INTERVAL_MS);
      }

      throw new Error("Timed out waiting for image generation to finish");
    }

    /**
     * Execute a single prompt through the full lifecycle.
     * @param {string} prompt
     * @returns {Promise<{ images: Array<{url: string, mimeType: string}>, submitMethod: string }>}
     */
    async runSinglePrompt(prompt) {
      if (!Targeting.isOnFlowPage()) {
        throw new Error("Open Google Flow (labs.google/fx/tools/flow) in this tab first");
      }

      this.abortRequested = false;

      // ── 1. Wait for previous generation cycle to fully conclude ──
      this.transition(State.WAIT_UI_IDLE);
      await UiIdle.waitForCycleIdle();
      this.assertNotAborted();

      // ── 2. Disable Agent mode ──
      this.transition(State.ENSURE_AGENT_OFF);
      await Agent.ensureOff();
      this.assertNotAborted();

      const baselineImages = Images.collect();

      // ── 3. Insert prompt with reactive state sync ──
      this.transition(State.INSERT_PROMPT);
      const promptInput = await InputSync.insertPrompt(prompt);
      this.assertNotAborted();

      // ── 4. Wait until Generate button is enabled ──
      this.transition(State.WAIT_SUBMIT_ENABLED);
      await UiIdle.waitForSubmitEnabled();
      this.assertNotAborted();

      await Agent.ensureOff();

      // ── 5. Submit (native click → Enter fallback) ──
      this.transition(State.SUBMIT);
      const { method } = await Submitter.submit(promptInput, () => this.hasSubmissionStarted());
      this.assertNotAborted();

      // ── 6. Wait for generation to finish ──
      this.transition(State.WAIT_GENERATION);
      const imageUrls = await this.waitForGenerationComplete(baselineImages);
      if (!imageUrls.length) {
        throw new Error("Generation finished but no new image was detected");
      }

      // ── 7. Collect downloadable assets ──
      this.transition(State.COLLECT);
      const images = [];
      for (const url of imageUrls) {
        images.push(await Images.resolveForDownload(url));
      }

      // ── 8. Confirm UI settled before the next queue item ──
      this.transition(State.DONE);
      await UiIdle.waitForCycleIdle();

      this.transition(State.IDLE);
      return { images, submitMethod: method };
    }
  }

  ns.Lifecycle = { State, PromptLifecycle };
})(window.FlowAutomator);
