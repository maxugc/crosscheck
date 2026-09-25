# The crosscheck MCP server (stdio), from the published npm package.
# Tools: quote, order, accept, result. Set CROSSCHECK_WALLET_KEY to pay for order and accept;
# quote, result, and tool listing work without it.
FROM node:22-alpine
RUN npm install -g crosscheckapi@0.5.2 && npm cache clean --force
USER node
ENTRYPOINT ["crosscheckapi"]
