import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "../User/user.entity";

export const EMAIL_TOKEN_PURPOSES = ["verify-email", "reset-password"] as const;
export type EmailTokenPurpose = (typeof EMAIL_TOKEN_PURPOSES)[number];

/** A single-use link sent by email. As with sessions, only the hash is kept. */
@Entity({ name: "email_token" })
@Index("IDX_email_token_user_purpose", ["user", "purpose"])
export class EmailToken {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @ManyToOne(() => User, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({ name: "user_id" })
    user: User;

    @Column({ type: "varchar", length: 32 })
    purpose: EmailTokenPurpose;

    @Column({ name: "token_hash", type: "char", length: 64, unique: true })
    tokenHash: string;

    @Column({ name: "expires_at", type: "timestamptz" })
    expiresAt: Date;

    @Column({ name: "used_at", type: "timestamptz", nullable: true })
    usedAt: Date | null;

    @CreateDateColumn({ name: "created_at", type: "timestamptz" })
    createdAt: Date;
}
