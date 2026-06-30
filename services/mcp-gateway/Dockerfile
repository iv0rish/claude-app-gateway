FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
COPY services/mcp-gateway/package.json services/mcp-gateway/package.json
RUN npm install

COPY services/mcp-gateway services/mcp-gateway
RUN npm --workspace services/mcp-gateway run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY services/mcp-gateway/package.json services/mcp-gateway/package.json
RUN npm install --omit=dev

COPY --from=build /app/services/mcp-gateway/dist services/mcp-gateway/dist

USER node
EXPOSE 8080
CMD ["node", "services/mcp-gateway/dist/server.js"]

