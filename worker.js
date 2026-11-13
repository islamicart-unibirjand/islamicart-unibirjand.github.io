/**
 * Cloudflare Worker for the Islamic Arts Association assistant.
 * Secrets: GEMINI_API_KEY and GROQ_API_KEY
 * Variable: ALLOWED_ORIGIN (exact GitHub Pages origin)
 */
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const SYSTEM_PROMPT = `تو «یار هنر»، دستیار هوشمند انجمن علمی هنر اسلامی دانشگاه بیرجند هستی.
همیشه به زبان فارسی روان، محترمانه، روشن و مختصر پاسخ بده؛ مگر کاربر زبان دیگری بخواهد.
حوزه تخصصی تو هنر اسلامی و ایرانی، نگارگری، تذهیب، تشعیر، خوشنویسی، هنرهای سنتی، پژوهش و فعالیت‌های انجمن است.
اطلاعات قطعی سایت: انجمن علمی هنر اسلامی دانشگاه بیرجند؛ استاد مشاور معرفی‌شده در سایت دکتر آرزو پایدارفرد؛ رویداد شاخص سایت نمایشگاه نقش خیال؛ وب‌سایت رسمی انجمن https://islamicart-unibirjand.github.io/
درباره تاریخ‌ها، ثبت‌نام، برنامه‌های آینده، استادان، هزینه‌ها یا اطلاعاتی که در این متن نیستند حدس نزن. اگر مطمئن نیستی، صریح بگو و کاربر را به صفحه ارتباط با انجمن یا منابع رسمی راهنمایی کن.
اطلاعات ساختگی، نقل‌قول جعلی یا منبع خیالی تولید نکن. پاسخ را متناسب با پرسش و بدون مقدمه‌های طولانی بنویس.`;

function corsHeaders(origin, env) {
  const allowed = env.ALLOWED_ORIGIN || "https://islamicart-unibirjand.github.io";
  return {
    "Access-Control-Allow-Origin": origin === allowed ? allowed : "null",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}
function json(data, status, cors) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...cors } });
}
export default {
 async fetch(request, env) {
   const origin=request.headers.get("Origin") || "";
   const cors=corsHeaders(origin,env);
   if(request.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
   if(origin && cors["Access-Control-Allow-Origin"]==="null") return json({error:"Origin not allowed"},403,cors);
   const url=new URL(request.url);
   if(request.method==="GET" && url.pathname==="/api/health") return json({ok:true,service:"یار هنر"},200,cors);
   if(request.method!=="POST") return json({error:"Method not allowed"},405,cors);
   if(url.pathname==="/api/chat") {
     if(!env.GEMINI_API_KEY) return json({error:"GEMINI_API_KEY is not configured"},503,cors);
     let body;try{body=await request.json()}catch{return json({error:"Invalid JSON"},400,cors)}
     const messages=Array.isArray(body.messages)?body.messages.slice(-12):[];
     const contents=messages.filter(m=>["user","assistant"].includes(m.role)&&typeof m.content==="string")
       .map(m=>({role:m.role==="assistant"?"model":"user",parts:[{text:m.content.slice(0,3000)}]}));
     if(!contents.length || contents[contents.length-1].role!=="user") return json({error:"A user message is required"},400,cors);
     const upstream=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key="+encodeURIComponent(env.GEMINI_API_KEY),{
       method:"POST",headers:{"Content-Type":"application/json"},
       body:JSON.stringify({systemInstruction:{parts:[{text:SYSTEM_PROMPT}]},contents,generationConfig:{temperature:0.65,maxOutputTokens:900}})
     });
     const data=await upstream.json().catch(()=>({}));
     if(!upstream.ok) return json({error:"AI provider error",details:data.error?.message||"Request failed"},502,cors);
     const reply=data.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("").trim();
     if(!reply) return json({error:"Empty model response"},502,cors);
     return json({reply},200,cors);
   }
   if(url.pathname==="/api/transcribe") {
     if(!env.GROQ_API_KEY) return json({error:"GROQ_API_KEY is not configured"},503,cors);
     let form;try{form=await request.formData()}catch{return json({error:"Invalid audio form"},400,cors)}
     const file=form.get("file");
     if(!file || typeof file==="string" || file.size>12*1024*1024) return json({error:"Audio file is missing or exceeds 12 MB"},400,cors);
     const outgoing=new FormData();
     outgoing.append("file",file,file.name||"voice.webm");
     outgoing.append("model","whisper-large-v3-turbo");
     outgoing.append("language","fa");
     outgoing.append("response_format","json");
     const upstream=await fetch("https://api.groq.com/openai/v1/audio/transcriptions",{
       method:"POST",headers:{Authorization:"Bearer "+env.GROQ_API_KEY},body:outgoing
     });
     const data=await upstream.json().catch(()=>({}));
     if(!upstream.ok) return json({error:"Speech recognition provider error",details:data.error?.message||"Request failed"},502,cors);
     return json({text:data.text||""},200,cors);
   }
   return json({error:"Not found"},404,cors);
 }
};
