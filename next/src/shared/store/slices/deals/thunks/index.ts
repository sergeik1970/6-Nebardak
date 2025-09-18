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
            const url = `${process.env.NEXT_PUBLIC_API_URL}/api/deals/add`;
            console.log("addDeal - sending request to:", url);
            console.log("addDeal - payload:", { name });

            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ name }),
            });

            console.log("addDeal - response status:", response.status);
            console.log("addDeal - response ok:", response.ok);

            if (!response.ok) {
                const errorText = await response.text();
                console.error("addDeal - error response:", errorText);
                return rejectWithValue(`HTTP ${response.status}: ${errorText}`);
            }

            const result = await response.json();
            console.log("addDeal - success result:", result);
            return result;
        } catch (err) {
            console.error("addDeal - catch error:", err);
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
