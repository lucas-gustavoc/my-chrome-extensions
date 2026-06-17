(function () {
  "use strict";

  const CURRENT_KEY = "copynator.currentMapping";
  const MAPS_KEY = "copynator.savedMappings";

  const state = {
    tab: null,
    origin: "",
    current: null,
    maps: {}
  };

  const tabOrigin = document.getElementById("tabOrigin");
  const sourceOrigin = document.getElementById("sourceOrigin");
  const targetOrigin = document.getElementById("targetOrigin");
  const fieldList = document.getElementById("fieldList");
  const savedList = document.getElementById("savedList");
  const status = document.getElementById("status");
  const captureButton = document.getElementById("captureButton");
  const mapButton = document.getElementById("mapButton");
  const recaptureButton = document.getElementById("recaptureButton");
  const fillButton = document.getElementById("fillButton");
  const saveButton = document.getElementById("saveButton");
  const clearButton = document.getElementById("clearButton");
  const refreshButton = document.getElementById("refreshButton");

  function setStatus(message, isError) {
    status.textContent = message || "";
    status.classList.toggle("error", Boolean(isError));
  }

  function formatOrigin(origin) {
    return origin || "None";
  }

  function isSupportedUrl(url) {
    return /^https?:\/\//i.test(url || "");
  }

  function getOrigin(url) {
    try {
      return new URL(url).origin;
    } catch (error) {
      return "";
    }
  }

  function mappingKey(mapping) {
    return `${mapping.sourceOrigin} -> ${mapping.targetOrigin}`;
  }

  function getMappedFields(mapping) {
    return Object.values((mapping && mapping.fields) || {}).filter((field) => field.targetSelector);
  }

  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  function storageSet(data) {
    return new Promise((resolve) => chrome.storage.local.set(data, resolve));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function loadState() {
    state.tab = await getActiveTab();
    state.origin = getOrigin(state.tab && state.tab.url);
    const data = await storageGet([CURRENT_KEY, MAPS_KEY]);
    state.current = data[CURRENT_KEY] || null;
    state.maps = data[MAPS_KEY] || {};
    render();
  }

  function renderFields() {
    const fields = Object.values((state.current && state.current.fields) || {});
    if (fields.length === 0) {
      fieldList.innerHTML = '<div class="empty">No source fields yet.</div>';
      return;
    }

    fieldList.innerHTML = fields.map((field) => {
      const mapped = field.targetSelector ? '<span class="badge">Mapped</span>' : '<span class="badge">Source</span>';
      const targetLabel = field.targetLabel ? `<div class="hint">Target: ${escapeHtml(field.targetLabel)}</div>` : "";
      return `
        <article class="fieldItem" data-field-id="${escapeHtml(field.id)}">
          <div class="fieldTop">
            <div class="fieldName" title="${escapeHtml(field.name)}">${escapeHtml(field.name)}</div>
            ${mapped}
          </div>
          <div class="fieldValue">Latest: ${escapeHtml(field.value || "")}</div>
          ${targetLabel}
          <div class="fieldActions">
            <button class="miniButton danger" type="button" data-action="delete-field" data-field-id="${escapeHtml(field.id)}">Delete field</button>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderSaved() {
    const maps = Object.entries(state.maps);
    if (maps.length === 0) {
      savedList.innerHTML = '<div class="empty">No saved site pairs yet.</div>';
      return;
    }

    savedList.innerHTML = maps.map(([key, mapping]) => {
      const count = getMappedFields(mapping).length;
      return `
        <article class="savedItem">
          <div class="savedName" title="${escapeHtml(mappingKey(mapping))}">${escapeHtml(mappingKey(mapping))}</div>
          <div class="hint">${count} mapped field${count === 1 ? "" : "s"}</div>
          <div class="savedActions">
            <button class="miniButton" type="button" data-action="load" data-key="${escapeHtml(key)}">Load</button>
            <button class="miniButton danger" type="button" data-action="delete" data-key="${escapeHtml(key)}">Delete</button>
          </div>
        </article>
      `;
    }).join("");
  }

  function render() {
    const supported = state.tab && isSupportedUrl(state.tab.url);
    tabOrigin.textContent = supported ? state.origin : "Open an http or https page";
    sourceOrigin.textContent = formatOrigin(state.current && state.current.sourceOrigin);
    targetOrigin.textContent = formatOrigin(state.current && state.current.targetOrigin);

    const hasFields = Object.values((state.current && state.current.fields) || {}).length > 0;
    const hasMappedFields = getMappedFields(state.current).length > 0;
    const isOnSource = Boolean(state.current && state.current.sourceOrigin && state.current.sourceOrigin === state.origin);
    const isOnMappedTarget = Boolean(state.current && state.current.targetOrigin && state.current.targetOrigin === state.origin);

    captureButton.disabled = !supported;
    mapButton.disabled = !supported || !hasFields;
    recaptureButton.disabled = !supported || !hasFields || !isOnSource;
    fillButton.disabled = !supported || !hasMappedFields || !isOnMappedTarget;
    saveButton.disabled = !hasMappedFields || !state.current.sourceOrigin || !state.current.targetOrigin;
    clearButton.disabled = !state.current;

    renderFields();
    renderSaved();
  }

  async function injectContentScript() {
    if (!state.tab || !isSupportedUrl(state.tab.url)) {
      throw new Error("Open an http or https page first.");
    }

    await chrome.scripting.executeScript({
      target: { tabId: state.tab.id },
      files: ["content.js"]
    });
  }

  async function sendToTab(message) {
    await injectContentScript();
    return chrome.tabs.sendMessage(state.tab.id, message);
  }

  async function startCapture() {
    try {
      await sendToTab({ type: "COP_START_CAPTURE" });
      setStatus("Capture mode is active on the page. Click source fields to save them.");
      window.close();
    } catch (error) {
      setStatus(error.message || "Could not start capture mode.", true);
    }
  }

  async function startMap() {
    try {
      await sendToTab({ type: "COP_START_MAP" });
      setStatus("Map mode is active on the page. Click target fields for each source field.");
      window.close();
    } catch (error) {
      setStatus(error.message || "Could not start map mode.", true);
    }
  }

  async function fillPage() {
    try {
      const result = await sendToTab({ type: "COP_FILL", mapping: state.current });
      const missing = result.missing && result.missing.length ? ` Missing: ${result.missing.join(", ")}.` : "";
      const unmatched = result.unmatched && result.unmatched.length ? ` Unmatched: ${result.unmatched.join("; ")}.` : "";
      setStatus(`Filled ${result.filled} field${result.filled === 1 ? "" : "s"}.${missing}${unmatched}`, result.filled === 0 || Boolean(unmatched));
    } catch (error) {
      setStatus(error.message || "Could not fill this page.", true);
    }
  }

  async function recapturePage() {
    try {
      const result = await sendToTab({ type: "COP_RECAPTURE" });
      const missing = result.missing && result.missing.length ? ` Missing: ${result.missing.join(", ")}.` : "";
      setStatus(`Recaptured ${result.updated} source field${result.updated === 1 ? "" : "s"}.${missing}`, result.updated === 0);
      await loadState();
    } catch (error) {
      setStatus(error.message || "Could not recapture this source page.", true);
    }
  }

  async function saveMapping() {
    if (!state.current || !state.current.sourceOrigin || !state.current.targetOrigin) {
      setStatus("Capture source fields and map a target before saving.", true);
      return;
    }

    const key = mappingKey(state.current);
    const maps = {
      ...state.maps,
      [key]: {
        ...state.current,
        savedAt: new Date().toISOString()
      }
    };
    await storageSet({ [MAPS_KEY]: maps });
    setStatus("Mapping saved for this site pair.");
    await loadState();
  }

  async function clearCurrent() {
    await storageSet({ [CURRENT_KEY]: null });
    setStatus("Current mapping cleared.");
    await loadState();
  }

  async function deleteCurrentField(fieldId) {
    if (!state.current || !state.current.fields || !state.current.fields[fieldId]) {
      return;
    }

    const fieldName = state.current.fields[fieldId].name;
    const fields = { ...state.current.fields };
    delete fields[fieldId];

    const updatedCurrent = {
      ...state.current,
      fields,
      updatedAt: new Date().toISOString()
    };

    const key = updatedCurrent.sourceOrigin && updatedCurrent.targetOrigin ? mappingKey(updatedCurrent) : "";
    const maps = { ...state.maps };
    if (key && maps[key]) {
      maps[key] = {
        ...maps[key],
        fields: { ...(maps[key].fields || {}) },
        updatedAt: updatedCurrent.updatedAt
      };
      delete maps[key].fields[fieldId];
    }

    await storageSet({
      [CURRENT_KEY]: updatedCurrent,
      [MAPS_KEY]: maps
    });
    setStatus(`Deleted "${fieldName}" from the mapping.`);
    await loadState();
  }

  async function handleFieldClick(event) {
    const button = event.target.closest("button[data-action='delete-field']");
    if (!button) {
      return;
    }
    await deleteCurrentField(button.dataset.fieldId);
  }

  async function handleSavedClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    const key = button.dataset.key;
    const action = button.dataset.action;
    const mapping = state.maps[key];
    if (!mapping) {
      return;
    }

    if (action === "load") {
      await storageSet({ [CURRENT_KEY]: mapping });
      setStatus("Saved mapping loaded.");
    } else if (action === "delete") {
      const maps = { ...state.maps };
      delete maps[key];
      await storageSet({ [MAPS_KEY]: maps });
      setStatus("Saved mapping deleted.");
    }
    await loadState();
  }

  captureButton.addEventListener("click", startCapture);
  mapButton.addEventListener("click", startMap);
  recaptureButton.addEventListener("click", recapturePage);
  fillButton.addEventListener("click", fillPage);
  saveButton.addEventListener("click", saveMapping);
  clearButton.addEventListener("click", clearCurrent);
  refreshButton.addEventListener("click", loadState);
  fieldList.addEventListener("click", handleFieldClick);
  savedList.addEventListener("click", handleSavedClick);

  loadState().catch((error) => {
    setStatus(error.message || "Could not load Copynator.", true);
  });
})();
