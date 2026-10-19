import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
} from "typeorm";

export const USER_ROLES = ["designer", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

@Entity()
export class User {
    @PrimaryGeneratedColumn("increment")
    id: number;

    @Column({ unique: true })
    email: string;

    @Column()
    name: string;

    @Column({ select: false })
    password: string;

    /**
     * Accounts are created as designers. Elevation is an explicit
     * administrator operation and is never accepted from a registration body.
     */
    @Column({ type: "varchar", length: 16, default: "designer" })
    role: UserRole;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
