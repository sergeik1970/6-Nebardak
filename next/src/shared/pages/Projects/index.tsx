import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import React, { useCallback, useEffect, useId, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { projectsService, type ProjectListItem } from "@/services/projectsService";
import Dialog from "@/shared/components/Dialog";
import Footer from "@/shared/components/Footer";
import InputText from "@/shared/components/InputText";
import Navigation from "@/shared/components/Navigation";
import { isAuthEnabled } from "@/shared/config/runtime";
import { trackGoal } from "@/shared/lib/analytics";
import { summarizeProjectDocument } from "@/shared/lib/project-scope/document";
import { withProjectParam } from "@/shared/lib/project-scope/storage";
import { importGuestDraft, readGuestDocument } from "@/shared/lib/project-sync/guest-import";
import { forgetProjectCache } from "@/shared/lib/project-sync/registry";
import {
    createEmptyProjectDocument,
    describeProject,
    formatUpdatedAt,
    projectEntryHref,
} from "./model";
import styles from "./index.module.scss";

const errorText = (caught: unknown, fallback: string) =>
    caught instanceof Error && caught.message ? caught.message : fallback;

type Pending =
    | { kind: "rename"; project: ProjectListItem }
    | { kind: "remove"; project: ProjectListItem }
    | null;

const RenameDialog: React.FC<{
    project: ProjectListItem;
    onDone: (renamed: ProjectListItem | null) => void;
}> = ({ project, onDone }) => {
    const [name, setName] = useState(project.name);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const inputId = useId();

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) {
            setError("Введите название.");
            return;
        }
        setBusy(true);
        setError("");
        try {
            onDone(await projectsService.rename(project.id, trimmed));
        } catch (caught) {
            setError(errorText(caught, "Не удалось переименовать проект"));
            setBusy(false);
        }
    };

    return (
        <Dialog
            open
            title="Переименовать проект"
            onCancel={() => onDone(null)}
            actions={
                <>
                    <button
                        data-variant="primary"
                        disabled={busy}
                        form="project-rename"
                        type="submit"
                    >
                        {busy ? "Сохраняем…" : "Сохранить"}
                    </button>
                    <button disabled={busy} onClick={() => onDone(null)} type="button">
                        Отмена
                    </button>
                </>
            }
        >
            <form className={styles.dialogForm} id="project-rename" onSubmit={submit}>
                <label htmlFor={inputId}>Название</label>
                <InputText
                    autoFocus
                    id={inputId}
                    maxLength={80}
                    onChange={(event) => setName(event.target.value)}
                    required
                    value={name}
                />
                {error ? <p role="alert">{error}</p> : null}
            </form>
        </Dialog>
    );
};

const RemoveDialog: React.FC<{
    project: ProjectListItem;
    onDone: (removed: boolean) => void;
}> = ({ project, onDone }) => {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const remove = async () => {
        setBusy(true);
        setError("");
        try {
            await projectsService.remove(project.id);
            forgetProjectCache(project.id);
            onDone(true);
        } catch (caught) {
            setError(errorText(caught, "Не удалось удалить проект"));
            setBusy(false);
        }
    };

    return (
        <Dialog
            open
            title="Удалить проект?"
            onCancel={() => onDone(false)}
            actions={
                <>
                    <button
                        data-variant="danger"
                        disabled={busy}
                        onClick={() => void remove()}
                        type="button"
                    >
                        {busy ? "Удаляем…" : "Удалить навсегда"}
                    </button>
                    <button disabled={busy} onClick={() => onDone(false)} type="button">
                        Отмена
                    </button>
                </>
            }
        >
            <p>
                «{project.name}» удалится сразу и навсегда, вместе с анкетой, чертежом и
                расстановкой. Восстановить его будет нельзя.
            </p>
            {error ? <p role="alert">{error}</p> : null}
        </Dialog>
    );
};

