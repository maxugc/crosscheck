"""Check a draft with crosscheck from Python, paying over x402 with your own wallet.

    pip install -r requirements.txt
    CROSSCHECK_WALLET_KEY=0x... python check.py ../draft.txt

Set CROSSCHECK_NETWORKS=eip155:84532 to pay with free test USDC on Base Sepolia.
"""

import asyncio
import json
import os
import sys

import httpx
from eth_account import Account
from x402 import max_amount, prefer_network, x402Client
from x402.http.clients import x402HttpxClient
from x402.mechanisms.evm.exact.register import register_exact_evm_client

URL = "https://crosscheckapi.com/v1/check"
# Networks you will pay on, in order of preference. Default: Base.
NETWORKS = [n.strip() for n in os.environ.get("CROSSCHECK_NETWORKS", "eip155:8453").split(",")]
MAX_ATOMIC = 100_000  # never pay more than $0.10 (USDC has 6 decimals)


async def check(draft: str) -> dict:
    payer = x402Client()
    # Pay only on NETWORKS, and refuse anything above MAX_ATOMIC.
    register_exact_evm_client(payer, Account.from_key(os.environ["CROSSCHECK_WALLET_KEY"]), networks=NETWORKS)
    for network in reversed(NETWORKS):
        payer.register_policy(prefer_network(network))
    payer.register_policy(max_amount(MAX_ATOMIC))

    async with x402HttpxClient(payer, timeout=120) as http:
        res = await http.post(URL, json={"draft": draft})
    body = res.json()
    if res.status_code not in (200, 202):
        raise RuntimeError(f"crosscheck returned {res.status_code}: {body}")

    # 202 means paid and queued. Poll the result with the token (free).
    url, token = body.get("result_url"), body.get("result_token")
    async with httpx.AsyncClient(timeout=30) as plain:
        while body.get("status") == "pending":
            await asyncio.sleep(body.get("retry_after_seconds", 5))
            body = (await plain.get(url, headers={"authorization": f"Bearer {token}"})).json()
    return body


if __name__ == "__main__":
    text = open(sys.argv[1], encoding="utf-8").read() if len(sys.argv) > 1 else sys.stdin.read()
    result = asyncio.run(check(text))
    verdict = result.get("verdict", result)
    print(json.dumps(verdict, indent=2))
    sys.exit(0 if verdict.get("pass") else 1)
