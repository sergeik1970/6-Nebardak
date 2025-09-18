export interface IDeals {
    deals: Array<IDeal> | null | undefined;
}

export interface IDeal {
    name: string;
    id: number;
    done: boolean;
}
