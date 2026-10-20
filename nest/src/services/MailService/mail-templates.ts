export interface MailMessage {
    to: string;
    subject: string;
    text: string;
    html: string;
}

const escapeHtml = (value: string): string =>
    value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

interface LayoutInput {
    to: string;
    subject: string;
    name: string;
    lead: string;
    action: string;
    link: string;
    notes: string[];
}

/**
 * Plain, image-free letters: no tracking pixels or remote assets, and the
 * same content in text for clients that do not render HTML.
 */
function layout(input: LayoutInput): MailMessage {
    const text = [
        `Здравствуйте, ${input.name}!`,
        "",
        input.lead,
        "",
        `${input.action}: ${input.link}`,
        "",
        ...input.notes,
        "",
        "— StyleFinder",
    ].join("\n");

    const html = `<!doctype html>
<html lang="ru">
<body style="margin:0;padding:24px;background:#f4efe5;font-family:Arial,sans-serif;color:#302a24">
<div style="max-width:520px;margin:0 auto;padding:32px;background:#fffdf8;border:1px solid #d7cbbb">
<p style="margin:0 0 16px;font-size:16px">Здравствуйте, ${escapeHtml(input.name)}!</p>
<p style="margin:0 0 24px;font-size:16px;line-height:1.5">${escapeHtml(input.lead)}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(input.link)}" style="display:inline-block;padding:12px 20px;background:#9b5100;color:#ffffff;font-weight:bold;text-decoration:none">${escapeHtml(input.action)}</a></p>
<p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#625b52">Если кнопка не открывается, скопируйте ссылку в браузер:<br>${escapeHtml(input.link)}</p>
${input.notes.map((note) => `<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#625b52">${escapeHtml(note)}</p>`).join("\n")}
<p style="margin:24px 0 0;font-size:13px;color:#625b52">— StyleFinder</p>
</div>
</body>
</html>`;

    return { to: input.to, subject: input.subject, text, html };
}

export function verificationEmail(input: {
    to: string;
    name: string;
    link: string;
}): MailMessage {
    return layout({
        ...input,
        subject: "Подтвердите почту для StyleFinder",
        lead: "Вы создали аккаунт в StyleFinder. Подтвердите, что это ваша почта, — тогда проекты будут надёжно привязаны к аккаунту, а пароль можно будет восстановить.",
        action: "Подтвердить почту",
        notes: [
            "Ссылка действует 48 часов.",
            "Неподтверждённый аккаунт, которым не пользовались 30 дней, удаляется вместе с проектами.",
            "Если вы не регистрировались, просто проигнорируйте это письмо.",
        ],
    });
}

export function passwordResetEmail(input: {
    to: string;
    name: string;
    link: string;
}): MailMessage {
    return layout({
        ...input,
        subject: "Восстановление пароля StyleFinder",
        lead: "Мы получили запрос на смену пароля. Чтобы задать новый пароль, откройте ссылку ниже.",
        action: "Задать новый пароль",
        notes: [
            "Ссылка действует 1 час и сработает один раз.",
            "После смены пароля все устройства выйдут из аккаунта.",
            "Если вы не запрашивали смену пароля, ничего делать не нужно: текущий пароль останется прежним.",
        ],
    });
}
