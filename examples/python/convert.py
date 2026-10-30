"""Convert a local file with the ConvertFly API.

Usage:
    export CONVERTFLY_API_KEY=cvfly_sk_...
    python convert.py photo.png pdf

Requires: requests (pip install requests)
"""
import os
import sys
import time

import requests

API = "https://convertfly.io/api/v1"


def tasks_by_name(job):
    tasks = job.get("tasks") or []
    if isinstance(tasks, dict):
        return tasks
    return {t.get("name"): t for t in tasks}


def convert(path, output_format, api_key):
    session = requests.Session()
    session.headers["Authorization"] = f"Bearer {api_key}"
    name = os.path.basename(path)
    size = os.path.getsize(path)

    # 1. Create a job: upload -> convert -> export.
    r = session.post(f"{API}/jobs", json={"tasks": {
        "upload": {"operation": "import/upload", "filename": name, "file_size": size},
        "convert": {"operation": "convert", "input": "upload", "output_format": output_format},
        "export": {"operation": "export/url", "input": "convert"},
    }}, timeout=60)
    r.raise_for_status()
    job_id = r.json()["id"]

    # 2. Wait for the upload URL, send the file, then confirm the upload.
    for _ in range(60):
        upload_task = tasks_by_name(session.get(f"{API}/jobs/{job_id}", timeout=30).json())["upload"]
        upload = (upload_task.get("result") or {}).get("upload") or {}
        if upload.get("url"):
            break
        time.sleep(0.5)
    else:
        raise RuntimeError("no upload URL received")
    with open(path, "rb") as f:
        requests.put(upload["url"], data=f, timeout=300).raise_for_status()
    session.post(f"{API}/tasks/{upload_task['id']}/upload-confirm", json={
        "s3_key": upload["s3_key"], "filename": name,
        "mime_type": "application/octet-stream", "file_size": size,
    }, timeout=60).raise_for_status()

    # 3. Poll until the job is finished, then download the result.
    while True:
        job = session.get(f"{API}/jobs/{job_id}", timeout=30).json()
        status = str(job.get("status", "")).lower()
        failed = [t for t in tasks_by_name(job).values() if str(t.get("status", "")).lower() == "error"]
        if status == "finished" or status == "error" or failed:
            break
        time.sleep(1)
    if status == "error" or failed:
        reason = failed[0].get("error") or failed[0].get("code") if failed else "unknown error"
        raise RuntimeError(f"job {job_id} failed: {reason}")
    result = tasks_by_name(job)["export"]["result"]["files"][0]
    data = requests.get(result["url"], timeout=300)
    data.raise_for_status()
    out = result.get("filename") or f"{os.path.splitext(name)[0]}.{output_format}"
    with open(out, "wb") as f:
        f.write(data.content)
    return out


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: python convert.py <file> <output_format>")
    key = os.environ.get("CONVERTFLY_API_KEY")
    if not key:
        sys.exit("set CONVERTFLY_API_KEY first")
    print("saved", convert(sys.argv[1], sys.argv[2], key))