const GuestDraftCard: React.FC<{ onImported: (project: ProjectListItem) => void }> = ({
    onImported,
}) => {
    const [summary, setSummary] = useState<string[] | null>(null);
    const [state, setState] = useState<"idle" | "saving" | "error">("idle");

    useEffect(() => {
        const document = readGuestDocument();
        setSummary(document ? describeProject(summarizeProjectDocument(document)) : null);
    }, []);

    if (!summary) return null;

    const save = async () => {
        setState("saving");
        try {
            const project = await importGuestDraft(projectsService);
            setSummary(null);
            if (project) onImported(project);
        } catch {
            setState("error");
        }
    };

    return (
        <section className={styles.guestDraft} aria-labelledby="guest-draft-title">
            <div>
                <h2 id="guest-draft-title">Черновик в этом браузере</h2>
                <p>{summary.join(" · ")}</p>
                {state === "error" ? (
                    <p role="alert">Не удалось сохранить черновик. Попробуйте ещё раз.</p>
                ) : null}
            </div>
            <div className={styles.cardActions}>
                <button
                    className={styles.primary}
                    disabled={state === "saving"}
                    onClick={() => void save()}
                    type="button"
                >
                    {state === "saving" ? "Сохраняем…" : "Сохранить в аккаунт"}
                </button>
                <Link className={styles.secondary} href="/questionnaire">
                    Открыть
                </Link>
            </div>
        </section>
    );
};

