import { join } from "path";

export enum EUserRoles {
    ADMIN = "admin",
    USER = "user",
    MOD = "mod",
}

export const publicUploadDir = join(
    __dirname,
    "..",
    "..",
    "..",
    "public",
    "uploads",
);
