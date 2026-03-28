export type ReceiptImageRecord = {
  id: string;
  messageGuid: string;
  chatId: string;
  filename: string | null;
  mimeType: string;
  size: number;
  key: string;
  url: string;
  uploadedAt: string;
};

const receiptImages: ReceiptImageRecord[] = [];
const MAX_RECORDS = 1000;

export function addReceiptImage(record: ReceiptImageRecord): void {
  receiptImages.unshift(record);
  if (receiptImages.length > MAX_RECORDS) {
    receiptImages.length = MAX_RECORDS;
  }
}

export function listReceiptImages(): ReceiptImageRecord[] {
  return [...receiptImages];
}
