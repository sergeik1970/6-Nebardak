import { IDeal } from "@/shared/types/deals";
import { createAsyncThunk } from "@reduxjs/toolkit";

const apiUrl = () => process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";
const getToken = (): string | null =>
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

export const getDeals = createAsyncThunk("deals/getDeals", async (_, { rejectWithValue }) => {
    try {
        const token = getToken();
        const response = await fetch(`${apiUrl()}/deals/get`, {
            headers: { ...(token && { Authorization: `Bearer ${token}` }) },
        });
        if (!response.ok) return rejectWithValue(`HTTP ${response.status}`);
        return response.json();
    } catch (err) {
        return rejectWithValue(err);
    }
});

export const addDeal = createAsyncThunk(
    "deals/addDeal",
    async ({ name }: { name: string }, { rejectWithValue }) => {
        try {
            const token = getToken();
            const response = await fetch(`${apiUrl()}/deals/add`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token && { Authorization: `Bearer ${token}` }),
                },
                body: JSON.stringify({ name }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                return rejectWithValue(`HTTP ${response.status}: ${errorText}`);
            }

            return response.json();
        } catch (err) {
            return rejectWithValue(err);
        }
    },
);

export const changeDeal = createAsyncThunk(
    "deals/changeDeal",
    async ({ id, element }: { id: string; element: IDeal }, { rejectWithValue }) => {
        try {
            const token = getToken();
            const response = await fetch(`${apiUrl()}/deals/change/${id}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    ...(token && { Authorization: `Bearer ${token}` }),
                },
                body: JSON.stringify({ data: element }),
            });
            if (!response.ok) return rejectWithValue(`HTTP ${response.status}`);
            return response.json();
        } catch (err) {
            return rejectWithValue(err);
        }
    },
);

export const deleteDeal = createAsyncThunk(
    "deals/deleteDeal",
    async ({ id }: { id: string }, { rejectWithValue }) => {
        try {
            const token = getToken();
            const response = await fetch(`${apiUrl()}/deals/delete/${id}`, {
                method: "DELETE",
                headers: { ...(token && { Authorization: `Bearer ${token}` }) },
            });
            if (!response.ok) return rejectWithValue(`HTTP ${response.status}`);
            return response.json();
        } catch (err) {
            return rejectWithValue(err);
        }
    },
);
