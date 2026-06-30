FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
COPY services/llm-gateway/package.json services/llm-gateway/package.json
COPY services/mcp-gateway/package.json services/mcp-gateway/package.json
RUN npm install

COPY services/llm-gateway services/llm-gateway
RUN npm --workspace services/llm-gateway run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY services/llm-gateway/package.json services/llm-gateway/package.json
COPY services/mcp-gateway/package.json services/mcp-gateway/package.json
RUN npm install --omit=dev

COPY --from=build /app/services/llm-gateway/dist services/llm-gateway/dist

USER node
EXPOSE 8080
CMD ["node", "services/llm-gateway/dist/server.js"]
