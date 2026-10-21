import { Inject, Injectable, Optional } from "@nestjs/common";
import { createTransport } from "nodemailer";
import { getRuntimeConfig } from "../../config/runtime.config";
import { MailMessage } from "./mail-templates";

export interface MailTransport {
    sendMail(message: MailMessage & { from: string }): Promise<unknown>;
}

/** Tests replace the SMTP transport through this token. */
export const MAIL_TRANSPORT = Symbol("MAIL_TRANSPORT");

@Injectable()
export class MailService {
    private transport?: MailTransport;

    constructor(
        @Optional()
        @Inject(MAIL_TRANSPORT)
        transport?: MailTransport,
    ) {
        this.transport = transport;
    }

    async send(message: MailMessage): Promise<void> {
        const { mail } = getRuntimeConfig();
        await this.getTransport().sendMail({ ...message, from: mail.from });
    }

    private getTransport(): MailTransport {
        if (!this.transport) {
            const { nodeEnv, mail } = getRuntimeConfig();
            this.transport = createTransport({
                host: mail.host,
                port: mail.port,
                secure: mail.secure,
                // Production refuses to send credentials or links in clear text.
                requireTLS: nodeEnv === "production" && !mail.secure,
                auth: mail.username
                    ? { user: mail.username, pass: mail.password }
                    : undefined,
                connectionTimeout: 10_000,
                greetingTimeout: 10_000,
                socketTimeout: 20_000,
            });
        }
        return this.transport;
    }
}
