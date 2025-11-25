export type NonArrayKeys<T> = {
    [K in keyof T]: T[K] extends any[] ? never : K;
}[keyof T] &
    keyof T;

export type ArrayKeys<T> = {
    [K in keyof T]: T[K] extends any[] ? K : never;
}[keyof T] &
    keyof T;
