import { testEnvironment } from "./igdb/helpers/test-environment";

// Always the disposable Redis: specs must never fall back to an application REDIS_URL.
const { redis } = testEnvironment(process.env);
process.env.REDIS_URL = `redis://${redis.host}:${redis.port}`;
