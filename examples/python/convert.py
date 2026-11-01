"""Convert a local file with the ConvertFly API.

Usage:
    export CONVERTFLY_API_KEY=cvfly_sk_...
    python convert.py photo.png pdf

Requires: requests (pip install requests)
"""
import os
import sys

import requests

API = "https://convertfly.io/api/v1"


def by_name(job):
    return {task["name"]: task for task in job["tasks"]}


def convert(path, output_format, api_key):
    session = requests.Session()
    session.headers["Authorization"] = f"Bearer {api_key}"
    name = os.path.basename(path)
    size = os.path.getsize(path)

    # 1. Create the job: upload -> convert -> export. The upload URL comes back at once.
    r = session.post(f"{API}/jobs", json={"tasks": {
        "upload": {"operation": "import/upload", "filename": name, "file_size": size},
        "convert": {"operation": "convert", "input": "upload", "output_format": output_format},
        "export": {"operation": "export/url", "input": "convert"},
    }}, timeout=60)
    r.raise_for_status()
    job = r.json()
    upload_task = by_name(job)["upload"]
    upload = (upload_task.get("result") or {}).get("upload")
    if not upload:
        raise RuntimeError(f"upload refused: {upload_task.get('error') or upload_task.get('code')}")

    # 2. Send the file, then confirm the upload: the conversion starts right away.
    with open(path, "rb") as f:
        requests.put(upload["url"], data=f, headers={"Content-Type": "application/octet-stream"},
                     timeout=300).raise_for_status()
    session.post(f"{API}/tasks/{upload_task['id']}/upload-confirm", json={
        "s3_key": upload["s3_key"], "filename": name,
        "mime_type": "application/octet-stream", "file_size": size,
    }, timeout=60).raise_for_status()

    # 3. Wait for the job: /wait answers 200 once it is finished, 202 after about 30 s.
    while True:
        r = session.get(f"{API}/jobs/{job['id']}/wait", timeout=60)
        r.raise_for_status()
        if r.status_code == 200:
            job = r.json()
            break

    if job["status"] != "finished":
        # The task that failed first; the ones it blocked say DEPENDENCY_FAILED.
        failed = sorted((t for t in job["tasks"] if t["status"] == "error"),
                        key=lambda t: t.get("code") == "DEPENDENCY_FAILED")
        reason = (failed[0].get("error") or failed[0].get("code")) if failed else "unknown error"
        raise RuntimeError(f"job {job['id']} failed: {reason}")

    # 4. Download the result.
    result = by_name(job)["export"]["result"]["files"][0]
    data = requests.get(result["url"], timeout=300)
    data.raise_for_status()
    out = os.path.basename(result.get("filename") or "") or f"{os.path.splitext(name)[0]}.{output_format}"
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
