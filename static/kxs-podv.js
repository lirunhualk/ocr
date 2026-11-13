const fallbackStamp = "收获专用章";
const deliveryLabel = /送货(?:日期|时间)/u;
const outboundLabel = /(?:出库|出仓)(?:日期|时间)/u;
const signatureLabel = /^(?:客户签收人|签收人|收货人|客户签字|客户签名)(?!员|员签)/u;
const signatureDateLabel = /^(?:(?:客户)?签收(?:日期|时间)|日\s*期)/u;
const defectPattern = /(?:仅|只)(?:对|作|做|确认|验收|核对|清点|收|验)*(?:货物)?数量|(?:未|不|待)(?:做|作|进行)?(?:验收|检验|检查|验|检)?(?:品质|质量)|(?:品质|质量)(?:未经|未|待|不)(?:验收|检验|检查|确认|检)|收货未检/u;
const exceptionPattern = /未收货|拒收|退货|短收|少收|多收|破损|错发|漏发|补送|数量(?:不符|有误)|外箱(?:损坏|破损)/u;
const clockPattern = /(?<!\d)(?:[01]?\d|2[0-3])[:：][0-5]\d(?:[:：][0-5]\d)?(?!\d)/u;

function dateIn(text, allowPartial = false) {
  const value = text.normalize("NFKC").replace(/\s*([-./年月日:])\s*/gu, "$1");
  const full = /(?<!\d)(20\d{2})[-./年](\d{1,2})[-./月](\d{1,2})(?:日)?(?!\d)/u.exec(value);
  const match = full || (allowPartial && /(?<![\d:])([01]?\d)[-./月](\d{1,2})(?:日)?(?!\d)/u.exec(value));
  if (!match) return "";
  const year = full?.[1];
  const [month, day] = match.slice(-2);
  const date = new Date(Date.UTC(Number(year ?? 2000), Number(month) - 1, Number(day)));
  if (date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) return "";
  const clock = value.slice(match.index + match[0].length).trim().match(clockPattern)?.[0];
  const label = year ? date.toISOString().slice(0, 10) : `${Number(month)}月${Number(day)}日`;
  return clock ? `${label} ${clock}` : label;
}

function positionLines(result, width, height) {
  return result.lines.map(({ text, confidence, box }) => {
    const xs = box.map(([x]) => x * width / result.width);
    const ys = box.map(([, y]) => y * height / result.height);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    return { text: text.normalize("NFKC").trim(), confidence, left, right, top, bottom,
      x: (left + right) / 2, y: (top + bottom) / 2 };
  });
}

function rightOf(lines, label, maxDistance, rowTolerance) {
  return lines.filter((line) => line.left >= label.right - 1
    && line.left - label.right <= maxDistance && Math.abs(line.y - label.y) <= rowTolerance)
    .sort((a, b) => a.left - b.left);
}

function attachedText(lines, label, pattern, maxDistance, rowTolerance) {
  const suffix = label.text.replace(pattern, "").replace(/^[\s:：;；]+/u, "");
  const nearby = rightOf(lines, label, maxDistance, rowTolerance).map(({ text }) => text).join(" ");
  return `${suffix} ${nearby}`.trim();
}

