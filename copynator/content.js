(function () {
  "use strict";

  if (window.__copynatorContentLoaded) {
    return;
  }
  window.__copynatorContentLoaded = true;

  const CURRENT_KEY = "copynator.currentMapping";
  const MAPS_KEY = "copynator.savedMappings";
  const OVERLAY_ID = "copynator-mode-label";
  const PANEL_ID = "copynator-side-panel";
  const STYLE_ID = "copynator-style";

  let activeMode = null;
  let hoveredElement = null;
  let panelRoot = null;
  let panelState = {
    message: "",
    level: "info"
  };

  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  function storageSet(data) {
    return new Promise((resolve) => chrome.storage.local.set(data, resolve));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function makeId() {
    if (crypto && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `field-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function isElementVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function getUniqueSelector(selector) {
    try {
      return document.querySelectorAll(selector).length === 1 ? selector : "";
    } catch (error) {
      return "";
    }
  }

  function getSelector(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const preferredAttributes = ["id", "name", "data-testid", "data-test", "data-cy", "aria-label", "placeholder", "title"];
    for (const attribute of preferredAttributes) {
      const value = element.getAttribute(attribute);
      if (value) {
        const selector = attribute === "id"
          ? `#${cssEscape(value)}`
          : `${element.localName}[${attribute}="${cssEscape(value)}"]`;
        const unique = getUniqueSelector(selector);
        if (unique) {
          return unique;
        }
      }
    }

    if (element.labels && element.labels.length > 0) {
      for (const label of element.labels) {
        const labelSelector = getSelector(label);
        if (labelSelector) {
          return `${labelSelector} input, ${labelSelector} textarea, ${labelSelector} select`;
        }
      }
    }

    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      let part = current.localName;
      if (current.classList.length > 0) {
        const stableClass = Array.from(current.classList).find((className) => !/\d{3,}|active|hover|focus|selected/i.test(className));
        if (stableClass) {
          part += `.${cssEscape(stableClass)}`;
        }
      }

      const siblings = Array.from(current.parentElement ? current.parentElement.children : []);
      const sameTagSiblings = siblings.filter((sibling) => sibling.localName === current.localName);
      if (sameTagSiblings.length > 1) {
        part += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
      }

      parts.unshift(part);
      const selector = parts.join(" > ");
      if (getUniqueSelector(selector)) {
        return selector;
      }
      current = current.parentElement;
    }

    return parts.length ? `body > ${parts.join(" > ")}` : "";
  }

  function getLabelText(element) {
    if (element.labels && element.labels.length > 0) {
      return Array.from(element.labels).map((label) => label.innerText.trim()).filter(Boolean).join(", ");
    }

    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) {
      return ariaLabel.trim();
    }

    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      return labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((label) => label.innerText.trim())
        .filter(Boolean)
        .join(", ");
    }

    return element.getAttribute("placeholder") || element.getAttribute("name") || element.getAttribute("id") || element.innerText.trim().slice(0, 80);
  }

  function isFillable(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    const tagName = element.localName;
    return tagName === "input" || tagName === "textarea" || tagName === "select" || element.isContentEditable || isCustomSelectTrigger(element);
  }

  function isCustomSelectTrigger(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    const role = (element.getAttribute("role") || "").toLowerCase();
    const ariaHasPopup = (element.getAttribute("aria-haspopup") || "").toLowerCase();
    const hasListboxPopup = ariaHasPopup === "listbox" || ariaHasPopup === "true";
    const hasSelectAria = element.hasAttribute("aria-expanded") || element.hasAttribute("aria-controls") || element.hasAttribute("aria-activedescendant");
    const tagName = element.localName;

    return role === "combobox"
      || (hasListboxPopup && (tagName === "button" || role === "button" || hasSelectAria))
      || (role === "button" && hasSelectAria && ariaHasPopup === "listbox");
  }

  function getTargetKind(element) {
    const tagName = element.localName;
    if (tagName === "select") {
      return "native-select";
    }
    if (isCustomSelectTrigger(element)) {
      return "custom-select";
    }
    if (tagName === "input") {
      const type = (element.getAttribute("type") || "text").toLowerCase();
      return type === "checkbox" || type === "radio" ? type : "input";
    }
    if (tagName === "textarea") {
      return "textarea";
    }
    if (element.isContentEditable) {
      return "editable";
    }
    return "field";
  }

  function getSourceValue(element) {
    const tagName = element.localName;
    if (tagName === "input") {
      const type = (element.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox" || type === "radio") {
        return element.checked ? (element.value || "true") : "false";
      }
      return element.value || element.getAttribute("value") || "";
    }
    if (tagName === "textarea") {
      return element.value || "";
    }
    if (tagName === "select") {
      const option = element.selectedOptions && element.selectedOptions[0];
      return option ? (option.textContent.trim() || option.value) : element.value;
    }
    if (tagName === "a") {
      const text = element.innerText.trim();
      return text || element.href;
    }
    return element.innerText.trim().replace(/\s+/g, " ");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function previewText(value, fallback) {
    const text = String(value || fallback || "").replace(/\s+/g, " ").trim();
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  }

  function setNativeValue(element, value) {
    const tagName = element.localName;
    const prototype = tagName === "textarea"
      ? HTMLTextAreaElement.prototype
      : tagName === "select"
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  function dispatchFillEvents(element) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function normalizeMatchText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function isDisabledOption(option) {
    return option.disabled || Boolean(option.parentElement && option.parentElement.matches("optgroup[disabled]"));
  }

  function findBestOption(options, value, getText, getValue, isDisabled) {
    const normalized = normalizeMatchText(value);
    if (!normalized) {
      return null;
    }

    const available = options.filter((option) => !isDisabled(option));
    const exact = available.find((option) => {
      const optionValue = normalizeMatchText(getValue(option));
      const optionText = normalizeMatchText(getText(option));
      return optionValue === normalized || optionText === normalized;
    });
    if (exact) {
      return exact;
    }

    return available.find((option) => {
      const optionValue = normalizeMatchText(getValue(option));
      const optionText = normalizeMatchText(getText(option));
      return (optionText && optionText.includes(normalized))
        || (optionValue && optionValue.includes(normalized))
        || (optionText && normalized.includes(optionText));
    }) || null;
  }

  function fillNativeSelect(element, value) {
    const options = Array.from(element.options || []);
    const option = findBestOption(
      options,
      value,
      (candidate) => candidate.textContent,
      (candidate) => candidate.value,
      isDisabledOption
    );

    if (!option) {
      return { filled: false, reason: `No enabled option matches "${String(value)}"` };
    }

    setNativeValue(element, option.value);
    option.selected = true;
    dispatchFillEvents(element);
    return { filled: true };
  }

  function waitForCustomOptions(trigger, timeoutMs) {
    const getCandidates = () => getCustomSelectOptions(trigger);
    const initial = getCandidates();
    if (initial.length > 0) {
      return Promise.resolve(initial);
    }

    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        observer.disconnect();
        resolve(getCandidates());
      }, timeoutMs);
      const observer = new MutationObserver(() => {
        const options = getCandidates();
        if (options.length > 0) {
          window.clearTimeout(timeout);
          observer.disconnect();
          resolve(options);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "style", "class", "aria-expanded"] });
    });
  }

  function getCustomSelectOptions(trigger) {
    const controlledIds = (trigger.getAttribute("aria-controls") || trigger.getAttribute("aria-owns") || "")
      .split(/\s+/)
      .map((id) => id.trim())
      .filter(Boolean);
    const containers = controlledIds
      .map((id) => document.getElementById(id))
      .filter(Boolean);

    const selectors = [
      '[role="option"]',
      '[role="listbox"] [role="option"]',
      '[aria-selected][role="option"]'
    ];

    const scopedOptions = containers.flatMap((container) => selectors.flatMap((selector) => Array.from(container.querySelectorAll(selector))));
    const documentOptions = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    const options = Array.from(new Set([...scopedOptions, ...documentOptions]));

    return options.filter((option) => {
      if (option === trigger || trigger.contains(option)) {
        return false;
      }
      return isElementVisible(option) && option.getAttribute("aria-disabled") !== "true";
    });
  }

  async function fillCustomSelect(element, value) {
    element.focus({ preventScroll: true });
    element.click();

    const options = await waitForCustomOptions(element, 700);
    const option = findBestOption(
      options,
      value,
      (candidate) => candidate.innerText || candidate.textContent,
      (candidate) => candidate.getAttribute("data-value") || candidate.getAttribute("value") || candidate.textContent,
      (candidate) => candidate.getAttribute("aria-disabled") === "true"
    );

    if (!option) {
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return { filled: false, reason: `No visible dropdown option matches "${String(value)}"` };
    }

    option.scrollIntoView({ block: "nearest" });
    option.click();
    dispatchFillEvents(element);
    return { filled: true };
  }

  async function fillElement(element, value, targetKind) {
    const tagName = element.localName;
    if (targetKind === "custom-select" || (tagName !== "select" && isCustomSelectTrigger(element))) {
      return fillCustomSelect(element, value);
    }
    if (tagName === "input") {
      const type = (element.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") {
        element.checked = ["true", "yes", "1", "on", element.value].includes(String(value).toLowerCase());
      } else if (type === "radio") {
        element.checked = String(element.value).toLowerCase() === String(value).toLowerCase();
      } else {
        setNativeValue(element, String(value));
      }
    } else if (tagName === "textarea") {
      setNativeValue(element, String(value));
    } else if (tagName === "select") {
      return fillNativeSelect(element, value);
    } else if (element.isContentEditable) {
      element.textContent = String(value);
    }

    dispatchFillEvents(element);
    return { filled: true };
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .copynator-hover {
        outline: 3px solid #0b6b5d !important;
        outline-offset: 2px !important;
        cursor: copy !important;
      }
      #${OVERLAY_ID} {
        position: fixed;
        z-index: 2147483647;
        top: 16px;
        left: 16px;
        max-width: min(360px, calc(100vw - 32px));
        padding: 12px 14px;
        border-radius: 8px;
        background: #0b6b5d;
        color: #ffffff;
        box-shadow: 0 14px 34px rgba(15, 23, 42, 0.25);
        font: 600 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${PANEL_ID} {
        position: fixed !important;
        z-index: 2147483647 !important;
        top: 16px !important;
        right: 16px !important;
        width: min(360px, calc(100vw - 32px)) !important;
        max-height: calc(100vh - 32px) !important;
        color-scheme: light !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function showOverlay(text) {
    ensureStyles();
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      document.documentElement.appendChild(overlay);
    }
    overlay.textContent = text;
  }

  function getModeTitle() {
    if (activeMode === "capture") {
      return "Capture source";
    }
    if (activeMode === "map") {
      return "Map target";
    }
    return "Copynator";
  }

  function getModeHelp() {
    if (activeMode === "capture") {
      return "Click a value on the page, then name it here.";
    }
    if (activeMode === "map") {
      return "Click a target field, then choose the source value for it.";
    }
    return "Local page helper stopped.";
  }

  function getPanelHost() {
    ensureStyles();
    let host = document.getElementById(PANEL_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = PANEL_ID;
      document.documentElement.appendChild(host);
      panelRoot = host.attachShadow({ mode: "open" });
    } else if (!panelRoot) {
      panelRoot = host.shadowRoot;
    }
    return host;
  }

  function isPanelEvent(event) {
    return event.composedPath().some((node) => node instanceof Element && node.id === PANEL_ID);
  }

  function setPanelMessage(message, level) {
    panelState = {
      message: message || "",
      level: level || "info"
    };
  }

  function panelShell(bodyHtml) {
    const levelClass = panelState.level === "error" ? "message error" : "message";
    const messageHtml = panelState.message ? `<p class="${levelClass}">${escapeHtml(panelState.message)}</p>` : "";
    return `
      <style>
        :host {
          all: initial;
          display: block;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: #1f2933;
        }
        * {
          box-sizing: border-box;
        }
        .panel {
          display: grid;
          gap: 12px;
          max-height: calc(100vh - 32px);
          overflow: auto;
          padding: 14px;
          border: 1px solid #d5ddd8;
          border-radius: 8px;
          background: #ffffff;
          box-shadow: 0 18px 46px rgba(15, 23, 42, 0.26);
        }
        .header {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
          align-items: start;
        }
        h2,
        p {
          margin: 0;
        }
        h2 {
          font-size: 15px;
          line-height: 1.2;
          letter-spacing: 0;
          color: #1f2933;
        }
        .help,
        .hint,
        .message {
          color: #667085;
          font-size: 12px;
          line-height: 1.4;
        }
        .message {
          padding: 9px 10px;
          border-radius: 8px;
          background: #e3f4ef;
          color: #084f45;
        }
        .message.error {
          background: #fbeae7;
          color: #a4382b;
        }
        .buttonRow {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          flex-wrap: wrap;
        }
        button {
          min-height: 34px;
          padding: 0 11px;
          border: 1px solid #d5ddd8;
          border-radius: 8px;
          background: #ffffff;
          color: #1f2933;
          cursor: pointer;
          font: 700 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        button.primary {
          border-color: #0b6b5d;
          background: #0b6b5d;
          color: #ffffff;
        }
        button:hover {
          border-color: #0b6b5d;
        }
        button:focus-visible,
        input:focus-visible {
          outline: 3px solid rgba(11, 107, 93, 0.22);
          outline-offset: 2px;
        }
        label {
          display: grid;
          gap: 6px;
          color: #1f2933;
          font-size: 12px;
          font-weight: 750;
        }
        input[type="text"] {
          width: 100%;
          min-height: 38px;
          padding: 8px 10px;
          border: 1px solid #d5ddd8;
          border-radius: 8px;
          color: #1f2933;
          font: 13px/1.3 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .preview,
        .choice {
          padding: 10px;
          border: 1px solid #d5ddd8;
          border-radius: 8px;
          background: #fbfcfb;
        }
        .preview strong,
        .choice strong {
          display: block;
          margin-bottom: 4px;
          color: #1f2933;
          font-size: 12px;
          line-height: 1.3;
        }
        .preview span,
        .choice span {
          display: block;
          overflow-wrap: anywhere;
          color: #667085;
          font-size: 12px;
          line-height: 1.35;
        }
        .choice {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 9px;
          align-items: start;
          cursor: pointer;
          font-weight: 400;
        }
        .choice input {
          margin-top: 2px;
        }
        .choices {
          display: grid;
          gap: 8px;
          max-height: 260px;
          overflow: auto;
        }
      </style>
      <section class="panel" role="dialog" aria-label="Copynator ${escapeHtml(getModeTitle())}">
        <div class="header">
          <div>
            <h2>${escapeHtml(getModeTitle())}</h2>
            <p class="help">${escapeHtml(getModeHelp())}</p>
          </div>
          <button type="button" data-action="stop" title="Stop Copynator">Stop</button>
        </div>
        ${messageHtml}
        ${bodyHtml}
      </section>
    `;
  }

  function renderModePanel(message, level) {
    if (message !== undefined) {
      setPanelMessage(message, level);
    }
    const host = getPanelHost();
    if (!panelRoot) {
      return;
    }
    panelRoot.innerHTML = panelShell(`
      <p class="hint">Hovering outlines the page element Copynator will use. Press Esc or Stop when finished.</p>
    `);
    panelRoot.querySelector("[data-action='stop']").addEventListener("click", () => stopMode("Copynator stopped."));
    host.hidden = false;
  }

  function removePanel(delay) {
    const host = document.getElementById(PANEL_ID);
    if (!host) {
      return;
    }
    if (delay) {
      setTimeout(() => host.remove(), delay);
      return;
    }
    host.remove();
    panelRoot = null;
  }

  function clearHover() {
    if (hoveredElement) {
      hoveredElement.classList.remove("copynator-hover");
      hoveredElement = null;
    }
  }

  function stopMode(message) {
    activeMode = null;
    clearHover();
    document.removeEventListener("mouseover", handleMouseOver, true);
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("keydown", handleKeyDown, true);
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) {
      overlay.textContent = message || "Copynator stopped.";
      setTimeout(() => overlay.remove(), 1400);
    }
    if (message) {
      renderModePanel(message);
      removePanel(1400);
    } else {
      removePanel();
    }
  }

  function handleMouseOver(event) {
    if (!activeMode) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element) || target.id === OVERLAY_ID || isPanelEvent(event)) {
      return;
    }
    clearHover();
    hoveredElement = target;
    hoveredElement.classList.add("copynator-hover");
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      stopMode("Copynator canceled.");
    }
  }

  async function captureSource(element) {
    const value = getSourceValue(element);
    if (!value && !isFillable(element)) {
      renderModePanel("Copynator could not read a value from this element. Try another part of the page.", "error");
      return;
    }

    const suggestedName = getLabelText(element) || "Source field";
    const selector = getSelector(element);
    const sourceKind = isFillable(element) ? "field" : "text";
    const host = getPanelHost();
    setPanelMessage("Review the captured value and choose a local name for it.");
    panelRoot.innerHTML = panelShell(`
      <form data-form="capture">
        <label>
          Source field name
          <input type="text" name="fieldName" value="${escapeHtml(suggestedName)}" autocomplete="off">
        </label>
        <div class="preview">
          <strong>Captured value</strong>
          <span>${escapeHtml(previewText(value, "Empty value"))}</span>
        </div>
        <div class="buttonRow">
          <button type="button" data-action="cancel-selection">Cancel</button>
          <button class="primary" type="submit">Add source</button>
        </div>
      </form>
    `);
    host.hidden = false;

    const nameInput = panelRoot.querySelector("input[name='fieldName']");
    const form = panelRoot.querySelector("form[data-form='capture']");
    panelRoot.querySelector("[data-action='stop']").addEventListener("click", () => stopMode("Copynator stopped."));
    panelRoot.querySelector("[data-action='cancel-selection']").addEventListener("click", () => {
      renderModePanel("Selection canceled. Click another source value.");
    });
    nameInput.focus();
    nameInput.select();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) {
        setPanelMessage("Add a name before saving this source field.", "error");
        captureSource(element);
        return;
      }

      const data = await storageGet([CURRENT_KEY]);
      const current = data[CURRENT_KEY] || {};
      const isSameSource = !current.sourceOrigin || current.sourceOrigin === location.origin;
      const baseCurrent = isSameSource ? current : {};
      const fields = baseCurrent.fields || {};
      const id = makeId();

      fields[id] = {
        id,
        name,
        value,
        sourceSelector: selector,
        sourceLabel: suggestedName,
        sourceUrl: location.href,
        sourceKind,
        capturedAt: nowIso()
      };

      await storageSet({
        [CURRENT_KEY]: {
          ...baseCurrent,
          sourceOrigin: location.origin,
          sourceTitle: document.title,
          fields,
          updatedAt: nowIso()
        }
      });
      showOverlay(`Added source field "${name}". Click another source field, or press Esc when done.`);
      renderModePanel(`Added source field "${name}". Click another source value.`);
    });
  }

  async function mapTarget(element) {
    if (!isFillable(element)) {
      renderModePanel("Choose an input, textarea, select, dropdown, checkbox, radio, or editable field.", "error");
      return;
    }

    const data = await storageGet([CURRENT_KEY]);
    const current = data[CURRENT_KEY] || {};
    const fields = Object.values(current.fields || {});
    if (fields.length === 0) {
      renderModePanel("Capture source fields before mapping target fields.", "error");
      stopMode("Capture source fields first.");
      return;
    }

    const targetSelector = getSelector(element);
    const targetLabel = getLabelText(element) || "Selected target field";
    const targetKind = getTargetKind(element);
    setPanelMessage("Choose which captured source value should fill this target.");
    const choices = fields.map((field, index) => `
      <label class="choice">
        <input type="radio" name="sourceField" value="${escapeHtml(field.id)}" ${index === 0 ? "checked" : ""}>
        <span>
          <strong>${escapeHtml(field.name)}</strong>
          <span>${escapeHtml(previewText(field.value, "Empty value"))}</span>
        </span>
      </label>
    `).join("");

    const host = getPanelHost();
    panelRoot.innerHTML = panelShell(`
      <form data-form="map">
        <div class="preview">
          <strong>Target field</strong>
          <span>${escapeHtml(previewText(targetLabel, "Selected target field"))}</span>
        </div>
        <div class="choices">${choices}</div>
        <div class="buttonRow">
          <button type="button" data-action="cancel-selection">Cancel</button>
          <button class="primary" type="submit">Map target</button>
        </div>
      </form>
    `);
    host.hidden = false;

    const form = panelRoot.querySelector("form[data-form='map']");
    panelRoot.querySelector("[data-action='stop']").addEventListener("click", () => stopMode("Copynator stopped."));
    panelRoot.querySelector("[data-action='cancel-selection']").addEventListener("click", () => {
      renderModePanel("Selection canceled. Click another target field.");
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const selected = form.querySelector("input[name='sourceField']:checked");
      const field = fields.find((item) => item.id === (selected && selected.value));
      if (!field) {
        renderModePanel("Choose a source value before mapping this target.", "error");
        return;
      }

      const isSameTarget = !current.targetOrigin || current.targetOrigin === location.origin;
      const updatedFields = Object.fromEntries(Object.entries(current.fields || {}).map(([id, item]) => {
        if (isSameTarget) {
          return [id, item];
        }
        const { targetSelector: oldTargetSelector, targetLabel: oldTargetLabel, targetKind: oldTargetKind, targetUrl, mappedAt, ...sourceOnly } = item;
        return [id, sourceOnly];
      }));
      updatedFields[field.id] = {
        ...field,
        targetSelector,
        targetLabel,
        targetKind,
        targetUrl: location.href,
        mappedAt: nowIso()
      };

      await storageSet({
        [CURRENT_KEY]: {
          ...current,
          targetOrigin: location.origin,
          targetTitle: document.title,
          fields: updatedFields,
          updatedAt: nowIso()
        }
      });
      showOverlay(`Mapped source field "${field.name}". Click another target field, or press Esc when done.`);
      renderModePanel(`Mapped source field "${field.name}". Click another target field.`);
    });
  }

  async function handleClick(event) {
    if (!activeMode || !(event.target instanceof Element) || isPanelEvent(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (activeMode === "capture") {
      await captureSource(event.target);
    } else if (activeMode === "map") {
      await mapTarget(event.target);
    }
  }

  function startMode(mode) {
    stopMode("");
    activeMode = mode;
    document.addEventListener("mouseover", handleMouseOver, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown, true);
    showOverlay(mode === "capture"
      ? "Copynator capture mode: click source fields. Press Esc when done."
      : "Copynator map mode: click target fields for source fields. Press Esc when done.");
    renderModePanel(mode === "capture"
      ? "Click a source value on the page to capture it."
      : "Click a target field on the page to map it.");
  }

  async function recaptureSourceFields() {
    const data = await storageGet([CURRENT_KEY, MAPS_KEY]);
    const current = data[CURRENT_KEY] || {};
    if (current.sourceOrigin !== location.origin) {
      return { updated: 0, missing: Object.values(current.fields || {}).map((field) => field.name), mapping: current };
    }

    const fields = current.fields || {};
    const updatedFields = {};
    let updated = 0;
    const missing = [];

    for (const [id, field] of Object.entries(fields)) {
      if (!field.sourceSelector) {
        updatedFields[id] = field;
        missing.push(field.name);
        continue;
      }

      const element = document.querySelector(field.sourceSelector);
      if (!element) {
        updatedFields[id] = field;
        missing.push(field.name);
        continue;
      }

      updatedFields[id] = {
        ...field,
        value: getSourceValue(element),
        sourceUrl: location.href,
        recapturedAt: nowIso()
      };
      updated += 1;
    }

    const updatedCurrent = {
      ...current,
      sourceTitle: document.title,
      fields: updatedFields,
      updatedAt: nowIso()
    };

    const maps = data[MAPS_KEY] || {};
    const key = updatedCurrent.sourceOrigin && updatedCurrent.targetOrigin
      ? `${updatedCurrent.sourceOrigin} -> ${updatedCurrent.targetOrigin}`
      : "";
    const nextMaps = key && maps[key]
      ? { ...maps, [key]: { ...updatedCurrent, savedAt: maps[key].savedAt || nowIso() } }
      : maps;

    await storageSet({
      [CURRENT_KEY]: updatedCurrent,
      [MAPS_KEY]: nextMaps
    });

    return { updated, missing, mapping: updatedCurrent };
  }

  async function fillFromMapping(mapping) {
    const fields = Object.values((mapping && mapping.fields) || {});
    let filled = 0;
    const missing = [];
    const unmatched = [];

    for (const field of fields) {
      if (!field.targetSelector) {
        continue;
      }
      const element = document.querySelector(field.targetSelector);
      if (!element) {
        missing.push(field.name);
        continue;
      }
      const result = await fillElement(element, field.value, field.targetKind);
      if (result && result.filled) {
        filled += 1;
      } else {
        unmatched.push(`${field.name}: ${(result && result.reason) || "Could not fill this field"}`);
      }
    }

    return { filled, missing, unmatched };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type || !message.type.startsWith("COP_")) {
      return false;
    }

    if (message.type === "COP_START_CAPTURE") {
      startMode("capture");
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "COP_START_MAP") {
      startMode("map");
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "COP_FILL") {
      fillFromMapping(message.mapping).then((result) => sendResponse({ ok: true, ...result }));
      return true;
    }

    if (message.type === "COP_RECAPTURE") {
      recaptureSourceFields().then((result) => sendResponse({ ok: true, ...result }));
      return true;
    }

    if (message.type === "COP_STOP") {
      stopMode("Copynator stopped.");
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });
})();
