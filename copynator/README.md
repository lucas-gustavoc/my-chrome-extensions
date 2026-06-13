# Copynator

Copynator is a local-first Chrome and Microsoft Edge extension for transferring information from one website to another. It lets you click source fields, map them to target form fields, recapture the latest source values, and fill the target page using saved site-pair mappings.

## How To Install In Developer Mode

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Microsoft Edge.
2. Enable developer mode.
3. Choose load unpacked extension.
4. Select this folder: `C:\PROJETOS\personal\chrome_extensions\copynator`.

## How To Use

1. Open the source website and click the Copynator extension icon.
2. Choose **Capture source**, then click source fields on the page. Name each source field when prompted.
3. Open the target website and click the Copynator extension icon.
4. Choose **Map target**, then click each target field and choose which source field should fill it.
5. Choose **Save this site pair** if you want to reuse the mapping later.
6. When the source page has new values, open that source page and choose **Recapture**.
7. Open the target website and choose **Fill page**.

Use **Delete field** on a field card to remove one source field and its target mapping from the current site-pair mapping.

Press `Esc` while capture or map mode is active to stop the page overlay.

## What It Can Capture

Copynator can track common source fields from inputs, textareas, selects, links, table cells, labels, and regular page text. Recapture rereads those tracked source fields from the current source page. It can fill common inputs, textareas, selects, radio buttons, checkboxes, and editable fields.

## Privacy

Copynator runs locally in the browser. It does not use a server, make network requests, or include remote dependencies. Saved source-field mappings and latest recaptured values are stored only in local extension storage.

## Permissions

- `activeTab`: lets Copynator work on the page you choose after clicking the extension.
- `scripting`: injects the local page helper used for capture, mapping, and filling.
- `storage`: saves current and reusable site-pair mappings locally.
