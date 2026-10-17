import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "../../../contexts/AuthContext";
import AuthModal from ".";

const renderModal = (registrationEnabled: boolean) =>
    renderToStaticMarkup(
        <AuthProvider>
            <AuthModal isOpen onClose={() => undefined} registrationEnabled={registrationEnabled} />
        </AuthProvider>,
    );

describe("AuthModal modes", () => {
    it("is strictly login-only when registration is disabled", () => {
        const markup = renderModal(false);

        expect(markup).toContain('role="dialog"');
        expect(markup).toContain(">Вход<");
        expect(markup).not.toContain("Регистрация");
        expect(markup).not.toContain("Зарегистрироваться");
        expect(markup).not.toContain(">Имя<");
    });

    it("offers an explicit registration switch only when enabled", () => {
        expect(renderModal(true)).toContain("Зарегистрироваться");
    });
});
