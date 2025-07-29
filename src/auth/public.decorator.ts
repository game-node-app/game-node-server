import { SetMetadata } from "@nestjs/common";

/**
 * When used with {@link AuthGuard} on controllers/methods, makes authentication optional. <br>
 * User session info will still be available if the user is logged in, but will be null if not.
 * @see AuthGuard
 * @constructor
 */
export const Public = () => SetMetadata("isPublic", true);
