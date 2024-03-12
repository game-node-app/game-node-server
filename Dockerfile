FROM node:20
WORKDIR /app

# Install dependencies
COPY package.json .
COPY yarn.lock .
RUN yarn install

# Copy source code
COPY . .

# Removes local .env to avoid conflict with docker-compose.yml
RUN rm -f .env

# Build app
RUN yarn build