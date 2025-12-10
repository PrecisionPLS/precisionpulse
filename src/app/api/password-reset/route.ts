import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    // Where should the reset link send them?
    // Update this if you have a custom reset page.
    const redirectTo =
      process.env.NEXT_PUBLIC_SUPABASE_REDIRECT_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "http://localhost:3000/auth";

    const { data, error } =
      await supabaseAdmin.auth.resetPasswordForEmail(email, {
        redirectTo,
      });

    if (error) {
      console.error("resetPasswordForEmail error", error);
      return NextResponse.json(
        { error: error.message || "Failed to send reset email" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Password reset email sent (if user exists).",
      data,
    });
  } catch (e: any) {
    console.error("Unexpected error in /api/password-reset", e);
    return NextResponse.json(
      { error: "Unexpected server error" },
      { status: 500 }
    );
  }
}
