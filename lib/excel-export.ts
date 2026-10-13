import ExcelJS from "exceljs";

export type ResumeExportRow = {
  id: string;
  fileName: string;
  name: string;
  email: string;
  phone: string;
  designation: string;
  nameConfidence: number;
  emailConfidence: number;
  phoneConfidence: number;
  designationConfidence: number;
  overallConfidence: number;
  status: string;
  createdAt: string;
};

export function createResumeWorksheet(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
) {
  const sheet = workbook.addWorksheet("Resumes");
  sheet.columns = [
    { header: "CV ID", key: "id", width: 24 },
    { header: "File Name", key: "fileName", width: 32 },
    { header: "Name", key: "name", width: 24 },
    { header: "Email", key: "email", width: 32 },
    { header: "Phone", key: "phone", width: 22 },
    { header: "Designation", key: "designation", width: 30 },
    { header: "Name Confidence", key: "nameConfidence", width: 18 },
    { header: "Email Confidence", key: "emailConfidence", width: 18 },
    { header: "Phone Confidence", key: "phoneConfidence", width: 18 },
    {
      header: "Designation Confidence",
      key: "designationConfidence",
      width: 23,
    },
    { header: "Overall Confidence", key: "overallConfidence", width: 20 },
    { header: "Status", key: "status", width: 16 },
    { header: "Created At", key: "createdAt", width: 24 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF6652CF" },
  };
  return sheet;
}

export function appendResumeExportRow(
  sheet: Pick<ExcelJS.Worksheet, "addRow">,
  row: ResumeExportRow,
) {
  sheet.addRow(row).commit();
}
