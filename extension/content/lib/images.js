/**
 * Image discovery and download helpers for completed generations.
 */
(function initImages(ns) {
  const { DOM } = ns;
  const Images = {};

  const IMAGE_SELECTORS = [
    'img[src*="googleusercontent"]',
    'img[src*="blob:"]',
    'img[src^="https://"]',
  ];

  Images.collect = () => {
    const urls = new Set();

    for (const selector of IMAGE_SELECTORS) {
      for (const img of DOM.queryAllDeep(selector)) {
        if (!DOM.isVisible(img)) continue;
        const src = img.currentSrc || img.src;
        if (!src || src.length < 20) continue;
        if (src.includes("data:image/svg") || src.includes("favicon")) continue;
        const rect = img.getBoundingClientRect();
        if (rect.width < 80 || rect.height < 80) continue;
        urls.add(src);
      }
    }

    return Array.from(urls);
  };

  Images.resolveForDownload = async (url) => {
    if (!url.startsWith("blob:")) {
      return { url, mimeType: "image/png" };
    }

    const response = await fetch(url);
    const blob = await response.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Failed to read generated image blob"));
      reader.readAsDataURL(blob);
    });

    return { url: dataUrl, mimeType: blob.type || "image/png" };
  };

  Images.clickDownloadButtons = async () => {
    let count = 0;
    const buttons = DOM.queryAllDeep(
      'button[aria-label*="download" i], button[aria-label*="save" i], a[download]'
    );

    for (const btn of buttons) {
      if (!DOM.isVisible(btn) || btn.disabled) continue;
      btn.click();
      count += 1;
      await DOM.sleep(800);
    }

    return count;
  };

  Images.downloadViaMenu = async () => {
    let count = 0;
    const menuButtons = DOM.queryAllDeep(
      'button[aria-label*="more" i], button[aria-label*="menu" i]'
    );

    for (const menuBtn of menuButtons) {
      const container = menuBtn.closest('[class*="clip" i], [class*="card" i], [class*="image" i]');
      if (!container || !container.querySelector("img")) continue;

      menuBtn.click();
      await DOM.sleep(400);

      const downloadOption = DOM.findByText("download", ["button", "div", "span", "li", "a"]);
      if (downloadOption) {
        downloadOption.click();
        count += 1;
        await DOM.sleep(800);
      } else {
        document.body.click();
        await DOM.sleep(200);
      }
    }

    return count;
  };

  ns.Images = Images;
})(window.FlowAutomator);
