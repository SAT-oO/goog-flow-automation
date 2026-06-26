/**
 * State synchronization — writes prompt text and notifies reactive frameworks.
 *
 * Flow: focus → clear → write value → dispatch bubbling `input` (required for
 * React/Angular/Wiz) → optional Slate editor API for Google Flow's composer.
 */
(function initInputSync(ns) {
  const { DOM, Targeting } = ns;
  const InputSync = {};

  InputSync.getSlateEditor = () => {
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

  /** Dispatch the canonical bubbling input event after any programmatic write. */
  InputSync.dispatchInputSync = (element, text) => {
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text,
      })
    );
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };

  InputSync.setNativeValue = (element, value) => {
    const proto =
      element.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : element.tagName === "INPUT"
          ? window.HTMLInputElement.prototype
          : null;

    const setter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : null;
    if (setter) {
      setter.call(element, value);
    } else {
      element.value = value;
    }
  };

  InputSync.clearElement = async (element) => {
    element.focus();
    await DOM.sleep(80);

    if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") {
      element.select();
      InputSync.setNativeValue(element, "");
      InputSync.dispatchInputSync(element, "");
      return;
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("delete", false, null);
    InputSync.dispatchInputSync(element, "");
  };

  InputSync.writeToSlate = async (text) => {
    const slate = InputSync.getSlateEditor();
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
      InputSync.dispatchInputSync(element, text);
      await DOM.sleep(300);
      return true;
    } catch (error) {
      console.warn("[FlowAutomator] Slate write failed:", error);
      return false;
    }
  };

  InputSync.writeToElement = async (element, text) => {
    element.focus();
    await DOM.sleep(80);
    await InputSync.clearElement(element);

    const pasted = document.execCommand("insertText", false, text);
    if (!pasted) {
      if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") {
        InputSync.setNativeValue(element, text);
      } else {
        element.textContent = text;
      }
      InputSync.dispatchInputSync(element, text);
    }

    await DOM.sleep(200);
  };

  /**
   * Insert prompt text using the best available strategy and return the
   * element that received the input (needed for keyboard-submit fallback).
   */
  InputSync.insertPrompt = async (text) => {
    if (await InputSync.writeToSlate(text)) {
      return InputSync.getSlateEditor()?.element || DOM.queryDeep('[data-slate-editor="true"]');
    }

    const input = Targeting.getPromptInput();
    if (!input) {
      throw new Error("Could not find the Google Flow prompt input");
    }

    await InputSync.writeToElement(input, text);
    return input;
  };

  ns.InputSync = InputSync;
})(window.FlowAutomator);
