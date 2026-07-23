const seedProducts = [
  {
    id: "p1", nameAr: "Netflix", nameEn: "Netflix", category: "اشتراكات",
    descriptionAr: "اشتراك مرن بخيارات مشترك أو شخصي أو حساب كامل.",
    descriptionEn: "Flexible subscription with shared, private, or full account options.",
    basePrice: 8000, delivery: "فوري", warranty: "7 أيام", stock: 21, published: true,
    symbol: "N", accent: "rgba(229,9,20,.95)",
    variants: [
      {nameAr:"مشترك",nameEn:"Shared",price:8000,durations:["شهر","3 أشهر"]},
      {nameAr:"شخصي",nameEn:"Private",price:18000,durations:["شهر"]},
      {nameAr:"حساب كامل",nameEn:"Full account",price:28000,durations:["شهر"]}
    ]
  },
  {
    id: "p2", nameAr: "Canva Pro", nameEn: "Canva Pro", category: "اشتراكات",
    descriptionAr: "تفعيل كانفا برو مع ضمان طوال مدة الاشتراك.",
    descriptionEn: "Canva Pro activation with subscription-long warranty.",
    basePrice: 12000, delivery: "بانتظار كود", warranty: "طوال الاشتراك", stock: 14, published: true,
    symbol: "C", accent: "rgba(32,212,255,.9)",
    variants: [{nameAr:"شخصي",nameEn:"Private",price:12000,durations:["شهر","سنة"]}]
  },
  {
    id: "p3", nameAr: "Xbox Game Pass", nameEn: "Xbox Game Pass", category: "ألعاب",
    descriptionAr: "كود أو تفعيل مباشر مع تسليم سريع.",
    descriptionEn: "Code or direct activation with fast delivery.",
    basePrice: 18000, delivery: "فوري", warranty: "7 أيام", stock: 9, published: true,
    symbol: "X", accent: "rgba(16,180,90,.92)",
    variants: [{nameAr:"كود",nameEn:"Code",price:18000,durations:["شهر","3 أشهر"]}]
  },
  {
    id: "p4", nameAr: "حساب ChatGPT", nameEn: "ChatGPT Account", category: "حسابات",
    descriptionAr: "حساب شخصي أو مشترك حسب اختيارك.",
    descriptionEn: "Private or shared account based on your choice.",
    basePrice: 15000, delivery: "فوري", warranty: "30 يوم", stock: 12, published: true,
    symbol: "AI", accent: "rgba(124,92,255,.95)",
    variants: [
      {nameAr:"مشترك",nameEn:"Shared",price:15000,durations:["شهر"]},
      {nameAr:"شخصي",nameEn:"Private",price:30000,durations:["شهر"]}
    ]
  }
];

function getProducts(){
  const saved = localStorage.getItem("cd_products");
  if(!saved){ localStorage.setItem("cd_products", JSON.stringify(seedProducts)); return seedProducts; }
  try{return JSON.parse(saved)}catch{return seedProducts}
}
let products = getProducts().filter(p=>p.published!==false);
let currentLang = localStorage.getItem("cd_lang") || "ar";
let selectedCategory = "الكل";
let activeProduct = null;
let activeVariant = 0;
let activeDuration = 0;

const t = {
  ar:{brandSub:"متجرك الرقمي",eyebrow:"تسليم رقمي سريع وآمن",heroTitle:"كل اشتراكاتك ومنتجاتك الرقمية بمكان واحد",heroText:"اختار المنتج، حدّد النوع والمدة، ادفع واستلم بدون تعقيد.",browse:"تصفح المنتجات",adminDemo:"تجربة لوحة الإدارة",fast:"تسليم سريع",secure:"بيانات مشفّرة",support:"دعم مباشر",categories:"الأقسام",chooseCategory:"اختار القسم المناسب",products:"المنتجات",featured:"الأكثر طلباً",filter:"فلترة",home:"الرئيسية",favorites:"المفضلة",orders:"طلباتي",accountType:"نوع الاشتراك",duration:"المدة",delivery:"التسليم",warranty:"الضمان",total:"المجموع",buyNow:"شراء الآن",noProducts:"ماكو منتجات بهذا القسم",tryAnother:"جرّب قسم ثاني أو امسح البحث."},
  en:{brandSub:"Your digital store",eyebrow:"Fast & secure digital delivery",heroTitle:"All your subscriptions and digital products in one place",heroText:"Choose a product, select a type and duration, pay and receive it without complexity.",browse:"Browse products",adminDemo:"Admin demo",fast:"Fast delivery",secure:"Encrypted data",support:"Direct support",categories:"Categories",chooseCategory:"Choose the right category",products:"Products",featured:"Most requested",filter:"Filter",home:"Home",favorites:"Favorites",orders:"Orders",accountType:"Account type",duration:"Duration",delivery:"Delivery",warranty:"Warranty",total:"Total",buyNow:"Buy now",noProducts:"No products in this category",tryAnother:"Try another category or clear search."}
};

function setLang(lang){
  currentLang=lang; localStorage.setItem("cd_lang",lang);
  document.documentElement.lang=lang; document.documentElement.dir=lang==="ar"?"rtl":"ltr";
  document.querySelectorAll("[data-i18n]").forEach(el=>{ const key=el.dataset.i18n; if(t[lang][key]) el.textContent=t[lang][key]; });
  document.getElementById("langToggle").textContent=lang==="ar"?"EN":"AR";
  document.getElementById("searchInput").placeholder=lang==="ar"?"ابحث عن منتج...":"Search products...";
  renderCategories(); renderProducts(); if(activeProduct) openProduct(activeProduct.id);
}
function money(n){return new Intl.NumberFormat(currentLang==="ar"?"ar-IQ":"en-US").format(n)+" "+(currentLang==="ar"?"د.ع":"IQD")}
function categories(){return ["الكل",...new Set(products.map(p=>p.category))]}
function catName(c){ if(currentLang==="ar") return c; const map={الكل:"All",اشتراكات:"Subscriptions",ألعاب:"Gaming",حسابات:"Accounts",أكواد:"Codes",خدمات:"Services"}; return map[c]||c; }

