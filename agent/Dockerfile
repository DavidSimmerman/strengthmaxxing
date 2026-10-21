FROM node:22-slim

# The coach agent talks to the model through the `claude` CLI (personal Claude
# subscription). Install it globally so `claude -p ... --output-format json` is
# on PATH inside the container.
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# No third-party runtime deps (stdlib only), so just copy the source.
COPY package.json ./
COPY server.js ./

ENV PORT=8787
EXPOSE 8787

# AUTH — pick ONE at deploy time (Coolify):
#   (a) Personal subscription: CLAUDE_CODE_OAUTH_TOKEN=<output of `claude setup-token`>.
#   (b) API key: ANTHROPIC_API_KEY=sk-ant-... (falls back to the Messages API).
# Optional: AGENT_MODEL (default claude-opus-5-5), AGENT_EFFORT (default medium).
CMD ["node", "server.js"]
