import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { User } from "@/types/auth";

const auth = vi.hoisted(() => ({ user: null as User | null }));

vi.mock("@/contexts/AuthContext", () => ({
    useAuth: () => ({ user: auth.user, resendVerification: vi.fn() }),
}));

import EmailVerificationBanner from ".";

const baseUser: User = {
    id: 1,
    name: "Мария",
    email: "maria@example.com",
    role: "designer",
    emailVerified: false,
};

describe("EmailVerificationBanner", () => {
    it("renders nothing for guests and verified users", () => {
        auth.user = null;
        expect(renderToStaticMarkup(<EmailVerificationBanner />)).toBe("");

        auth.user = { ...baseUser, emailVerified: true };
        expect(renderToStaticMarkup(<EmailVerificationBanner />)).toBe("");
    });

    it("names the address, warns about deletion and offers a resend", () => {
        auth.user = baseUser;
        const markup = renderToStaticMarkup(<EmailVerificationBanner />);

        expect(markup).toContain("maria@example.com");
        expect(markup).toContain("30 дней");
        expect(markup).toContain("Отправить ещё раз");
    });
});
