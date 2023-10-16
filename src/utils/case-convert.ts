export const snakeCaseToCamelCase = (str: string) => {
    return str.replace(/([-_][a-z])/g, (group) =>
        group.toUpperCase().replace("-", "").replace("_", ""),
    );
};

export const objectKeysToCamelCase = (obj: any): any => {
    // Only converts objects which are actual objects (not arrays, not null, not undefined, not numbers, etc)
    if (obj == null || typeof obj !== "object") {
        return obj;
    } else if (Array.isArray(obj)) {
        return obj.map((item) => objectKeysToCamelCase(item));
    }

    const camelCaseObj: any = {};
    // eslint-disable-next-line prefer-const
    for (let [key, value] of Object.entries(obj)) {
        if (typeof value === "object" && value != null) {
            camelCaseObj[snakeCaseToCamelCase(key)] =
                objectKeysToCamelCase(value);
            continue;
        }

        camelCaseObj[snakeCaseToCamelCase(key)] = value;
    }

    return camelCaseObj;
};
