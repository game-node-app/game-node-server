FROM node:24
WORKDIR /app

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
