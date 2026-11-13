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
const scenario = document.querySelector("#scenario");
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
const resultPodv = document.querySelector("#result-podv");
const textView = document.querySelector("#text-view");
const lineView = document.querySelector("#line-view");
const podvView = document.querySelector("#podv-view");
const podvWarnings = document.querySelector("#podv-warnings");
const podvFields = document.querySelector("#podv-fields");
const podvItemNumbers = document.querySelector("#podv-item-numbers");
const downloadPodv = document.querySelector("#download-podv");
const podvExportNote = document.querySelector("#podv-export-note");
const copyResult = document.querySelector("#copy-result");
const copyLabel = document.querySelector("#copy-label");

const browserMode = location.hostname.endsWith(".github.io")
  || new URLSearchParams(location.search).get("engine") === "browser";
const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxBytes = 15 * 1024 * 1024;
const decimal = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("zh-CN", { style: "percent" });
const podvHeaders = [
  "客户", "发货单号（U8系统）", "发货单时间(U8系统)", "客户送货单号", "实际送货日期",
  "物料编码", "物料名称", "物料编码", "单位", "出库数量",
  "客户格式出库单上载明的出库时间", "是否出库单完全无签收或盖章", "出库单上客户的签收时间（具体时间或没有的不填）",
  "纸质是否有签收时间", "是否签字（选择是或者否）", "签字人姓名（据实填写姓名，不好辨认写“看不清”）",
  "是否盖章", "盖章类型", "是否瑕疵（例如，是否声明仅验收数量）", "如有瑕疵，备注多余文字内容",
];
const podvLabels = {
  D: "客户送货单号", E: "实际送货日期", K: "是否有出库时间", L: "是否无其他红章",
  M: "客户签收时间", N: "签收时间或否", O: "是否签字", P: "签字人姓名辨识",
  Q: "是否有其他红章", R: "其他红章类型", S: "是否瑕疵", T: "备注",
};
const yesNo = ["是", "否"];
const podvChoices = { K: yesNo, O: yesNo, P: ["有", "无", "看不清"], Q: yesNo, S: yesNo };

let currentFile = null;
let currentImage = null;
let currentImageUrl = null;
let result = null;
let podv = null;
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
  scenario.disabled = unavailable;
  rotation.disabled = unavailable || !currentFile;
  chooseImage.disabled = unavailable;
  replaceImage.disabled = unavailable;
  downloadPodv.disabled = unavailable || !podv?.fields.D?.trim() || !podvItemNumbers.validity.valid;
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
  podvView.setAttribute("aria-pressed", String(view === "podv"));
  textView.setAttribute("aria-pressed", String(view === "text"));
  lineView.setAttribute("aria-pressed", String(view === "lines"));
  resultEmpty.hidden = hasLines || Boolean(podv);
  resultText.hidden = !hasLines || view !== "text";
  resultLines.hidden = !hasLines || view !== "lines";
  resultPodv.hidden = !podv || view !== "podv";
}

function renderPodv() {
  podvWarnings.replaceChildren();
  podvFields.replaceChildren();
  podvItemNumbers.setCustomValidity("");
  if (!podv) return;
  podvItemNumbers.value = (podv.itemNumbers ?? []).join("、");

  for (const warning of podv.warnings) {
    const item = document.createElement("li");
    item.textContent = warning;
    podvWarnings.append(item);
  }
  podvWarnings.hidden = podv.warnings.length === 0;

  const inputs = {};
  for (const [column, name] of Object.entries(podvLabels)) {
    const row = document.createElement("tr");
    const heading = document.createElement("th");
    const label = document.createElement("label");
    const letter = document.createElement("span");
    const cell = document.createElement("td");
    const choices = podvChoices[column];
    const input = document.createElement(choices ? "select" : "input");
    input.id = `podv-${column}`;
    if (choices) {
      input.append(new Option("待核对", ""), ...choices.map((value) => new Option(value, value)));
    } else {
      input.type = "text";
      input.readOnly = column === "L" || column === "N";
    }
    input.value = podv.fields[column] ?? "";
    heading.scope = "row";
    label.htmlFor = input.id;
    letter.className = "podv-column";
    letter.textContent = column;
    label.append(letter, name);
    heading.append(label);
    cell.append(input);
    row.append(heading, cell);
    podvFields.append(row);
    inputs[column] = input;
  }

  const syncFields = () => {
    const { fields } = podv;
    fields.N = inputs.N.value = fields.M?.trim() || "否";
    fields.L = inputs.L.value = { 是: "否", 否: "是" }[fields.Q] ?? "";
    inputs.R.readOnly = fields.Q !== "是";
    fields.R = inputs.R.value = fields.Q === "是" ? fields.R || "收获专用章" : "";
    updatePodvExport();
  };
  for (const [column, input] of Object.entries(inputs)) {
    input.addEventListener("input", () => {
      podv.fields[column] = input.value;
      if (column !== "R") syncFields();
    });
  }
  inputs.R.addEventListener("change", syncFields);
  syncFields();
}

