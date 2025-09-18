import React, { ReactNode } from "react";
import { useAuth } from "../contexts/AuthContext";

interface ProtectedRouteProps {
    children: ReactNode;
    fallback?: ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
    children,
    fallback = <div>Пожалуйста, войдите в систему для доступа к этой странице.</div>,
}) => {
    const { isAuthenticated, isLoading } = useAuth();

    if (isLoading) {
        return <div>Загрузка...</div>;
    }

    if (!isAuthenticated) {
        return <>{fallback}</>;
    }

    return <>{children}</>;
};

export default ProtectedRoute;
