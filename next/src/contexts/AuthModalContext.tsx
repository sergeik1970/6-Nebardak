import React, { ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";
import AuthModal from "@/shared/components/AuthModal";
import { authUiMode, isAuthRegistrationEnabled } from "@/shared/config/runtime";

interface AuthModalContextValue {
    openAuthModal: () => void;
}

const AuthModalContext = createContext<AuthModalContextValue | null>(null);

/**
 * One sign-in dialog for the whole app, so pages without the site navigation
 * (planner, room editor, an expired session mid-save) can ask to sign in.
 */
export const AuthModalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isOpen, setIsOpen] = useState(false);
    const openAuthModal = useCallback(() => setIsOpen(true), []);
    const value = useMemo(() => ({ openAuthModal }), [openAuthModal]);

    return (
        <AuthModalContext.Provider value={value}>
            {children}
            {authUiMode !== "off" ? (
                <AuthModal
                    isOpen={isOpen}
                    onClose={() => setIsOpen(false)}
                    registrationEnabled={isAuthRegistrationEnabled}
                />
            ) : null}
        </AuthModalContext.Provider>
    );
};

const noop: AuthModalContextValue = { openAuthModal: () => undefined };

/** Outside the provider (isolated tests) the call is a harmless no-op. */
export const useAuthModal = (): AuthModalContextValue => useContext(AuthModalContext) ?? noop;
