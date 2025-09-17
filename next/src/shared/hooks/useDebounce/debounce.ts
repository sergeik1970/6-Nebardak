export interface DebouncedFunc<T extends (...args: any[]) => any> {
    (...args: Parameters<T>): ReturnType<T> | void;
}

export default function debounce<T extends (...args: any) => any>(
    func: T,
    timeout = 100,
): DebouncedFunc<T> {
    let timer: any;

    return function (...args) {
        clearTimeout(timer);

        timer = setTimeout(() => {
            // @ts-ignore
            func.apply(this, args);
        }, timeout);
    };
}
