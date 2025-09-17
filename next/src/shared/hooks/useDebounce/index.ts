import debounce, { DebouncedFunc } from "./debounce";
import { useLatest } from "./useLatest";
import { useMemo } from "react";

const useDebounce = <T extends (...args: any) => any>(cb: T, ms: number): DebouncedFunc<T> => {
    const latestCb = useLatest(cb);

    return useMemo(() => {
        return debounce(latestCb.current, ms);
    }, [ms, latestCb]);
};

export default useDebounce;
