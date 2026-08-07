# NullCity demo image.
#
# Builds the whole pnpm workspace from source inside the container (no host
# node_modules or dist are copied in — see .dockerignore) and produces one
# image that can run either the public server or the built Command Center
# static bundle, selected by the command in docker-compose.yml.
#
# This image is for the local one-command demo path (`docker compose up`),
# not a minimal/production-hardened distroless image: it intentionally keeps
# devDependencies (Vite, TypeScript) so the same image can also serve the
# Command Center's `vite preview` process without a second build stage.
FROM node:20-slim AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
COPY scenarios ./scenarios
COPY templates ./templates

RUN pnpm install --frozen-lockfile
RUN pnpm -r build
RUN pnpm --filter @null-city/command-center build

FROM node:20-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app ./

EXPOSE 8787 4173

# Overridden per-service by docker-compose.yml; this default runs the
# public server standalone (`docker run <image>`).
CMD ["node", "packages/server/dist/cli/start.js"]
