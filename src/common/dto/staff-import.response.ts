export type StaffImportRowError = { row: number; message: string };

export type StaffImportResponse = {
  imported: number;
  updated: number;
  skipped: number;
  errors: StaffImportRowError[];
  message: string;
  /** Present when dryRun: true */
  valid?: number;
};
