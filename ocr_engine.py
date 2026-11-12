from functools import lru_cache
from statistics import median
from threading import Lock
from time import perf_counter

import numpy as np
from PIL import Image
from rapidocr import RapidOCR

ROTATE = {
    90: Image.Transpose.ROTATE_270,
    180: Image.Transpose.ROTATE_180,
    270: Image.Transpose.ROTATE_90,
}
INFERENCE_LOCK = Lock()


@lru_cache(maxsize=1)
def get_engine():
    return RapidOCR(params={
        "Global.max_side_len": 2400,
        "EngineConfig.onnxruntime.intra_op_num_threads": 4,
        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
    })


def read_lines(engine, image):
    # RapidOCR expects BGR for NumPy input.
    bgr = np.asarray(image)[:, :, ::-1].copy()
    result = engine(bgr, use_cls=False)
    if not result.txts:
        return []
    return [
        {
            "text": text,
            "confidence": round(float(score), 4),
            "box": [[round(float(x), 1), round(float(y), 1)] for x, y in box],
        }
        for box, text, score in zip(result.boxes, result.txts, result.scores, strict=True)
    ]


def orientation_score(lines):
    # A few confident detections are weaker evidence than a page of legible text.
    return sum(
        min(48, sum(char.isalnum() for char in line["text"]))
        * max(0, line["confidence"] - 0.55) ** 2
        for line in lines
    )


def group_rows(lines):
    if not lines:
        return []

    # Estimate the dominant text slope using the top edges of wide boxes.
    slopes = []
    for line in lines:
        top_left, top_right, bottom_right, _ = line["box"]
        dx = top_right[0] - top_left[0]
        dy = top_right[1] - top_left[1]
        height = bottom_right[1] - top_right[1]
        if dx > 2 * max(height, 1) and abs(dy) < 0.25 * dx:
            slopes.append(dy / dx)
    slope = median(slopes) if slopes else 0

    positions = []
    for line in lines:
        xs, ys = zip(*line["box"], strict=True)
        deskewed_y = [y - slope * x for x, y in zip(xs, ys, strict=True)]
        y_center = sum(deskewed_y) / len(deskewed_y)
        positions.append((y_center, min(xs), max(deskewed_y) - min(deskewed_y), line))

    tolerance = max(3, 0.65 * median(position[2] for position in positions))
    rows = []
    for position in sorted(positions, key=lambda item: item[:2]):
        if not rows or position[0] - rows[-1][0][0] > tolerance:
            rows.append([])
        rows[-1].append(position)
    return [
        [position[3] for position in sorted(row, key=lambda item: item[1])]
        for row in rows
    ]


def recognize(image, rotation=None):
    started_at = perf_counter()
    angles = (0, 90, 180, 270) if rotation is None else (rotation,)
    best_score = -1

    # Reuse the model and serialize access to its mutable inference pipeline.
    with INFERENCE_LOCK:
        engine = get_engine()
        for angle in angles:
            oriented = image.transpose(ROTATE[angle]) if angle else image
            lines = read_lines(engine, oriented)
            score = orientation_score(lines)
            if score > best_score:
                best_score = score
                best_angle, best_size, best_lines = angle, oriented.size, lines

    rows = group_rows(best_lines)
    return {
        "width": best_size[0],
        "height": best_size[1],
        "rotation": best_angle,
        "elapsed_ms": round((perf_counter() - started_at) * 1000),
        "text": "\n".join("  ".join(line["text"] for line in row) for row in rows),
        "lines": [line for row in rows for line in row],
    }
