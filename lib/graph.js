import fs from "fs";import fetch from "node-fetch";import { ConfidentialClientApplication } from "@azure/msal-node";
function msal(tenant){const pem=fs.readFileSync(tenant.auth.certPath,"utf8");return new ConfidentialClientApplication({auth:{clientId:tenant.clientId,authority:`https://login.microsoftonline.com/${tenant.tenantId}`,clientCertificate:{thumbprint:tenant.auth.thumbprint,privateKey:pem}}});}
async function token(app){const r=await app.acquireTokenByClientCredential({scopes:["https://graph.microsoft.com/.default"]}); if(!r?.accessToken) throw new Error("no token"); return r.accessToken;}
export async function sendViaGraph({tenant,mailbox,parsed,rcpts,envelopeFrom,bccRecipients=[],saveToSent=false}){
  console.log(`🔐 MSAL authenticatie voor tenant: ${tenant.name}`);
  const app=msal(tenant); 
  
  let tk; // Declareer tk buiten de try block
  try {
    console.log(`🎫 Ophalen access token...`);
    tk=await token(app);
    console.log(`✅ Access token opgehaald (${tk.substring(0, 20)}...)`);
  } catch (error) {
    console.error(`❌ MSAL authenticatie gefaald:`, error.message);
    throw error;
  }
  
  const body=parsed.html?{contentType:"HTML",content:parsed.html}:{contentType:"Text",content:parsed.text||""};
  const to=(parsed.to?.value||rcpts.map(a=>({address:a}))).map(v=>({emailAddress:{address:v.address||v}}));
  const cc=(parsed.cc?.value||[]).map(v=>({emailAddress:{address:v.address}}));
  const bcc=[...(parsed.bcc?.value||[]).map(v=>({emailAddress:{address:v.address}})),...bccRecipients.map(a=>({emailAddress:{address:a}}))];
  const msg={subject:parsed.subject||"(no subject)",body,toRecipients:to,ccRecipients:cc,bccRecipients:bcc};
  
  console.log(`📧 Email bericht samengesteld:`);
  console.log(`   Onderwerp: ${msg.subject}`);
  console.log(`   Type: ${body.contentType}`);
  console.log(`   To: ${to.map(r => r.emailAddress.address).join(", ")}`);
  console.log(`   CC: ${cc.map(r => r.emailAddress.address).join(", ") || "geen"}`);
  console.log(`   BCC: ${bcc.map(r => r.emailAddress.address).join(", ") || "geen"}`);
  
  const url=`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`;
  console.log(`🌐 Graph API URL: ${url}`);
  
  try {
    console.log(`📤 Verzenden naar Graph API...`);
    const res=await fetch(url,{method:"POST",headers:{Authorization:`Bearer ${tk}`,"Content-Type":"application/json"},body:JSON.stringify({message:msg,saveToSentItems:!!saveToSent})});
    
    console.log(`📊 Graph API Response:`);
    console.log(`   Status: ${res.status} ${res.statusText}`);
    console.log(`   Headers:`, Object.fromEntries(res.headers.entries()));
    
    if(!res.ok){
      let errorBody = "";
      try {
        errorBody = await res.text();
        console.error(`❌ Graph API Error Body:`, errorBody);
      } catch (e) {
        console.error(`❌ Kon error body niet lezen:`, e.message);
      }
      
      throw new Error(`Graph send failed ${res.status} ${res.statusText}${errorBody ? ` - ${errorBody}` : ""}`);
    }
    
    console.log(`✅ Email succesvol verzonden via Graph API`);
  } catch (error) {
    console.error(`❌ Graph API verzending gefaald:`, error.message);
    throw error;
  }
}
