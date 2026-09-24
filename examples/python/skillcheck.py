"""Security-check a skill or MCP server folder before you install it. Free if someone already
scanned these exact files; otherwise it pays about $0.03.

    pip install -r requirements.txt
    CROSSCHECK_WALLET_KEY=0x... python skillcheck.py path/to/skill
"""

import asyncio
import hashlib
import json
import os
import sys

import httpx

from pay import post_and_wait

SKIP = {"node_modules", ".git", "dist", "build", "__pycache__", ".venv"}


def read_files(folder: str) -> list[dict]:
    files = []
    for root, dirs, names in os.walk(folder):
        dirs[:] = sorted(d for d in dirs if d not in SKIP)
        for name in sorted(names):
            data = open(os.path.join(root, name), "rb").read()
            if b"\x00" in data or len(data) > 200_000:
                continue  # binary or too large
            path = os.path.relpath(os.path.join(root, name), folder).replace(os.sep, "/")
            files.append({"path": path, "content": data.decode("utf-8")})
    return files


def bundle_sha256(files: list[dict]) -> str:
    """SHA-256 of the canonical JSON list of {path, sha256}, sorted by path."""
    sha = lambda s: hashlib.sha256(s.encode("utf-8")).hexdigest()
    entries = sorted(({"path": f["path"], "sha256": sha(f["content"])} for f in files), key=lambda e: e["path"])
    return sha(json.dumps(entries, separators=(",", ":"), ensure_ascii=False))


async def main(folder: str) -> int:
    files = read_files(folder)
    async with httpx.AsyncClient(timeout=30) as plain:
        known = await plain.get(f"https://crosscheckapi.com/v1/skillcheck/{bundle_sha256(files)}")
    if known.status_code == 200:
        v = known.json().get("verdict") or known.json()
        print("(already scanned)", end=" ")
    else:
        v = (await post_and_wait("https://crosscheckapi.com/v1/skillcheck", {"files": files}))["verdict"]
    print(f"risk: {v['risk']}. {v.get('summary', '')}")
    for f in v.get("findings", []):
        print(f"  {f['severity']:<8} {f['category']:<20} {f['file']}: {f['explanation']}")
    return 1 if v["risk"] in ("critical", "high") else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1])))
