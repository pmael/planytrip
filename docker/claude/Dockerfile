# The Claude Code CLI, alone in a container, for PlanyTrip's AI calls (TRIP_CLAUDE_MODE=docker).
# Build it with `npm run claude:image`. It holds no login: the token is handed to each run as an
# environment variable (CLAUDE_CODE_OAUTH_TOKEN, from `claude setup-token`).
FROM node:22-slim

# Pin a version with --build-arg CLAUDE_CODE_VERSION=2.1.302
ARG CLAUDE_CODE_VERSION=latest
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force

# Not root, and nothing to update itself or phone home about
USER node
ENV HOME=/home/node \
    DISABLE_AUTOUPDATER=1
WORKDIR /tmp

ENTRYPOINT ["claude"]
