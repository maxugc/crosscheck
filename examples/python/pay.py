"""Shared setup for the Python examples: an httpx client that pays x402 challenges from your
wallet, only on the networks you allow and never above $0.10 a call.

Set CROSSCHECK_NETWORKS=eip155:84532 to pay with free test USDC on Base Sepolia.
"""

import asyncio
import os

import httpx
from eth_account import Account
from x402 import max_amount, prefer_network, x402Client
from x402.http.clients import x402HttpxClient

from x402.mechanisms.evm.exact.register import register_exact_evm_client

NETWORKS = [n.strip() for n in os.environ.get("CROSSCHECK_NETWORKS", "eip155:8453").split(",")]


def paying_client() -> x402HttpxClient:
    payer = x402Client()
    register_exact_evm_client(payer, Account.from_key(os.environ["CROSSCHECK_WALLET_KEY"]), networks=NETWORKS)
    for network in reversed(NETWORKS):
        payer.register_policy(prefer_network(network))
    payer.register_policy(max_amount(100_000))  # never more than $0.10 (USDC has 6 decimals)
    return x402HttpxClient(payer, timeout=120)


async def post_and_wait(url: str, body: dict) -> dict:
    """POST a paid request and wait for the result (a 202 means paid and queued)."""
    async with paying_client() as http:
        res = await http.post(url, json=body)
    out = res.json()
    if res.status_code not in (200, 202):
        raise RuntimeError(f"crosscheck returned {res.status_code}: {out}")
    result_url, token = out.get("result_url"), out.get("result_token")
    async with httpx.AsyncClient(timeout=30) as plain:
        while out.get("status") == "pending":
            await asyncio.sleep(out.get("retry_after_seconds", 5))
            out = (await plain.get(result_url, headers={"authorization": f"Bearer {token}"})).json()
    return out
