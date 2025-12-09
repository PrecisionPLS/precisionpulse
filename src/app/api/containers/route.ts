// src/app/api/containers/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculateContainerPay } from "@/lib/payScale";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      containerNo,
      piecesTotal,
      skusTotal,
      workers,
    } = body;

    if (
      !containerNo ||
      typeof piecesTotal !== "number" ||
      typeof skusTotal !== "number" ||
      !Array.isArray(workers) ||
      workers.length === 0
    ) {
      return NextResponse.json(
        { error: "Missing or invalid fields" },
        { status: 400 }
      );
    }

    // Calculate container pay on the server so it’s always correct
    const containerPay = calculateContainerPay(piecesTotal);

    const created = await prisma.container.create({
      data: {
        containerNo,
        piecesTotal,
        skusTotal,
        containerPay,
        workers: {
          create: workers.map((w: any) => ({
            name: w.name || "",
            minutesWorked: Number(w.minutesWorked) || 0,
            percentShare: Number(w.percentShare) || 0,
            payout:
              ((Number(w.percentShare) || 0) / 100) * containerPay,
          })),
        },
      },
      include: {
        workers: true,
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("Create container error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
