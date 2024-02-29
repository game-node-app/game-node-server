export const dataSourceMock = {
    getRepository: jest.fn(() => {
        console.warn(
            "getRepository of dataSourceMock is being called and not being mocked. This is probably going to result in errors.",
        );
    }),
};
