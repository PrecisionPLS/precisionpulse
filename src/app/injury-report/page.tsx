"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, FormEvent } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { BUILDINGS } from "@/lib/buildings";

const SHIFTS = ["1st", "2nd", "3rd", "4th"] as const;
type ShiftName = (typeof SHIFTS)[number];

type WorkforceWorker = {
  id: string;
  fullName: string;
  building: string | null;
  shift: string | null;
  active: boolean;
};

type ProtocolDoc = {
  id: string;
  title: string;
  description: string | null;
  file_path: string;
  sort_order: number;
  is_active: boolean;
};

type Witness = { name: string; phone?: string; statement?: string };

type ReportRow = {
  id: string;
  created_at: string;

  building: string;
  shift: string | null;
  work_date: string;

  reported_by_user_id: string | null;
  reported_by_email: string | null;
  reported_by_name: string | null;
  reported_by_role: string | null;

  employee_id: string | null;
  employee_name: string;
  employee_phone: string | null;
  employee_dob: string | null;
  employee_job_title: string | null;

  incident_datetime: string;
  incident_location: string;
  incident_area: string | null;
  incident_type: string;
  body_part: string;
  injury_description: string;
  immediate_actions: string;

  first_aid_given: boolean;
  first_aid_by: string | null;
  ems_called: boolean;
  sent_to_clinic: boolean;
  clinic_name: string | null;

  medical_refused: boolean;
  refusal_reason: string | null;

  supervisor_on_duty: string | null;
  witnesses: Witness[];
  employee_statement: string | null;

  status: string;
  hr_notes: string | null;

  employee_signed: boolean;
  manager_signed: boolean;

  work_order_id: string | null;

  // Optional if you added these columns:
  emailed_draft_at?: string | null;
  emailed_submitted_at?: string | null;
};

type FileRow = {
  id: string;
  report_id: string;
  file_path: string;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  category: string;
  created_at: string;
};

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function extractName(user: unknown): string {
  if (!user || typeof user !== "object") return "User";
  const u = user as Record<string, unknown>;

  const fullName = typeof u.fullName === "string" ? u.fullName : "";
  const name = typeof u.name === "string" ? u.name : "";
  const email = typeof u.email === "string" ? u.email : "";

  return fullName || name || (email ? email.split("@")[0] : "User");
}

type WorkforceRow = Record<string, unknown>;
function mapWorkforceRow(row: WorkforceRow): WorkforceWorker {
  const fullName =
    (typeof row.full_name === "string" ? row.full_name : null) ??
    (typeof row.fullName === "string" ? row.fullName : null) ??
    (typeof row.name === "string" ? row.name : null) ??
    (typeof row.worker_name === "string" ? row.worker_name : null) ??
    "Unknown";

  const building =
    (typeof row.building === "string" ? row.building : null) ??
    (typeof row.dc === "string" ? row.dc : null) ??
    (typeof row.location === "string" ? row.location : null) ??
    null;

  const shift =
    (typeof row.shift === "string" ? row.shift : null) ??
    (typeof row.shift_name === "string" ? row.shift_name : null) ??
    (typeof row.shiftName === "string" ? row.shiftName : null) ??
    null;

  const activeRaw =
    (typeof row.active === "boolean" ? row.active : null) ??
    (typeof row.is_active === "boolean" ? row.is_active : null) ??
    null;

  const statusRaw =
    (typeof row.status === "string" ? row.status : null) ??
    (typeof row.employment_status === "string" ? row.employment_status : null) ??
    null;

  const active =
    typeof activeRaw === "boolean"
      ? activeRaw
      : statusRaw
      ? String(statusRaw).toLowerCase().includes("active")
      : true;

  const idValue =
    (typeof row.id === "string" ? row.id : null) ??
    (typeof row.id === "number" ? String(row.id) : null) ??
    (typeof row.worker_id === "string" ? row.worker_id : null) ??
    (typeof row.worker_id === "number" ? String(row.worker_id) : null) ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()));

  return {
    id: String(idValue),
    fullName: String(fullName).trim(),
    building,
    shift,
    active,
  };
}

const INCIDENT_TYPES = [
  "Slip / Trip / Fall",
  "Strain / Sprain",
  "Cut / Laceration",
  "Pinch / Crush",
  "Impact / Struck By",
  "Overexertion",
  "Burn",
  "Chemical Exposure",
  "Eye Injury",
  "Other",
] as const;

const BODY_PARTS = [
  "Head / Face",
  "Eye",
  "Neck",
  "Shoulder",
  "Arm",
  "Elbow",
  "Wrist / Hand / Fingers",
  "Back",
  "Hip",
  "Leg",
  "Knee",
  "Ankle / Foot / Toes",
  "Multiple",
  "Other",
] as const;