function orientedCanvas(image, rotation, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const w = Math.round(image.naturalWidth * scale);
  const h = Math.round(image.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  const sideways = rotation === 90 || rotation === 270;
  canvas.width = sideways ? h : w;
  canvas.height = sideways ? w : h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(rotation * Math.PI / 180);
  ctx.drawImage(image, -w / 2, -h / 2, w, h);
  ctx.resetTransform();
  return canvas;
}

function bounds(canvas, [left, top, right, bottom]) {
  return [Math.max(0, Math.floor(left)), Math.max(0, Math.floor(top)),
    Math.min(canvas.width, Math.ceil(right)), Math.min(canvas.height, Math.ceil(bottom))];
}

function inkRegion(canvas, region, color, omit = null) {
  const [left, top, right, bottom] = bounds(canvas, region);
  if (right <= left || bottom <= top) return null;
  const width = right - left;
  const height = bottom - top;
  const data = canvas.getContext("2d").getImageData(left, top, width, height);
  const pixels = data.data;
  let count = 0;
  let minX = right;
  let minY = bottom;
  let maxX = left;
  let maxY = top;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const index = ((y - top) * width + x - left) * 4;
      const [r, g, b] = [pixels[index], pixels[index + 1], pixels[index + 2]];
      const ignored = omit && x >= omit[0] && x <= omit[2] && y >= omit[1] && y <= omit[3];
      const strength = color === "red"
        ? (r > 158 ? Math.min(r - g - 9, r - b - 13) : 0)
        : (b > 135 ? Math.min(b - r - 3, g - r - 1) : 0);
      const level = ignored ? 0 : Math.min(255, Math.max(0, strength * 16));
      pixels[index] = pixels[index + 1] = pixels[index + 2] = 255 - level;
      if (level >= 16) {
        count++;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return { data, count, spanX: maxX - minX, spanY: maxY - minY,
    left: minX - left, top: minY - top };
}

function stampType(text) {
  return text.replace(/\s+/gu, "").match(/收货[未本末]检[章部]?|(?:收货|收料|收讫|签收|验收|仓库|物料|物流|业务|财务)(?:专用)?章|合同专用章|公章/u)?.[0]
    ?.replace(/^收货[未本末]检[章部]?$/u, "收货未检章") ?? "";
}

function handInk(ink, unit, minimum) {
  return ink && ink.count >= minimum * unit ** 2 && ink.spanX >= 8 * unit && ink.spanY >= 4 * unit;
}

function cropJob(crops) {
  const strips = crops.map(([key, { data, left, top, spanX, spanY }, scale]) => {
    const source = document.createElement("canvas");
    source.width = data.width;
    source.height = data.height;
    source.getContext("2d").putImageData(data, 0, 0);
    return { key, source, left, top, w: spanX + 1, h: spanY + 1, scale };
  });
  const canvas = document.createElement("canvas");
  const margin = 22;
  canvas.width = Math.ceil(Math.max(...strips.map(({ w, scale }) => w * scale)) + 2 * margin);
  canvas.height = Math.ceil(strips.reduce((total, { h, scale }) => total + h * scale + margin, margin));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = margin;
  for (const strip of strips) {
    const { source, left, top, w, h, scale } = strip;
    ctx.drawImage(source, left, top, w, h, margin, y, w * scale, h * scale);
    strip.top = y - margin / 2;
    y += h * scale + margin;
    strip.bottom = y - margin / 2;
  }
  return { strips, file: new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob && new File([blob], "podv-fields.png", { type: "image/png" })));
  }) };
}

