import Head from "next/head";
import Link from "next/link";
import React, { useEffect, useId, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { isAuthEnabled } from "@/shared/config/runtime";
import Footer from "@/shared/components/Footer";
import InputText from "@/shared/components/InputText";
import Navigation from "@/shared/components/Navigation";
import styles from "./index.module.scss";

type Feedback = { kind: "success" | "error"; text: string } | null;

const errorText = (caught: unknown, fallback: string) =>
    caught instanceof Error && caught.message ? caught.message : fallback;

const FeedbackMessage: React.FC<{ feedback: Feedback }> = ({ feedback }) =>
    feedback ? (
        <p
            className={`${styles.feedback} ${styles[feedback.kind]}`}
            role={feedback.kind === "error" ? "alert" : "status"}
        >
            {feedback.text}
        </p>
    ) : null;

const ProfileSection: React.FC = () => {
    const { user, updateProfile, resendVerification } = useAuth();
    const [name, setName] = useState(user?.name ?? "");
    const [feedback, setFeedback] = useState<Feedback>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [resend, setResend] = useState<"idle" | "sending" | "sent">("idle");
    const nameId = useId();

    useEffect(() => setName(user?.name ?? ""), [user?.name]);

    if (!user) return null;

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setIsSaving(true);
        setFeedback(null);
        try {
            await updateProfile(name.trim());
            setFeedback({ kind: "success", text: "Имя сохранено." });
        } catch (caught) {
            setFeedback({ kind: "error", text: errorText(caught, "Не удалось сохранить имя") });
        } finally {
            setIsSaving(false);
        }
    };

    const handleResend = async () => {
        setResend("sending");
        try {
            await resendVerification();
            setResend("sent");
        } catch (caught) {
            setResend("idle");
            setFeedback({ kind: "error", text: errorText(caught, "Не удалось отправить письмо") });
        }
    };

    return (
        <section className={styles.section} aria-labelledby="account-profile">
            <h2 id="account-profile">Профиль</h2>
            <form className={styles.form} onSubmit={handleSubmit}>
                <div className={styles.field}>
                    <label className={styles.label} htmlFor={nameId}>
                        Имя
                    </label>
                    <InputText
                        autoComplete="name"
                        id={nameId}
                        maxLength={80}
                        minLength={2}
                        onChange={(event) => setName(event.target.value)}
                        required
                        value={name}
                    />
                </div>
                <div className={styles.field}>
                    <span className={styles.label}>Email</span>
                    <p className={styles.value}>
                        {user.email}{" "}
                        <span className={user.emailVerified ? styles.badgeOk : styles.badgeWarn}>
                            {user.emailVerified ? "подтверждён" : "не подтверждён"}
                        </span>
                    </p>
                    {!user.emailVerified ? (
                        <p className={styles.hint}>
                            {resend === "sent" ? (
                                "Письмо отправлено. Проверьте почту и папку «Спам»."
                            ) : (
                                <button
                                    className={styles.linkButton}
                                    disabled={resend === "sending"}
                                    onClick={handleResend}
                                    type="button"
                                >
                                    {resend === "sending"
                                        ? "Отправляем…"
                                        : "Отправить письмо для подтверждения ещё раз"}
                                </button>
                            )}
                        </p>
                    ) : null}
                </div>
                <FeedbackMessage feedback={feedback} />
                <div className={styles.actions}>
                    <button
                        className={styles.primary}
                        disabled={isSaving || name.trim() === user.name}
                        type="submit"
                    >
                        {isSaving ? "Сохраняем…" : "Сохранить"}
                    </button>
                </div>
            </form>
        </section>
    );
};

const PasswordSection: React.FC = () => {
    const { changePassword } = useAuth();
    const [current, setCurrent] = useState("");
    const [next, setNext] = useState("");
    const [repeat, setRepeat] = useState("");
    const [feedback, setFeedback] = useState<Feedback>(null);
    const [isSaving, setIsSaving] = useState(false);
    const currentId = useId();
    const nextId = useId();
    const repeatId = useId();

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (next !== repeat) {
            setFeedback({ kind: "error", text: "Новые пароли не совпадают." });
            return;
        }
        setIsSaving(true);
        setFeedback(null);
        try {
            await changePassword(current, next);
            setCurrent("");
            setNext("");
            setRepeat("");
            setFeedback({
                kind: "success",
                text: "Пароль изменён. На остальных устройствах нужно будет войти заново.",
            });
        } catch (caught) {
            setFeedback({ kind: "error", text: errorText(caught, "Не удалось сменить пароль") });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <section className={styles.section} aria-labelledby="account-password">
            <h2 id="account-password">Пароль</h2>
            <form className={styles.form} onSubmit={handleSubmit}>
                <div className={styles.field}>
                    <label className={styles.label} htmlFor={currentId}>
                        Текущий пароль
                    </label>
                    <InputText
                        autoComplete="current-password"
                        id={currentId}
                        maxLength={128}
                        onChange={(event) => setCurrent(event.target.value)}
                        required
                        type="password"
                        value={current}
                    />
                </div>
                <div className={styles.field}>
                    <label className={styles.label} htmlFor={nextId}>
                        Новый пароль
                    </label>
                    <InputText
                        autoComplete="new-password"
                        id={nextId}
                        maxLength={128}
                        minLength={8}
                        onChange={(event) => setNext(event.target.value)}
                        required
                        type="password"
                        value={next}
                    />
                    <p className={styles.hint}>Не короче 8 символов.</p>
                </div>
                <div className={styles.field}>
                    <label className={styles.label} htmlFor={repeatId}>
                        Повторите новый пароль
                    </label>
                    <InputText
                        autoComplete="new-password"
                        id={repeatId}
                        maxLength={128}
                        minLength={8}
                        onChange={(event) => setRepeat(event.target.value)}
                        required
                        type="password"
                        value={repeat}
                    />
                </div>
                <FeedbackMessage feedback={feedback} />
                <div className={styles.actions}>
                    <button className={styles.primary} disabled={isSaving} type="submit">
                        {isSaving ? "Сохраняем…" : "Сменить пароль"}
                    </button>
                    <Link className={styles.secondaryLink} href="/auth/forgot">
                        Не помню текущий пароль
                    </Link>
                </div>
            </form>
        </section>
    );
};

