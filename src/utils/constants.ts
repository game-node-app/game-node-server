import { join } from "path";

export enum EUserRoles {
    ADMIN = "admin",
    USER = "user",
    MOD = "mod",
}

export const publicImagesDir = join(__dirname, "..", "..", "..", "public");