function renderCategories(){
  const box=document.getElementById("categoryChips"); box.innerHTML="";
  categories().forEach(c=>{
    const b=document.createElement("button"); b.className="category-chip"+(selectedCategory===c?" active":""); b.textContent=catName(c);
    b.onclick=()=>{selectedCategory=c;renderCategories();renderProducts()}; box.appendChild(b);
  });
}
function renderProducts(){
  const q=document.getElementById("searchInput").value.trim().toLowerCase();
  const list=products.filter(p=>{
    const inCat=selectedCategory==="الكل"||p.category===selectedCategory;
    const name=(p.nameAr+" "+p.nameEn+" "+p.descriptionAr+" "+p.descriptionEn).toLowerCase();
    return inCat && (!q||name.includes(q));
  });
  const grid=document.getElementById("productsGrid"), empty=document.getElementById("emptyState"); grid.innerHTML="";
  empty.classList.toggle("hidden",list.length>0);
  list.forEach(p=>{
    const title=currentLang==="ar"?p.nameAr:p.nameEn||p.nameAr;
    const desc=currentLang==="ar"?p.descriptionAr:p.descriptionEn||p.descriptionAr;
    const card=document.createElement("article"); card.className="product-card"; card.onclick=()=>openProduct(p.id);
    card.innerHTML=`<div class="product-cover" style="--accent:${p.accent||'rgba(124,92,255,.9)'}">
      <span class="product-symbol">${p.symbol||title.slice(0,2).toUpperCase()}</span>
      <small>${catName(p.category)}</small>
    </div><div class="product-body">
      <div class="product-top"><h3>${title}</h3><span class="product-badge">${p.delivery||"فوري"}</span></div>
      <p>${desc||""}</p>
      <div class="product-bottom"><div class="product-price"><small>${currentLang==="ar"?"يبدأ من":"Starts from"}</small><strong>${money(p.basePrice)}</strong></div><span class="arrow-btn">←</span></div>
    </div>`; grid.appendChild(card);
  });
}
function openProduct(id){
  activeProduct=products.find(p=>p.id===id); if(!activeProduct)return;
  activeVariant=0;activeDuration=0;
  const title=currentLang==="ar"?activeProduct.nameAr:activeProduct.nameEn||activeProduct.nameAr;
  document.getElementById("drawerMedia").textContent=activeProduct.symbol||title.slice(0,2).toUpperCase();
  document.getElementById("drawerTitle").textContent=title;
  document.getElementById("drawerDescription").textContent=currentLang==="ar"?activeProduct.descriptionAr:activeProduct.descriptionEn||activeProduct.descriptionAr;
  document.getElementById("drawerBadge").textContent=catName(activeProduct.category);
  document.getElementById("deliveryText").textContent=activeProduct.delivery;
  document.getElementById("warrantyText").textContent=activeProduct.warranty;
  renderVariantOptions();
  document.getElementById("productDrawer").classList.add("open");document.getElementById("productDrawer").setAttribute("aria-hidden","false");
  document.getElementById("productDrawerBackdrop").classList.remove("hidden");
}
function renderVariantOptions(){
  const variants=activeProduct.variants?.length?activeProduct.variants:[{nameAr:"الافتراضي",nameEn:"Default",price:activeProduct.basePrice,durations:["شهر"]}];
  const box=document.getElementById("variantOptions");box.innerHTML="";
  variants.forEach((v,i)=>{const b=document.createElement("button");b.textContent=currentLang==="ar"?v.nameAr:v.nameEn||v.nameAr;b.className=i===activeVariant?"active":"";b.onclick=()=>{activeVariant=i;activeDuration=0;renderVariantOptions()};box.appendChild(b)});
  const dbox=document.getElementById("durationOptions");dbox.innerHTML="";
  const durations=variants[activeVariant].durations||["شهر"];
  durations.forEach((d,i)=>{const b=document.createElement("button");b.textContent=d;b.className=i===activeDuration?"active":"";b.onclick=()=>{activeDuration=i;renderVariantOptions()};dbox.appendChild(b)});
  const multiplier=[1,2.7,5,9][activeDuration]||1;
  document.getElementById("drawerPrice").textContent=money(Math.round(variants[activeVariant].price*multiplier));
}
function closeDrawer(){document.getElementById("productDrawer").classList.remove("open");document.getElementById("productDrawerBackdrop").classList.add("hidden")}
function toast(msg){const el=document.getElementById("toast");el.textContent=msg;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2200)}

document.getElementById("langToggle").onclick=()=>setLang(currentLang==="ar"?"en":"ar");
document.getElementById("searchToggle").onclick=()=>{document.getElementById("searchBox").classList.toggle("hidden");document.getElementById("searchInput").focus()};
document.getElementById("searchInput").addEventListener("input",renderProducts);
document.getElementById("drawerClose").onclick=closeDrawer;document.getElementById("productDrawerBackdrop").onclick=closeDrawer;
document.querySelectorAll("[data-scroll-products]").forEach(b=>b.onclick=()=>document.getElementById("productsSection").scrollIntoView());
document.getElementById("buyBtn").onclick=()=>toast(currentLang==="ar"?"تمت إضافة المنتج للسلة — نموذج تجريبي":"Added to cart — demo");
setLang(currentLang);
