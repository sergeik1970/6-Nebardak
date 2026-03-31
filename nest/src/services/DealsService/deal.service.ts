import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Deals } from "src/entities/Deals/deals.entity";
import { Repository } from "typeorm";

@Injectable()
export class DealsService {
    constructor(
        @InjectRepository(Deals)
        private readonly dealsRepository: Repository<Deals>,
    ) {}

    async createDeal(name: string): Promise<Deals> {
        const deal = this.dealsRepository.create({ name });
        return this.dealsRepository.save(deal);
    }

    async getAllDeals(): Promise<Array<Deals>> {
        return (await this.dealsRepository.find()).reverse();
    }

    async deleteDeal(id: string): Promise<Array<Deals>> {
        await this.dealsRepository.delete({ id: Number(id) });
        return this.dealsRepository.find();
    }

    async changeDeal(id: string, data: Deals): Promise<Deals> {
        await this.dealsRepository.update({ id: Number(id) }, data);
        return (
            await this.dealsRepository.find({ where: { id: Number(id) } })
        )[0];
    }
}
