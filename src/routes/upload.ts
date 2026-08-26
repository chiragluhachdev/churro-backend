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
