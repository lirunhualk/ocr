"use strict";

const fileInput = document.querySelector("#file-input");
const chooseImage = document.querySelector("#choose-image");
const replaceImage = document.querySelector("#replace-image");
const dropZone = document.querySelector("#drop-zone");
const uploadPrompt = document.querySelector("#upload-prompt");
const uploadHint = document.querySelector("#upload-hint");
const batchControls = document.querySelector("#batch-controls");
const batchImage = document.querySelector("#batch-image");
const batchSummary = document.querySelector("#batch-summary");
const removeImage = document.querySelector("#remove-image");
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
const downloadBatch = document.querySelector("#download-batch");
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

const queues = { general: [], kxs_podv: [] };
let entries = queues[scenario.value];
let currentEntry = null;
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
  const batch = scenario.value === "kxs_podv" && entries.length > 1;
  const needsRecognition = entries.some(needsOcr);
  recognize.disabled = unavailable || !currentEntry;
  scenario.disabled = unavailable;
  rotation.disabled = unavailable || !currentEntry;
  chooseImage.disabled = unavailable;
  replaceImage.disabled = unavailable;
  batchImage.disabled = unavailable;
  removeImage.disabled = unavailable;
  resultPodv.inert = unavailable;
  downloadPodv.disabled = unavailable || !canExport(currentEntry);
  downloadBatch.hidden = !batch;
  const ready = batch ? entries.filter(canExport).length : 0;
  downloadBatch.disabled = unavailable || ready !== entries.length;
  if (!batch) {
    batchSummary.textContent = "";
  } else if (ready < entries.length) {
    batchSummary.textContent = `${ready}/${entries.length} 张可导出。请识别或核对其余图片。`;
  } else {
    const keys = entries.flatMap(({ podv }) => exportKeys(podv));
    const duplicates = keys.length - new Set(keys).size;
    batchSummary.textContent = duplicates
      ? `${entries.length} 张可导出，共有 ${duplicates} 条重复 D 列单号。`
      : `${entries.length} 张可导出，共 ${keys.length} 条明细。`;
  }
  resultsBody.setAttribute("aria-busy", String(busy));
  recognizeIndicator.className = busy ? "spinner" : "scan-icon";
  recognizeLabel.textContent = busy ? "识别中…" : batch && needsRecognition ? "批量识别"
    : currentEntry && !needsOcr(currentEntry) ? (batch ? "重新识别当前图" : "重新识别") : "开始识别";
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

function exportItemNumbers(check) {
  return /^\d{17}$/.test(check.fields.D?.trim()) ? (check.itemNumbers ?? []) : [];
}

function updatePodvExport() {
  const items = podvItemNumbers.value.split(/[\s,，、;；]+/u).filter(Boolean);
  const invalid = items.some((item) => !/^\d{1,5}$/u.test(item));
  const message = invalid ? "物料行号请填写数字，可用顿号分隔。" : "";
  podvItemNumbers.setCustomValidity(message);
  podvItemNumbers.setAttribute("aria-invalid", String(invalid));
  podv.itemNumbers = [...new Set(items)];
  podvExportNote.textContent = message || (exportItemNumbers(podv).length
    ? "CSV 的 D 列按模板生成完整单号。"
    : "如果 D 列仅有主单号，可与模板 D 列斜杠前的内容匹配。用 Excel 导入时将 D 列设为文本。");
  const option = batchImage.selectedOptions[0];
  if (option) option.textContent = queueLabel(currentEntry, entries.indexOf(currentEntry));
  updateControls();
}

function canExport(entry) {
  return Boolean(entry?.podv?.fields.D?.trim()
    && (entry.podv.itemNumbers ?? []).every((item) => /^\d{1,5}$/u.test(item)));
}

function exportKeys(check) {
  const itemNumbers = exportItemNumbers(check);
  const mainId = check.fields.D.trim();
  return itemNumbers.length ? itemNumbers.map((number) => `${mainId}/${number}/Y`) : [mainId];
}

