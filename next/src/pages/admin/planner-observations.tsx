import Head from "next/head";
import React from "react";
import AdminPlannerObservations from "@/shared/pages/AdminPlannerObservations";

const AdminPlannerObservationsPage: React.FC = () => (
    <>
        <Head>
            <title>Разбор расстановок · StyleFinder</title>
            <meta
                content="Закрытая очередь проверки сохранённых расстановок мебели."
                name="description"
            />
            <meta content="noindex,nofollow" name="robots" />
        </Head>
        <AdminPlannerObservations />
    </>
);

export default AdminPlannerObservationsPage;
