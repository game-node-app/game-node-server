import { createParamDecorator } from "@nestjs/common";
import { SessionContainer } from "supertokens-node/recipe/session";
import ThirdPartyPasswordless from "supertokens-node/recipe/thirdpartypasswordless";

export type User = ThirdPartyPasswordless.User;

export const User = createParamDecorator(async (data, req) => {
    const session: SessionContainer = req.session;
    return await ThirdPartyPasswordless.getUserById(session.getUserId());
});
