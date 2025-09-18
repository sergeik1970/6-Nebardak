import React from "react";
import styles from "./index.module.scss";

const Header: React.FC = () => {
    return (
        <header className={styles.header}>
            <div className={styles["header-content"]}>
                <h1 className={styles["header-title"]}>НЕБАРДАК</h1>
                <p className={styles["header-subtitle"]}>дизайн интерьера</p>
            </div>
        </header>
    );
};

export default Header;