export default function InjuryReportPage() {
  const currentUser = useCurrentUser();

  const role = currentUser?.accessRole || "";
  const isLead = role === "Lead";
  const isBuildingManager = role === "Building Manager";
  const isSuperAdmin = role === "Super Admin";

  // Scoped view (Lead + Building Manager stay in their building)
  const isScoped = (isLead || isBuildingManager) && !!currentUser?.building;
  const scopedBuilding = currentUser?.building || "";

  // HR/Admin tier (keep)
  const canManageAll =
    role === "Super Admin" || role === "Admin" || role === "HR" || role === "Director of Operations";

  // KEY RULES YOU ASKED FOR:
  // - ONLY Building Managers + Super Admin can edit/delete existing reports
  const canEditExisting = isSuperAdmin || isBuildingManager;
  const canDeleteExisting = isSuperAdmin || isBuildingManager;

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [protocolDocs, setProtocolDocs] = useState<ProtocolDoc[]>([]);
  const [protocolLoading, setProtocolLoading] = useState(false);

  const [workforce, setWorkforce] = useState<WorkforceWorker[]>([]);
  const [workforceLoading, setWorkforceLoading] = useState(false);

  const [reports, setReports] = useState<ReportRow[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);

  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const selectedReport = useMemo(
    () => reports.find((r) => r.id === selectedReportId) || null,
    [reports, selectedReportId]
  );

  const [files, setFiles] = useState<FileRow[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);

  const [form, setForm] = useState<Omit<ReportRow, "id" | "created_at">>(() => ({
    building: currentUser?.building || BUILDINGS[0] || "DC18",
    shift: "1st",
    work_date: todayISODate(),

    reported_by_user_id: currentUser?.id ?? null,
    reported_by_email: currentUser?.email ?? null,
    reported_by_name: extractName(currentUser),
    reported_by_role: role || null,

    employee_id: null,
    employee_name: "",
    employee_phone: "",
    employee_dob: null,
    employee_job_title: "",

    incident_datetime: new Date().toISOString(),
    incident_location: "",
    incident_area: "",
    incident_type: "Slip / Trip / Fall",
    body_part: "Other",
    injury_description: "",
    immediate_actions: "",

    first_aid_given: false,
    first_aid_by: "",
    ems_called: false,
    sent_to_clinic: false,
    clinic_name: "",

    medical_refused: false,
    refusal_reason: "",

    supervisor_on_duty: "",
    witnesses: [],
    employee_statement: "",

    status: "Draft",
    hr_notes: "",

    employee_signed: false,
    manager_signed: false,

    work_order_id: null,

    emailed_draft_at: null,
    emailed_submitted_at: null,
  }));

  // Printable area ref
  const printRef = useRef<HTMLDivElement>(null);

  // Built-in print using a new window
  function handlePrintPacket() {
    if (!printRef.current) return;

    const html = printRef.current.innerHTML;
    const title = selectedReport
      ? `Injury_Report_${selectedReport.employee_name}_${String(selectedReport.work_date).slice(0, 10)}`
      : "Injury_Report";

    const w = window.open("", "_blank", "width=900,height=900");
    if (!w) {
      setError("Popup blocked. Allow popups to print/download.");
      return;
    }

    w.document.open();
    w.document.write(`
      <html>
        <head>
          <title>${title}</title>
          <meta charset="utf-8" />
          <style>
            body { font-family: Arial, Helvetica, sans-serif; padding: 24px; }
            hr { margin: 14px 0; }
            ul { padding-left: 18px; }
          </style>
        </head>
        <body>
          ${html}
          <script>
            window.onload = function() { window.print(); };
          </script>
        </body>
      </html>
    `);
    w.document.close();
  }

  function resetForm() {
    setForm({
      building: currentUser?.building || BUILDINGS[0] || "DC18",
      shift: "1st",
      work_date: todayISODate(),

      reported_by_user_id: currentUser?.id ?? null,
      reported_by_email: currentUser?.email ?? null,
      reported_by_name: extractName(currentUser),
      reported_by_role: role || null,

      employee_id: null,
      employee_name: "",
      employee_phone: "",
      employee_dob: null,
      employee_job_title: "",

      incident_datetime: new Date().toISOString(),
      incident_location: "",
      incident_area: "",
      incident_type: "Slip / Trip / Fall",
      body_part: "Other",
      injury_description: "",
      immediate_actions: "",

      first_aid_given: false,
      first_aid_by: "",
      ems_called: false,
      sent_to_clinic: false,
      clinic_name: "",

      medical_refused: false,
      refusal_reason: "",

      supervisor_on_duty: "",
      witnesses: [],
      employee_statement: "",

      status: "Draft",
      hr_notes: "",

      employee_signed: false,
      manager_signed: false,

      work_order_id: null,

      emailed_draft_at: null,
      emailed_submitted_at: null,
    });
    setSelectedReportId(null);
    setFiles([]);
  }

  // -----------------------------
  // EMAIL NOTIFICATION (Edge Function)
  // -----------------------------
  async function sendEmailNotification(reportId: string, event: "draft" | "submitted") {
    try {
      // Non-blocking; function itself handles duplicates using emailed_* columns
      const { error } = await supabase.functions.invoke("injury-email", {
        body: { report_id: reportId, event },
      });
      if (error) {
        // Don’t block user flow; show a small warning only
        console.warn("injury-email invoke error:", error);
      }
    } catch (e) {
      console.warn("injury-email invoke failed:", e);
    }
  }

  const loadProtocolDocs = useCallback(async () => {
    setProtocolLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("injury_protocol_docs")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      if (error) throw error;
      setProtocolDocs((data || []) as ProtocolDoc[]);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e ? String((e as { message?: unknown }).message) : "Unknown error";
      setError(`Failed to load protocol docs: ${msg}`);
    } finally {
      setProtocolLoading(false);
    }
  }, []);

  const loadWorkforce = useCallback(async () => {
    if (!currentUser) return;
    setWorkforceLoading(true);
    setError(null);
    try {
      let q = supabase.from("workforce").select("*").order("created_at", { ascending: false });
      if (isScoped) q = q.eq("building", scopedBuilding);

      const { data, error } = await q;
      if (error) throw error;

      const mapped = (data || [])
        .map((r) => mapWorkforceRow(r as WorkforceRow))
        .filter((w) => w.fullName && w.fullName !== "Unknown" && w.active !== false);

      setWorkforce(mapped);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e ? String((e as { message?: unknown }).message) : "Unknown error";
      setError(`Failed to load workforce: ${msg}`);
    } finally {
      setWorkforceLoading(false);
    }
  }, [currentUser, isScoped, scopedBuilding]);

  const loadReports = useCallback(async () => {
    if (!currentUser) return;
    setReportsLoading(true);
    setError(null);
    try {
      let q = supabase.from("injury_reports").select("*").order("created_at", { ascending: false });
      if (isScoped) q = q.eq("building", scopedBuilding);

      const { data, error } = await q;
      if (error) throw error;

      const rows = (data || []).map((r) => {
        const rr = r as unknown as ReportRow & { witnesses?: unknown };
        return {
          ...rr,
          witnesses: Array.isArray(rr.witnesses) ? (rr.witnesses as Witness[]) : [],
        } as ReportRow;
      });

      setReports(rows);

      // If currently selected report was deleted elsewhere, clear selection
      if (selectedReportId && !rows.some((x) => x.id === selectedReportId)) {
        setSelectedReportId(null);
        setFiles([]);
      }
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e ? String((e as { message?: unknown }).message) : "Unknown error";
      setError(`Failed to load injury reports: ${msg}`);
    } finally {
      setReportsLoading(false);
    }
  }, [currentUser, isScoped, scopedBuilding, selectedReportId]);

  const loadFiles = useCallback(async (reportId: string) => {
    setFilesLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("injury_report_files")
        .select("*")
        .eq("report_id", reportId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setFiles((data || []) as FileRow[]);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e ? String((e as { message?: unknown }).message) : "Unknown error";
      setError(`Failed to load report files: ${msg}`);
    } finally {
      setFilesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    loadProtocolDocs();
    loadWorkforce();
    loadReports();
  }, [currentUser, loadProtocolDocs, loadWorkforce, loadReports]);

  useEffect(() => {
    if (selectedReportId) loadFiles(selectedReportId);
  }, [selectedReportId, loadFiles]);

  async function openProtocolDoc(doc: ProtocolDoc) {
    setError(null);
    try {
      const { data, error } = await supabase.storage.from("injury-protocol").createSignedUrl(doc.file_path, 60 * 10);
      if (error) throw error;
      if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e ? String((e as { message?: unknown }).message) : "Unknown error";
      setError(`Failed to open protocol doc: ${msg}`);
    }
  }

  async function openUploadedFile(file: FileRow) {
    setError(null);
    try {
      const { data, error } = await supabase.storage.from("injury-uploads").createSignedUrl(file.file_path, 60 * 10);
      if (error) throw error;
      if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e ? String((e as { message?: unknown }).message) : "Unknown error";
      setError(`Failed to open file: ${msg}`);
    }
  }

  const [workerSearch, setWorkerSearch] = useState("");
  const filteredWorkers = useMemo(() => {
    const q = workerSearch.trim().toLowerCase();
    const base = workforce.filter((w) => w.active !== false);
    const scoped = isScoped ? base.filter((w) => !w.building || w.building === scopedBuilding) : base;
    if (!q) return scoped.slice(0, 50);
    return scoped.filter((w) => w.fullName.toLowerCase().includes(q)).slice(0, 50);
  }, [workerSearch, workforce, isScoped, scopedBuilding]);

  function chooseWorker(w: WorkforceWorker) {
    setForm((p) => ({
      ...p,
      employee_id: w.id,
      employee_name: w.fullName,
      building: isScoped ? scopedBuilding : w.building || p.building,
      shift: ((w.shift as ShiftName) || (p.shift as ShiftName)) ?? null,
    }));
  }

  function addWitness() {
    setForm((p) => ({
      ...p,
      witnesses: [...(p.witnesses || []), { name: "", phone: "", statement: "" }],
    }));
  }

  function updateWitness(i: number, key: "name" | "phone" | "statement", val: string) {
    setForm((p) => {
      const next = [...(p.witnesses || [])];
      const existing = next[i] || { name: "" };
      const updated: Witness = { ...existing, [key]: val };
      next[i] = updated;
      return { ...p, witnesses: next };
    });
  }

  function removeWitness(i: number) {
    setForm((p) => ({ ...p, witnesses: (p.witnesses || []).filter((_, idx) => idx !== i) }));
  }

  // Read-only mode for existing reports if user lacks edit rights
  const isViewingExisting = !!selectedReportId;
  const readOnlyExisting = isViewingExisting && !canEditExisting;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!currentUser) return;
    if (saving) return;

    setError(null);

    // Block editing existing reports unless BM/Super Admin
    if (selectedReportId && !canEditExisting) {
      setError("Only Building Managers and Super Admins can edit existing injury reports.");
      return;
    }

    const effectiveBuilding = isScoped ? scopedBuilding : form.building;

    if (!effectiveBuilding) return setError("Building is required.");
    if (!form.work_date) return setError("Work date is required.");
    if (!form.employee_name.trim()) return setError("Employee name is required.");
    if (!form.incident_datetime) return setError("Incident date/time is required.");
    if (!form.incident_location.trim()) return setError("Incident location is required.");
    if (!form.incident_type.trim()) return setError("Incident type is required.");
    if (!form.body_part.trim()) return setError("Body part is required.");
    if (!form.injury_description.trim()) return setError("Injury description is required.");
    if (!form.immediate_actions.trim()) return setError("Immediate actions taken is required.");

    setSaving(true);

    try {
      const payload: Record<string, unknown> = {
        ...form,
        building: effectiveBuilding,
        shift: form.shift || null,

        reported_by_user_id: currentUser.id ?? null,
        reported_by_email: currentUser.email ?? null,
        reported_by_name: extractName(currentUser),
        reported_by_role: role || null,

        employee_phone: form.employee_phone?.trim() || null,
        employee_job_title: form.employee_job_title?.trim() || null,
        incident_area: form.incident_area?.trim() || null,
        first_aid_by: form.first_aid_by?.trim() || null,
        clinic_name: form.clinic_name?.trim() || null,
        refusal_reason: form.refusal_reason?.trim() || null,
        supervisor_on_duty: form.supervisor_on_duty?.trim() || null,
        employee_statement: form.employee_statement?.trim() || null,
        hr_notes: form.hr_notes?.trim() || null,
        witnesses: Array.isArray(form.witnesses) ? form.witnesses : [],
      };

      if (selectedReportId) {
        const { error } = await supabase.from("injury_reports").update(payload).eq("id", selectedReportId);
        if (error) throw error;

        // Email on draft save (update)
        await sendEmailNotification(selectedReportId, "draft");
      } else {
        const { data, error } = await supabase.from("injury_reports").insert(payload).select("*").single();
        if (error) throw error;

        if (data?.id) {
          const newId = String(data.id);
          setSelectedReportId(newId);

          // Email on draft save (insert)
          await sendEmailNotification(newId, "draft");
        }
      }

      await loadReports();
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e ? String((e as { message?: unknown }).message) : "Unknown error";
      setError(`Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteReport() {
    if (!selectedReportId) return;
    if (!canDeleteExisting) {
      setError("Only Building Managers and Super Admins can delete injury reports.");
      return;
    }

    const ok = window.confirm("Delete this injury report? This will also delete its uploaded file records.");
    if (!ok) return;

    setSaving(true);
    setError(null);

    const deletingId = selectedReportId;

    try {
      // Immediately remove from UI so it cannot be clicked anymore
      setReports((prev) => prev.filter((r) => r.id !== deletingId));
      setSelectedReportId(null);
      setFiles([]);
      resetForm();

      const { error } = await supabase.from("injury_reports").delete().eq("id", deletingId);
      if (error) throw error;

      await loadReports();
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e ? String((e as { message?: unknown }).message) : "Unknown error";
      setError(`Delete failed: ${msg}`);
      // Reload to ensure UI matches server if something failed
      await loadReports();
    } finally {
      setSaving(false);
    }
  }

  async function uploadFile(file: File, category: string) {
    if (!selectedReportId) {
      setError("Save the report first (Draft) before uploading files.");
      return;
    }

    // If user cannot edit existing reports, block uploads too
    if (!canEditExisting) {
      setError("Only Building Managers and Super Admins can upload files to existing reports.");
      return;
    }

    setError(null);
    try {
      const safeName = file.name.replace(/[^\w.\-() ]+/g, "_");
      const path = `reports/${selectedReportId}/${Date.now()}-${safeName}`;

      const up = await supabase.storage.from("injury-uploads").upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (up.error) throw up.error;

      const { error } = await supabase.from("injury_report_files").insert({
        report_id: selectedReportId,
        file_path: path,
        file_name: file.name,
        mime_type: file.type || null,
        file_size: file.size || null,
        category,
      });
      if (error) throw error;

      await loadFiles(selectedReportId);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e ? String((e as { message?: unknown }).message) : "Unknown error";
      setError(`Upload failed: ${msg}`);
    }
  }

  async function markSubmitted() {
    if (!selectedReportId) return setError("Save the report first.");
    setError(null);
    try {
      const { error } = await supabase.from("injury_reports").update({ status: "Submitted" }).eq("id", selectedReportId);
      if (error) throw error;

      // Email on submit
      await sendEmailNotification(selectedReportId, "submitted");

      await loadReports();
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e ? String((e as { message?: unknown }).message) : "Unknown error";
      setError(`Submit failed: ${msg}`);
    }
  }

  async function markClosed() {
    if (!selectedReportId) return setError("Select a report.");
    if (!canManageAll) return setError("Only HR/Admin can close reports.");
    setError(null);
    try {
      const { error } = await supabase.from("injury_reports").update({ status: "Closed" }).eq("id", selectedReportId);
      if (error) throw error;
      await loadReports();
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e ? String((e as { message?: unknown }).message) : "Unknown error";
      setError(`Close failed: ${msg}`);
    }
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-400 flex flex-col items-center justify-center text-sm gap-2">
        <div>Redirecting to login…</div>
        <a href="/auth" className="text-sky-400 text-xs underline hover:text-sky-300">
          Click here if you are not redirected.
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-50">
      <div className="mx-auto max-w-7xl p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">Injury Reporting</h1>
            <p className="text-sm text-slate-400">HR-grade incident intake + protocol library + printable packet.</p>
            {isScoped && (
              <p className="text-[11px] text-slate-500 mt-1">
                Scoped to: <span className="text-sky-300 font-semibold">{scopedBuilding}</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
            >
              ← Back to Dashboard
            </Link>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border border-slate-700 px-4 py-2 text-[12px] text-slate-200 hover:bg-slate-800"
            >
              New Report
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-700 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-100">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT */}
          <div className="lg:col-span-4 space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold text-slate-100">Protocol Library</div>
                {protocolLoading && <div className="text-[11px] text-slate-500">Loading…</div>}
              </div>
              <div className="text-[11px] text-slate-400 mb-3">Click to open the official protocol and forms.</div>

              {protocolDocs.length === 0 ? (
                <div className="text-[11px] text-slate-500">
                  No protocol docs yet. Add files to <span className="text-slate-200">injury-protocol</span> and insert rows
                  into <span className="text-slate-200">injury_protocol_docs</span>.
                </div>
              ) : (
                <div className="space-y-2">
                  {protocolDocs.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => openProtocolDoc(d)}
                      className="w-full text-left rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 hover:bg-slate-900"
                    >
                      <div className="text-[12px] font-semibold text-slate-100">{d.title}</div>
                      {d.description && <div className="text-[11px] text-slate-400 mt-0.5">{d.description}</div>}
                      <div className="text-[10px] text-slate-500 mt-1">Open →</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold text-slate-100">Recent Reports</div>
                {reportsLoading && <div className="text-[11px] text-slate-500">Loading…</div>}
              </div>

              <div className="space-y-2">
                {reports.length === 0 ? (
                  <div className="text-[11px] text-slate-500">No reports yet.</div>
                ) : (
                  reports.slice(0, 30).map((r) => {
                    const active = r.id === selectedReportId;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => {
                          setSelectedReportId(r.id);
                          const { id, created_at, ...rest } = r;
                          setForm(rest);
                        }}
                        className={`w-full text-left rounded-xl border px-3 py-2 ${
                          active ? "border-sky-600 bg-sky-950/20" : "border-slate-800 bg-slate-950 hover:bg-slate-900"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[12px] font-semibold text-slate-100">{r.employee_name}</div>
                          <span className="text-[10px] rounded-full border border-slate-700 px-2 py-0.5 text-slate-300">
                            {r.status}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {r.building} • {r.shift ?? "—"} • {String(r.work_date).slice(0, 10)}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {r.incident_type} • {r.body_part}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* RIGHT */}
          <div className="lg:col-span-8 space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-semibold text-slate-100">{selectedReportId ? "Injury Report" : "New Injury Report"}</div>
                  <div className="text-[11px] text-slate-400">
                    {readOnlyExisting
                      ? "View-only: Only Building Managers and Super Admins can edit or delete existing reports."
                      : "Required fields are enforced so nothing can be missed."}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {selectedReportId && (
                    <button
                      type="button"
                      onClick={markSubmitted}
                      className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-[12px] font-medium text-white px-4 py-2"
                    >
                      Submit to HR
                    </button>
                  )}

                  {selectedReportId && (
                    <button
                      type="button"
                      onClick={handlePrintPacket}
                      className="rounded-lg bg-sky-600 hover:bg-sky-500 text-[12px] font-medium text-white px-4 py-2"
                    >
                      Print / Download Packet
                    </button>
                  )}

                  {canManageAll && selectedReportId && (
                    <button
                      type="button"
                      onClick={markClosed}
                      className="rounded-lg border border-slate-700 px-4 py-2 text-[12px] text-slate-200 hover:bg-slate-800"
                    >
                      Close Report
                    </button>
                  )}

                  {selectedReportId && canDeleteExisting && (
                    <button
                      type="button"
                      onClick={handleDeleteReport}
                      className="rounded-lg bg-rose-700 hover:bg-rose-600 text-[12px] font-medium text-white px-4 py-2"
                    >
                      Delete Report
                    </button>
                  )}
                </div>
              </div>

              <form onSubmit={handleSave} className="space-y-5">
                {/* Building / Shift / Date */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Building</label>
                    <select
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-[12px] text-slate-50"
                      value={isScoped ? scopedBuilding : form.building}
                      onChange={(e) => setForm((p) => ({ ...p, building: e.target.value }))}
                      disabled={isScoped || readOnlyExisting}
                    >
                      {BUILDINGS.map((b) => {
                        if (isScoped && b !== scopedBuilding) return null;
                        return (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Shift</label>
                    <select
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-[12px] text-slate-50"
                      value={(form.shift as ShiftName) || "1st"}
                      onChange={(e) => setForm((p) => ({ ...p, shift: e.target.value as ShiftName }))}
                      disabled={readOnlyExisting}
                    >
                      {SHIFTS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Work Date</label>
                    <input
                      type="date"
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-[12px] text-slate-50"
                      value={form.work_date}
                      onChange={(e) => setForm((p) => ({ ...p, work_date: e.target.value }))}
                      disabled={readOnlyExisting}
                    />
                  </div>
                </div>

                {/* Assign Employee */}
                <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[12px] font-semibold text-slate-100">Assign Employee</div>
                      <div className="text-[11px] text-slate-400">Search workforce, then click a worker to attach.</div>
                    </div>
                    {workforceLoading && <div className="text-[11px] text-slate-500">Loading…</div>}
                  </div>

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <input
                        className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-[12px] text-slate-50"
                        placeholder="Search worker name…"
                        value={workerSearch}
                        onChange={(e) => setWorkerSearch(e.target.value)}
                        disabled={readOnlyExisting}
                      />
                      <div className="mt-2 max-h-44 overflow-auto rounded-xl border border-slate-800 bg-slate-950">
                        {filteredWorkers.length === 0 ? (
                          <div className="px-3 py-3 text-[11px] text-slate-500">No matches.</div>
                        ) : (
                          filteredWorkers.map((w) => (
                            <button
                              key={w.id}
                              type="button"
                              onClick={() => chooseWorker(w)}
                              disabled={readOnlyExisting}
                              className="w-full text-left px-3 py-2 border-b border-slate-800 hover:bg-slate-900 disabled:opacity-60"
                            >
                              <div className="text-[12px] text-slate-100 font-medium">{w.fullName}</div>
                              <div className="text-[11px] text-slate-500">
                                {w.building ?? "—"} • {w.shift ?? "—"}
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">Employee Name (required)</label>
                        <input
                          className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-[12px] text-slate-50"
                          value={form.employee_name}
                          onChange={(e) => setForm((p) => ({ ...p, employee_name: e.target.value }))}
                          placeholder="Employee full name"
                          disabled={readOnlyExisting}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Phone</label>
                          <input
                            className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-[12px] text-slate-50"
                            value={form.employee_phone || ""}
                            onChange={(e) => setForm((p) => ({ ...p, employee_phone: e.target.value }))}
                            placeholder="(optional)"
                            disabled={readOnlyExisting}
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Job Title</label>
                          <input
                            className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-[12px] text-slate-50"
                            value={form.employee_job_title || ""}
                            onChange={(e) => setForm((p) => ({ ...p, employee_job_title: e.target.value }))}
                            placeholder="(optional)"
                            disabled={readOnlyExisting}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Incident */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Incident Date/Time (required)</label>
                    <input
                      type="datetime-local"
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-[12px] text-slate-50"
                      value={new Date(form.incident_datetime).toISOString().slice(0, 16)}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          incident_datetime: new Date(e.target.value).toISOString(),
                        }))
                      }
                      disabled={readOnlyExisting}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Location (required)</label>
                    <input
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-[12px] text-slate-50"
                      value={form.incident_location}
                      onChange={(e) => setForm((p) => ({ ...p, incident_location: e.target.value }))}
                      placeholder="Example: Inbound Dock"
                      disabled={readOnlyExisting}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Area (optional)</label>
                    <input
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-[12px] text-slate-50"
                      value={form.incident_area || ""}
                      onChange={(e) => setForm((p) => ({ ...p, incident_area: e.target.value }))}
                      placeholder="Dock door, lane, line, etc"
                      disabled={readOnlyExisting}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Incident Type (required)</label>
                    <select
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-[12px] text-slate-50"
                      value={form.incident_type}
                      onChange={(e) => setForm((p) => ({ ...p, incident_type: e.target.value }))}
                      disabled={readOnlyExisting}
                    >
                      {INCIDENT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Body Part (required)</label>
                    <select
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-[12px] text-slate-50"
                      value={form.body_part}
                      onChange={(e) => setForm((p) => ({ ...p, body_part: e.target.value }))}
                      disabled={readOnlyExisting}
                    >
                      {BODY_PARTS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Supervisor on Duty</label>
                    <input
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-[12px] text-slate-50"
                      value={form.supervisor_on_duty || ""}
                      onChange={(e) => setForm((p) => ({ ...p, supervisor_on_duty: e.target.value }))}
                      placeholder="(optional)"
                      disabled={readOnlyExisting}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Injury Description (required)</label>
                    <textarea
                      rows={4}
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-[12px] text-slate-50 resize-none"
                      value={form.injury_description}
                      onChange={(e) => setForm((p) => ({ ...p, injury_description: e.target.value }))}
                      placeholder="What happened? What were they doing? Equipment involved? Conditions? PPE?"
                      disabled={readOnlyExisting}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Immediate Actions Taken (required)</label>
                    <textarea
                      rows={4}
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-[12px] text-slate-50 resize-none"
                      value={form.immediate_actions}
                      onChange={(e) => setForm((p) => ({ ...p, immediate_actions: e.target.value }))}
                      placeholder="First aid, stop work, notify supervisor, secure area, etc."
                      disabled={readOnlyExisting}
                    />
                  </div>
                </div>

                {/* Treatment */}
                <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                  <div className="text-[12px] font-semibold text-slate-100">Treatment / Medical</div>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3">
                    {[
                      { key: "first_aid_given", label: "First Aid Given" },
                      { key: "ems_called", label: "EMS Called" },
                      { key: "sent_to_clinic", label: "Sent to Clinic" },
                      { key: "medical_refused", label: "Medical Refused" },
                    ].map((c) => (
                      <label key={c.key} className="flex items-center gap-2 text-[12px] text-slate-200">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={(form as any)[c.key] as boolean}
                          onChange={(e) => setForm((p) => ({ ...(p as any), [c.key]: e.target.checked }))}
                          disabled={readOnlyExisting}
                        />
                        {c.label}
                      </label>
                    ))}
                  </div>

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">First Aid By</label>
                      <input
                        className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-[12px] text-slate-50"
                        value={form.first_aid_by || ""}
                        onChange={(e) => setForm((p) => ({ ...p, first_aid_by: e.target.value }))}
                        placeholder="Name"
                        disabled={readOnlyExisting}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Clinic Name</label>
                      <input
                        className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-[12px] text-slate-50"
                        value={form.clinic_name || ""}
                        onChange={(e) => setForm((p) => ({ ...p, clinic_name: e.target.value }))}
                        placeholder="(if applicable)"
                        disabled={readOnlyExisting}
                      />
                    </div>
                  </div>

                  {form.medical_refused && (
                    <div className="mt-3">
                      <label className="block text-[11px] text-slate-400 mb-1">Refusal Reason</label>
                      <textarea
                        rows={3}
                        className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-[12px] text-slate-50 resize-none"
                        value={form.refusal_reason || ""}
                        onChange={(e) => setForm((p) => ({ ...p, refusal_reason: e.target.value }))}
                        placeholder="Employee refused medical treatment. Explain what was offered and what they said."
                        disabled={readOnlyExisting}
                      />
                      <div className="mt-1 text-[11px] text-slate-400">
                        Tip: Upload the signed <span className="text-slate-200 font-semibold">Refusal Form</span> below once signed.
                      </div>
                    </div>
                  )}
                </div>

                {/* Witnesses */}
                <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[12px] font-semibold text-slate-100">Witnesses</div>
                      <div className="text-[11px] text-slate-400">Add witness names and statements if available.</div>
                    </div>
                    <button
                      type="button"
                      onClick={addWitness}
                      className="text-[11px] text-sky-300 hover:underline"
                      disabled={readOnlyExisting}
                    >
                      + Add Witness
                    </button>
                  </div>

                  {(form.witnesses || []).length === 0 ? (
                    <div className="text-[11px] text-slate-500">No witnesses entered.</div>
                  ) : (
                    (form.witnesses || []).map((w, i) => (
                      <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-[11px] font-semibold text-slate-200">Witness #{i + 1}</div>
                          <button
                            type="button"
                            onClick={() => removeWitness(i)}
                            className="text-[11px] text-rose-300 hover:underline"
                            disabled={readOnlyExisting}
                          >
                            Remove
                          </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">Name</label>
                            <input
                              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-[12px] text-slate-50"
                              value={w.name || ""}
                              onChange={(e) => updateWitness(i, "name", e.target.value)}
                              placeholder="Witness name"
                              disabled={readOnlyExisting}
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">Phone (optional)</label>
                            <input
                              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-[12px] text-slate-50"
                              value={w.phone || ""}
                              onChange={(e) => updateWitness(i, "phone", e.target.value)}
                              placeholder="(optional)"
                              disabled={readOnlyExisting}
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Statement (optional)</label>
                          <textarea
                            rows={3}
                            className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-[12px] text-slate-50 resize-none"
                            value={w.statement || ""}
                            onChange={(e) => updateWitness(i, "statement", e.target.value)}
                            placeholder="What did they see?"
                            disabled={readOnlyExisting}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Employee statement */}
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Employee Statement (optional)</label>
                  <textarea
                    rows={3}
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-[12px] text-slate-50 resize-none"
                    value={form.employee_statement || ""}
                    onChange={(e) => setForm((p) => ({ ...p, employee_statement: e.target.value }))}
                    placeholder="Employee’s own words (if provided)."
                    disabled={readOnlyExisting}
                  />
                </div>

                {/* HR notes */}
                {canManageAll && (
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">HR Notes (internal)</label>
                    <textarea
                      rows={3}
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-[12px] text-slate-50 resize-none"
                      value={form.hr_notes || ""}
                      onChange={(e) => setForm((p) => ({ ...p, hr_notes: e.target.value }))}
                      placeholder="Internal notes, follow-ups, case handling, etc."
                      disabled={readOnlyExisting}
                    />
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="text-[11px] text-slate-500">
                    Status: <span className="text-slate-200 font-semibold">{form.status}</span>
                    {selectedReportId ? <span className="text-slate-500"> • Report ID: {selectedReportId.slice(0, 8)}…</span> : null}
                  </div>

                  {!readOnlyExisting && (
                    <button
                      type="submit"
                      disabled={saving}
                      className="rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-[12px] font-medium text-white px-5 py-2"
                    >
                      {saving ? "Saving…" : selectedReportId ? "Save Changes" : "Save Draft"}
                    </button>
                  )}
                </div>
              </form>
            </div>

            {/* Uploads */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-sm font-semibold text-slate-100">Attachments & Signed Forms</div>
                  <div className="text-[11px] text-slate-400">Upload incident photos, clinic notes, and signed documents. (Save report first.)</div>
                </div>
                {filesLoading && <div className="text-[11px] text-slate-500">Loading…</div>}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                  { label: "Incident Photos", category: "incident_photo" },
                  { label: "Clinic / Doctor Notes", category: "clinic_note" },
                  { label: "Signed Forms (Report / Refusal)", category: "signed_form" },
                ].map((c) => (
                  <div key={c.category} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                    <div className="text-[12px] font-semibold text-slate-100">{c.label}</div>
                    <input
                      type="file"
                      className="mt-2 block w-full text-[11px] text-slate-300"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadFile(f, c.category);
                        e.currentTarget.value = "";
                      }}
                      disabled={!selectedReportId || !canEditExisting}
                    />
                    <div className="mt-1 text-[10px] text-slate-500">PDF, JPG, PNG accepted.</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-3">
                <div className="text-[12px] font-semibold text-slate-100">Files</div>
                {files.length === 0 ? (
                  <div className="mt-2 text-[11px] text-slate-500">No files uploaded yet.</div>
                ) : (
                  <div className="mt-2 space-y-2">
                    {files.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="text-[12px] text-slate-100 font-medium truncate">{f.file_name}</div>
                          <div className="text-[10px] text-slate-500">
                            {f.category} • {new Date(f.created_at).toISOString().slice(0, 19).replace("T", " ")}
                          </div>
                        </div>
                        <button type="button" onClick={() => openUploadedFile(f)} className="text-[11px] text-sky-300 hover:underline">
                          Open →
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Printable Packet */}
            {selectedReport && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">Printable Packet Preview</div>
                    <div className="text-[11px] text-slate-400">This prints like an HR packet: report + signature lines + refusal section if needed.</div>
                  </div>
                  <button
                    type="button"
                    onClick={handlePrintPacket}
                    className="rounded-lg bg-sky-600 hover:bg-sky-500 text-[12px] font-medium text-white px-4 py-2"
                  >
                    Print / Download
                  </button>
                </div>

                <div className="mt-4 rounded-xl border border-slate-800 bg-white text-black p-6">
                  <div ref={printRef}>
                    <div className="flex items-start justify-between">
                      <div>
                        <div style={{ fontSize: 18, fontWeight: 700 }}>Precision Injury Report Packet</div>
                        <div style={{ fontSize: 12, marginTop: 4 }}>
                          Building: <b>{selectedReport.building}</b> • Shift: <b>{selectedReport.shift ?? "—"}</b> • Work Date:{" "}
                          <b>{String(selectedReport.work_date).slice(0, 10)}</b>
                        </div>
                      </div>
                      <div style={{ fontSize: 11, textAlign: "right" }}>
                        Status: <b>{selectedReport.status}</b>
                        <div>Report ID: {selectedReport.id}</div>
                      </div>
                    </div>

                    <hr style={{ margin: "14px 0" }} />

                    <div style={{ fontSize: 13, fontWeight: 700 }}>Employee</div>
                    <div style={{ fontSize: 12, marginTop: 6 }}>
                      Name: <b>{selectedReport.employee_name}</b>{" "}
                      {selectedReport.employee_job_title ? ` • Title: ${selectedReport.employee_job_title}` : ""}
                    </div>
                    <div style={{ fontSize: 12 }}>Phone: {selectedReport.employee_phone || "—"}</div>

                    <hr style={{ margin: "14px 0" }} />

                    <div style={{ fontSize: 13, fontWeight: 700 }}>Incident Details</div>
                    <div style={{ fontSize: 12, marginTop: 6 }}>
                      Date/Time: <b>{new Date(selectedReport.incident_datetime).toISOString().slice(0, 16).replace("T", " ")}</b>
                    </div>
                    <div style={{ fontSize: 12 }}>
                      Location: <b>{selectedReport.incident_location}</b>{" "}
                      {selectedReport.incident_area ? `(${selectedReport.incident_area})` : ""}
                    </div>
                    <div style={{ fontSize: 12 }}>
                      Type: <b>{selectedReport.incident_type}</b> • Body Part: <b>{selectedReport.body_part}</b>
                    </div>
                    <div style={{ fontSize: 12, marginTop: 8 }}>
                      <b>Description:</b>
                      <div style={{ whiteSpace: "pre-wrap" }}>{selectedReport.injury_description}</div>
                    </div>
                    <div style={{ fontSize: 12, marginTop: 8 }}>
                      <b>Immediate Actions Taken:</b>
                      <div style={{ whiteSpace: "pre-wrap" }}>{selectedReport.immediate_actions}</div>
                    </div>

                    <hr style={{ margin: "14px 0" }} />

                    <div style={{ fontSize: 13, fontWeight: 700 }}>Treatment / Medical</div>
                    <div style={{ fontSize: 12, marginTop: 6 }}>
                      First Aid Given: <b>{selectedReport.first_aid_given ? "Yes" : "No"}</b>{" "}
                      {selectedReport.first_aid_by ? ` • By: ${selectedReport.first_aid_by}` : ""}
                    </div>
                    <div style={{ fontSize: 12 }}>
                      EMS Called: <b>{selectedReport.ems_called ? "Yes" : "No"}</b> • Sent to Clinic:{" "}
                      <b>{selectedReport.sent_to_clinic ? "Yes" : "No"}</b>{" "}
                      {selectedReport.clinic_name ? ` • Clinic: ${selectedReport.clinic_name}` : ""}
                    </div>

                    <hr style={{ margin: "14px 0" }} />

                    <div style={{ fontSize: 13, fontWeight: 700 }}>Witnesses</div>
                    <div style={{ fontSize: 12, marginTop: 6 }}>
                      {(selectedReport.witnesses || []).length === 0 ? (
                        <div>None listed.</div>
                      ) : (
                        <ul>
                          {selectedReport.witnesses.map((w, i) => (
                            <li key={i}>
                              <b>{w.name}</b> {w.phone ? `(${w.phone})` : ""} {w.statement ? `— ${w.statement}` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <hr style={{ margin: "14px 0" }} />

                    <div style={{ fontSize: 13, fontWeight: 700 }}>Statements</div>
                    <div style={{ fontSize: 12, marginTop: 6 }}>
                      Employee Statement:
                      <div style={{ minHeight: 50, border: "1px solid #ddd", padding: 8, marginTop: 4, whiteSpace: "pre-wrap" }}>
                        {selectedReport.employee_statement || ""}
                      </div>
                    </div>

                    {selectedReport.medical_refused && (
                      <>
                        <hr style={{ margin: "14px 0" }} />
                        <div style={{ fontSize: 13, fontWeight: 700 }}>Refusal of Medical Treatment</div>
                        <div style={{ fontSize: 12, marginTop: 6 }}>
                          Employee refused medical treatment: <b>Yes</b>
                        </div>
                        <div style={{ fontSize: 12, marginTop: 6 }}>
                          Reason:
                          <div style={{ minHeight: 50, border: "1px solid #ddd", padding: 8, marginTop: 4, whiteSpace: "pre-wrap" }}>
                            {selectedReport.refusal_reason || ""}
                          </div>
                        </div>
                      </>
                    )}

                    <hr style={{ margin: "14px 0" }} />

                    <div style={{ fontSize: 13, fontWeight: 700 }}>Signatures</div>
                    <div style={{ fontSize: 12, marginTop: 10 }}>
                      Employee Signature: ______________________________________ Date: _____________
                    </div>
                    <div style={{ fontSize: 12, marginTop: 10 }}>
                      Manager/Supervisor Signature: ______________________________ Date: _____________
                    </div>

                    <div style={{ fontSize: 10, marginTop: 16, color: "#555" }}>
                      Submitted by: {selectedReport.reported_by_name || "—"} ({selectedReport.reported_by_email || "—"}) • Role:{" "}
                      {selectedReport.reported_by_role || "—"}
                    </div>
                  </div>
                </div>

                <div className="mt-3 text-[11px] text-slate-400">
                  Tip: After printing, upload the signed pages under <b>Signed Forms</b>.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
