import React, { useState } from "react";
import styles from "./index.module.scss";

const Navigation: React.FC = () => {
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const toggleMenu = () => {
        setIsMenuOpen(!isMenuOpen);
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
                    <button className={styles["nav-register-btn"]}>Регистрация</button>
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
                    <a
                        href="#"
                        className={styles["mobile-nav-link"]}
                        onClick={() => setIsMenuOpen(false)}
                    >
                        Регистрация
                    </a>
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
        </nav>
    );
};

export default Navigation;
