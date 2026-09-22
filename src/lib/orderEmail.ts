import { sendCourseAccessEmail } from "./email.js";
import { gstBreakdown } from "./invoice.js";
import { generateInvoicePdf } from "./invoicePdf.js";
import { BillingSettings } from "../models/BillingSettings.js";
import { Course, type CourseDoc } from "../models/Course.js";
import { Order, type OrderDoc } from "../models/Order.js";

/**
 * Sends (or resends) the "you're enrolled" email for one paid order, using
 * whatever Drive link/password the admin has set on the course right now —
 * so editing them later and hitting "Resend" picks up the change. The tax
 * invoice goes along as a real PDF attachment, not a link to click through.
 * Records the outcome on the order; never throws.
 */
export async function dispatchOrderEmail(order: OrderDoc): Promise<{ ok: true } | { ok: false; error: string }> {
  const course = (await Course.findById(order.course).lean()) as CourseDoc | null;
  const settings = await BillingSettings.findOne({ key: "billing" }).lean();
  const seller = {
    companyName: settings?.companyName || "Churro Academy",
    gstin: settings?.gstin || "",
    address: settings?.address || "",
    email: settings?.email || "",
    phone: settings?.phone || "",
  };
  const gst = gstBreakdown(order.amount, settings?.gstRate ?? 18);

  const invoicePdf =
    order.status === "paid"
      ? await generateInvoicePdf({
          invoiceNumber: order.invoiceNumber,
          status: order.status,
          date: order.paidAt ?? order.createdAt,
          currency: order.currency,
          courseTitle: order.courseTitle,
          buyer: { name: order.buyerName, email: order.buyerEmail, phone: order.buyerPhone },
          seller,
          gst,
        }).then((content) => ({ filename: `Invoice-${order.invoiceNumber || order._id}.pdf`, content }))
      : undefined;

  const result = await sendCourseAccessEmail({
    to: order.buyerEmail,
    buyerName: order.buyerName,
    courseTitle: order.courseTitle,
    shortDescription: course?.shortDescription ?? "",
    invoiceNumber: order.invoiceNumber,
    driveLink: course?.driveLink ?? "",
    drivePassword: course?.drivePassword ?? "",
    seller,
    invoicePdf,
  });

  if (result.ok) {
    await Order.updateOne({ _id: order._id }, { $set: { emailSentAt: new Date(), emailError: "" } });
  } else {
    console.error(`[email] failed to send order ${String(order._id)} to ${order.buyerEmail}:`, result.error);
    await Order.updateOne({ _id: order._id }, { $set: { emailError: result.error } });
  }
  return result;
}
