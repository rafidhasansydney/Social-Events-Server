import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import { rateLimit } from "express-rate-limit";
import { UploadedImage } from "../models/image.js";
import { HttpError } from "../utils/http-error.js";

const types = ["image/jpeg", "image/png", "image/webp"];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 4 * 1024 * 1024,
    files: 1,
    fields: 0,
    parts: 1,
    headerPairs: 30,
  },
  fileFilter(req, file, done) {
    if (!types.includes(file.mimetype))
      return done(
        new HttpError(400, "INVALID_IMAGE", "Choose a JPG, PNG or WebP photo."),
      );
    done(null, true);
  },
});

export async function prepareImage(buffer, kind = "event") {
  try {
    const image = sharp(buffer, {
      limitInputPixels: 40_000_000,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    if (
      !["jpeg", "png", "webp"].includes(metadata.format) ||
      (metadata.pages || 1) > 1
    )
      throw new Error();
    const size = kind === "profile" ? 512 : 1600;
    const result = await image
      .rotate()
      .resize(size, size, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    if (result.data.length > 1024 * 1024)
      throw new HttpError(
        400,
        "IMAGE_TOO_COMPLEX",
        "Choose a smaller photo and try again.",
      );
    return {
      data: result.data,
      width: result.info.width,
      height: result.info.height,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      400,
      "INVALID_IMAGE",
      "We couldn’t read that photo. Choose a valid JPG, PNG or WebP under 4 MB and 40 megapixels.",
    );
  }
}

export function createImageRouter({
  authenticate,
  clientUrl,
  imageModel = UploadedImage,
}) {
  const router = Router();
  const limit = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    keyGenerator: (req) => req.auth.id,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler(req, res, next) {
      next(
        new HttpError(
          429,
          "UPLOAD_LIMIT",
          "You’ve reached the photo upload limit. Please try again in an hour.",
        ),
      );
    },
  });

  router.post(
    "/uploads",
    authenticate,
    limit,
    upload.single("image"),
    async (req, res) => {
      if (!req.file)
        throw new HttpError(400, "IMAGE_REQUIRED", "Choose a photo to upload.");
      const kind = req.query.kind || "event";
      if (!["event", "profile"].includes(kind))
        throw new HttpError(
          400,
          "INVALID_IMAGE_KIND",
          "Choose an event or profile photo.",
        );
      const photo = await prepareImage(req.file.buffer, kind);
      const image = await imageModel.create({ ...photo, ownerId: req.auth.id });
      res
        .status(201)
        .json({
          ok: true,
          image: {
            url: `${clientUrl}/api/images/${image._id}`,
            width: image.width,
            height: image.height,
          },
        });
    },
  );

  router.get("/images/:id", async (req, res) => {
    if (!/^[a-f\d]{24}$/i.test(req.params.id))
      throw new HttpError(404, "IMAGE_NOT_FOUND", "This photo is unavailable.");
    const image = await imageModel.findById(req.params.id).select("+data");
    if (!image)
      throw new HttpError(404, "IMAGE_NOT_FOUND", "This photo is unavailable.");
    res.set({
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Type": "image/webp",
      "Content-Disposition": 'inline; filename="bandhan-photo.webp"',
    });
    res.send(image.data);
  });

  return router;
}
