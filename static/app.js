"use strict";

const fileInput = document.querySelector("#file-input");
const chooseImage = document.querySelector("#choose-image");
const replaceImage = document.querySelector("#replace-image");
const dropZone = document.querySelector("#drop-zone");
const uploadPrompt = document.querySelector("#upload-prompt");
const preview = document.querySelector("#preview");
const canvas = document.querySelector("#preview-canvas");
const fileDetails = document.querySelector("#file-details");
const fileName = document.querySelector("#file-name");
const showBoxes = document.querySelector("#show-boxes");
const showBoxesLabel = document.querySelector("#show-boxes-label");
const rotation = document.querySelector("#rotation");
const recognize = document.querySelector("#recognize");
const recognizeLabel = document.querySelector("#recognize-label");
const recognizeIndicator = document.querySelector("#recognize-indicator");
const status = document.querySelector("#status");
const resultsBody = document.querySelector("#results-body");
const resultEmpty = document.querySelector("#result-empty");
const resultHeading = document.querySelector("#result-heading");
const resultHint = document.querySelector("#result-hint");
const documentIcon = document.querySelector("#document-icon");
const resultMeta = document.querySelector("#result-meta");
const resultText = document.querySelector("#result-text");
const resultLines = document.querySelector("#result-lines");
const textView = document.querySelector("#text-view");
const lineView = document.querySelector("#line-view");
const copyResult = document.querySelector("#copy-result");
const copyLabel = document.querySelector("#copy-label");

const browserMode = location.hostname.endsWith(".github.io")
  || new URLSearchParams(location.search).get("engine") === "browser";
const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxBytes = 15 * 1024 * 1024;
const decimal = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("zh-CN", { style: "percent" });

let currentFile = null;
let currentImage = null;
let currentImageUrl = null;
let result = null;
let busy = false;
let decoding = false;
let selectedBox = -1;
let currentView = "text";
let copyTimer;

if (browserMode) {
  document.querySelector("#engine-label").textContent = "浏览器识别";
  document.querySelector("#privacy-label").textContent = "图片在当前浏览器内处理";
}

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle("is-error", error);
}

function updateControls() {
  const unavailable = busy || decoding;
  recognize.disabled = unavailable || !currentFile;
  rotation.disabled = unavailable || !currentFile;
  chooseImage.disabled = unavailable;
  replaceImage.disabled = unavailable;
  resultsBody.setAttribute("aria-busy", String(busy));
  recognizeIndicator.className = busy ? "spinner" : "scan-icon";
  recognizeLabel.textContent = busy ? "识别中…" : result ? "重新识别" : "开始识别";
}

function drawPreview() {
  if (!currentImage) return;

  const degrees = result?.rotation ?? (Number(rotation.value) || 0);
  const { naturalWidth, naturalHeight } = currentImage;
  const scale = Math.min(1, 1800 / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));
  const quarterTurn = degrees === 90 || degrees === 270;
  canvas.width = quarterTurn ? height : width;
  canvas.height = quarterTurn ? width : height;

  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(degrees * Math.PI / 180);
  context.drawImage(currentImage, -width / 2, -height / 2, width, height);
  context.restore();

  if (!result || !showBoxes.checked) return;

  const scaleX = canvas.width / result.width;
  const scaleY = canvas.height / result.height;
  const stroke = Math.max(1, Math.max(canvas.width, canvas.height) / 600);
  result.lines.forEach(({ box }, index) => {
    if (box.length < 3) return;

    const active = index === selectedBox;
    context.beginPath();
    box.forEach(([x, y], corner) => {
      if (corner === 0) context.moveTo(x * scaleX, y * scaleY);
      else context.lineTo(x * scaleX, y * scaleY);
    });
    context.closePath();
    context.fillStyle = active ? "#f2b22966" : "#11a16c16";
    context.strokeStyle = active ? "#a96100" : "#126b50";
    context.lineWidth = active ? stroke * 2 : stroke;
    context.fill();
    context.stroke();
  });
}

function setView(view) {
  currentView = view;
  const hasLines = Boolean(result?.lines.length);
  textView.setAttribute("aria-pressed", String(view === "text"));
  lineView.setAttribute("aria-pressed", String(view === "lines"));
  resultText.hidden = !hasLines || view !== "text";
  resultLines.hidden = !hasLines || view !== "lines";
}

function renderResult(heading, hint) {
  clearTimeout(copyTimer);
  copyLabel.textContent = "复制文字";
  selectedBox = -1;
  const count = result?.lines.length ?? 0;
  resultText.textContent = result?.text ?? "";
  resultLines.replaceChildren();
  result?.lines.forEach((line, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const label = document.createElement("span");
    const confidence = document.createElement("span");
    button.type = "button";
    button.className = "result-line";
    button.setAttribute("aria-pressed", "false");
    label.textContent = line.text;
    confidence.textContent = percent.format(line.confidence);
    confidence.title = "识别置信度";
    button.append(label, confidence);
    button.addEventListener("click", () => {
      resultLines.querySelector('[aria-pressed="true"]')?.setAttribute("aria-pressed", "false");
      selectedBox = selectedBox === index ? -1 : index;
      button.setAttribute("aria-pressed", String(selectedBox === index));
      if (selectedBox === index) showBoxes.checked = true;
      drawPreview();
    });
    item.append(button);
    resultLines.append(item);
  });
  resultMeta.textContent = result ? `${count} 个文本块 · ${decimal.format(result.elapsed_ms / 1000)} 秒` : "";
  copyResult.disabled = !result?.text;
  textView.disabled = count === 0;
  lineView.disabled = count === 0;
  showBoxesLabel.hidden = count === 0;
  resultEmpty.hidden = count > 0;
  resultHeading.textContent = heading;
  resultHint.textContent = hint;
  documentIcon.className = busy ? "spinner" : "document-icon";
  setView(currentView);
  drawPreview();
}

