import { Provider } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { EntityClassOrSchema } from "@nestjs/typeorm/dist/interfaces/entity-class-or-schema.type";
import { ObjectLiteral } from "typeorm";

export const mockCreateQueryBuilder = {
    relation: () => mockCreateQueryBuilder,
    of: () => mockCreateQueryBuilder,
    remove: () => jest.fn(),
    select: () => mockCreateQueryBuilder,
};

export const mockRepository = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    delete: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    findOneOrFail: jest.fn(),
    createQueryBuilder: () => mockCreateQueryBuilder,
};

export const getMockRepositoryProvider = <T extends EntityClassOrSchema>(
    entity: T,
): Provider => {
    return {
        provide: getRepositoryToken(entity),
        useValue: mockRepository,
    };
};