function downloadChecks(exportEntries, filename) {
  const rows = exportEntries.flatMap(({ podv: check }) => exportKeys(check).map((key) => {
    const row = { ...check.fields, D: key };
    return podvHeaders.map((_, index) => row[String.fromCharCode(65 + index)]);
  }));
  const csv = [podvHeaders, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", csv, "\r\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
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

function fileError(file) {
  if (!supportedTypes.has(file.type) && (file.type || !/\.(jpe?g|png|webp)$/i.test(file.name))) {
    return "请选择 JPG、PNG 或 WebP 图片。";
  }
  if (file.size === 0) return "图片文件为空。";
  if (file.size > maxBytes) return "图片超过 15 MB，请压缩后再上传。";
  return "";
}

function makeEntry(file) {
  return { file, rotation: "auto", result: null, podv: null, error: "" };
}

async function decodeFile(file) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    return { url, image };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("无法打开这张图片，请换一张重试。");
  }
}

function renderQueue() {
  const isPodv = scenario.value === "kxs_podv";
  fileInput.multiple = isPodv;
  uploadHint.textContent = isPodv ? "可多选 JPG、PNG 或 WebP，每张最大 15 MB" : "JPG、PNG 或 WebP，最大 15 MB";
  replaceImage.textContent = isPodv ? "添加图片" : "更换图片";
  replaceImage.hidden = !currentEntry;
  batchControls.hidden = !isPodv || !currentEntry;
  batchImage.replaceChildren(...entries.map((entry, index) => new Option(queueLabel(entry, index), String(index))));
  batchImage.value = String(entries.indexOf(currentEntry));
}

function queueLabel(entry, index) {
  const state = entry.error && !entry.podv ? "识别失败" : canExport(entry) ? "可导出" : entry.podv ? "待核对" : "待识别";
  return `${index + 1}. ${entry.file.name} · ${state}`;
}

function renderCurrent() {
  result = currentEntry?.result ?? null;
  podv = currentEntry?.podv ?? null;
  currentView = podv ? "podv" : "text";
  rotation.value = currentEntry?.rotation ?? "auto";
  fileName.textContent = fileName.title = currentEntry?.file.name ?? "";
  uploadPrompt.hidden = Boolean(currentEntry);
  preview.hidden = !currentImage;
  fileDetails.hidden = !currentEntry;
  dropZone.classList.toggle("has-image", Boolean(currentEntry));
  const direction = rotation.value === "auto" && result?.rotation ? `已自动顺时针旋转 ${result.rotation}°。` : "";
  setStatus(currentEntry?.error || direction, Boolean(currentEntry?.error));
  renderQueue();
  renderResult(currentEntry?.error ? "识别未完成" : result ? "未识别到文字" : "等待识别",
    currentEntry?.error ? "请检查图片后重试。" : result ? "可以换一张清晰的图片，或调整图片方向后重试。"
      : "上传图片后，点击「开始识别」。");
  updateControls();
}

async function selectEntry(entry, decoded = null) {
  if (entry === currentEntry && !decoded) {
    renderCurrent();
    return;
  }
  decoding = true;
  updateControls();
  setStatus("正在读取图片…");
  if (currentImageUrl) URL.revokeObjectURL(currentImageUrl);
  currentEntry = entry;
  currentImageUrl = currentImage = null;
  try {
    if (entry) ({ url: currentImageUrl, image: currentImage } = decoded ?? await decodeFile(entry.file));
  } catch (error) {
    entry.error = error.message;
  } finally {
    decoding = false;
    renderCurrent();
  }
}

