import React from "react";
import styles from "./index.module.scss";

const HeroTest: React.FC = () => {
    const handleTestClick = () => {
        // Здесь будет логика перехода к тесту
        console.log("Переход к тесту");
    };

    const handleResultsClick = () => {
        // Здесь будет логика перехода к результатам
        console.log("Переход к результатам");
    };

    return (
        <section className={styles["hero-test"]}>
            <div className={styles["hero-test-content"]}>
                <h2 className={`${styles["hero-test-title"]} ${styles["hero-test-title-mobile"]}`}>
                    Попробуй сейчас!
                </h2>

                <div className={styles["hero-test-visual"]}>
                    <div className={styles["hero-test-arrow"]}></div>
                    <div className={styles["hero-test-capsule"]}>
                        <img src="/images/Home/capsule.jpg" alt="Капсула с людьми за тестом" />
                    </div>
                </div>

                <div className={styles["hero-test-buttons"]}>
                    <h2
                        className={`${styles["hero-test-title"]} ${styles["hero-test-title-desktop"]}`}
                    >
                        Попробуй сейчас!
                    </h2>
                    <div className={styles["hero-test-buttons-group"]}>
                        <button
                            className={`${styles["hero-test-btn"]} ${styles["hero-test-btn-results"]}`}
                            onClick={handleResultsClick}
                        >
                            Результаты
                        </button>
                        <button
                            className={`${styles["hero-test-btn"]} ${styles["hero-test-btn-test"]}`}
                            onClick={handleTestClick}
                        >
                            Тест
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default HeroTest;