const SessionsSection: React.FC = () => {
    const { logoutEverywhere } = useAuth();
    const [feedback, setFeedback] = useState<Feedback>(null);
    const [isBusy, setIsBusy] = useState(false);

    const handleClick = async () => {
        setIsBusy(true);
        setFeedback(null);
        try {
            await logoutEverywhere();
        } catch (caught) {
            setFeedback({ kind: "error", text: errorText(caught, "Не удалось завершить сеансы") });
            setIsBusy(false);
        }
    };

    return (
        <section className={styles.section} aria-labelledby="account-sessions">
            <h2 id="account-sessions">Устройства</h2>
            <p className={styles.text}>
                Если вы входили с чужого компьютера или потеряли телефон, завершите все сеансы.
                Выйти придётся и на этом устройстве.
            </p>
            <FeedbackMessage feedback={feedback} />
            <div className={styles.actions}>
                <button
                    className={styles.secondary}
                    disabled={isBusy}
                    onClick={handleClick}
                    type="button"
                >
                    {isBusy ? "Завершаем…" : "Выйти на всех устройствах"}
                </button>
            </div>
        </section>
    );
};

const DeleteSection: React.FC<{ onDeleted: () => void }> = ({ onDeleted }) => {
    const { deleteAccount } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const [password, setPassword] = useState("");
    const [feedback, setFeedback] = useState<Feedback>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const passwordId = useId();

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setIsDeleting(true);
        setFeedback(null);
        try {
            await deleteAccount(password);
            onDeleted();
        } catch (caught) {
            setFeedback({ kind: "error", text: errorText(caught, "Не удалось удалить аккаунт") });
            setIsDeleting(false);
        }
    };

    return (
        <section className={`${styles.section} ${styles.danger}`} aria-labelledby="account-delete">
            <h2 id="account-delete">Удаление аккаунта</h2>
            <p className={styles.text}>
                Аккаунт, все сохранённые проекты и сеансы будут удалены сразу и навсегда.
                Восстановить их будет невозможно. Удаление также отзывает согласие на обработку
                персональных данных.
            </p>
            {!isOpen ? (
                <div className={styles.actions}>
                    <button
                        className={styles.dangerButton}
                        onClick={() => setIsOpen(true)}
                        type="button"
                    >
                        Удалить аккаунт…
                    </button>
                </div>
            ) : (
                <form className={styles.form} onSubmit={handleSubmit}>
                    <div className={styles.field}>
                        <label className={styles.label} htmlFor={passwordId}>
                            Введите пароль, чтобы подтвердить удаление
                        </label>
                        <InputText
                            autoComplete="current-password"
                            autoFocus
                            id={passwordId}
                            maxLength={128}
                            onChange={(event) => setPassword(event.target.value)}
                            required
                            type="password"
                            value={password}
                        />
                    </div>
                    <FeedbackMessage feedback={feedback} />
                    <div className={styles.actions}>
                        <button className={styles.dangerButton} disabled={isDeleting} type="submit">
                            {isDeleting ? "Удаляем…" : "Удалить навсегда"}
                        </button>
                        <button
                            className={styles.secondary}
                            disabled={isDeleting}
                            onClick={() => {
                                setIsOpen(false);
                                setPassword("");
                                setFeedback(null);
                            }}
                            type="button"
                        >
                            Отмена
                        </button>
                    </div>
                </form>
            )}
        </section>
    );
};

const Account: React.FC = () => {
    const { user, isLoading } = useAuth();
    const [wasDeleted, setWasDeleted] = useState(false);

    const renderContent = () => {
        if (wasDeleted) {
            return (
                <section className={styles.section} aria-live="polite">
                    <h2>Аккаунт удалён</h2>
                    <p className={styles.text}>
                        Мы удалили аккаунт и все проекты. Спасибо, что пользовались StyleFinder.
                    </p>
                    <div className={styles.actions}>
                        <Link className={styles.primary} href="/">
                            На главную
                        </Link>
                    </div>
                </section>
            );
        }
        if (!isAuthEnabled) {
            return <p className={styles.text}>Аккаунты сейчас отключены.</p>;
        }
        if (isLoading) return <p className={styles.text}>Загружаем аккаунт…</p>;
        if (!user) {
            return (
                <section className={styles.section}>
                    <h2>Вы не вошли</h2>
                    <p className={styles.text}>
                        Войдите через кнопку «Войти» вверху страницы, чтобы открыть личный кабинет.
                    </p>
                </section>
            );
        }

        return (
            <>
                <ProfileSection />
                <PasswordSection />
                <SessionsSection />
                <DeleteSection onDeleted={() => setWasDeleted(true)} />
            </>
        );
    };

    return (
        <div className={styles.page}>
            <Head>
                <title>Личный кабинет · StyleFinder</title>
                <meta name="robots" content="noindex, nofollow" />
            </Head>
            <Navigation />
            <main id="main-content" className={styles.main} tabIndex={-1}>
                <div className={styles.container}>
                    <h1>Личный кабинет</h1>
                    {renderContent()}
                </div>
            </main>
            <Footer />
        </div>
    );
};

export default Account;
