import React from "react";
import Head from "next/head";
import Test from "@/shared/pages/Test";

const TestPage: React.FC = () => {
    return (
        <>
            <Head>
                <title>Тест визуальных предпочтений · StyleFinder</title>
                <meta
                    name="description"
                    content="Сравните близкие вам интерьеры и получите несколько визуальных направлений для дальнейшего подбора мебели."
                />
            </Head>
            <Test />
        </>
    );
};

export default TestPage;
