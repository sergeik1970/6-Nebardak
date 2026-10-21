import React from "react";
import Head from "next/head";
import Questionnaire from "@/shared/pages/Questionnaire";
import ProjectScope from "@/shared/lib/project-scope/ProjectScope";

const QuestionnairePage: React.FC = () => (
    <>
        <Head>
            <title>Подбор мебели для комнаты · StyleFinder</title>
            <meta
                name="description"
                content="Короткая анкета поможет собрать поштучный комплект мебели перед автоматической расстановкой."
            />
            <meta name="robots" content="noindex,follow" />
        </Head>
        <ProjectScope>
            <Questionnaire />
        </ProjectScope>
    </>
);

export default QuestionnairePage;
