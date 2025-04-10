import { join } from "path";

export enum EUserRoles {
    ADMIN = "admin",
    USER = "user",
    MOD = "mod",
    EDITOR = "editor",
}

export const publicImagesDir = join(__dirname, "..", "..", "..", "public");
