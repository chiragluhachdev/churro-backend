import { Router } from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";

import { asyncHandler, HttpError } from "../lib/http.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({ storage: multer.memoryStorage() });

export const uploadRouter = Router();

uploadRouter.post(
  "/",
  authenticate,
  requireAdmin,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "No file uploaded.");

    const b64 = Buffer.from(req.file.buffer).toString("base64");
    const dataURI = `data:${req.file.mimetype};base64,${b64}`;

    try {
      const result = await cloudinary.uploader.upload(dataURI, {
        folder: "churro_academy",
      });
      res.status(201).json({ url: result.secure_url });
    } catch (error) {
      console.error("Cloudinary upload error:", error);
      throw new HttpError(500, "Failed to upload image.");
    }
  }),
);

/**
 * Signs a direct browser-to-Cloudinary upload for course images (thumbnails,
 * hero images). The API secret never leaves the server.
 */
uploadRouter.post(
  "/signature",
  authenticate,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const { cloud_name, api_key, api_secret } = cloudinary.config();
    if (!cloud_name || !api_key || !api_secret) throw new HttpError(503, "Uploads aren't configured on the server.");

    const timestamp = Math.round(Date.now() / 1000);
    const folder = "churro_academy";
    const signature = cloudinary.utils.api_sign_request({ timestamp, folder }, api_secret);

    res.json({
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloud_name}/image/upload`,
      apiKey: api_key,
      timestamp,
      folder,
      signature,
    });
  }),
);
