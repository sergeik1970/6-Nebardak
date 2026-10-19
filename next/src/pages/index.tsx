import Head from "next/head";
import React from "react";
import Home from "@/shared/pages/Home";

const Main = () => {
    return (
        <>
            <Head>
                <title>StyleFinder — подберите стиль и планировку комнаты</title>
                <meta
                    name="description"
                    content="Определите визуальные предпочтения, соберите мебель и получите проверяемый план прямоугольной комнаты."
                />
            </Head>
            <Home />
        </>
    );
};

export default Main;
