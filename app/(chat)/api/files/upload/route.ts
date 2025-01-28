import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";

// Supported file types and their MIME types
const SUPPORTED_FILE_TYPES = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "application/pdf": [".pdf"],
  "text/plain": [".txt"],
  "application/json": [".json"],
} as const;

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// Use Blob instead of File since File is not available in Node.js environment
const FileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => file.size <= MAX_FILE_SIZE, {
      message: `File size must be less than ${MAX_FILE_SIZE / 1024 / 1024}MB`,
    })
    .refine((file) => Object.keys(SUPPORTED_FILE_TYPES).includes(file.type), {
      message: `File type must be one of: ${Object.keys(SUPPORTED_FILE_TYPES)
        .map(
          (type) =>
            SUPPORTED_FILE_TYPES[type as keyof typeof SUPPORTED_FILE_TYPES]
        )
        .flat()
        .join(", ")}`,
    }),
});

export async function POST(request: Request) {
  console.log("Starting file upload process");

  if (request.body === null) {
    console.error("Upload failed: Request body is empty");
    return NextResponse.json(
      { error: "Request body is empty" },
      { status: 400 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as Blob | null;

    if (!file) {
      console.error("Upload failed: No file in request");
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    console.log("Received file:", {
      type: file.type,
      size: `${(file.size / 1024).toFixed(2)}KB`,
    });

    const validatedFile = FileSchema.safeParse({ file });

    if (!validatedFile.success) {
      const errorMessage = validatedFile.error.errors
        .map((error) => error.message)
        .join(", ");

      console.error("File validation failed:", errorMessage);
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    // Get filename from formData since Blob doesn't have name property
    const originalFile = formData.get("file") as File;
    const filename = originalFile.name;

    // Validate filename
    if (!filename) {
      console.error("Upload failed: Missing filename");
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    // Generate a safe filename with timestamp to prevent collisions
    const safeFilename = `${Date.now()}-${filename.replace(
      /[^a-zA-Z0-9.-]/g,
      "_"
    )}`;

    console.log("Processing file:", {
      originalName: filename,
      safeName: safeFilename,
    });

    try {
      const fileBuffer = await file.arrayBuffer();
      console.log("Converting file to buffer successful");

      const data = await put(safeFilename, fileBuffer, {
        access: "public",
        addRandomSuffix: true, // Add random suffix for extra collision prevention
      });

      console.log("File upload successful:", {
        url: data.url,
      });

      return NextResponse.json({
        ...data,
        originalName: filename,
      });
    } catch (error) {
      console.error("Blob storage error:", error);
      return NextResponse.json(
        {
          error: "Failed to upload file to storage",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Request processing error:", error);
    return NextResponse.json(
      {
        error: "Failed to process upload request",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
