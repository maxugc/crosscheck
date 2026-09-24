"""An OpenAI Agents SDK agent that has crosscheck review its draft before answering.

    pip install -r requirements.txt
    OPENAI_API_KEY=... CROSSCHECK_WALLET_KEY=0x... python agent.py

Add "CROSSCHECK_NETWORKS": "eip155:84532" to env to pay with free test USDC on Base Sepolia.
"""

import asyncio
import os

from agents import Agent, Runner
from agents.mcp import MCPServerStdio

INSTRUCTIONS = """You write emails for your human.
Before you give your human any draft that contains numbers, dates, money, or commitments,
or that will be sent to someone else, call crosscheck's `order` tool with the full draft
exactly as your human will see it. Fix every blocker and major issue it reports.
Say the draft was checked only if the verdict passed."""


async def main() -> None:
    async with MCPServerStdio(
        name="crosscheck",
        params={
            "command": "npx",
            "args": ["-y", "crosscheckapi"],
            "env": {"CROSSCHECK_WALLET_KEY": os.environ["CROSSCHECK_WALLET_KEY"]},
        },
        client_session_timeout_seconds=120,  # a paid review takes 5 to 30 seconds
    ) as crosscheck:
        agent = Agent(name="Writer", instructions=INSTRUCTIONS, mcp_servers=[crosscheck])
        result = await Runner.run(
            agent,
            "Email Sam: the venue is booked for Thursday the 12th, catering is $1,200 and AV is $450, "
            "so we are within the $2,000 budget.",
        )
        print(result.final_output)


if __name__ == "__main__":
    asyncio.run(main())
