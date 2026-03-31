import {
    Body,
    Controller,
    Delete,
    Get,
    HttpException,
    HttpStatus,
    Param,
    Patch,
    Post,
    UseGuards,
} from "@nestjs/common";
import { DealsService } from "../../services/DealsService/deal.service";
import { Deals } from "src/entities/Deals/deals.entity";
import { AuthGuard } from "src/guards/auth.guard";

@Controller()
@UseGuards(AuthGuard)
export class DealsController {
    constructor(private readonly dealService: DealsService) {}

    @Get("deals/get")
    getAllDeals() {
        return this.dealService.getAllDeals();
    }

    @Post("deals/add")
    createDeal(@Body() { name }: { name: string }) {
        if (name.trim()) {
            return this.dealService.createDeal(name);
        } else {
            throw new HttpException("Invalid name", HttpStatus.NOT_ACCEPTABLE);
        }
    }

    @Delete("deals/delete/:id")
    deleteDeal(@Param("id") id: string) {
        if (id) {
            return this.dealService.deleteDeal(id);
        } else {
            throw new HttpException("Invalid id", HttpStatus.NOT_ACCEPTABLE);
        }
    }

    @Patch("deals/change/:id")
    changeDeal(@Param("id") id: string, @Body() { data }: { data: Deals }) {
        if (id) {
            return this.dealService.changeDeal(id, data);
        } else {
            throw new HttpException("Invalid id", HttpStatus.NOT_ACCEPTABLE);
        }
    }
}
