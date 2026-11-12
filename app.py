import argparse
from io import BytesIO
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory
from PIL import Image, ImageOps
from waitress import serve
from werkzeug.exceptions import HTTPException

from ocr_engine import recognize

MAX_FILE_BYTES = 15 * 1024 * 1024
MAX_REQUEST_BYTES = MAX_FILE_BYTES + 64 * 1024
MAX_PIXELS = 32_000_000
IMAGE_FORMATS = ("JPEG", "PNG", "WEBP")
ROTATIONS = {"auto": None, "0": 0, "90": 90, "180": 180, "270": 270}
STATIC_DIR = Path(__file__).resolve().parent / "static"

app = Flask(__name__, static_folder=None)
app.config.update(MAX_CONTENT_LENGTH=MAX_REQUEST_BYTES, MAX_FORM_PARTS=8)
app.json.ensure_ascii = False


@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/<path:filename>")
def static_file(filename):
    return send_from_directory(STATIC_DIR, filename)


@app.errorhandler(HTTPException)
def handle_http_error(error):
    if request.path != "/api/ocr":
        return error
    message = "图片大小不能超过 15 MB。" if error.code == 413 else error.description
    return jsonify(error=message), error.code


def decode_image(contents):
    try:
        with Image.open(BytesIO(contents), formats=IMAGE_FORMATS) as image:
            if image.width * image.height > MAX_PIXELS:
                abort(422, "图片总像素不能超过 3200 万。")
            if getattr(image, "is_animated", False):
                abort(422, "请上传静态图片。")

            upright = ImageOps.exif_transpose(image)
            if "A" in upright.getbands() or "transparency" in upright.info:
                rgba = upright.convert("RGBA")
                background = Image.new("RGB", rgba.size, "white")
                background.paste(rgba, mask=rgba.getchannel("A"))
                return background
            return upright.convert("RGB")
    except Image.DecompressionBombError:
        abort(422, "图片总像素不能超过 3200 万。")
    except (OSError, ValueError, SyntaxError):
        abort(422, "无法读取图片，请选择完整的 JPG、PNG 或 WebP 文件。")


@app.post("/api/ocr")
def run_ocr():
    uploaded = request.files.get("file")
    if not uploaded or not uploaded.filename:
        abort(400, "请选择要识别的图片。")

    rotation_mode = request.form.get("rotation", "auto")
    if rotation_mode not in ROTATIONS:
        abort(400, "方向必须为 auto、0、90、180 或 270。")

    contents = uploaded.read(MAX_FILE_BYTES + 1)
    if len(contents) > MAX_FILE_BYTES:
        abort(413)
    if not contents:
        abort(400, "图片文件为空。")

    image = decode_image(contents)
    try:
        result = recognize(image, ROTATIONS[rotation_mode])
    except Exception:
        app.logger.exception("OCR inference failed")
        return jsonify(error="识别服务暂时不可用，请稍后重试。"), 503
    response = jsonify(result)
    response.headers["Cache-Control"] = "no-store"
    return response


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the OCR web application.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    serve(app, host=args.host, port=args.port, max_request_body_size=MAX_REQUEST_BYTES)
