import Link from "next/link";
import React, { useId, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { isAuthEnabled } from "@/shared/config/runtime";
import InputText from "@/shared/components/InputText";
import AuthPageShell from "./AuthPageShell";
import { useOneTimeUrlToken } from "./useOneTimeUrlToken";
import styles from "./auth-page.module.scss";

const MIN_PASSWORD_LENGTH = 8;

const ResetPassword: React.FC = () => {
    const token = useOneTimeUrlToken();
    const { resetPassword } = useAuth();
    const { openAuthModal } = useAuthModal();
    const [password, setPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [error, setError] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [isDone, setIsDone] = useState(false);
    const [needsSignIn, setNeedsSignIn] = useState(false);
    const passwordId = useId();
    const confirmationId = useId();
    const errorId = useId();
    const hintId = useId();

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!token) return;
        if (password !== confirmation) {
            setError("Пароли не совпадают.");
            return;
        }

        setError("");
        setIsSaving(true);
        try {
            setNeedsSignIn(!(await resetPassword(token, password)));
            setIsDone(true);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Не удалось сменить пароль");
        } finally {
            setIsSaving(false);
        }
    };

    const renderBody = () => {
        if (!isAuthEnabled) return <p className={styles.text}>Аккаунты сейчас отключены.</p>;
        if (token === undefined) return <p className={styles.text}>Открываем ссылку…</p>;

        if (isDone && needsSignIn) {
            return (
                <>
                    <p className={`${styles.status} ${styles.success}`} aria-live="polite">
                        Пароль изменён, все устройства вышли из аккаунта. Войдите с новым паролем:
                        для аккаунта администратора на почту придёт код подтверждения.
                    </p>
                    <div className={styles.actions}>
                        <button className={styles.primary} onClick={openAuthModal} type="button">
                            Войти
                        </button>
                    </div>
                </>
            );
        }

        if (isDone) {
            return (
                <>
                    <p className={`${styles.status} ${styles.success}`} aria-live="polite">
                        Пароль изменён, вы вошли в аккаунт. На остальных устройствах нужно будет
                        войти заново.
                    </p>
                    <div className={styles.actions}>
                        <Link className={styles.primary} href="/planner">
                            Перейти к планировщику
                        </Link>
                    </div>
                </>
            );
        }

        if (token === null) {
            return (
                <>
                    <p className={`${styles.status} ${styles.error}`} role="alert">
                        В ссылке нет кода восстановления. Откройте ссылку из письма целиком или
                        запросите новую.
                    </p>
                    <div className={styles.actions}>
                        <Link className={styles.primary} href="/auth/forgot">
                            Запросить новую ссылку
                        </Link>
                    </div>
                </>
            );
        }

        const linkExpired = /Ссылка недействительна/.test(error);
        return (
            <form aria-busy={isSaving} className={styles.form} onSubmit={handleSubmit}>
                {error ? (
                    <p className={`${styles.status} ${styles.error}`} id={errorId} role="alert">
                        {error}
                    </p>
                ) : null}
                <div className={styles.field}>
                    <label className={styles.label} htmlFor={passwordId}>
                        Новый пароль
                    </label>
                    <InputText
                        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
                        autoComplete="new-password"
                        id={passwordId}
                        maxLength={128}
                        minLength={MIN_PASSWORD_LENGTH}
                        onChange={(event) => setPassword(event.target.value)}
                        required
                        type="password"
                        value={password}
                    />
                    <p className={styles.hint} id={hintId}>
                        Не короче {MIN_PASSWORD_LENGTH} символов.
                    </p>
                </div>
                <div className={styles.field}>
                    <label className={styles.label} htmlFor={confirmationId}>
                        Повторите пароль
                    </label>
                    <InputText
                        aria-describedby={error ? errorId : undefined}
                        autoComplete="new-password"
                        id={confirmationId}
                        maxLength={128}
                        minLength={MIN_PASSWORD_LENGTH}
                        onChange={(event) => setConfirmation(event.target.value)}
                        required
                        type="password"
                        value={confirmation}
                    />
                </div>
                <div className={styles.actions}>
                    <button className={styles.primary} disabled={isSaving} type="submit">
                        {isSaving ? "Сохраняем…" : "Сохранить пароль"}
                    </button>
                    {linkExpired ? (
                        <Link className={styles.secondary} href="/auth/forgot">
                            Запросить новую ссылку
                        </Link>
                    ) : null}
                </div>
            </form>
        );
    };

    return (
        <AuthPageShell title="Новый пароль" eyebrow="Аккаунт" heading="Новый пароль">
            {renderBody()}
        </AuthPageShell>
    );
};

export default ResetPassword;
