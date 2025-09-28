import React, { useState, useEffect } from "react";
import styles from "./index.module.scss";
import InputText from "../InputText";
import Button from "../Button";
import { useAuth } from "../../../contexts/AuthContext";

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        password: "",
    });
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const { login, register } = useAuth();

    const handleInputChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData((prev) => ({
            ...prev,
            [field]: e.target.value,
        }));
        // Очищаем ошибку при изменении полей
        if (error) setError("");
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setIsLoading(true);

        try {
            if (isLogin) {
                await login({
                    email: formData.email,
                    password: formData.password,
                });
            } else {
                await register({
                    name: formData.name,
                    email: formData.email,
                    password: formData.password,
                });
            }
            onClose();
        } catch (err: any) {
            setError(err.message || "Произошла ошибка");
        } finally {
            setIsLoading(false);
        }
    };

    const toggleMode = () => {
        setIsLogin(!isLogin);
        setFormData({ name: "", email: "", password: "" });
        setError("");
    };

    // Закрытие модального окна по клавише Escape
    useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener("keydown", handleEscape);
            // Блокируем скролл страницы при открытом модальном окне
            document.body.style.overflow = "hidden";
        }

        return () => {
            document.removeEventListener("keydown", handleEscape);
            document.body.style.overflow = "unset";
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <button className={styles.closeButton} onClick={onClose}>
                    ×
                </button>

                <div className={styles.header}>
                    <h2 className={styles.title}>{isLogin ? "Вход" : "Регистрация"}</h2>
                    <p className={styles.subtitle}>
                        {isLogin ? "Войдите в свой аккаунт" : "Создайте новый аккаунт"}
                    </p>
                </div>

                <form className={styles.form} onSubmit={handleSubmit}>
                    {error && <div className={styles.error}>{error}</div>}

                    {!isLogin && (
                        <div className={styles.inputGroup}>
                            <label className={styles.label}>Имя</label>
                            <InputText
                                value={formData.name}
                                onChange={handleInputChange("name")}
                                placeholder="Введите ваше имя"
                                className={styles.input}
                                required
                            />
                        </div>
                    )}

                    <div className={styles.inputGroup}>
                        <label className={styles.label}>Email</label>
                        <InputText
                            type="email"
                            value={formData.email}
                            onChange={handleInputChange("email")}
                            placeholder="Введите ваш email"
                            className={styles.input}
                            required
                        />
                    </div>

                    <div className={styles.inputGroup}>
                        <label className={styles.label}>Пароль</label>
                        <InputText
                            type="password"
                            value={formData.password}
                            onChange={handleInputChange("password")}
                            placeholder="Введите пароль"
                            className={styles.input}
                            required
                        />
                    </div>

                    <button type="submit" className={styles.submitButton} disabled={isLoading}>
                        {isLoading ? "Загрузка..." : isLogin ? "Войти" : "Зарегистрироваться"}
                    </button>
                </form>

                <div className={styles.switchMode}>
                    <p>
                        {isLogin ? "Нет аккаунта?" : "Уже есть аккаунт?"}
                        <button type="button" className={styles.switchButton} onClick={toggleMode}>
                            {isLogin ? "Зарегистрироваться" : "Войти"}
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
};

export default AuthModal;



...