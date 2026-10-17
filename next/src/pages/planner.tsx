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
    const drawRoomDraft = router.isReady && router.query.drawRoom === "1";

    return (
        <>
            <Head>
                <title>Планировщик мебели · StyleFinder</title>
                <meta
                    name="description"
                    content="Автоматическая проверка и расстановка мебели с учётом проходов и зон доступа."
                />
                <meta name="robots" content="noindex,follow" />
            </Head>
            <Planner handoffId={handoffId} drawRoomDraft={drawRoomDraft} />
        </>
    );
};

export default PlannerPage;
