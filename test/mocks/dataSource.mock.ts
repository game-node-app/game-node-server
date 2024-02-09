import { ObjectLiteral } from "typeorm";

export const dataSourceMock = {
    getRepository: jest.fn((entity: ObjectLiteral) => {
        return structuredClone();
    }),
};
