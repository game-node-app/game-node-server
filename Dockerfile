FROM node:18
WORKDIR /app

# Install dependencies

COPY package.json .
COPY yarn.lock .
RUN yarn install

# Copy source code
COPY . .

RUN rm -f .env

# Build app
RUN yarn build

# Do not start the application here, since env variables are not yet loaded.