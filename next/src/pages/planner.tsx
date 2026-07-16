import React from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import Planner from "@/shared/pages/Planner";

const PlannerPage: React.FC = () => {
    const router = useRouter();
    const handoffId: string | null | undefined = !router.isReady
        ? undefined
        : typeof router.query.handoff === "string"
          ? router.query.handoff
          : router.query.handoff
            ? ""
            : null;

    return (
        <>
            <Head>
                <title>Планировщик мебели · StyleFinder</title>
                <meta
                    name="description"
                    content="Автоматическая проверка и расстановка мебели с учётом проходов и зон доступа."
                />
            </Head>
            <Planner handoffId={handoffId} />
        </>
    );
};

export default PlannerPage;
