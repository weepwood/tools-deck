#!/usr/bin/env python3
import csv
import json
import os
import ssl
import sys
import tempfile
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

PREFIX = "::tools-deck::"


def emit(payload):
    print(PREFIX + json.dumps(payload, ensure_ascii=False), flush=True)


def load_params():
    return json.loads(os.environ.get("TOOLS_DECK_PARAMS_JSON", "{}"))


def check_url(url, timeout):
    started = time.perf_counter()
    request = urllib.request.Request(url, headers={"User-Agent": "Tools-Deck/0.3"})
    try:
        with urllib.request.urlopen(request, timeout=timeout, context=ssl.create_default_context()) as response:
            status = response.status
            final_url = response.geturl()
            error = ""
    except urllib.error.HTTPError as exc:
        status = exc.code
        final_url = exc.geturl()
        error = str(exc)
    except Exception as exc:  # noqa: BLE001
        status = 0
        final_url = url
        error = str(exc)
    duration_ms = round((time.perf_counter() - started) * 1000, 2)
    return {"url": url, "status": status, "duration_ms": duration_ms, "final_url": final_url, "error": error}


def main():
    params = load_params()
    urls_value = params.get("urls", "")
    if isinstance(urls_value, list):
        urls = [str(value).strip() for value in urls_value if str(value).strip()]
    else:
        urls = [line.strip() for line in str(urls_value).splitlines() if line.strip()]
    if not urls:
        raise ValueError("URL 列表不能为空")

    timeout = max(1, min(120, int(params.get("timeout", 10))))
    concurrency = max(1, min(20, int(params.get("concurrency", 5))))
    emit({"type": "progress", "progress": 5, "message": f"准备检测 {len(urls)} 个 URL"})

    results = []
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = {executor.submit(check_url, url, timeout): url for url in urls}
        for index, future in enumerate(as_completed(futures), start=1):
            result = future.result()
            results.append(result)
            emit({
                "type": "progress",
                "progress": min(95, 5 + round(index / len(urls) * 90)),
                "message": f"[{index}/{len(urls)}] {result['url']} → {result['status'] or '失败'}",
                "level": "warning" if result["error"] else "info",
            })

    output_dir = Path(tempfile.gettempdir()) / "tools-deck" / os.environ.get("TOOLS_DECK_RUN_ID", "run")
    output_dir.mkdir(parents=True, exist_ok=True)
    report = output_dir / "http-check-report.csv"
    with report.open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=["url", "status", "duration_ms", "final_url", "error"])
        writer.writeheader()
        writer.writerows(results)

    emit({"type": "artifact", "progress": 100, "artifact": {"type": "file", "label": "HTTP 检测报告", "path": str(report), "content": str(report)}})
    print(f"检测完成：{len(results)} 个 URL", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"HTTP 检测失败：{exc}", file=sys.stderr, flush=True)
        raise
