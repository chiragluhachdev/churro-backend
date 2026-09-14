import { appUrl, sendCourseAccessEmail } from "./email.js";
import { BillingSettings } from "../models/BillingSettings.js";
import { Course, type CourseDoc } from "../models/Course.js";
import { Order, type OrderDoc } from "../models/Order.js";

/**
 * Sends (or resends) the "you're enrolled" email for one paid order, using
 * whatever lesson video links the admin has set on the course right now —
 * so editing them later and hitting "Resend" picks up the change. Records
 * the outcome on the order; never throws.
 */
export async function dispatchOrderEmail(order: OrderDoc): Promise<{ ok: true } | { ok: false; error: string }> {
  const course = (await Course.findById(order.course).lean()) as CourseDoc | null;
  const settings = await BillingSettings.findOne({ key: "billing" }).lean();
  const seller = {
    companyName: settings?.companyName || "Churro Academy",
    email: settings?.email || "",
    phone: settings?.phone || "",
  };

  const result = await sendCourseAccessEmail({
    to: order.buyerEmail,
    buyerName: order.buyerName,
    courseTitle: order.courseTitle,
    shortDescription: course?.shortDescription ?? "",
    invoiceNumber: order.invoiceNumber,
    invoiceUrl: `${appUrl()}/invoice/${String(order._id)}`,
    sections: (course?.curriculum ?? []).map((section) => ({
      title: section.title,
      lessons: section.lessons.map((lesson) => ({ title: lesson.title, videoUrl: lesson.videoUrl })),
    })),
    seller,
  });

  if (result.ok) {
    await Order.updateOne({ _id: order._id }, { $set: { emailSentAt: new Date(), emailError: "" } });
  } else {
    console.error(`[email] failed to send order ${String(order._id)} to ${order.buyerEmail}:`, result.error);
    await Order.updateOne({ _id: order._id }, { $set: { emailError: result.error } });
  }
  return result;
}
