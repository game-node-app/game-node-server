import type { CorsOptions } from "@nestjs/common/interfaces/external/cors-options.interface";

/** Shared by main.ts and the auth integration spec so the preflight test checks the real config. */
export const CORS_OPTIONS: CorsOptions = {
    credentials: true,
    origin: true,
    optionsSuccessStatus: 204,
    allowedHeaders: [
        "content-type",
        "authorization",
        "capacitor-origin",
        "x-skip-oauth-proxy",
    ],
    exposedHeaders: ["set-auth-token"],
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
};
