// src/app/api/containers/get/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const containers = await prisma.container.findMany({
      orderBy: { createdAt: "desc" },
      include: { workers: true },
    });

    return NextResponse.json(containers);
  } catch (error) {
    console.error("Get containers error:", error);
    return NextResponse.json(
      { error: "Failed to load containers" },
      { status: 500 }
    );
  }
}
