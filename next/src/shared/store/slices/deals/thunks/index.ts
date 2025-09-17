import { IDeal } from "@/shared/types/deals";
import { createAsyncThunk } from "@reduxjs/toolkit";

export const getDeals = createAsyncThunk("deals/getDeals", async (_, { rejectWithValue }) => {
    try {
        return await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/deals/get/`).then((res) =>
            res.json(),
        );
    } catch (err) {
        return rejectWithValue(err);
    }
});

export const addDeal = createAsyncThunk(
    "deals/addDeal",
    async ({ name }: { name: string }, { rejectWithValue }) => {
        try {
            return await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/deals/add`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ name }),
            }).then((res) => res.json());
        } catch (err) {
            return rejectWithValue(err);
        }
    },
);

export const changeDeal = createAsyncThunk(
    "deals/changeDeal",
    async ({ id, element }: { id: string; element: IDeal }, { rejectWithValue }) => {
        try {
            return await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/deals/change/${id}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ data: element }),
            }).then((res) => res.json());
        } catch (err) {
            return rejectWithValue(err);
        }
    },
);

export const deleteDeal = createAsyncThunk(
    "deals/deleteDeal",
    async ({ id }: { id: string }, { rejectWithValue }) => {
        try {
            return await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/deals/delete/${id}`, {
                method: "DELETE",
            }).then((res) => res.json());
        } catch (err) {
            return rejectWithValue(err);
        }
    },
);
