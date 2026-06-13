(function () {
  "use strict";

  const MAX_CHARS = 700;
  const input = document.getElementById("textInput");
  const canvas = document.getElementById("qrCanvas");
  const panel = document.querySelector(".qrPanel");
  const copyButton = document.getElementById("copyButton");
  const downloadButton = document.getElementById("downloadButton");
  const status = document.getElementById("status");

  function setStatus(message, isError) {
    status.textContent = message || "";
    status.classList.toggle("error", Boolean(isError));
  }

  function setActionsEnabled(enabled) {
    copyButton.disabled = !enabled;
    downloadButton.disabled = !enabled;
  }

  function clearQr(message) {
    panel.classList.remove("hasQr");
    setActionsEnabled(false);
    setStatus(message || "");
  }

  function renderQr() {
    const text = input.value;

    if (text.length === 0) {
      clearQr("");
      return;
    }

    if (text.length > MAX_CHARS) {
      clearQr(`Use até ${MAX_CHARS} caracteres para manter o QR Code legível.`);
      status.classList.add("error");
      return;
    }

    try {
      window.QrCode.toCanvas(canvas, text, {
        size: 256,
        margin: 4,
        foreground: "#101828",
        background: "#ffffff"
      });
      panel.classList.add("hasQr");
      setActionsEnabled(true);
      setStatus(`${text.length}/${MAX_CHARS} caracteres`);
    } catch (error) {
      clearQr("Não foi possível gerar um QR Code para esse texto.");
      status.classList.add("error");
    }
  }

  async function copyQr() {
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
      setStatus("Seu navegador não permite copiar imagem aqui. Use Baixar PNG.", true);
      return;
    }

    try {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) {
        throw new Error("Canvas PNG unavailable");
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setStatus("QR Code copiado como imagem.");
    } catch (error) {
      setStatus("Não foi possível copiar. Use Baixar PNG.", true);
    }
  }

  function downloadQr() {
    const link = document.createElement("a");
    link.download = "qrcode.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
    setStatus("Arquivo PNG baixado.");
  }

  input.addEventListener("input", renderQr);
  copyButton.addEventListener("click", copyQr);
  downloadButton.addEventListener("click", downloadQr);

  window.addEventListener("DOMContentLoaded", () => {
    input.focus();
    renderQr();
  });
})();