export async function extractPodv(result, image, recognizeCrop) {
  const canvas = orientedCanvas(image, result.rotation, 1920);
  const lines = positionLines(result, canvas.width, canvas.height);
  const unit = canvas.width / 960;
  const lineGap = 10 * unit;
  const text = lines.map((line) => line.text).join("\n");
  const delivery = lines.find((line) => deliveryLabel.test(line.text));
  const deliveryText = delivery ? attachedText(lines, delivery, /^.*?送货(?:日期|时间)/u, 90 * unit, lineGap) : "";
  const deliveryDate = dateIn(deliveryText).split(" ")[0];
  const header = lines.find((line) => line.text.includes("行号"));
  const numberCandidates = new Set();
  for (const line of lines) {
    if (line.y >= (header?.y ?? (delivery ? delivery.y + 25 * unit : canvas.height * 0.45))) continue;
    const number = /(?<!\d)\d{6}20\d{9}(?!\d)/u.exec(line.text.replace(/\s+/gu, ""))?.[0];
    if (number && dateIn(`${number.slice(6, 10)}-${number.slice(10, 12)}-${number.slice(12, 14)}`)) {
      numberCandidates.add(number);
    }
  }
  const number = numberCandidates.size === 1 ? [...numberCandidates][0] : "";
  const outbound = lines.some((line) => {
    if (!outboundLabel.test(line.text)) return false;
    const value = attachedText(lines, line, /^.*?(?:出库|出仓)(?:日期|时间)/u, 100 * unit, lineGap);
    return Boolean(dateIn(value, true) || clockPattern.test(value));
  });

  const memo = lines.find((line) => /送货备(?:注)?/u.test(line.text));
  const total = lines.find((line) => /^合\s*计/u.test(line.text) && (!header || line.y > header.y));
  const itemLines = header ? lines.filter((line) => /^\d{1,5}$/u.test(line.text)
    && line.y > header.y + 8 * unit && line.y < (total?.y ?? memo?.y ?? canvas.height) - 5 * unit
    && Math.abs(line.x - header.x) <= Math.max(12 * unit, (header.right - header.left) * 0.6))
    .sort((a, b) => a.y - b.y) : [];
  const itemNumbers = [...new Set(itemLines.map((line) => line.text))];
  const printedDate = lines.find((line) => signatureDateLabel.test(line.text)
    && (line.y > (header?.y ?? 0)) && (!memo || Math.abs(line.y - memo.y) < 55 * unit));
  const receiver = lines.find((line) => signatureLabel.test(line.text)
    && (line.y > (header?.y ?? 0)) && (!memo || Math.abs(line.y - memo.y) < 30 * unit));
  const headerRemark = lines.find((line) => line.text === "备注"
    && (!header || Math.abs(line.y - header.y) < lineGap));
  const right = headerRemark?.x ?? ((receiver ?? printedDate)?.left + 62 * unit);
  const signY = receiver?.y ?? ((printedDate?.y ?? memo?.y + 23 * unit) - 23 * unit);
  const dateY = printedDate?.y ?? signY + 23 * unit;
  const receiverText = receiver ? attachedText(lines, receiver, signatureLabel, 95 * unit, lineGap) : "";
  const signatureName = /^(\p{Script=Han}{2,4})(?:\s|$)/u.exec(receiverText)?.[1];
  const receiverOcr = receiver?.text.match(signatureLabel)?.[0];
  const receiverWidth = receiverOcr && receiver?.text.length > receiverOcr.length + 1
    ? (receiver.right - receiver.left) * (receiverOcr.length + 1) / receiver.text.length : null;
  const signLeft = receiver ? Math.min(receiverWidth === null ? receiver.right : receiver.left + receiverWidth,
    right + 6 * unit) + 2 * unit : right - 28 * unit;
  const dateLeft = printedDate && !/\d/u.test(printedDate.text) ? printedDate.right + 3 * unit : signLeft;
  const hasLayout = Number.isFinite(right) && Number.isFinite(signY);
  const signInk = hasLayout && inkRegion(canvas, [signLeft, signY - 9 * unit, right + 34 * unit, signY + 11 * unit], "blue");
  const dateInk = hasLayout && inkRegion(canvas, [dateLeft, dateY - 7 * unit, right + 34 * unit, dateY + 15 * unit], "blue");
  const signed = Boolean(signatureName || handInk(signInk, unit, 22));
  const nameLine = rightOf(lines, receiver ?? { right: signLeft, y: signY }, 95 * unit, 13 * unit)
    .find((line) => line.text === signatureName);
  const legibleName = Boolean(signatureName && (nameLine?.confidence ?? receiver?.confidence ?? 0) >= 0.92);
  const dateText = printedDate ? attachedText(lines, printedDate, signatureDateLabel, 95 * unit, lineGap) : "";
  let signedDate = dateIn(dateText, true) || dateText.match(clockPattern)?.[0] || "";

  const dispatch = lines.find((line) => /出货专用章/u.test(line.text));
  const dispatchRegion = dispatch && [dispatch.left - 47 * unit, dispatch.top - 65 * unit,
    dispatch.right + 47 * unit, dispatch.bottom + 30 * unit];
  const stampRegion = hasLayout && inkRegion(canvas, [right - 125 * unit, signY - 105 * unit,
    right + 22 * unit, dateY + 55 * unit], "red", dispatchRegion);
  const redStampText = lines.filter((line) => {
    if (line.y <= (header?.y ?? 0) || /出货专用章/u.test(line.text)) return false;
    const ink = inkRegion(canvas, [line.left, line.top, line.right, line.bottom], "red", dispatchRegion);
    return ink && ink.count >= 14 * unit ** 2;
  }).map(({ text }) => text).join("\n");
  let type = stampType(redStampText);
  const hasRedInk = stampRegion && stampRegion.count >= 110 * unit ** 2
    && stampRegion.spanX >= 28 * unit && stampRegion.spanY >= 15 * unit;
  const otherStamp = Boolean(hasRedInk || type);
  const warnings = [];
  const crops = [];
  if (!signedDate && handInk(dateInk, unit, signed ? 4 : 10)) crops.push(["date", dateInk, 5 / unit]);
  if (!type && hasRedInk) crops.push(["stamp", stampRegion, 2.5 / unit]);
  if (recognizeCrop && crops.length) {
    try {
      const { strips, file } = cropJob(crops);
      const crop = await file;
      if (crop) {
        const enhanced = await recognizeCrop(crop);
        const detected = positionLines(enhanced, enhanced.width, enhanced.height);
        for (const { key, top, bottom } of strips) {
          const recognized = detected.filter((line) => line.y >= top && line.y < bottom)
            .sort((a, b) => a.y - b.y || a.x - b.x).map((line) => line.text).join(" ");
          if (key === "date") signedDate = dateIn(recognized, true);
          if (key === "stamp") type = stampType(recognized);
        }
      }
    } catch {
      warnings.push("局部增强识别未完成，请对照图片核对签收日期及印章。");
    }
  }

  const defect = defectPattern.test(text.replace(/\s+/gu, "")) || type === "收货未检章";
  const extra = lines.filter((line) => line.y > (header?.y ?? 0) && exceptionPattern.test(line.text))
    .map((line) => {
      const item = itemLines.find(({ y }) => Math.abs(y - line.y) < 8 * unit);
      if (!item) return line.text;
      const canceledQuantity = lines.find(({ text, y, x }) => /^\d+(?:\.\d+)?[-—]$/u.test(text)
        && Math.abs(y - item.y) < 8 * unit && x > item.x && x < line.x);
      const canceled = canceledQuantity ? `数量${canceledQuantity.text.slice(0, -1)}疑似划销，` : "";
      return `第${item.text}行${canceled}${line.text}`;
    });
  if (!number) warnings.push("请核对并填写送货单主单号（D 列）。");
  if (!deliveryDate) warnings.push("请核对送货日期（E 列）。");
  if (!hasLayout) warnings.push("未定位到签收区，请核对手写日期、签字及印章。");
  if (!signedDate && (signed || handInk(dateInk, unit, 10))) warnings.push("请核对手写签收日期（M、N 列）。");
  if (signed && !legibleName) warnings.push("检测到签字笔迹，请核对签字人姓名（P 列）。");
  if (otherStamp && !type) warnings.push("检出额外红章，章型按“收获专用章”暂填，请核对章型和瑕疵（R、S 列）。");

  return { fields: {
    D: number, E: deliveryDate, K: outbound ? "是" : "否", L: otherStamp ? "否" : "是",
    M: signedDate, N: signedDate || "否", O: signed ? "是" : "否",
    P: signed ? (legibleName ? "有" : "看不清") : "无", Q: otherStamp ? "是" : "否",
    R: otherStamp ? type || fallbackStamp : "", S: defect ? "是" : "否", T: [...new Set(extra)].join("；"),
  }, itemNumbers, warnings };
}