function csvCell(value) {
  const cell = value?.trim() ?? "";
  const escaped = /^[=+\-@]/.test(cell) ? `'${cell}` : cell;
  return `"${escaped.replaceAll('"', '""')}"`;
}

function exportItemNumbers() {
  return /^\d{17}$/.test(podv.fields.D?.trim()) ? (podv.itemNumbers ?? []) : [];
}

function updatePodvExport() {
  const items = podvItemNumbers.value.split(/[\s,，、;；]+/u).filter(Boolean);
  const invalid = items.some((item) => !/^\d{1,5}$/u.test(item));
  const message = invalid ? "物料行号请填写数字，可用顿号分隔。" : "";
  podvItemNumbers.setCustomValidity(message);
  podvItemNumbers.setAttribute("aria-invalid", String(invalid));
  podv.itemNumbers = [...new Set(items)];
  podvExportNote.textContent = message || (exportItemNumbers().length
    ? "CSV 的 D 列按模板生成完整单号。"
    : "如果 D 列仅有主单号，可与模板 D 列斜杠前的内容匹配。用 Excel 导入时将 D 列设为文本。");
  updateControls();
}

function exportPodv() {
  if (downloadPodv.disabled) return;

  const { fields } = podv;
  const itemNumbers = exportItemNumbers();
  const mainId = fields.D.trim();
  const keys = itemNumbers.length ? itemNumbers.map((number) => `${mainId}/${number}/Y`) : [mainId];
  const rows = keys.map((key) => {
    const row = { ...fields, D: key };
    return podvHeaders.map((_, index) => row[String.fromCharCode(65 + index)]);
  });
  const csv = [podvHeaders, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", csv, "\r\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${currentFile.name.replace(/\.[^.]+$/, "")}_kxs_podv.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  podvView.hidden = scenario.value !== "kxs_podv";
  podvView.disabled = !podv;
  showBoxesLabel.hidden = count === 0;
  resultHeading.textContent = heading;
  resultHint.textContent = hint;
  documentIcon.className = busy ? "spinner" : "document-icon";
  renderPodv();
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
    podv = null;
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

async function getRecognition(file, mode, onProgress = setStatus) {
  if (!browserMode) return recognizeOnServer(file, mode);

  const { recognizeInBrowser } = await import("./browser-ocr.js");
  return recognizeInBrowser(file, mode, onProgress);
}

async function requestRecognition() {
  if (!currentFile || busy || decoding) return;

  result = null;
  podv = null;
  if (currentView === "podv") currentView = "text";
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
    const directionMessage = adjusted ? `已自动顺时针旋转 ${result.rotation}°。` : "";
    setStatus(directionMessage);
    if (scenario.value === "kxs_podv") {
      try {
        const { extractPodv } = await import("./kxs-podv.js");
        podv = await extractPodv(payload, currentImage, (crop) => {
          setStatus("正在复查签收区域…");
          return getRecognition(crop, "0", null);
        });
        currentView = "podv";
        setStatus(directionMessage);
      } catch (error) {
        console.error("POD field extraction failed", error);
        setStatus("签收字段提取失败，已保留 OCR 文字。请重试。", true);
      }
    }
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
function resetRecognition(hint) {
  result = null;
  podv = null;
  if (currentView === "podv") currentView = "text";
  setStatus("");
  updateControls();
  renderResult("等待识别", hint);
}

scenario.addEventListener("change", () => {
  currentView = "text";
  resetRecognition(currentFile ? "点击「开始识别」，按当前场景识别。" : "上传图片后，点击「开始识别」。");
});
rotation.addEventListener("change", () => {
  resetRecognition("点击「开始识别」，按当前方向设置重新识别。");
});
showBoxes.addEventListener("change", drawPreview);
recognize.addEventListener("click", requestRecognition);
textView.addEventListener("click", () => setView("text"));
lineView.addEventListener("click", () => setView("lines"));
podvItemNumbers.addEventListener("input", updatePodvExport);
podvView.addEventListener("click", () => setView("podv"));
downloadPodv.addEventListener("click", exportPodv);
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
