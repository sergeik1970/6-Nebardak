import React from "react";
import Head from "next/head";
import Questionnaire from "@/shared/pages/Questionnaire";

const QuestionnairePage: React.FC = () => (
    <>
        <Head>
            <title>Подбор мебели для комнаты · StyleFinder</title>
            <meta
                name="description"
                content="Короткая анкета поможет собрать поштучный комплект мебели перед автоматической расстановкой."
            />
        </Head>
        <Questionnaire />
    </>
);

export default QuestionnairePage;
