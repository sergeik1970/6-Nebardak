import React from "react";
import styles from "./index.module.scss";

const Header: React.FC = () => {
    return (
        <header className={styles.header}>
            <div className={styles["header-content"]}>
                <h1 className={styles["header-title"]}>StyleFinder</h1>
                <p className={styles["header-subtitle"]}>Найди свой стиль</p>
            </div>
        </header>
    );
};

export default Header;
