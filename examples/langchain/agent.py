"""A LangChain agent that has crosscheck review its draft before answering.

    pip install -r requirements.txt
    ANTHROPIC_API_KEY=... CROSSCHECK_WALLET_KEY=0x... python agent.py

Any chat model works; change MODEL to your provider (for example "openai:gpt-5").
Add "CROSSCHECK_NETWORKS": "eip155:84532" to env to pay with free test USDC on Base Sepolia.
"""

import asyncio
import os

from langchain.agents import create_agent
from langchain_mcp_adapters.client import MultiServerMCPClient

MODEL = "anthropic:claude-sonnet-5"
INSTRUCTIONS = """You write emails for your human.
Before you give your human any draft that contains numbers, dates, money, or commitments,
or that will be sent to someone else, call crosscheck's `order` tool with the full draft
exactly as your human will see it. Fix every blocker and major issue it reports.
Say the draft was checked only if the verdict passed."""


async def main() -> None:
    client = MultiServerMCPClient(
        {
            "crosscheck": {
                "transport": "stdio",
                "command": "npx",
                "args": ["-y", "crosscheckapi"],
                "env": {"CROSSCHECK_WALLET_KEY": os.environ["CROSSCHECK_WALLET_KEY"]},
            }
        }
    )
    agent = create_agent(MODEL, await client.get_tools(), system_prompt=INSTRUCTIONS)
    result = await agent.ainvoke(
        {
            "messages": [
                {
                    "role": "user",
                    "content": "Email Sam: the venue is booked for Thursday the 12th, catering is $1,200 "
                    "and AV is $450, so we are within the $2,000 budget.",
                }
            ]
        }
    )
    print(result["messages"][-1].content)


if __name__ == "__main__":
    asyncio.run(main())
