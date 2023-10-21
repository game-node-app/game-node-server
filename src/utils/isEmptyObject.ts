export default function isEmptyObject(obj: any) {
    return JSON.stringify(obj) === JSON.stringify({});
}
