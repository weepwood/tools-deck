#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path

PREFIX = "::tools-deck::"


def emit(payload):
    print(PREFIX + json.dumps(payload, ensure_ascii=False), flush=True)


def is_within(path, parent):
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def main():
    params = json.loads(os.environ.get("TOOLS_DECK_PARAMS_JSON", "{}"))
    source = Path(str(params.get("input", ""))).expanduser().resolve()
    output = Path(str(params.get("output", ""))).expanduser().resolve()
    quality = max(30, min(100, int(params.get("quality", 82))))
    recursive = bool(params.get("recursive", True))

    if not source.is_dir():
        raise ValueError("输入文件夹不存在")
    if output == source or is_within(output, source):
        raise ValueError("输出文件夹不能与输入文件夹相同，也不能位于输入文件夹内部")

    try:
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("缺少 Pillow。请运行：python -m pip install Pillow") from exc

    output.mkdir(parents=True, exist_ok=True)
    pattern = "**/*" if recursive else "*"
    files = [
        path
        for path in source.glob(pattern)
        if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
    ]
    emit({"type": "progress", "progress": 5, "message": f"找到 {len(files)} 张图片"})

    for index, file in enumerate(files, start=1):
        relative = file.relative_to(source)
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(file) as image:
            save_kwargs = {"optimize": True}
            if file.suffix.lower() in {".jpg", ".jpeg", ".webp"}:
                save_kwargs["quality"] = quality
            image.save(target, **save_kwargs)
        emit({
            "type": "progress",
            "progress": min(95, 5 + round(index / max(len(files), 1) * 90)),
            "message": f"[{index}/{len(files)}] {relative}",
        })

    emit({
        "type": "artifact",
        "progress": 100,
        "artifact": {
            "type": "directory",
            "label": "压缩结果目录",
            "path": str(output),
            "content": str(output),
        },
    })
    print(f"压缩完成：{len(files)} 张图片", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"图片压缩失败：{exc}", file=sys.stderr, flush=True)
        raise
