import { Provider } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { EntityClassOrSchema } from "@nestjs/typeorm/dist/interfaces/entity-class-or-schema.type";
import { Repository } from "typeorm";

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
    save: jest.fn(async () => {}),
    update: jest.fn(),
    findOneOrFail: jest.fn(),
    findAndCount: jest.fn(),
    countBy: jest.fn(),
    exist: jest.fn(),
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

/**
 * A getMockRepositoryProvider utility shorthand for multiple repositories
 * @usage providers: [...getMockRepositoriesProviders([Entity1, Entity2, Entity3])],
 * @param entities
 */
export const getMockRepositoriesProviders = <T extends EntityClassOrSchema[]>(
    entities: T,
): Provider[] => {
    return entities.map((entity): Provider => {
        return getMockRepositoryProvider(entity);
    });
};
