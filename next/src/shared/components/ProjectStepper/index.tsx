import Link from "next/link";
import { useRouter } from "next/router";
import React, { useEffect, useState } from "react";
import { readProjectDocument } from "@/shared/lib/project-scope/document";
import {
    PROJECT_STEPS,
    getProjectProgress,
    type ProjectProgress,
    type ProjectStepId,
} from "@/shared/lib/project-scope/progress";
import {
    getProjectStorage,
    subscribeProjectStorage,
    withProjectParam,
} from "@/shared/lib/project-scope/storage";
import styles from "./index.module.scss";

/** Pages write on every keystroke; the steps only need to catch up shortly after. */
const REFRESH_DELAY_MS = 300;

const readProgress = (): ProjectProgress => {
    const storage = getProjectStorage();
    // Reading an old draft migrates it in place; that is the page's job (it
    // tells the person about the migration), so the steps only look.
    const result = readProjectDocument(
        storage && {
            getItem: (key) => storage.getItem(key),
            setItem: () => undefined,
            removeItem: () => undefined,
        },
    );
    return getProjectProgress(result.status === "success" ? result.value : null);
};

/** Recomputed whenever a page of the flow writes to the open project. */
export const useProjectProgress = (): ProjectProgress | null => {
    const [progress, setProgress] = useState<ProjectProgress | null>(null);

    useEffect(() => {
        setProgress(readProgress());
        let timer: number | undefined;
        const unsubscribe = subscribeProjectStorage(() => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => setProgress(readProgress()), REFRESH_DELAY_MS);
        });
        return () => {
            window.clearTimeout(timer);
            unsubscribe();
        };
    }, []);

    return progress;
};

const CURRENT_STEP_BY_PATH: Record<string, ProjectStepId> = {
    "/test": "style",
    "/questionnaire": "plan",
    "/planner": "plan",
    "/planner/draw": "plan",
    "/planner/layout": "plan",
};

/** «Стиль → Планировка → Итог» above every step of a project. */
const ProjectStepper: React.FC<{ projectId: string | null }> = ({ projectId }) => {
    const router = useRouter();
    const progress = useProjectProgress();
    const current = CURRENT_STEP_BY_PATH[router.pathname];

    return (
        <nav aria-label="Шаги проекта" className={styles.stepper} data-project-stepper="true">
            <ol>
                {PROJECT_STEPS.map((step, index) => {
                    const state = progress?.[step.id];
                    const isCurrent = step.id === current;
                    const marker = state?.done && !isCurrent ? "✓" : String(index + 1);
                    const content = (
                        <>
                            <span className={styles.marker} aria-hidden="true">
                                {marker}
                            </span>
                            <span className={styles.label}>{step.label}</span>
                            {state?.done ? <span className={styles.srOnly}> — готово</span> : null}
                        </>
                    );
                    const status = isCurrent
                        ? "current"
                        : state?.done
                          ? "done"
                          : state && !state.available
                            ? "locked"
                            : "open";

                    return (
                        <li key={step.id} data-step={step.id} data-status={status}>
                            {isCurrent ? (
                                <span aria-current="step" className={styles.step}>
                                    {content}
                                </span>
                            ) : state && !state.available ? (
                                <span
                                    aria-disabled="true"
                                    className={styles.step}
                                    title={state.hint}
                                >
                                    {content}
                                    {state.hint ? (
                                        <span className={styles.srOnly}>. {state.hint}</span>
                                    ) : null}
                                </span>
                            ) : (
                                <Link
                                    className={styles.step}
                                    href={withProjectParam(step.href, projectId)}
                                >
                                    {content}
                                </Link>
                            )}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
};

export default ProjectStepper;
