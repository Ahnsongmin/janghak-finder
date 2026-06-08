// Vercel Cron이 매일 호출 → 프로덕션 재배포를 트리거.
// 재배포되면 vercel.json buildCommand가 정부 API에서 데이터를 새로 수집 → 자동 최신화.
//
// 필요 환경변수(프로덕션):
//  - CRON_SECRET : Vercel Cron 인증용(설정 시 Vercel이 Authorization: Bearer 로 전달)
//  - VERCEL_TOKEN: 재배포 API 호출용 토큰(사용자가 Vercel 대시보드에서 발급)

export const runtime = "nodejs";
export const maxDuration = 60;

const TEAM = "team_MRIj4lHmZ908l6PrAFhx4HME";
const PROJECT = "prj_EHxV8tEGUbAHLHYeEDhTxBIeGqHM";

export async function GET(req: Request) {
  // Vercel Cron 인증 (CRON_SECRET 설정 시)
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    return Response.json(
      { ok: false, error: "VERCEL_TOKEN 미설정 — Vercel 토큰을 환경변수로 추가하세요." },
      { status: 500 },
    );
  }

  const headers = { Authorization: `Bearer ${token}` };

  // 1) 최신 프로덕션 배포 ID 조회
  const listRes = await fetch(
    `https://api.vercel.com/v6/deployments?projectId=${PROJECT}&teamId=${TEAM}&target=production&limit=1`,
    { headers },
  );
  const list = await listRes.json();
  const latest = list?.deployments?.[0];
  if (!latest?.uid) {
    return Response.json({ ok: false, error: "최신 배포를 찾지 못함", detail: list }, { status: 500 });
  }

  // 2) 해당 배포를 재배포(빌드 재실행 → 데이터 재수집)
  const redeployRes = await fetch(`https://api.vercel.com/v13/deployments?teamId=${TEAM}&forceNew=1`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "janghak-finder", deploymentId: latest.uid, target: "production" }),
  });
  const result = await redeployRes.json();

  return Response.json({
    ok: redeployRes.ok,
    triggeredAt: new Date().toISOString(),
    redeployUrl: result?.url ?? null,
    error: redeployRes.ok ? null : result,
  });
}
