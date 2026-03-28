import { NextResponse } from "next/server";

import { isHydraPersistenceEnabled, listPersistedTransactions } from "@/lib/hydradb-receipts";

export type Transaction = {
  id: string;
  merchantName: string | null;
  total: string | null;
  purchaseDate: string | null;
  processedAt: string;
  summary: string;
  receipt: {
    merchantName?: string;
    merchantAddress?: string;
    receiptNumber?: string;
    purchaseDate?: string;
    currency?: string;
    subtotal?: string;
    tax?: string;
    tip?: string;
    total?: string;
    paymentMethod?: string;
    lineItems: {
      description: string;
      quantity?: string;
      unitPrice?: string;
      totalPrice?: string;
    }[];
  };
};

/**
 * GET /api/transactions
 * Returns processed receipt transactions from HydraDB.
 */
export async function GET() {
  if (!isHydraPersistenceEnabled()) {
    return NextResponse.json({ transactions: [] satisfies Transaction[] });
  }

  try {
    const transactions = await listPersistedTransactions();
    return NextResponse.json({ transactions });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load transactions from HydraDB.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
