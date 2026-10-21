import { passwordResetEmail, verificationEmail } from "./mail-templates";

describe("mail templates", () => {
    it("escapes user-controlled names in HTML but keeps them readable in text", () => {
        const message = verificationEmail({
            to: "maria@example.com",
            name: '<img src=x onerror="alert(1)">',
            link: "https://stylefinder.example/auth/verify?token=abc&x=1",
        });

        expect(message.html).not.toContain("<img");
        expect(message.html).toContain("&lt;img src=x onerror=&quot;");
        expect(message.html).toContain("token=abc&amp;x=1");
        expect(message.text).toContain('<img src=x onerror="alert(1)">');
        expect(message.text).toContain(
            "https://stylefinder.example/auth/verify?token=abc&x=1",
        );
    });

    it("loads no remote images or trackers", () => {
        const message = passwordResetEmail({
            to: "maria@example.com",
            name: "Мария",
            link: "https://stylefinder.example/auth/reset?token=abc",
        });

        expect(message.html).not.toMatch(/<img|src=|url\(/i);
        expect(message.subject).toBe("Восстановление пароля StyleFinder");
        expect(message.text).toContain("1 час");
    });
});
