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
            state.deals = action.payload;
        });

        builder.addCase(addDeal.fulfilled, (state, action) => {
            state.deals = [action.payload, ...state.deals];
        });

        builder.addCase(deleteDeal.fulfilled, (state, action) => {
            state.deals = action.payload;
        });

        builder.addCase(changeDeal.fulfilled, (state, action) => {
            console.log(action);
        });
    },
});

// export const { increment, decrement, incrementByAmount } = dealsSlice.actions;
export const selectDeals = (state: RootState) => state.deals.deals;
export default dealsSlice.reducer;
