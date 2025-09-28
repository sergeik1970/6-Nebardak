import React, { useState } from "react";
import Navigation from "@/shared/components/Navigation";
import Footer from "@/shared/components/Footer";
import styles from "./index.module.scss";

const Test: React.FC = () => {
    const [selectedOption, setSelectedOption] = useState<string | null>(null);

    const handleOptionClick = (option: string) => {
        setSelectedOption(option);
        console.log(`Выбрана опция: ${option}`);
        // Здесь можно добавить логику обработки выбора
    };

    return (
        <div className={styles.test}>
            <Navigation />

            <main className={styles.main}>
                <div className={styles.container}>
                    <h1 className={styles.title}>Выбери понравившееся изображение</h1>
                    <div className={styles.imageBlock}>
                        <button
                            className={styles.imgButton}
                            onClick={() => handleOptionClick("house")}
                        >
                            <img src="/images/Home/house.jpg" alt="Изображение дома" />
                        </button>
                        <button
                            className={styles.imgButton}
                            onClick={() => handleOptionClick("capsule")}
                        >
                            <img src="/images/Home/capsule.jpg" alt="Изображение капсулы" />
                        </button>
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
};

export default Test;
