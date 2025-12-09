"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const CONTAINER_STORAGE_KEY = "precisionpulse_containers";
const WORKORDER_STORAGE_KEY = "precisionpulse_workorders";

type SavedWorker = {
  name: string;
  minutesWorked: number;
  percentShare: number;
  payout: number;
};

type SavedContainer = {
  id: string;
  containerNo: string;
  piecesTotal: number;
  skusTotal: number;
  containerPay: number;
  workers: SavedWorker[];
};

type WorkOrder = {
  id: string;
  workOrderNo: string;
  building: string;
  shift: string;
  containerIds: string[];
  createdAt: string;
};

const BUILDINGS = ["DC1", "DC5", "DC11", "DC14", "DC18"];
const SHIFTS = ["1st", "2nd", "3rd", "4th"];

export default function ShiftsPage() {
  const [containers, setContainers] = useState<SavedContainer[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);

  const [selectedBuilding, setSelectedBuilding] = useState(BUILDINGS[0]);
  const [selectedShift, setSelectedShift] = useState(SHIFTS[0]);

  // Load data from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const rawContainers = window.localStorage.getItem(
        CONTAINER_STORAGE_KEY
      );
      if (rawContainers) {
        setContainers(JSON.parse(rawContainers));
      }
    } catch (e) {
      console.error("Failed to load containers on Shifts page", e);
    }

    try {
      const rawWorkOrders = window.localStorage.getItem(
        WORKORDER_STORAGE_KEY
      );
      if (rawWorkOrders) {
        setWorkOrders(JSON.parse(rawWorkOrders));
      }
    } catch (e) {
      console.error("Failed to load work orders on Shifts page", e);
    }
  }, []);

  // Filter work orders by selected building + shift
  const filteredWorkOrders = useMemo(
    () =>
      workOrders.filter(
        (wo) =>
          wo.building === selectedBuilding && wo.shift === selectedShift
      ),
    [workOrders, selectedBuilding, selectedShift]
  );

  // Containers linked to the filtered work orders
  const filteredContainers = useMemo(() => {
    const containerIds = new Set(
      filteredWorkOrders.flatMap((wo) => wo.containerIds)
    );
    return containers.filter((c) => containerIds.has(c.id));
  }, [filteredWorkOrders, containers]);

  const summary = useMemo(() => {
    const totalContainers = filteredContainers.length;
    const totalPieces = filteredContainers.reduce(
      (sum, c) => sum + c.piecesTotal,
      0
    );
    const totalPay = filteredContainers.reduce(
      (sum, c) => sum + c.containerPay,
      0
    );
    return {
      totalContainers,
      totalPieces,
      totalPay,
    };
  }, [filteredContainers]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
  <div>
    <h1 className="text-2xl font-semibold text-slate-50">
      Shifts Overview
    </h1>
    <p className="text-sm text-slate-400">
      View production and payout by building and shift, based on work
      orders and container assignments.
    </p>
  </div>
  <Link
    href="/"
    className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
  >
    ← Back to Dashboard
  </Link>
</div>

      {/* Filters + summary */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-slate-300 mb-1">
              Building
            </label>
            <select
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
              value={selectedBuilding}
              onChange={(e) => setSelectedBuilding(e.target.value)}
            >
              {BUILDINGS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-300 mb-1">
              Shift
            </label>
            <select
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
              value={selectedShift}
              onChange={(e) => setSelectedShift(e.target.value)}
            >
              {SHIFTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="col-span-2 grid grid-cols-3 gap-3 text-xs">
            <div className="rounded-xl bg-slate-950 border border-slate-700 px-3 py-2">
              <div className="text-slate-400 mb-1">
                Containers this shift
              </div>
              <div className="text-lg font-semibold text-sky-300">
                {summary.totalContainers}
              </div>
            </div>
            <div className="rounded-xl bg-slate-950 border border-slate-700 px-3 py-2">
              <div className="text-slate-400 mb-1">
                Pieces this shift
              </div>
              <div className="text-lg font-semibold text-emerald-300">
                {summary.totalPieces}
              </div>
            </div>
            <div className="rounded-xl bg-slate-950 border border-slate-700 px-3 py-2">
              <div className="text-slate-400 mb-1">
                Payout this shift
              </div>
              <div className="text-lg font-semibold text-amber-300">
                ${summary.totalPay.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Work orders list for selection */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-slate-100">
            Work Orders - {selectedBuilding} / {selectedShift}
          </h2>
          <div className="text-xs text-slate-500">
            Work orders filtered by building and shift.
          </div>
        </div>

        {filteredWorkOrders.length === 0 ? (
          <p className="text-sm text-slate-500">
            No work orders for this building and shift. Create some on the
            Work Orders page.
          </p>
        ) : (
          <div className="space-y-3">
            {filteredWorkOrders.map((wo) => {
              const relatedContainers = containers.filter((c) =>
                wo.containerIds.includes(c.id)
              );
              const pieces = relatedContainers.reduce(
                (sum, c) => sum + c.piecesTotal,
                0
              );
              const pay = relatedContainers.reduce(
                (sum, c) => sum + c.containerPay,
                0
              );
              return (
                <div
                  key={wo.id}
                  className="border border-slate-800 rounded-xl p-3 bg-slate-950"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="text-sm font-semibold text-slate-50">
                      Work Order #{wo.workOrderNo}
                    </div>
                    <div className="text-xs text-slate-400">
                      Containers:{" "}
                      <span className="text-sky-300">
                        {relatedContainers.length}
                      </span>{" "}
                      • Pieces:{" "}
                      <span className="text-emerald-300">{pieces}</span>{" "}
                      • Pay:{" "}
                      <span className="text-amber-300">
                        ${pay.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-slate-300">
                    {relatedContainers.map((c) => (
                      <div
                        key={c.id}
                        className="border border-slate-800 rounded-lg px-2 py-1 bg-slate-900"
                      >
                        <div className="font-semibold text-slate-100">
                          {c.containerNo}
                        </div>
                        <div className="text-slate-400">
                          Pieces {c.piecesTotal} • Pay $
                          {c.containerPay.toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
