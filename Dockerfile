FROM node:24
WORKDIR /app

# ffmpeg converts supporter profile videos; prlimit and nice come from util-linux/coreutils.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies; dropping the yarn cache keeps it out of the image layer.
COPY package.json .
COPY yarn.lock .
RUN yarn install --frozen-lockfile && yarn cache clean

# Copy source code
COPY . .

# Removes local .env to avoid conflict with docker-compose.yml
RUN rm -f .env

# Build app
RUN yarn build