const ProjectList: React.FC = () => {
    const router = useRouter();
    const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
    const [limit, setLimit] = useState(50);
    const [loadError, setLoadError] = useState("");
    const [actionError, setActionError] = useState("");
    const [busyId, setBusyId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [pending, setPending] = useState<Pending>(null);

    const load = useCallback(async () => {
        setLoadError("");
        try {
            const result = await projectsService.list();
            setProjects(result.projects);
            setLimit(result.limit);
        } catch (caught) {
            setLoadError(errorText(caught, "Не удалось загрузить проекты"));
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const create = async () => {
        setCreating(true);
        setActionError("");
        try {
            const document = createEmptyProjectDocument();
            const project = await projectsService.create({
                document,
                summary: summarizeProjectDocument(document),
            });
            trackGoal("project_created");
            await router.push(withProjectParam("/test", project.id));
        } catch (caught) {
            setActionError(errorText(caught, "Не удалось создать проект"));
            setCreating(false);
        }
    };

    const duplicate = async (project: ProjectListItem) => {
        setBusyId(project.id);
        setActionError("");
        try {
            await projectsService.duplicate(project.id);
            await load();
        } catch (caught) {
            setActionError(errorText(caught, "Не удалось скопировать проект"));
        } finally {
            setBusyId(null);
        }
    };

    const atLimit = projects !== null && projects.length >= limit;

    return (
        <>
            <div className={styles.toolbar}>
                <p className={styles.count} aria-live="polite">
                    {projects ? `${projects.length} из ${limit}` : ""}
                </p>
                <button
                    className={styles.primary}
                    disabled={creating || atLimit || projects === null}
                    onClick={() => void create()}
                    type="button"
                >
                    {creating ? "Создаём…" : "Новый проект"}
                </button>
            </div>
            {atLimit ? (
                <p className={styles.notice}>
                    Достигнут лимит в {limit} проектов. Удалите ненужные, чтобы создать новый.
                </p>
            ) : null}
            {actionError ? (
                <p className={styles.error} role="alert">
                    {actionError}
                </p>
            ) : null}

            <GuestDraftCard onImported={() => void load()} />

            {loadError ? (
                <section className={styles.empty}>
                    <p role="alert">{loadError}</p>
                    <button className={styles.secondary} onClick={() => void load()} type="button">
                        Повторить
                    </button>
                </section>
            ) : projects === null ? (
                <p className={styles.muted}>Загружаем проекты…</p>
            ) : projects.length === 0 ? (
                <section className={styles.empty}>
                    <h2>Проектов пока нет</h2>
                    <p>
                        Начните с теста стиля или сразу с анкеты: всё, что вы сделаете, сохранится
                        здесь автоматически.
                    </p>
                </section>
            ) : (
                <ul className={styles.list} aria-label="Проекты">
                    {projects.map((project) => (
                        <li className={styles.card} key={project.id} data-project-card="true">
                            <div className={styles.cardBody}>
                                <h2>
                                    <Link href={projectEntryHref(project.id, project.summary)}>
                                        {project.name}
                                    </Link>
                                </h2>
                                <p>{describeProject(project.summary).join(" · ")}</p>
                                <p className={styles.muted}>
                                    Изменён {formatUpdatedAt(project.updatedAt)}
                                </p>
                            </div>
                            <div className={styles.cardActions}>
                                <button
                                    className={styles.linkButton}
                                    disabled={busyId === project.id}
                                    onClick={() => setPending({ kind: "rename", project })}
                                    type="button"
                                    aria-label={`Переименовать «${project.name}»`}
                                >
                                    Переименовать
                                </button>
                                <button
                                    className={styles.linkButton}
                                    disabled={busyId === project.id || atLimit}
                                    onClick={() => void duplicate(project)}
                                    type="button"
                                    aria-label={`Сделать копию «${project.name}»`}
                                >
                                    {busyId === project.id ? "Копируем…" : "Копия"}
                                </button>
                                <button
                                    className={`${styles.linkButton} ${styles.dangerLink}`}
                                    disabled={busyId === project.id}
                                    onClick={() => setPending({ kind: "remove", project })}
                                    type="button"
                                    aria-label={`Удалить «${project.name}»`}
                                >
                                    Удалить
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {pending?.kind === "rename" ? (
                <RenameDialog
                    project={pending.project}
                    onDone={(renamed) => {
                        setPending(null);
                        if (renamed) {
                            setProjects(
                                (current) =>
                                    current?.map((item) =>
                                        item.id === renamed.id ? { ...item, ...renamed } : item,
                                    ) ?? current,
                            );
                        }
                    }}
                />
            ) : null}
            {pending?.kind === "remove" ? (
                <RemoveDialog
                    project={pending.project}
                    onDone={(removed) => {
                        const removedId = pending.project.id;
                        setPending(null);
                        if (removed) {
                            setProjects(
                                (current) =>
                                    current?.filter((item) => item.id !== removedId) ?? current,
                            );
                        }
                    }}
                />
            ) : null}
        </>
    );
};

const Projects: React.FC = () => {
    const { user, isLoading } = useAuth();
    const { openAuthModal } = useAuthModal();

    const renderContent = () => {
        if (!isAuthEnabled) {
            return (
                <p className={styles.muted}>
                    Аккаунты сейчас отключены. Проект можно вести без входа —{" "}
                    <Link href="/questionnaire">открыть черновик</Link>.
                </p>
            );
        }
        if (isLoading) return <p className={styles.muted}>Загружаем…</p>;
        if (!user) {
            return (
                <section className={styles.empty}>
                    <h2>Войдите, чтобы увидеть проекты</h2>
                    <p>Проекты хранятся в аккаунте и открываются с любого устройства.</p>
                    <button className={styles.primary} onClick={openAuthModal} type="button">
                        Войти
                    </button>
                </section>
            );
        }
        return <ProjectList />;
    };

    return (
        <div className={styles.page}>
            <Head>
                <title>Мои проекты · StyleFinder</title>
                <meta name="robots" content="noindex, nofollow" />
            </Head>
            <Navigation />
            <main id="main-content" className={styles.main} tabIndex={-1}>
                <div className={styles.container}>
                    <h1>Мои проекты</h1>
                    {renderContent()}
                </div>
            </main>
            <Footer />
        </div>
    );
};

export default Projects;
