import Link from "next/link";
import { useRouter } from "next/router";
import React, {
    ReactNode,
    createContext,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useState,
    useSyncExternalStore,
} from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { projectsService } from "@/services/projectsService";
import Dialog from "@/shared/components/Dialog";
import ProjectBar, { describeSyncState } from "@/shared/components/ProjectBar";
import { isAuthEnabled } from "@/shared/config/runtime";
import { importGuestDraft } from "@/shared/lib/project-sync/guest-import";
import type { ProjectSync, SyncState } from "@/shared/lib/project-sync/ProjectSync";
import { getProjectSync } from "@/shared/lib/project-sync/registry";
import { activateProjectScope, parseProjectId, withProjectParam } from "./storage";
import styles from "./project-scope.module.scss";

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

/** The current address with `?project=` removed (or replaced). */
const pathWithProject = (asPath: string, projectId: string | null): string => {
    const [pathAndQuery, hash] = asPath.split("#", 2);
    const [path, query = ""] = pathAndQuery.split("?", 2);
    const params = new URLSearchParams(query);
    params.delete("project");
    const rest = params.toString();
    const base = `${path}${rest ? `?${rest}` : ""}${hash ? `#${hash}` : ""}`;
    return projectId ? withProjectParam(base, projectId) : base;
};

const INITIAL_STATE: SyncState = {
    status: "loading",
    ready: false,
    name: null,
    lastSavedAt: null,
    updatedElsewhere: false,
    message: null,
};

const useSyncState = (engine: ProjectSync | null): SyncState =>
    useSyncExternalStore(
        useCallback(
            (onChange: () => void) => (engine ? engine.subscribe(onChange) : () => undefined),
            [engine],
        ),
        () => engine?.getState() ?? INITIAL_STATE,
        () => INITIAL_STATE,
    );

const ScopeMessage: React.FC<{ title: string; children?: ReactNode }> = ({ title, children }) => (
    <main className={styles.message} id="main-content" tabIndex={-1}>
        <section className={styles.card} aria-live="polite">
            <h1>{title}</h1>
            {children}
        </section>
    </main>
);

const ConflictDialog: React.FC<{ engine: ProjectSync; open: boolean; message: string | null }> = ({
    engine,
    open,
    message,
}) => {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const choose = async (choice: "theirs" | "mine" | "copy") => {
        setBusy(true);
        setError("");
        try {
            const result = await engine.resolveConflict(choice);
            if (result.copyProjectId) {
                window.location.assign(pathWithProject(router.asPath, result.copyProjectId));
            } else if (result.reload) {
                window.location.reload();
            } else {
                setBusy(false);
            }
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Не удалось выполнить действие");
            setBusy(false);
        }
    };

    return (
        <Dialog
            open={open}
            title="Проект изменён в другом месте"
            actions={
                <>
                    <button
                        data-variant="primary"
                        disabled={busy}
                        onClick={() => void choose("copy")}
                        type="button"
                    >
                        Сохранить мою версию отдельным проектом
                    </button>
                    <button disabled={busy} onClick={() => void choose("theirs")} type="button">
                        Открыть версию из аккаунта
                    </button>
                    <button disabled={busy} onClick={() => void choose("mine")} type="button">
                        Перезаписать её моей версией
                    </button>
                </>
            }
        >
            <p>
                {message ??
                    "Пока вы работали здесь, проект сохранили в другой вкладке или на другом устройстве."}
            </p>
            <p>Ваши изменения на этом устройстве пока не потеряны. Выберите, что с ними сделать.</p>
            {error ? <p role="alert">{error}</p> : null}
        </Dialog>
    );
};

/** A signed-in or anonymous guest working on the browser-only draft. */
const GuestBar: React.FC = () => {
    const router = useRouter();
    const { user } = useAuth();
    const { openAuthModal } = useAuthModal();
    const [state, setState] = useState<"idle" | "saving" | "empty" | "error">("idle");

    if (!isAuthEnabled) return null;

    const saveToAccount = async () => {
        setState("saving");
        try {
            const project = await importGuestDraft(projectsService);
            if (!project) {
                setState("empty");
                return;
            }
            void router.replace(pathWithProject(router.asPath, project.id));
        } catch {
            setState("error");
        }
    };

    return (
        <ProjectBar
            title="Черновик"
            status={
                state === "empty"
                    ? "Пока нечего сохранять — начните проект"
                    : state === "error"
                      ? "Не удалось сохранить в аккаунт"
                      : user
                        ? "Хранится только в этом браузере"
                        : "Хранится только в этом браузере — войдите, чтобы не потерять"
            }
            tone={state === "error" ? "error" : "warn"}
            action={
                user
                    ? {
                          label: state === "saving" ? "Сохраняем…" : "Сохранить в аккаунт",
                          onClick: () => void saveToAccount(),
                          disabled: state === "saving",
                      }
                    : { label: "Войти", onClick: openAuthModal }
            }
        />
    );
};

