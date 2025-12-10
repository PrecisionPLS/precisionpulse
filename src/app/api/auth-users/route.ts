import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Admin client using service role key (SERVER ONLY)
const supabaseAdmin =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey)
    : null;

export async function POST(req: Request) {
  if (!supabaseAdmin) {
    console.error("Supabase admin client not initialized - missing env vars.");
    return NextResponse.json(
      {
        error:
          "Server misconfiguration: missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL.",
      },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const email = (body.email || "").trim().toLowerCase();
    const name = (body.name || "").trim() || undefined;
    const sendInvite = body.sendInvite ?? true;

    if (!email) {
      return NextResponse.json(
        { error: "Email is required." },
        { status: 400 }
      );
    }

    // 1) Check if a user already exists in Supabase Auth
    // Using the auth.users table (requires service role key)
    const { data: existingUsers, error: existingError } = await supabaseAdmin
      .from("auth.users")
      .select("id, email")
      .eq("email", email)
      .limit(1);

    if (existingError) {
      console.error("Error checking existing auth user", existingError);
      // We won't fail hard here; we'll just continue and try to create the user
    }

    const existingUser = existingUsers && existingUsers[0];

    if (existingUser) {
      // Already has an auth user
      return NextResponse.json(
        {
          ok: true,
          alreadyExists: true,
          userId: existingUser.id,
        },
        { status: 200 }
      );
    }

    // 2) If not, create + optionally send invite
    let createdUserId: string | undefined;

    if (sendInvite) {
      // inviteUserByEmail both creates and sends an email
      const { data, error } =
        await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
          data: name ? { name } : undefined,
        });

      if (error) {
        console.error("Error inviting user by email", error);
        return NextResponse.json(
          { error: error.message || "Failed to invite user." },
          { status: 500 }
        );
      }

      createdUserId = data?.user?.id;
    } else {
      // Just create the user silently without sending an email
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: name ? { name } : undefined,
      });

      if (error) {
        console.error("Error creating auth user", error);
        return NextResponse.json(
          { error: error.message || "Failed to create auth user." },
          { status: 500 }
        );
      }

      createdUserId = data.user?.id;
    }

    return NextResponse.json(
      {
        ok: true,
        alreadyExists: false,
        userId: createdUserId,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Unexpected error in /api/auth-users", err);
    return NextResponse.json(
      {
        error: "Unexpected server error while creating auth user.",
      },
      { status: 500 }
    );
  }
}