async function loadFile(file) {
  if (!file || busy || decoding) return;

  if (!supportedTypes.has(file.type) && (file.type || !/\.(jpe?g|png|webp)$/i.test(file.name))) {
    setStatus("请选择 JPG、PNG 或 WebP 图片。", true);
    return;
  }
  if (file.size > maxBytes || file.size === 0) {
    setStatus(file.size === 0 ? "图片文件为空。" : "图片超过 15 MB，请压缩后再上传。", true);
    return;
  }

  decoding = true;
  updateControls();
  setStatus("正在读取图片…");
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    if (currentImageUrl) URL.revokeObjectURL(currentImageUrl);
    currentImageUrl = url;
    currentFile = file;
    currentImage = image;
    result = null;
    currentView = "text";
    rotation.value = "auto";
    showBoxes.checked = true;
    fileName.textContent = file.name;
    fileName.title = file.name;
    uploadPrompt.hidden = true;
    preview.hidden = false;
    fileDetails.hidden = false;
    replaceImage.hidden = false;
    dropZone.classList.add("has-image");
    setStatus("");
    renderResult("等待识别", "点击「开始识别」提取图片中的文字。");
  } catch {
    if (currentImageUrl !== url) URL.revokeObjectURL(url);
    setStatus("无法打开这张图片，请换一张重试。", true);
  } finally {
    decoding = false;
    updateControls();
    if (currentImageUrl === url) recognize.focus();
  }
}

async function recognizeOnServer(file, mode) {
  const body = new FormData();
  body.set("file", file);
  body.set("rotation", mode);
  const response = await fetch("/api/ocr", { method: "POST", body });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof payload?.error === "string" ? payload.error : null;
    throw new Error(detail || "识别服务暂时不可用，请稍后重试。");
  }
  return payload;
}

async function getRecognition(file, mode) {
  if (!browserMode) return recognizeOnServer(file, mode);

  const { recognizeInBrowser } = await import("./browser-ocr.js");
  return recognizeInBrowser(file, mode, (message) => setStatus(message));
}

async function requestRecognition() {
  if (!currentFile || busy || decoding) return;

  result = null;
  busy = true;
  updateControls();
  setStatus(browserMode ? "正在准备浏览器识别模型，请稍候。" : "正在处理图片，请稍候。");
  renderResult("正在识别", browserMode
    ? "首次识别需要下载模型，请稍候。"
    : "识别完成后，文字会显示在这里。");

  try {
    const payload = await getRecognition(currentFile, rotation.value);
    if (!Array.isArray(payload?.lines) || typeof payload.text !== "string"
      || !(payload.width > 0 && payload.height > 0)) {
      throw new Error("识别结果格式异常，请重试。");
    }
    result = payload;
    const adjusted = rotation.value === "auto" && result.rotation !== 0;
    setStatus(adjusted ? `已自动顺时针旋转 ${result.rotation}°。` : "");
    renderResult("未识别到文字", "可以换一张清晰的图片，或调整图片方向后重试。");
  } catch (error) {
    result = null;
    const failure = browserMode ? "浏览器识别暂时不可用，请检查网络后重试。" : "无法连接识别服务，请检查服务是否已启动。";
    setStatus(error instanceof TypeError ? failure : error.message, true);
    renderResult("识别未完成", "请检查图片后重试。");
  } finally {
    busy = false;
    updateControls();
    documentIcon.className = "document-icon";
  }
}

chooseImage.addEventListener("click", () => fileInput.click());
replaceImage.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  loadFile(fileInput.files[0]);
  fileInput.value = "";
});
dropZone.addEventListener("dragover", (event) => {
  if (!event.dataTransfer.types.includes("Files")) return;

  event.preventDefault();
  event.dataTransfer.dropEffect = busy || decoding ? "none" : "copy";
  if (!busy && !decoding) dropZone.classList.add("is-dragging");
});
dropZone.addEventListener("dragleave", (event) => {
  if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove("is-dragging");
});
dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");
  if (busy || decoding) return;
  if (event.dataTransfer.files.length > 1) {
    setStatus("请一次上传一张图片。", true);
    return;
  }
  loadFile(event.dataTransfer.files[0]);
});
rotation.addEventListener("change", () => {
  result = null;
  setStatus("");
  updateControls();
  renderResult("等待识别", "点击「开始识别」，按当前方向设置重新识别。");
});
showBoxes.addEventListener("change", drawPreview);
recognize.addEventListener("click", requestRecognition);
textView.addEventListener("click", () => setView("text"));
lineView.addEventListener("click", () => setView("lines"));
copyResult.addEventListener("click", async () => {
  if (!result?.text) return;
  const currentResult = result;
  try {
    await navigator.clipboard.writeText(result.text);
    if (result !== currentResult) return;
    copyLabel.textContent = "已复制";
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copyLabel.textContent = "复制文字"; }, 1800);
  } catch {
    if (result !== currentResult) return;
    setView("text");
    const range = document.createRange();
    range.selectNodeContents(resultText);
    const selectedText = window.getSelection();
    selectedText.removeAllRanges();
    selectedText.addRange(range);
    resultText.focus();
    setStatus("已选中全文，可使用系统复制快捷键。");
  }
});
