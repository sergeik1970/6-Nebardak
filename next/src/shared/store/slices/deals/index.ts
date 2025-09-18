import { IDeals } from "@/shared/types/deals";
import { createSlice } from "@reduxjs/toolkit";
import { getDeals, addDeal, deleteDeal, changeDeal } from "./thunks";
import { RootState } from "../../store";

const initialState: IDeals = {
    deals: [],
};

// Логирование для отладки
console.log('Deals slice - initialState:', initialState);
const dealsSlice = createSlice({
    name: "deals",
    initialState,
    reducers: {},
    extraReducers: (builder) => {
        builder.addCase(getDeals.fulfilled, (state, action) => {
            state.deals = action.payload || [];
        });

        builder.addCase(addDeal.fulfilled, (state, action) => {
            state.deals = [action.payload, ...(state.deals || [])];
        });

        builder.addCase(deleteDeal.fulfilled, (state, action) => {
            state.deals = action.payload || [];
        });

        builder.addCase(changeDeal.fulfilled, (state, action) => {
            console.log(action);
        });

        // Обработка ошибок
        builder.addCase(getDeals.rejected, (state, action) => {
            console.error('Failed to get deals:', action.error);
        });

        builder.addCase(addDeal.rejected, (state, action) => {
            console.error('Failed to add deal:', action.error);
        });

        builder.addCase(deleteDeal.rejected, (state, action) => {
            console.error('Failed to delete deal:', action.error);
        });

        builder.addCase(changeDeal.rejected, (state, action) => {
            console.error('Failed to change deal:', action.error);
        });
    },
});

// export const { increment, decrement, incrementByAmount } = dealsSlice.actions;
export const selectDeals = (state: RootState) => {
    if (!state || !state.deals || !Array.isArray(state.deals.deals)) {
        return [];
    }
    return state.deals.deals;
};
export default dealsSlice.reducer;
