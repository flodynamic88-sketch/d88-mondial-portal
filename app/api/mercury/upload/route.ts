import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

/**
 * Vercel Blob client-upload token endpoint.
 *
 * The browser never talks to Blob directly with a secret key -- it calls
 * this route first to get a short-lived upload token (protected by the
 * same Supabase auth cookie / middleware.ts as every other route in the
 * app), then uploads straight to Blob storage with that token.
 *
 * Used by components/PhotoAttachments.tsx for Bad Orders, Incident
 * Reports, and Stock Receiving photo evidence.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        return {
          allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "image/heic"],
          addRandomSuffix: true,
          maximumSizeInBytes: 10 * 1024 * 1024, // 10MB
        };
      },
      onUploadCompleted: async () => {
        // no-op -- the client already receives the blob URL directly
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
