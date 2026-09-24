"""crosscheck as an output guardrail for the OpenAI Agents SDK.

Every final answer the agent produces is sent to crosscheck before it reaches your
human. If the verdict does not pass, the guardrail trips and the run raises
OutputGuardrailTripwireTriggered with the issues in output_info, so you can fix
the draft or show the issues instead.

    pip install -r requirements.txt "x402[httpx,evm]"
    OPENAI_API_KEY=... CROSSCHECK_WALLET_KEY=0x... python guardrail.py

Set CROSSCHECK_NETWORKS=eip155:84532 to pay with free test USDC on Base Sepolia.
"""

import asyncio
import os

from eth_account import Account
from x402 import max_amount, prefer_network, x402Client
from x402.http.clients import x402HttpxClient
from x402.mechanisms.evm.exact.register import register_exact_evm_client

from agents import Agent, GuardrailFunctionOutput, OutputGuardrailTripwireTriggered, Runner, output_guardrail

NETWORKS = [n.strip() for n in os.environ.get("CROSSCHECK_NETWORKS", "eip155:8453").split(",")]


async def crosscheck_draft(draft: str) -> dict:
    payer = x402Client()
    register_exact_evm_client(payer, Account.from_key(os.environ["CROSSCHECK_WALLET_KEY"]), networks=NETWORKS)
    for network in reversed(NETWORKS):
        payer.register_policy(prefer_network(network))
    payer.register_policy(max_amount(100_000))  # never more than $0.10
    async with x402HttpxClient(payer, timeout=120) as http:
        res = await http.post("https://crosscheckapi.com/v1/check", json={"draft": draft})
    body = res.json()
    if res.status_code != 200:
        # 202 means queued; for a guardrail, treat anything but a finished verdict as a failed check.
        return {"pass": False, "summary": f"crosscheck returned {res.status_code}", "issues": []}
    return {**body["verdict"], "share_url": body.get("share_url")}


@output_guardrail
async def crosscheck_guardrail(ctx, agent, output) -> GuardrailFunctionOutput:
    verdict = await crosscheck_draft(str(output))
    return GuardrailFunctionOutput(output_info=verdict, tripwire_triggered=not verdict["pass"])


writer = Agent(
    name="Writer",
    instructions="You write short emails for your human.",
    output_guardrails=[crosscheck_guardrail],
)


async def main() -> None:
    try:
        result = await Runner.run(writer, "Email Sam: catering is $1,200 and AV is $450, so the total is $1,560.")
        print(result.final_output)
    except OutputGuardrailTripwireTriggered as e:
        verdict = e.guardrail_result.output.output_info
        print("crosscheck stopped this draft:", verdict["summary"])
        for issue in verdict["issues"]:
            print(f"  {issue['severity']}: {issue['problem']}")


if __name__ == "__main__":
    asyncio.run(main())
