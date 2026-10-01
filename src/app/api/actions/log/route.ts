import { NextResponse } from "next/server";
import { z } from "zod";
import { listActionLogs } from "@/db/repo";
import { handle, requireOperator } from "@/lib/http";

const q = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().max(200).optional(),
  status: z.enum(["EXECUTING", "SUCCESS", "FAILED", "VERIFICATION_FAILED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

export const GET = handle(async (req) => {
  requireOperator(req);
  const raw = Object.fromEntries([...req.nextUrl.searchParams.entries()].filter(([, v]) => v !== ""));
  const p = q.parse(raw);
  const { items, total } = await listActionLogs({ ...p, limit: p.pageSize, offset: (p.page - 1) * p.pageSize });
  return NextResponse.json({ items, total, page: p.page, pageSize: p.pageSize, totalPages: Math.max(1, Math.ceil(total / p.pageSize)) });
});
