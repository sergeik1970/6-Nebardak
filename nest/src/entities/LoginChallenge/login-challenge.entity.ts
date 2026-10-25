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

/**
 * The pending second step of an administrator sign-in: the password was
 * right, the emailed code is still due. The browser holds the challenge
 * token; the code hash is keyed by that token, so a database read alone
 * cannot be brute-forced back into a usable code.
 */
@Entity({ name: "login_challenge" })
@Index("IDX_login_challenge_user", ["user"])
export class LoginChallenge {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @ManyToOne(() => User, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({ name: "user_id" })
    user: User;

    @Column({ name: "token_hash", type: "char", length: 64, unique: true })
    tokenHash: string;

    @Column({ name: "code_hash", type: "char", length: 64 })
    codeHash: string;

    @Column({ type: "smallint", default: 0 })
    attempts: number;

    @Column({ name: "expires_at", type: "timestamptz" })
    expiresAt: Date;

    @CreateDateColumn({ name: "created_at", type: "timestamptz" })
    createdAt: Date;
}
