import { getStore } from '@netlify/blobs';
const getBlobStore=()=>getStore({name:'dingqi-libya',consistency:'strong'});
const PASSWORD = String(globalThis.Netlify?.env?.get?.('DINGQI_ADMIN_PASSWORD') || '2005515');
const DEFAULT_SETTINGS={storeName:'DINGQI Libya',email:'dingql.libya51@gmail.com',whatsapp:'218946961543',currency:'د.ل',delivery:{'طرابلس':0,'بنغازي':25,'مصراتة':20,'الزاوية':15,'زليتن':20,'الخمس':20,'سبها':45,'أخرى':35},categories:['معدات ورش','أدوات','رفع وتحريك','إكسسوارات']};
const key=(x)=>`data/${x}`;
async function getJSON(k,f){const store=getBlobStore();return (await store.get(key(k),{type:'json',consistency:'strong'}))??f}
async function setJSON(k,v){const store=getBlobStore();await store.setJSON(key(k),v);return v}
function auth(req){const h=req.headers.get('authorization')||'';if(!h.startsWith('Bearer '))return false;try{const raw=h.slice(7);const decoded=typeof atob==='function'?atob(raw):Buffer.from(raw,'base64').toString('binary');return decodeURIComponent(escape(decoded))===PASSWORD}catch{return false}}
function res(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json;charset=UTF-8','cache-control':'no-store'}})}
export default async (req)=>{const url=new URL(req.url),path=url.pathname.replace(/^\/api\/?/,'');try{
  if(path==='auth'&&req.method==='POST'){const b=await req.json().catch(()=>({}));if(String(b.password||'')!==PASSWORD)return res({ok:false,error:'Unauthorized'},401);return res({ok:true})}
  if(path==='settings'&&req.method==='GET')return res(await getJSON('settings',DEFAULT_SETTINGS));
  if(path==='settings'&&req.method==='POST'){if(!auth(req))return res({error:'Unauthorized'},401);const b=await req.json(),s={...(await getJSON('settings',DEFAULT_SETTINGS)),...b};await setJSON('settings',s);return res(s)}
  if(path==='orders'&&req.method==='POST'){
    const b=await req.json();
    if(!b.customer?.name||!b.customer?.phone||!b.customer?.address||!Array.isArray(b.items)||!b.items.length)return res({error:'بيانات الطلب ناقصة'},400);
    const products=await getJSON('products',[]);
    const requested=new Map();
    for(const item of b.items){
      const qty=Math.floor(Number(item.qty||0));
      if(!item.id||qty<1)return res({error:'كمية منتج غير صالحة'},400);
      requested.set(item.id,(requested.get(item.id)||0)+qty);
    }
    for(const [id,qty] of requested){
      const p=products.find(x=>x.id===id);
      if(!p)return res({error:'أحد المنتجات لم يعد متوفرًا'},409);
      if(Number(p.stock||0)<qty)return res({error:`المخزون غير كافٍ للمنتج: ${p.name}`},409);
    }
    const now=new Date().toISOString();
    const orders=await getJSON('orders',[]);
    const order={id:'DQ-'+Date.now().toString(36).toUpperCase(),createdAt:now,status:'جديد',customer:b.customer,items:b.items,total:Number(b.total||0),delivery:Number(b.delivery||0),grandTotal:Number(b.grandTotal||b.total||0),deliveryArea:b.deliveryArea||''};
    for(const [id,qty] of requested){
      const p=products.find(x=>x.id===id);
      p.stock=Math.max(0,Number(p.stock||0)-qty);
      p.updatedAt=now;
    }
    await setJSON('products',products);
    orders.unshift(order);
    await setJSON('orders',orders);
    return res(order,201)
  }
  if(path==='orders'&&req.method==='GET'){if(!auth(req))return res({error:'Unauthorized'},401);return res(await getJSON('orders',[]))}
  if(path==='orders'&&req.method==='PATCH'){
    if(!auth(req))return res({error:'Unauthorized'},401);
    const b=await req.json();
    const orders=await getJSON('orders',[]);
    const i=orders.findIndex(o=>o.id===b.id);
    if(i<0)return res({error:'Not found'},404);
    const oldStatus=orders[i].status||'جديد';
    const newStatus=b.status||oldStatus;
    if(oldStatus!==newStatus){
      const products=await getJSON('products',[]);
      const items=orders[i].items||[];
      if(oldStatus!=='ملغي'&&newStatus==='ملغي'){
        for(const item of items){const p=products.find(x=>x.id===item.id);if(p)p.stock=Math.max(0,Number(p.stock||0)+Math.floor(Number(item.qty||0)));}
        await setJSON('products',products);
      }
      if(oldStatus==='ملغي'&&newStatus!=='ملغي'){
        for(const item of items){const p=products.find(x=>x.id===item.id);if(!p)return res({error:'المنتج الأصلي غير موجود'},409);if(Number(p.stock||0)<Number(item.qty||0))return res({error:`المخزون غير كافٍ لإعادة تفعيل الطلب: ${p.name}`},409);}
        for(const item of items){const p=products.find(x=>x.id===item.id);p.stock=Math.max(0,Number(p.stock||0)-Math.floor(Number(item.qty||0)));}
        await setJSON('products',products);
      }
    }
    orders[i]={...orders[i],status:newStatus,updatedAt:new Date().toISOString()};
    await setJSON('orders',orders);
    return res(orders[i])
  }
  if(path==='categories'&&req.method==='GET')return res((await getJSON('settings',DEFAULT_SETTINGS)).categories||[]);
  if(path==='categories'&&req.method==='POST'){if(!auth(req))return res({error:'Unauthorized'},401);const b=await req.json(),s=await getJSON('settings',DEFAULT_SETTINGS);s.categories=[...new Set((Array.isArray(b)?b:s.categories).map(String).map(x=>x.trim()).filter(Boolean))];await setJSON('settings',s);return res(s.categories)}
  if(path==='visit'&&req.method==='POST'){const today=new Date().toISOString().slice(0,10),a=await getJSON('analytics',{total:0,days:{}});a.total=(a.total||0)+1;a.days[today]=(a.days[today]||0)+1;await setJSON('analytics',a);return res({ok:true})}
  if(path==='analytics'&&req.method==='GET'){if(!auth(req))return res({error:'Unauthorized'},401);return res(await getJSON('analytics',{total:0,days:{}}))}
  if(path==='inventory'&&req.method==='GET'){if(!auth(req))return res({error:'Unauthorized'},401);return res(await getJSON('inventoryLog',[]))}
  return res({error:'Not found'},404)
}catch(e){console.error(e);return res({error:e.message||'Server error'},500)}};
