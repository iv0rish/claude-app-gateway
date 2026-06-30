FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Download and verify the pinned Linux claude binary before building,
# then place it in this build context as ./claude.
COPY claude /usr/local/bin/claude
RUN chmod 0555 /usr/local/bin/claude

ENV CLAUDE_CONFIG_DIR=/tmp/.claude
EXPOSE 8080

ENTRYPOINT ["claude", "gateway", "--config", "/etc/claude/gateway.yaml"]
