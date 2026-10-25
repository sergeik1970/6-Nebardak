import * as bcrypt from "bcryptjs";
import { isEmail } from "class-validator";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import dataSource from "../typeOrm.config";
import { User } from "../src/entities/User/user.entity";
import { isWithinBcryptPasswordLimit } from "../src/security/bcrypt-password.policy";
import { PASSWORD_HASH_COST } from "../src/services/AuthService/auth.service";

/**
 * Creates the operator's own administrator account on a server where public
 * registration is off. The password is read from the terminal without echo
 * (or as one line of stdin), never from argv, which lands in shell history
 * and the process list.
 */
const readArgument = (name: string): string | null => {
    const index = process.argv.indexOf(`--${name}`);
    const value = index >= 0 ? process.argv[index + 1] : undefined;
    return typeof value === "string" && value.trim() ? value.trim() : null;
};

const ask = (question: string, hidden: boolean): Promise<string> => {
    let muted = false;
    const output = new Writable({
        write(chunk, _encoding, done) {
            if (!muted) process.stdout.write(chunk);
            done();
        },
    });
    const prompt = createInterface({
        input: process.stdin,
        output,
        terminal: Boolean(process.stdin.isTTY),
    });
    return new Promise((resolve) => {
        prompt.question(question, (answer) => {
            prompt.close();
            if (hidden && process.stdin.isTTY) process.stdout.write("\n");
            resolve(answer);
        });
        muted = hidden;
    });
};

const readPassword = async (): Promise<string> => {
    const password = await ask("Пароль: ", true);
    if (process.stdin.isTTY) {
        const confirmation = await ask("Повторите пароль: ", true);
        if (confirmation !== password) throw new Error("Пароли не совпадают");
    }
    if (password.length < 8 || password.length > 128) {
        throw new Error("Пароль должен быть от 8 до 128 символов");
    }
    if (!isWithinBcryptPasswordLimit(password)) {
        throw new Error("Пароль не должен превышать 72 байта UTF-8");
    }
    return password;
};

async function main(): Promise<void> {
    const email = readArgument("email")?.toLowerCase() ?? null;
    const name = readArgument("name");
    if (!email || !name) {
        throw new Error(
            'Используйте: npm run admin:create -- --email you@example.com --name "Имя"',
        );
    }
    if (!isEmail(email) || email.length > 254) {
        throw new Error("Некорректный email");
    }
    if (
        name.length < 2 ||
        name.length > 80 ||
        /[\u0000-\u001f\u007f]/.test(name)
    ) {
        throw new Error("Имя — от 2 до 80 символов без управляющих");
    }

    const password = await readPassword();

    await dataSource.initialize();
    try {
        const users = dataSource.getRepository(User);
        if (await users.findOne({ where: { email } })) {
            throw new Error(
                "Аккаунт с этим email уже есть: используйте admin:grant",
            );
        }

        // The operator vouches for the address, and every sign-in proves it
        // again with the emailed code. No consent edition is recorded: the
        // account does not come from the public sign-up form.
        const user = await users.save(
            users.create({
                email,
                name,
                password: await bcrypt.hash(password, PASSWORD_HASH_COST),
                role: "admin",
                emailVerifiedAt: new Date(),
                consentVersion: null,
                consentAt: null,
            }),
        );

        console.info(`ADMIN_ACCOUNT_CREATED userId=${user.id}`);
    } finally {
        await dataSource.destroy();
    }
}

void main().catch((error: unknown) => {
    const message =
        error instanceof Error ? error.message : "Не удалось создать аккаунт";
    console.error(message);
    process.exitCode = 1;
});
