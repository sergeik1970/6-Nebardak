import { useRouter } from "next/router";
import React, {
    ReactNode,
    createContext,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useState,
} from "react";
import { activateProjectScope, parseProjectId, withProjectParam } from "./storage";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const ProjectScopeContext = createContext<string | null>(null);

/**
 * The project in the address bar. Read from `window.location` because a
 * statically optimised page renders before Next.js fills `router.query`.
 */
const readProjectIdFromLocation = (): string | null =>
    typeof window === "undefined"
        ? null
        : parseProjectId(new URLSearchParams(window.location.search).get("project"));

/**
 * Wraps one page of the project flow. The scope is selected during render, so
 * it is already in place when the page's own effects first touch storage;
 * the layout effect re-asserts it after a previous page has unmounted.
 */
const ProjectScope: React.FC<{ children: ReactNode }> = ({ children }) => {
    const router = useRouter();
    const locationProjectId = readProjectIdFromLocation();
    activateProjectScope(locationProjectId);

    // Links follow only after hydration, so server and client markup agree.
    const [linkProjectId, setLinkProjectId] = useState<string | null>(null);

    useIsomorphicLayoutEffect(() => {
        const projectId = readProjectIdFromLocation();
        activateProjectScope(projectId);
        setLinkProjectId(projectId);
    }, [router.asPath]);

    return (
        <ProjectScopeContext.Provider value={linkProjectId}>
            {children}
        </ProjectScopeContext.Provider>
    );
};

export default ProjectScope;

export const useProjectId = (): string | null => useContext(ProjectScopeContext);

/** Builds in-app links that stay inside the open project. */
export const useProjectHref = (): ((href: string) => string) => {
    const projectId = useProjectId();
    return useCallback((href: string) => withProjectParam(href, projectId), [projectId]);
};
