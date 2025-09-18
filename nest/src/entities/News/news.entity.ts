// import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from "typeorm";
// import { Slider } from "../Slider/slider.entity";
// import { Files } from "../Files/files.entity";

// @Entity()
// export class News {
//     @PrimaryGeneratedColumn("increment")
//     id: number;

//     @OneToMany(() => Slider, (slider) => slider.news, {
//         onDelete: "CASCADE",
//     })
//     slider: Array<Slider>;

//     @OneToMany(() => Files, (files) => files.news, {
//         onDelete: "CASCADE",
//     })
//     files: Array<Files>;

//     @Column()
//     title: string;

//     @Column()
//     link: string;

//     @Column()
//     body: string;
// }
