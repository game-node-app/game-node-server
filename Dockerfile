FROM node:24
WORKDIR /app

# ffmpeg converts supporter profile videos; prlimit and nice come from util-linux/coreutils.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Keep dependencies inside the image instead of linking to the global worktree store.
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --config.enable-global-virtual-store=false --store-dir=/tmp/pnpm-store \
    && rm -rf /tmp/pnpm-store

# Copy source code
COPY . .

# Removes local .env to avoid conflict with docker-compose.yml
RUN rm -f .env

# Build app
RUN pnpm build

CMD ["pnpm", "start:prod"]
