import Link from "next/link";
import React, { useId, useState } from "react";
import { authService } from "@/services/authService";
import { isAuthEnabled } from "@/shared/config/runtime";
import InputText from "@/shared/components/InputText";
import AuthPageShell from "./AuthPageShell";
import styles from "./auth-page.module.scss";

const ForgotPassword: React.FC = () => {
    const [email, setEmail] = useState("");
    const [sentTo, setSentTo] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [isSending, setIsSending] = useState(false);
    const emailId = useId();
    const errorId = useId();

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError("");
        setIsSending(true);
        try {
            await authService.requestPasswordReset(email);
            setSentTo(email.trim());
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Не удалось отправить письмо");
        } finally {
            setIsSending(false);
        }
    };

    return (
        <AuthPageShell title="Восстановление пароля" eyebrow="Аккаунт" heading="Забыли пароль?">
            {!isAuthEnabled ? (
                <p className={styles.text}>Аккаунты сейчас отключены.</p>
            ) : sentTo ? (
                <div aria-live="polite">
                    {/* Same wording for every address: the page must not reveal who has an account. */}
                    <p className={`${styles.status} ${styles.success}`}>
                        Если аккаунт с адресом {sentTo} существует, мы отправили на него письмо со
                        ссылкой. Она действует 1 час.
                    </p>
                    <p className={styles.text}>
                        Письма нет несколько минут? Проверьте «Спам» или запросите ссылку ещё раз.
                    </p>
                    <div className={styles.actions}>
                        <button
                            className={styles.secondary}
                            onClick={() => setSentTo(null)}
                            type="button"
                        >
                            Отправить ещё раз
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    <p className={styles.text}>
                        Укажите почту, с которой вы регистрировались. Мы пришлём ссылку для нового
                        пароля.
                    </p>
                    <form aria-busy={isSending} className={styles.form} onSubmit={handleSubmit}>
                        {error ? (
                            <p
                                className={`${styles.status} ${styles.error}`}
                                id={errorId}
                                role="alert"
                            >
                                {error}
                            </p>
                        ) : null}
                        <div className={styles.field}>
                            <label className={styles.label} htmlFor={emailId}>
                                Email
                            </label>
                            <InputText
                                aria-describedby={error ? errorId : undefined}
                                autoComplete="email"
                                id={emailId}
                                onChange={(event) => setEmail(event.target.value)}
                                placeholder="name@example.com"
                                required
                                type="email"
                                value={email}
                            />
                        </div>
                        <div className={styles.actions}>
                            <button className={styles.primary} disabled={isSending} type="submit">
                                {isSending ? "Отправляем…" : "Получить ссылку"}
                            </button>
                            <Link className={styles.secondary} href="/">
                                На главную
                            </Link>
                        </div>
                    </form>
                </>
            )}
        </AuthPageShell>
    );
};

export default ForgotPassword;
