import React from "react";
import Navigation from "@/shared/components/Navigation";
import Header from "./components/Header";
import About from "./components/About";
import HeroTest from "./components/HeroTest";
import Footer from "@/shared/components/Footer";
import styles from "./index.module.scss";

const Home: React.FC = () => {
    return (
        <div className={styles.home}>
            <Navigation />
            <Header />
            <About />
            <HeroTest />
            <Footer />
        </div>
    );
};

export default Home;
