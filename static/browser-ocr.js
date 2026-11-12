const sdkUrl = "https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/+esm";
// The SDK's CDN build uses ONNX Runtime Web 1.26.0.
const wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/";
const officialModels = "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/";
const detectionModel = "PP-OCRv6_tiny_det";
const recognitionModel = "PP-OCRv6_tiny_rec";
const modelChecksums = {
  [detectionModel]: "ff6ab415b0a6e0c488550f2fb5d5046f1719848df220b2dc21b56402a65bc05d",
  [recognitionModel]: "1e13b22717b1edd89d4cde4fda272b6c17d5b505c97c2baea99da1a3a2d54b29",
};
const rotations = [0, 90, 180, 270];
let enginePromise;

function modelAsset(name) {
  return { url: new URL(`./models/${name}_onnx_infer.tar`, import.meta.url).href };
}

async function downloadModel(name, mirrorUrl) {
  const officialUrl = new URL(`${name}_onnx_infer.tar`, officialModels);
  const sources = [[officialUrl, 8000], [mirrorUrl, 60000]];
  const failures = [];
  for (const [url, timeout] of sources) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
      if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
      const archive = await response.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", archive);
      const checksum = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (checksum !== modelChecksums[name]) throw new Error(`Checksum mismatch from ${url}`);
      return archive;
    } catch (error) {
      failures.push(error);
    }
  }
  throw new AggregateError(failures, `Unable to download ${name}`);
}

async function initializeEngine() {
  const detectionAsset = modelAsset(detectionModel);
  const recognitionAsset = modelAsset(recognitionModel);
  // Start both downloads while PaddleOCR loads its runtime.
  const models = new Map([
    [detectionAsset.url, downloadModel(detectionModel, detectionAsset.url)],
    [recognitionAsset.url, downloadModel(recognitionModel, recognitionAsset.url)],
  ]);
  const engine = import(sdkUrl).then(({ PaddleOCR }) => PaddleOCR.create({
    textDetectionModelName: detectionModel,
    textDetectionModelAsset: detectionAsset,
    textRecognitionModelName: recognitionModel,
    textRecognitionModelAsset: recognitionAsset,
    textRecognitionBatchSize: 8,
    ortOptions: { backend: "wasm", numThreads: 1, wasmPaths },
    async fetch(url) {
      const archive = models.get(url);
      if (!archive) throw new Error(`Unexpected model URL: ${url}`);
      return new Response(await archive);
    },
  }));
  const [readyEngine] = await Promise.all([engine, ...models.values()]);
  return readyEngine;
}

async function loadEngine(onProgress) {
  if (!enginePromise) {
    onProgress?.("首次使用正在加载 OCR 模型和运行库…");
    enginePromise = initializeEngine();
  }
  try {
    return await enginePromise;
  } catch (error) {
    enginePromise = undefined;
    console.error("Could not initialize PaddleOCR:", error);
    throw new Error("OCR 模型加载失败，请检查网络连接后重试。");
  }
}

function rotatedImage(bitmap, rotation) {
  const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const quarterTurn = rotation === 90 || rotation === 270;
  const canvas = document.createElement("canvas");
  canvas.width = quarterTurn ? height : width;
  canvas.height = quarterTurn ? width : height;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(rotation * Math.PI / 180);
  context.drawImage(bitmap, -width / 2, -height / 2, width, height);
  return canvas;
}

function scoreDirection(items) {
  return items.reduce((total, { text, score }) => {
    const characters = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
    return total + Math.min(48, characters) * Math.max(0, score - 0.55) ** 2;
  }, 0);
}

export async function recognizeInBrowser(file, rotationMode, onProgress) {
  const directions = rotationMode === "auto" ? rotations : [Number(rotationMode)];
  const start = performance.now();
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    if (bitmap.width * bitmap.height > 32_000_000) {
      throw new Error("图片总像素不能超过 3200 万。");
    }

    const engine = await loadEngine(onProgress);
    let bestResult;
    let bestScore = -1;
    for (const [index, rotation] of directions.entries()) {
      onProgress?.(directions.length === 1
        ? "正在识别图片…"
        : `正在识别图片方向（${index + 1}/${directions.length}）…`);
      // Yield before canvas preprocessing so the progress state can render.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const input = rotatedImage(bitmap, rotation);
      const [result] = await engine.predict(input, { textRecScoreThresh: 0.45 });
      const score = scoreDirection(result.items);
      if (score > bestScore) {
        bestResult = { ...result, rotation };
        bestScore = score;
      }
    }

    const lines = bestResult.items.map(({ text, score, poly }) => ({ text, confidence: score, box: poly }));
    return {
      width: bestResult.image.width,
      height: bestResult.image.height,
      rotation: bestResult.rotation,
      elapsed_ms: Math.round(performance.now() - start),
      text: lines.map(({ text }) => text).join("\n"),
      lines,
    };
  } finally {
    bitmap.close();
  }
}
