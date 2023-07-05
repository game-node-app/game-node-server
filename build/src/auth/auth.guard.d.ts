import { CanActivate, ExecutionContext } from "@nestjs/common";
import { VerifySessionOptions } from "supertokens-node/recipe/session";
export declare class AuthGuard implements CanActivate {
    private readonly verifyOptions?;
    constructor(verifyOptions?: VerifySessionOptions | undefined);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
