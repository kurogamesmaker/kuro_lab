import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set(["https://kurolab.cc.cd", "https://admin.kurolab.cc.cd"]);
function corsHeaders(origin: string | null) {
  const h: Record<string,string> = {
    "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Vary":"Origin"
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}
function reply(body: unknown, status=200, origin: string|null=null) {
  return new Response(JSON.stringify(body), {status, headers:{...corsHeaders(origin),"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  const origin=req.headers.get("Origin");
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders(origin)});
  if(req.method!=="POST") return reply({error:"Method not allowed"},405,origin);
  if(origin && !ALLOWED_ORIGINS.has(origin)) return reply({error:"Origin not allowed"},403,origin);
  const auth=req.headers.get("Authorization")||"";
  if(!auth.startsWith("Bearer ")) return reply({error:"ログインが必要です。"},401,origin);
  const url=Deno.env.get("SUPABASE_URL"), anon=Deno.env.get("SUPABASE_ANON_KEY"), service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service) return reply({error:"Server configuration missing"},503,origin);
  try {
    const callerClient=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{autoRefreshToken:false,persistSession:false}});
    const {data:authData,error:authError}=await callerClient.auth.getUser();
    const user=authData?.user;
    if(authError||!user||user.is_anonymous) return reply({error:"ログインアカウントで利用してください。"},401,origin);
    const admin=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}});
    const body=await req.json().catch(()=>({}));
    const action=String(body?.action||"");
    const now=new Date().toISOString();

    if(action==="get_status") {
      const [memberResult,appResult,controlResult,inviteResult]=await Promise.all([
        admin.from("pro_memberships").select("user_id,status,source,starts_at,expires_at,features,approved_at").eq("user_id",user.id).maybeSingle(),
        admin.from("pro_applications").select("id,reason,status,admin_note,reviewed_at,created_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(10),
        admin.from("pro_user_controls").select("reapply_allowed,reapply_after").eq("user_id",user.id).maybeSingle(),
        admin.from("pro_invitations").select("id,status,expires_at,membership_expires_at,created_at").eq("invited_user_id",user.id).eq("status","pending").gt("expires_at",now).order("created_at",{ascending:false})
      ]);
      for(const r of [memberResult,appResult,controlResult,inviteResult]) if(r.error) throw r.error;
      let membership=memberResult.data;
      if(membership?.status==="active" && membership.expires_at && new Date(membership.expires_at).getTime()<=Date.now()) {
        const {data,error}=await admin.from("pro_memberships").update({status:"expired",updated_at:now}).eq("user_id",user.id).eq("status","active").select("user_id,status,source,starts_at,expires_at,features,approved_at").maybeSingle();
        if(error) throw error;
        membership=data||{...membership,status:"expired"};
      }
      const control=controlResult.data||{reapply_allowed:true,reapply_after:null};
      const latest=(appResult.data||[])[0]||null;
      const reapplyBlocked=control.reapply_allowed===false || (control.reapply_after && new Date(control.reapply_after).getTime()>Date.now());
      return reply({membership,applications:appResult.data||[],latest_application:latest,control:{reapply_allowed:control.reapply_allowed!==false,reapply_after:control.reapply_after||null},can_apply:!reapplyBlocked && !membership?.status?.match(/^(active|suspended)$/) && latest?.status!=="pending",invitations:inviteResult.data||[]},200,origin);
    }

    if(action==="submit_application") {
      const reason=typeof body.reason==="string"?body.reason.trim():"";
      if(reason.length<10||reason.length>1000) return reply({error:"申請理由は10〜1000文字で入力してください。"},400,origin);
      const {data:member,error:memberError}=await admin.from("pro_memberships").select("status,expires_at").eq("user_id",user.id).maybeSingle();
      if(memberError) throw memberError;
      if(member?.status==="active" && (!member.expires_at || new Date(member.expires_at).getTime()>Date.now())) return reply({error:"すでにProを利用できます。"},409,origin);
      if(member?.status==="suspended") return reply({error:"現在Pro権限が停止されています。管理者にお問い合わせください。"},403,origin);
      const {data:control,error:controlError}=await admin.from("pro_user_controls").select("reapply_allowed,reapply_after").eq("user_id",user.id).maybeSingle();
      if(controlError) throw controlError;
      if(control?.reapply_allowed===false || (control?.reapply_after && new Date(control.reapply_after).getTime()>Date.now())) return reply({error:"現在はProを再申請できません。"},403,origin);
      const {data:pending,error:pendingError}=await admin.from("pro_applications").select("id").eq("user_id",user.id).eq("status","pending").maybeSingle();
      if(pendingError) throw pendingError;
      if(pending) return reply({error:"審査中の申請がすでにあります。"},409,origin);
      const {data,error}=await admin.from("pro_applications").insert({user_id:user.id,reason,status:"pending"}).select("id,status,created_at").single();
      if(error) throw error;
      return reply({ok:true,application:data},200,origin);
    }

    if(action==="accept_invitation") {
      const invitationId=typeof body.invitationId==="string"?body.invitationId:"";
      if(!uuidPattern.test(invitationId)) return reply({error:"招待IDが正しくありません。"},400,origin);
      const {data:invitation,error:invError}=await admin.from("pro_invitations").select("id,invited_user_id,status,expires_at,created_by").eq("id",invitationId).eq("invited_user_id",user.id).maybeSingle();
      if(invError) throw invError;
      if(!invitation) return reply({error:"このアカウント宛ての招待が見つかりません。"},404,origin);
      if(invitation.status!=="pending") return reply({error:"この招待はすでに利用済みか、取り消されています。"},409,origin);
      if(new Date(invitation.expires_at).getTime()<=Date.now()) {
        await admin.from("pro_invitations").update({status:"expired"}).eq("id",invitationId).eq("status","pending");
        return reply({error:"招待の有効期限が切れています。"},410,origin);
      }
      const {data:claimed,error:claimError}=await admin.from("pro_invitations").update({status:"accepted",accepted_at:now}).eq("id",invitationId).eq("invited_user_id",user.id).eq("status","pending").gt("expires_at",now).select("id").maybeSingle();
      if(claimError) throw claimError;
      if(!claimed) return reply({error:"招待を承諾できませんでした。画面を更新してください。"},409,origin);
      const {data:membership,error:membershipError}=await admin.from("pro_memberships").upsert({user_id:user.id,status:"active",source:"invitation",starts_at:now,expires_at:invitation.membership_expires_at||null,features:{workspace_plus:true,pro_tools:true,customization_plus:true,early_access:true},approved_by:invitation.created_by,approved_at:now,updated_at:now},{onConflict:"user_id"}).select("user_id,status,source,expires_at,features").single();
      if(membershipError) {
        await admin.from("pro_invitations").update({status:"pending",accepted_at:null}).eq("id",invitationId).eq("status","accepted");
        throw membershipError;
      }
      await admin.from("admin_audit_logs").insert({actor_user_id:invitation.created_by,action:"pro.invitation.accept",target_user_id:user.id,metadata:{invitation_id:invitationId}});
      return reply({ok:true,membership},200,origin);
    }
    return reply({error:"Unsupported action"},400,origin);
  } catch(error) {
    console.error("pro-access error",error);
    return reply({error:"Pro情報の処理に失敗しました。時間をおいて再試行してください。"},500,origin);
  }
});
