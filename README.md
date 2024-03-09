<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="200" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456

[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://coveralls.io/github/nestjs/nest?branch=master" target="_blank"><img src="https://coveralls.io/repos/github/nestjs/nest/badge.svg?branch=master#9" alt="Coverage" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

A NestJS API responsible for handling all GameNode requests.

## Docker

You can use the `docker-compose.yml` file in the root folder to start a local instance of GameNode.  
It will automatically set up a Supertokens instance, the NestJS server, a MySQL database and a Redis instance.  
If you are looking to self-host GameNode (server), this is the easiest way to do it.

#### Important:

You still need to set up `.env` file. Most of the docker-compose parameters come from it.
See [Installation](#installation) for more details.

#### Migrations and Docker

The default docker-compose files will **not** run migrations automatically.    
Migrations are dangerous and should be run manually, after checking each generated migration file.

You can attach to any running gamenode container and run the migrations manually:

```bash
$ docker exec -it gamenode_server_1 bash # Replace gamenode_server_1 with your container name
$ yarn migration:generate
# ...manually check the generated migration file (use Vim/Nano or docker cp to host)
$ yarn migration:run
# No need to restart the container, changes are made directly to MySQL.
```

If you are developing locally, you can use this command to spin up your containers and start the server:

```bash
$ yarn start:dev:docker # docker compose up -d && yarn start:dev
```

You can also attach your editor to the Docker container if it supports remote development (like VS Code, IntelliJ IDEA,
etc.).

The provided MySQL instance will hold all data for both GameNode Server itself and from Supertokens.

Bugs and issues related to migrations are not covered by support, and should instead be reported to
the [TypeORM team](https://github.com/typeorm/typeorm).

## Installation

```bash
$ yarn
```

Use the `.env.example` file as an example for your own `.env` file.  
All parameters are required.


You will also need to install MySQL, Redis and have a Supertokens instance running.
You can use a managed version of all of these services.

### SuperTokens

Hosting your own instance of Supertokens is not required for local development.
You can instead use their public instance url:

```dotenv
SUPERTOKENS_CORE_URI=https://try.supertokens.io
```

### Database

After setting up your database credentials in `.env`, run the migrations:

```bash
$ yarn typeorm:migration:generate
$ yarn typeorm:migration:run
```

We use TypeORM to handle everything related to database. You only need to run migrations when changing the models (
.entity.ts) files, or when you first start the app.

#### Important

ALWAYS check your migrations before running them. Typeorm may sometimes drop important tables and columns.

### IGDB

GameNode's games are powered by IGDB metadata. To use it, you need to set
up [game-node-sync](https://github.com/game-node-app/game-node-sync).

## Running the app

```bash
# development
$ yarn start

# watch mode
$ yarn start:dev

# production mode
$ yarn start:prod
```

## Test

```bash
# unit tests
$ yarn test

# e2e tests
$ yarn test:e2e

# test coverage
$ yarn test:cov
```

Keep in mind that you can't (they won't show in SwaggerDocs) test Supertokens protected routes without a valid session
token.  
This makes integration testing a tad difficult.

## Support

Feel free to reach out to us through a Github Issue. We can help you set up your own instance of GameNode,
or help you with any other issue you might have.

PS: If you have issues with overral app usage, please fill an issue in the corresponding repository.  
For example, if you have issues with the GameNode website, fill an issue in the `game-node-web` repository.
