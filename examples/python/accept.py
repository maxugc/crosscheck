"""Check work another agent handed back before you pay for it or pass it on.

    pip install -r requirements.txt
    CROSSCHECK_WALLET_KEY=0x... python accept.py task.txt deliverable.txt
"""

import asyncio
import sys

from pay import post_and_wait


async def main(task_file: str, deliverable_file: str) -> int:
    out = await post_and_wait(
        "https://crosscheckapi.com/v1/accept",
        {"task": open(task_file, encoding="utf-8").read(), "deliverable": open(deliverable_file, encoding="utf-8").read()},
    )
    v = out["verdict"]
    print("ACCEPT" if v["accept"] else "REJECT", "-", v["summary"])
    for r in v["requirements"]:
        print(f"  {'x' if r['blocking'] else 'ok'} {r['met']:<11} {r['requirement']}: {r['evidence']}")
    print("proof:", out.get("share_url"))
    return 0 if v["accept"] else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1], sys.argv[2])))