/**
 * Wraps one page of the project flow and decides where it keeps its state:
 * the browser-only guest draft, or a saved project (`?project=<id>`) that is
 * loaded from the account, edited locally and synced back automatically.
 */
const ProjectScope: React.FC<{ children: ReactNode }> = ({ children }) => {
    const router = useRouter();
    const { user, isLoading } = useAuth();
    const { openAuthModal } = useAuthModal();
    const locationProjectId = readProjectIdFromLocation();
    const engine = locationProjectId && user ? getProjectSync(locationProjectId) : null;

    // Selected during render, before the page's own effects touch storage.
    if (locationProjectId) activateProjectScope(locationProjectId, engine?.storage ?? null);
    else activateProjectScope(null);

    const state = useSyncState(engine);
    /**
     * Statically built pages know nothing about `?project=`, so the server and
     * the hydration pass render a neutral placeholder; the real page (guest or
     * project) mounts in a layout effect, before the first paint. Mounting a
     * page during hydration would let it read the wrong store.
     */
    const [hydrated, setHydrated] = useState(false);
    // Links follow only after hydration, so server and client markup agree.
    const [linkProjectId, setLinkProjectId] = useState<string | null>(null);

    useIsomorphicLayoutEffect(() => {
        const projectId = readProjectIdFromLocation();
        // Re-asserted after a previous page has unmounted.
        if (projectId) activateProjectScope(projectId, engine?.storage ?? null);
        else activateProjectScope(null);
        setLinkProjectId(projectId);
    }, [router.asPath, engine]);

    useIsomorphicLayoutEffect(() => setHydrated(true), []);

    useEffect(() => {
        void engine?.load();
    }, [engine]);

    const content = (
        <ProjectScopeContext.Provider value={linkProjectId}>
            {children}
        </ProjectScopeContext.Provider>
    );

    if (!hydrated) {
        return (
            <main className={styles.message} id="main-content" tabIndex={-1} aria-busy="true">
                <p className={styles.placeholder}>Загрузка…</p>
            </main>
        );
    }

    if (!locationProjectId) {
        return (
            <>
                <GuestBar />
                {content}
            </>
        );
    }

    if (!isAuthEnabled) {
        return (
            <ScopeMessage title="Сохранённые проекты недоступны">
                <p>Аккаунты на этом сайте сейчас выключены. Черновик можно вести без входа.</p>
                <div className={styles.actions}>
                    <Link className={styles.primary} href={pathWithProject(router.asPath, null)}>
                        Открыть черновик
                    </Link>
                </div>
            </ScopeMessage>
        );
    }

    if (isLoading) return <ScopeMessage title="Открываем проект…" />;

    if (!user) {
        return (
            <ScopeMessage title="Войдите, чтобы открыть проект">
                <p>Проекты хранятся в аккаунте. После входа он откроется здесь же.</p>
                <button className={styles.primary} onClick={openAuthModal} type="button">
                    Войти
                </button>
            </ScopeMessage>
        );
    }

    if (!engine || !state.ready) {
        if (state.status === "loading") return <ScopeMessage title="Открываем проект…" />;
        return (
            <ScopeMessage
                title={
                    state.status === "not-found" ? "Проект не найден" : "Не удалось открыть проект"
                }
            >
                <p>
                    {state.status === "not-found"
                        ? "Возможно, его удалили или ссылка относится к другому аккаунту."
                        : state.message ?? "Попробуйте ещё раз."}
                </p>
                <div className={styles.actions}>
                    {state.status !== "not-found" ? (
                        <button
                            className={styles.primary}
                            onClick={() => window.location.reload()}
                            type="button"
                        >
                            Повторить
                        </button>
                    ) : null}
                    <Link className={styles.secondary} href="/">
                        На главную
                    </Link>
                </div>
            </ScopeMessage>
        );
    }

    const { status, tone } = describeSyncState(state);
    const action =
        state.status === "auth"
            ? { label: "Войти", onClick: openAuthModal }
            : state.updatedElsewhere && state.status !== "conflict"
              ? { label: "Обновить", onClick: () => window.location.reload() }
              : state.status === "error"
                ? { label: "Повторить", onClick: () => engine.resume() }
                : undefined;

    return (
        <>
            <ProjectBar
                title={state.name ?? "Проект"}
                status={status}
                tone={tone}
                action={action}
            />
            {content}
            <ConflictDialog
                engine={engine}
                message={state.message}
                open={state.status === "conflict"}
            />
        </>
    );
};

export default ProjectScope;

export const useProjectId = (): string | null => useContext(ProjectScopeContext);

/** Builds in-app links that stay inside the open project. */
export const useProjectHref = (): ((href: string) => string) => {
    const projectId = useProjectId();
    return useCallback((href: string) => withProjectParam(href, projectId), [projectId]);
};