async function loadFiles(files) {
  if (!files.length || busy || decoding) return;
  const isPodv = scenario.value === "kxs_podv";
  if (!isPodv && files.length > 1) {
    setStatus("通用场景请一次上传一张图片。", true);
    return;
  }
  const valid = [];
  const invalid = [];
  for (const file of files) {
    const error = fileError(file);
    if (error) invalid.push(`${file.name}：${error}`);
    else valid.push(makeEntry(file));
  }
  if (valid.length) {
    if (!isPodv) {
      decoding = true;
      updateControls();
      let decoded;
      try {
        decoded = await decodeFile(valid[0].file);
      } catch (error) {
        setStatus(error.message, true);
        return;
      } finally {
        decoding = false;
        updateControls();
      }
      entries[0] = valid[0];
      await selectEntry(valid[0], decoded);
    } else {
      entries.push(...valid);
      if (currentEntry) {
        renderQueue();
        updateControls();
      } else {
        await selectEntry(valid[0]);
      }
    }
    if (currentImage) recognize.focus();
  }
  if (invalid.length) setStatus(invalid.join(" "), true);
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

function needsOcr(entry) {
  return scenario.value === "kxs_podv" ? !entry.podv : !entry.result;
}

async function recognizeEntry(entry, isPodv, onProgress) {
  let decoded;
  entry.error = "";
  try {
    if (entry !== currentEntry || !currentImage) decoded = await decodeFile(entry.file);
    const payload = await getRecognition(entry.file, entry.rotation, onProgress);
    if (!Array.isArray(payload?.lines) || typeof payload.text !== "string"
      || !(payload.width > 0 && payload.height > 0)) {
      throw new Error("识别结果格式异常，请重试。");
    }
    if (isPodv) {
      try {
        const { extractPodv } = await import("./kxs-podv.js");
        entry.podv = await extractPodv(payload, decoded?.image ?? currentImage, (crop) => {
          onProgress("正在复查签收区域…");
          return getRecognition(crop, "0", null);
        });
      } catch (error) {
        console.error("POD field extraction failed", error);
        entry.error = "签收字段提取失败，已保留 OCR 文字。请重试。";
      }
    }
    if (!entry.error || !entry.podv) entry.result = payload;
  } catch (error) {
    const failure = browserMode ? "浏览器识别暂时不可用，请检查网络后重试。" : "无法连接识别服务，请检查服务是否已启动。";
    entry.error = error instanceof TypeError ? failure : error.message;
  } finally {
    if (entry.error && entry.podv) entry.error += "已保留上次签收检查结果。";
    if (decoded) URL.revokeObjectURL(decoded.url);
  }
}

async function requestRecognition() {
  if (!currentEntry || busy || decoding) return;

  const isPodv = scenario.value === "kxs_podv";
  const pending = entries.filter(needsOcr);
  const targets = isPodv && pending.length ? pending : [currentEntry];
  const keepView = !isPodv && currentView === "lines";
  busy = true;
  result = podv = null;
  currentView = "text";
  updateControls();
  renderResult("正在识别", browserMode ? "首次识别需要下载模型，请稍候。" : "识别完成后，文字会显示在这里。");

  try {
    for (const [index, entry] of targets.entries()) {
      const prefix = targets.length > 1 ? `${index + 1}/${targets.length} ${entry.file.name}：` : "";
      const onProgress = (message) => setStatus(prefix + message);
      onProgress("正在处理图片，请稍候。");
      await recognizeEntry(entry, isPodv, onProgress);
    }
  } finally {
    busy = false;
    renderCurrent();
    if (keepView && result?.lines.length) setView("lines");
  }
}

chooseImage.addEventListener("click", () => fileInput.click());
replaceImage.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  loadFiles(Array.from(fileInput.files));
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
  loadFiles(Array.from(event.dataTransfer.files));
});

scenario.addEventListener("change", () => {
  const file = currentEntry?.file;
  entries = queues[scenario.value];
  if (!entries.length && file) entries.push(makeEntry(file));
  selectEntry(entries[0] ?? null);
});
rotation.addEventListener("change", () => {
  if (!currentEntry) return;
  currentEntry.rotation = rotation.value;
  currentEntry.result = currentEntry.podv = null;
  currentEntry.error = "";
  renderCurrent();
});
batchImage.addEventListener("change", () => {
  if (busy || decoding) return;
  selectEntry(entries[Number(batchImage.value)]);
});
removeImage.addEventListener("click", () => {
  if (!currentEntry || busy || decoding) return;
  const index = entries.indexOf(currentEntry);
  entries.splice(index, 1);
  selectEntry(entries[Math.min(index, entries.length - 1)] ?? null);
});
showBoxes.addEventListener("change", drawPreview);
recognize.addEventListener("click", requestRecognition);
textView.addEventListener("click", () => setView("text"));
lineView.addEventListener("click", () => setView("lines"));
podvItemNumbers.addEventListener("input", updatePodvExport);
podvView.addEventListener("click", () => setView("podv"));
downloadPodv.addEventListener("click", () => {
  if (downloadPodv.disabled) return;
  downloadChecks([currentEntry], `${currentEntry.file.name.replace(/\.[^.]+$/, "")}_kxs_podv.csv`);
});
downloadBatch.addEventListener("click", () => {
  if (downloadBatch.disabled) return;
  downloadChecks(entries, "签收单检查_kxs_podv.csv");
});
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
renderQueue();
updateControls();
