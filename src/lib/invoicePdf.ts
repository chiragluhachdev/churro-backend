import PDFDocument from "pdfkit";

import type { GstBreakdown } from "./invoice.js";

export interface InvoicePdfData {
  invoiceNumber: string;
  status: string;
  date?: Date;
  currency: string;
  courseTitle: string;
  buyer: { name: string; email: string; phone: string };
  seller: { companyName: string; gstin: string; address: string; email: string; phone: string };
  gst: GstBreakdown;
}

const COLORS = {
  forestDeep: "#163B29",
  forest: "#294B32",
  ink: "#1B2A20",
  muted: "#6F6A60",
  line: "#E7DFD1",
  cream: "#F9F6F2",
};

const money = (value: number, currency: string) =>
  `${currency === "INR" ? "Rs. " : currency + " "}${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Renders the same tax invoice the web `/invoice/[id]` page shows, as a PDF —
 * so it can travel as a real attachment instead of a link the buyer has to
 * click through. Resolves to the finished file's bytes.
 */
export function generateInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;

    // ---- Header: seller on the left, invoice meta on the right ------------
    doc.font("Helvetica-Bold").fontSize(18).fillColor(COLORS.forestDeep).text(data.seller.companyName, left, 50);
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted);
    let y = doc.y + 2;
    if (data.seller.gstin) {
      doc.text(`GSTIN: ${data.seller.gstin}`, left, y);
      y = doc.y;
    }
    if (data.seller.address) {
      doc.text(data.seller.address, left, y, { width: pageWidth * 0.55 });
      y = doc.y;
    }
    const contactLine = [data.seller.email, data.seller.phone].filter(Boolean).join("  ·  ");
    if (contactLine) doc.text(contactLine, left, y);

    doc.font("Helvetica-Bold").fontSize(16).fillColor(COLORS.ink).text("TAX INVOICE", left, 50, { width: pageWidth, align: "right" });
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted);
    doc.text(data.invoiceNumber || "—", left, doc.y + 2, { width: pageWidth, align: "right" });
    if (data.date) {
      doc.text(
        data.date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
        left,
        doc.y,
        { width: pageWidth, align: "right" },
      );
    }
    doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.forest);
    doc.text(data.status.toUpperCase(), left, doc.y + 2, { width: pageWidth, align: "right" });

    doc.moveDown(2);
    const dividerY = doc.y;
    doc.moveTo(left, dividerY).lineTo(left + pageWidth, dividerY).strokeColor(COLORS.line).lineWidth(1).stroke();
    doc.moveDown(1.2);

    // ---- Billed to ----------------------------------------------------------
    doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.muted).text("BILLED TO", left, doc.y);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(COLORS.ink).text(data.buyer.name, left, doc.y + 3);
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted);
    doc.text(data.buyer.email, left, doc.y + 2);
    doc.text(data.buyer.phone, left, doc.y + 2);

    doc.moveDown(1.5);
    const tableTop = doc.y + 10;
    const col2 = left + pageWidth - 130; // amount column, right-aligned block

    // ---- Line items table -----------------------------------------------
    doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.muted);
    doc.text("DESCRIPTION", left, tableTop);
    doc.text("AMOUNT", col2, tableTop, { width: 130, align: "right" });
    let rowY = tableTop + 16;
    doc.moveTo(left, rowY).lineTo(left + pageWidth, rowY).strokeColor(COLORS.line).lineWidth(1).stroke();
    rowY += 10;

    const row = (label: string, amount: string, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 10).fillColor(COLORS.ink);
      doc.text(label, left, rowY, { width: pageWidth - 140 });
      const labelHeight = doc.heightOfString(label, { width: pageWidth - 140 });
      doc.text(amount, col2, rowY, { width: 130, align: "right" });
      rowY += Math.max(labelHeight, 14) + 10;
    };

    row(`${data.courseTitle} — course access`, money(data.gst.taxableValue, data.currency));
    row(`CGST (${(data.gst.gstRate / 2).toFixed(1)}%)`, money(data.gst.cgstAmount, data.currency));
    row(`SGST (${(data.gst.gstRate / 2).toFixed(1)}%)`, money(data.gst.sgstAmount, data.currency));

    doc.moveTo(left, rowY).lineTo(left + pageWidth, rowY).strokeColor(COLORS.line).lineWidth(1).stroke();
    rowY += 12;
    row("Total", money(data.gst.totalAmount, data.currency), true);

    // ---- Footer -------------------------------------------------------------
    doc.font("Helvetica").fontSize(8).fillColor(COLORS.muted).text(
      `This is a system-generated invoice for ${data.seller.companyName}` +
        (data.seller.gstin ? ` (GSTIN ${data.seller.gstin})` : "") +
        `. Prices are inclusive of GST.` +
        (contactLine ? ` For billing questions, reach us at ${contactLine}.` : ""),
      left,
      rowY + 30,
      { width: pageWidth },
    );

    doc.end();
  });
}
