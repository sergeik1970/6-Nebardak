import React, { useState } from "react";
import styles from "./index.module.scss";
import AuthModal from "../AuthModal";
import { useAuth } from "../../../contexts/AuthContext";

const Navigation: React.FC = () => {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const { user, isAuthenticated, logout } = useAuth();

    const toggleMenu = () => {
        setIsMenuOpen(!isMenuOpen);
    };

    const openAuthModal = () => {
        setIsAuthModalOpen(true);
        setIsMenuOpen(false); // Закрываем мобильное меню при открытии модального окна
    };

    const closeAuthModal = () => {
        setIsAuthModalOpen(false);
    };

    const handleLogout = () => {
        logout();
        setIsMenuOpen(false);
    };

    return (
        <nav className={styles.navigation}>
            <div className={styles["nav-container"]}>
                {/* Логотип */}
                <div className={styles["nav-logo"]}>
                    <img
                        src="/images/Home/logo.jpg"
                        alt="Логотип"
                        className={styles["logo-image"]}
                    />
                </div>

                {/* Меню для десктопа и планшета */}
                <div className={styles["nav-menu"]}>
                    <a href="#" className={styles["nav-link"]}>
                        Главная
                    </a>
                    <a href="#" className={styles["nav-link"]}>
                        О нас
                    </a>
                    <a href="#" className={styles["nav-link"]}>
                        Контакты
                    </a>
                    <a href="#" className={styles["nav-link"]}>
                        Тест
                    </a>

                    {isAuthenticated ? (
                        <div className={styles["user-menu"]}>
                            <span className={styles["user-name"]}>Привет, {user?.name}!</span>
                            <button className={styles["nav-logout-btn"]} onClick={handleLogout}>
                                Выйти
                            </button>
                        </div>
                    ) : (
                        <button className={styles["nav-register-btn"]} onClick={openAuthModal}>
                            Регистрация
                        </button>
                    )}
                </div>

                {/* Кнопка бургер-меню для мобильных */}
                <button
                    className={`${styles["burger-menu"]} ${isMenuOpen ? styles.active : ""}`}
                    onClick={toggleMenu}
                    aria-label="Открыть меню"
                >
                    <span></span>
                    <span></span>
                    <span></span>
                </button>

                {/* Мобильное меню */}
                <div className={`${styles["mobile-menu"]} ${isMenuOpen ? styles.active : ""}`}>
                    <h2 className={styles["mobile-menu-title"]}>НЕБАРДАК</h2>
                    <div className={styles["mobile-menu-divider"]}></div>

                    {isAuthenticated ? (
                        <>
                            <div className={styles["mobile-user-info"]}>Привет, {user?.name}!</div>
                            <button className={styles["mobile-nav-link"]} onClick={handleLogout}>
                                Выйти
                            </button>
                        </>
                    ) : (
                        <button className={styles["mobile-nav-link"]} onClick={openAuthModal}>
                            Регистрация
                        </button>
                    )}

                    <a
                        href="#"
                        className={styles["mobile-nav-link"]}
                        onClick={() => setIsMenuOpen(false)}
                    >
                        О нас
                    </a>
                    <a
                        href="#"
                        className={styles["mobile-nav-link"]}
                        onClick={() => setIsMenuOpen(false)}
                    >
                        Тест
                    </a>
                </div>
            </div>

            {/* Модальное окно авторизации */}
            <AuthModal isOpen={isAuthModalOpen} onClose={closeAuthModal} />
        </nav>
    );
};

export default Navigation;
