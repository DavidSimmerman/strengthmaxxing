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
#   (a) CLI / personal subscription: mount the user's credentials dir into the
#       container so the CLI is authenticated, e.g. bind-mount the host
#       ~/.claude  ->  /root/.claude  (the CLI reads its OAuth creds from there).
#   (b) API key: set the env var  ANTHROPIC_API_KEY=sk-ant-...  and the service
#       falls back to the Anthropic Messages API automatically.
# Optional: AGENT_MODEL (default claude-opus-4-8), PORT (default 8787).
CMD ["node", "server.js"]
