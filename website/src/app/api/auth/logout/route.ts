import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { ok: false, code: 'CANONICAL_CLEANUP_REQUIRED' },
    { status: 409 },
  );
}
