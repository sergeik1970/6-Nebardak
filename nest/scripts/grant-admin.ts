import dataSource from "../typeOrm.config";
import { User } from "../src/entities/User/user.entity";
import { UserSession } from "../src/entities/UserSession/user-session.entity";

const readEmailArgument = (): string | null => {
    const index = process.argv.indexOf("--email");
    const value = index >= 0 ? process.argv[index + 1] : undefined;
    return typeof value === "string" && value.trim()
        ? value.trim().toLowerCase()
        : null;
};

async function main(): Promise<void> {
    const email = readEmailArgument();
    if (!email) {
        throw new Error(
            "Используйте: npm run admin:grant -- --email user@example.com",
        );
    }

    await dataSource.initialize();
    try {
        const user = await dataSource.getRepository(User).findOne({
            where: { email },
        });
        if (!user) {
            throw new Error("Пользователь не найден");
        }

        if (user.role !== "admin") {
            user.role = "admin";
            await dataSource.getRepository(User).save(user);
        }
        // Sessions opened before elevation never passed the emailed code;
        // the next sign-in asks for it and gets the shorter admin lifetime.
        await dataSource
            .getRepository(UserSession)
            .delete({ user: { id: user.id } });

        // Avoid echoing personal data. The identifier is enough for an
        // administrator to confirm that the explicit elevation completed.
        console.info(`ADMIN_ROLE_GRANTED userId=${user.id}`);
    } finally {
        await dataSource.destroy();
    }
}

void main().catch((error: unknown) => {
    const message =
        error instanceof Error ? error.message : "Не удалось выдать роль";
    console.error(message);
    process.exitCode = 1;
});
