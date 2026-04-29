import React from "react";
import Link from "next/link";
import Image from "next/image";
import styles from "./index.module.scss";
const HeroTest: React.FC = () => {
    return (
        <section className={styles["hero-test"]}>
            <div className={styles["hero-test-content"]}>
                <h2 className={`${styles["hero-test-title"]} ${styles["hero-test-title-mobile"]}`}>
                    Попробуй сейчас!
                </h2>

                <div className={styles["hero-test-visual"]}>
                    <div className={styles["hero-test-arrow"]}></div>
                    <div className={styles["hero-test-capsule"]}>
                        <Image
                            src="/images/Home/capsule.jpg"
                            alt="Капсула с людьми за тестом"
                            fill
                            sizes="(max-width: 768px) 80vw, (max-width: 1200px) 24rem, 500px"
                            quality={75}
                            style={{ objectFit: "cover" }}
                        />
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
                            type="button"
                            disabled
                            aria-disabled="true"
                        >
                            Результаты позже
                        </button>
                        <Link
                            href="/test"
                            className={`${styles["hero-test-btn"]} ${styles["hero-test-btn-test"]}`}
                        >
                            Пройти тест
                        </Link>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default HeroTest;
