import React from "react";
import Head from "next/head";
import Test from "@/shared/pages/Test";
import Navigation from "@/shared/components/Navigation";
import ProjectScope from "@/shared/lib/project-scope/ProjectScope";

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
            <ProjectScope header={<Navigation />}>
                <Test />
            </ProjectScope>
        </>
    );
};

export default TestPage;
