(function () {
  "use strict";

  if (window.__copynatorContentLoaded) {
    return;
  }
  window.__copynatorContentLoaded = true;

  const CURRENT_KEY = "copynator.currentMapping";
  const MAPS_KEY = "copynator.savedMappings";
  const OVERLAY_ID = "copynator-mode-label";
  const STYLE_ID = "copynator-style";

  let activeMode = null;
  let hoveredElement = null;

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
    return tagName === "input" || tagName === "textarea" || tagName === "select" || element.isContentEditable;
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

  function setNativeValue(element, value) {
    const tagName = element.localName;
    const prototype = tagName === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  function fillElement(element, value) {
    const tagName = element.localName;
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
      const normalized = String(value).trim().toLowerCase();
      const option = Array.from(element.options).find((candidate) => {
        return candidate.value.trim().toLowerCase() === normalized || candidate.textContent.trim().toLowerCase() === normalized;
      });
      if (option) {
        element.value = option.value;
      }
    } else if (element.isContentEditable) {
      element.textContent = String(value);
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
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
        right: 16px;
        max-width: min(420px, calc(100vw - 32px));
        padding: 12px 14px;
        border-radius: 8px;
        background: #0b6b5d;
        color: #ffffff;
        box-shadow: 0 14px 34px rgba(15, 23, 42, 0.25);
        font: 600 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
  }

  function handleMouseOver(event) {
    if (!activeMode) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element) || target.id === OVERLAY_ID) {
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
      alert("Copynator could not read a value from this element. Try another part of the page.");
      return;
    }

    const suggestedName = getLabelText(element) || "Source field";
    const name = prompt("Name this source field:", suggestedName);
    if (!name) {
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
      name: name.trim(),
      value,
      sourceSelector: getSelector(element),
      sourceLabel: suggestedName,
      sourceUrl: location.href,
      sourceKind: isFillable(element) ? "field" : "text",
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
    showOverlay(`Added source field "${name.trim()}". Click another source field, or press Esc when done.`);
  }

  async function mapTarget(element) {
    if (!isFillable(element)) {
      alert("Choose an input, textarea, select, checkbox, radio, or editable field.");
      return;
    }

    const data = await storageGet([CURRENT_KEY]);
    const current = data[CURRENT_KEY] || {};
    const fields = Object.values(current.fields || {});
    if (fields.length === 0) {
      alert("Capture source fields before mapping target fields.");
      stopMode("Capture source fields first.");
      return;
    }

    const choices = fields.map((field, index) => {
      const latestValue = String(field.value || "").slice(0, 60);
      return `${index + 1}. ${field.name}${latestValue ? ` (${latestValue})` : ""}`;
    }).join("\n");
    const answer = prompt(`Which source field should fill this target field?\n\n${choices}`, "1");
    const index = Number.parseInt(answer || "", 10) - 1;
    const field = fields[index];
    if (!field) {
      return;
    }

    const isSameTarget = !current.targetOrigin || current.targetOrigin === location.origin;
    const updatedFields = Object.fromEntries(Object.entries(current.fields || {}).map(([id, item]) => {
      if (isSameTarget) {
        return [id, item];
      }
      const { targetSelector, targetLabel, targetUrl, mappedAt, ...sourceOnly } = item;
      return [id, sourceOnly];
    }));
    updatedFields[field.id] = {
      ...field,
      targetSelector: getSelector(element),
      targetLabel: getLabelText(element),
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
  }

  async function handleClick(event) {
    if (!activeMode || !(event.target instanceof Element)) {
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

    for (const field of fields) {
      if (!field.targetSelector) {
        continue;
      }
      const element = document.querySelector(field.targetSelector);
      if (!element) {
        missing.push(field.name);
        continue;
      }
      fillElement(element, field.value);
      filled += 1;
    }

    return { filled, missing };
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
