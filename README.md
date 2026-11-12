# 单据 OCR

从照片中识别中文、英文和数字，适用于送货单等纸质单据。页面支持选择或拖入 JPG、PNG、WebP，单张最大 15 MB。识别后可以查看带文字框的预览、复制全文，或逐块检查文字和置信度。

## 在线使用

打开 [单据 OCR](https://lirunhualk.github.io/ocr/)，选择图片，再点击「开始识别」。可以自动判断方向，也可以手动指定顺时针旋转角度。

GitHub Pages 版使用 PaddleOCR.js 在浏览器里运行。首次识别需要下载模型和运行库，耗时随网络和设备而变化。图片和识别结果只在当前浏览器处理。

## 本地运行 Python 版

在仓库根目录执行以下命令。本项目已在 Windows 的 Python 3.14 上验证。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

打开 [本地识别页面](http://127.0.0.1:8000/)。Python 版由 Flask 提供页面和接口，使用 RapidOCR 和 ONNX Runtime 在本机 CPU 上识别，应用不会将单据写入项目目录。

## Python API

`POST /api/ocr` 接收 `multipart/form-data`。使用 `file` 上传一张图片，用可选的 `rotation` 选择 `auto`（默认）或顺时针 `0`、`90`、`180`、`270` 度。成功响应包括 `text`、`lines`、`width`、`height`、`rotation` 和 `elapsed_ms`。每个文字块包含 `text`、`confidence` 和 `box`，坐标以方向校正后的图片为准。

## 部署

GitHub Pages 发布源使用 GitHub Actions。推送 `main` 分支上的前端修改时，工作流下载并校验官方 PP-OCRv6 tiny 模型，再发布 `static/`。Python 服务与 GitHub Pages 分开运行。

本项目使用 [PaddleOCR.js](https://github.com/PaddlePaddle/PaddleOCR/tree/main/paddleocr-js) 和 [RapidOCR](https://github.com/RapidAI/RapidOCR)。
