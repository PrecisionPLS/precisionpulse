// src/app/api/admin/users/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// GET /api/admin/users
// Returns all profiles
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, email, full_name, access_role, building, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching profiles", error);
    return NextResponse.json(
      { error: "Failed to fetch users" },
      { status: 500 }
    );
  }

  return NextResponse.json(data ?? []);
}

// POST /api/admin/users
// Creates a new Supabase auth user + profile
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      fullName,
      email,
      accessRole,
      building,
      password,
    }: {
      fullName?: string;
      email?: string;
      accessRole?: string;
      building?: string;
      password?: string;
    } = body;

    if (!fullName || !email || !password) {
      return NextResponse.json(
        { error: "fullName, email, and password are required" },
        { status: 400 }
      );
    }

    const emailLower = email.trim().toLowerCase();

    // 1) Create auth user with service role (no email confirmation needed)
    const { data: userData, error: userError } =
      await supabaseAdmin.auth.admin.createUser({
        email: emailLower,
        password,
        email_confirm: true, // mark email as confirmed
      });

    if (userError || !userData?.user) {
      console.error("Error creating auth user", userError);
      return NextResponse.json(
        { error: userError?.message || "Failed to create auth user" },
        { status: 500 }
      );
    }

    const authUser = userData.user;

    // 2) Insert profile row
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .insert({
        id: authUser.id,
        email: emailLower,
        full_name: fullName.trim(),
        access_role: accessRole || "Building Manager",
        building: building || "DC18",
      })
      .select("id, email, full_name, access_role, building, created_at")
      .single();

    if (profileError) {
      console.error("Error inserting profile", profileError);
      return NextResponse.json(
        { error: "User auth created, but failed to save profile." },
        { status: 500 }
      );
    }

    return NextResponse.json(profile, { status: 201 });
  } catch (err) {
    console.error("Unhandled error in POST /api/admin/users", err);
    return NextResponse.json(
      { error: "Unexpected server error" },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/users
// Updates profile fields (access_role, building, full_name)
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const {
      id,
      fullName,
      accessRole,
      building,
    }: {
      id?: string;
      fullName?: string;
      accessRole?: string;
      building?: string;
    } = body;

    if (!id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }

    const updateData: any = {};
    if (fullName !== undefined) updateData.full_name = fullName;
    if (accessRole !== undefined) updateData.access_role = accessRole;
    if (building !== undefined) updateData.building = building;

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .update(updateData)
      .eq("id", id)
      .select("id, email, full_name, access_role, building, created_at")
      .single();

    if (error) {
      console.error("Error updating profile", error);
      return NextResponse.json(
        { error: "Failed to update user profile" },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("Unhandled error in PATCH /api/admin/users", err);
    return NextResponse.json(
      { error: "Unexpected server error" },
      { status: 500 }
    );
  }
}
