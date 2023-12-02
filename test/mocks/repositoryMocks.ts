export const mockCreateQueryBuilder = () => ({
    relation: () => mockCreateQueryBuilder,
    of: () => mockCreateQueryBuilder,
    remove: () => jest.fn(),
    select: () => mockCreateQueryBuilder,
});

export const mockRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    delete: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: () => mockCreateQueryBuilder,
};
