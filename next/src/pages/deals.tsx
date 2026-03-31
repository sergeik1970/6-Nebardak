import React from "react";
import Deals from "@/shared/pages/Deals";
import ProtectedRoute from "@/components/ProtectedRoute";

const Main = () => {
    return (
        <ProtectedRoute>
            <Deals />
        </ProtectedRoute>
    );
};

export default Main;
