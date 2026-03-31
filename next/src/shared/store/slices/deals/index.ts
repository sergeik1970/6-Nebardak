import { IDeals } from "@/shared/types/deals";
import { createSlice } from "@reduxjs/toolkit";
import { getDeals, addDeal, deleteDeal, changeDeal } from "./thunks";
import { RootState } from "../../store";

const initialState: IDeals = {
    deals: [],
};

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
            state.deals = (state.deals || []).map((deal) =>
                deal.id === action.payload?.id ? action.payload : deal,
            );
        });
    },
});

export const selectDeals = (state: RootState) => {
    if (!state || !state.deals || !Array.isArray(state.deals.deals)) {
        return [];
    }
    return state.deals.deals;
};
export default dealsSlice.reducer;
