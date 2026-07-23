const seedProducts = [
  {id:"p1",nameAr:"Netflix",nameEn:"Netflix",category:"اشتراكات",descriptionAr:"اشتراك مرن بخيارات مشترك أو شخصي أو حساب كامل.",descriptionEn:"Flexible subscription with shared, private, or full account options.",basePrice:8000,delivery:"فوري",warranty:"7 أيام",stock:21,published:true,symbol:"N",accent:"rgba(229,9,20,.95)",variants:[{nameAr:"مشترك",nameEn:"Shared",price:8000,durations:["شهر","3 أشهر"]},{nameAr:"شخصي",nameEn:"Private",price:18000,durations:["شهر"]}]},
  {id:"p2",nameAr:"Canva Pro",nameEn:"Canva Pro",category:"اشتراكات",descriptionAr:"تفعيل كانفا برو مع ضمان طوال مدة الاشتراك.",descriptionEn:"Canva Pro activation with subscription-long warranty.",basePrice:12000,delivery:"بانتظار كود",warranty:"طوال الاشتراك",stock:14,published:true,symbol:"C",accent:"rgba(32,212,255,.9)",variants:[{nameAr:"شخصي",nameEn:"Private",price:12000,durations:["شهر","سنة"]}]},
  {id:"p3",nameAr:"Xbox Game Pass",nameEn:"Xbox Game Pass",category:"ألعاب",descriptionAr:"كود أو تفعيل مباشر مع تسليم سريع.",descriptionEn:"Code or direct activation with fast delivery.",basePrice:18000,delivery:"فوري",warranty:"7 أيام",stock:9,published:true,symbol:"X",accent:"rgba(16,180,90,.92)",variants:[{nameAr:"كود",nameEn:"Code",price:18000,durations:["شهر","3 أشهر"]}]},
  {id:"p4",nameAr:"حساب ChatGPT",nameEn:"ChatGPT Account",category:"حسابات",descriptionAr:"حساب شخصي أو مشترك حسب اختيارك.",descriptionEn:"Private or shared account based on your choice.",basePrice:15000,delivery:"فوري",warranty:"30 يوم",stock:12,published:true,symbol:"AI",accent:"rgba(124,92,255,.95)",variants:[{nameAr:"مشترك",nameEn:"Shared",price:15000,durations:["شهر"]},{nameAr:"شخصي",nameEn:"Private",price:30000,durations:["شهر"]}]}
];
function loadProducts(){const s=localStorage.getItem("cd_products");if(!s){localStorage.setItem("cd_products",JSON.stringify(seedProducts));return seedProducts}try{return JSON.parse(s)}catch{return seedProducts}}
let products=loadProducts();
const modal=document.getElementById("productModal"), backdrop=document.getElementById("productModalBackdrop"), form=document.getElementById("productForm");
function save(){localStorage.setItem("cd_products",JSON.stringify(products));renderProducts();updateStats()}
function money(n){return new Intl.NumberFormat("ar-IQ").format(n)+" د.ع"}
function toast(msg){const el=document.getElementById("toast");el.textContent=msg;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2200)}
function updateStats(){document.getElementById("stockCount").textContent=products.reduce((s,p)=>s+(Number(p.stock)||0),0)}
function renderFilter(){const select=document.getElementById("adminCategoryFilter"),current=select.value;select.innerHTML='<option value="all">كل الأقسام</option>';[...new Set(products.map(p=>p.category))].forEach(c=>select.insertAdjacentHTML("beforeend",`<option>${c}</option>`));select.value=current||"all"}
function renderProducts(){
  renderFilter();
  const q=document.getElementById("adminSearch").value.trim().toLowerCase(), cat=document.getElementById("adminCategoryFilter").value;
  const list=products.filter(p=>(cat==="all"||p.category===cat)&&(!q||(p.nameAr+" "+p.nameEn+" "+p.category).toLowerCase().includes(q)));
  const box=document.getElementById("adminProducts");box.innerHTML="";
  list.forEach(p=>{
    const row=document.createElement("article");row.className="admin-product-card";
    row.innerHTML=`<div class="admin-thumb">${p.symbol||p.nameAr.slice(0,2)}</div>
      <div><b>${p.nameAr}</b><small>${p.nameEn||"—"} · ${p.category}</small></div>
      <div><small>السعر</small><b>${money(p.basePrice)}</b></div>
      <div><small>التسليم</small><b>${p.delivery}</b></div>
      <div><small>المخزون</small><span class="stock-pill">${p.stock}</span></div>
      <div class="row-actions"><button data-edit="${p.id}" title="تعديل">✎</button><button data-delete="${p.id}" title="حذف">⌫</button></div>`;
    box.appendChild(row);
  });
  box.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>openModal(products.find(p=>p.id===b.dataset.edit)));
  box.querySelectorAll("[data-delete]").forEach(b=>b.onclick=()=>{if(confirm("حذف المنتج؟")){products=products.filter(p=>p.id!==b.dataset.delete);save();toast("تم حذف المنتج")}});
}
function addVariantRow(v={nameAr:"مشترك",nameEn:"Shared",price:5000,durations:["شهر"]}){
  const row=document.createElement("div");row.className="variant-row";
  row.innerHTML=`<input class="v-name-ar" placeholder="اسم الخيار" value="${v.nameAr||""}"><input class="v-name-en" placeholder="English" value="${v.nameEn||""}"><input class="v-price" type="number" min="0" value="${v.price||0}"><button type="button">×</button>`;
  row.querySelector("button").onclick=()=>row.remove();document.getElementById("variantsBuilder").appendChild(row);
}
function openModal(product=null){
  form.reset();document.getElementById("variantsBuilder").innerHTML="";
  document.getElementById("productId").value=product?.id||"";
  document.getElementById("modalTitle").textContent=product?"تعديل المنتج":"إضافة منتج";
  if(product){
    ["nameAr","nameEn","category","basePrice","descriptionAr","descriptionEn","delivery","warranty","stock"].forEach(id=>document.getElementById(id).value=product[id]??"");
    document.getElementById("published").checked=product.published!==false;
    (product.variants||[]).forEach(addVariantRow);
  } else addVariantRow();
  modal.classList.remove("hidden");backdrop.classList.remove("hidden");
}
function closeModal(){modal.classList.add("hidden");backdrop.classList.add("hidden")}
function pseudoTranslate(text){
  const dict={"اشتراك":"Subscription","حساب":"Account","شخصي":"Private","مشترك":"Shared","نتفلكس":"Netflix","ألعاب":"Games","كود":"Code","سريع":"Fast","تفعيل":"Activation","شهر":"Month","سنة":"Year"};
  return text.split(/\s+/).map(w=>dict[w]||w).join(" ");
}
document.querySelectorAll(".side-nav button").forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll(".side-nav button").forEach(x=>x.classList.remove("active"));btn.classList.add("active");
  document.querySelectorAll(".admin-view").forEach(v=>v.classList.remove("active"));
  document.getElementById("view-"+btn.dataset.view).classList.add("active");
  document.getElementById("pageTitle").textContent=btn.textContent.trim();
  document.querySelector(".sidebar").classList.remove("open");
});
document.getElementById("mobileMenu").onclick=()=>document.querySelector(".sidebar").classList.toggle("open");
document.getElementById("addProductBtn").onclick=()=>openModal();document.getElementById("quickAddProduct").onclick=()=>{document.querySelector('[data-view="products"]').click();openModal()};
document.getElementById("closeProductModal").onclick=closeModal;document.getElementById("cancelProduct").onclick=closeModal;backdrop.onclick=closeModal;
document.getElementById("addVariant").onclick=()=>addVariantRow();
document.getElementById("translateBtn").onclick=()=>{
  const ar=document.getElementById("nameAr").value.trim(), desc=document.getElementById("descriptionAr").value.trim();
  if(!ar)return toast("اكتب الاسم العربي أولاً");
  document.getElementById("nameEn").value=pseudoTranslate(ar);
  document.getElementById("descriptionEn").value=pseudoTranslate(desc);
  toast("تمت الترجمة التجريبية — بالنسخة النهائية ترتبط بالذكاء الاصطناعي");
};
form.onsubmit=e=>{
  e.preventDefault();
  const id=document.getElementById("productId").value||"p"+Date.now();
  const variants=[...document.querySelectorAll(".variant-row")].map(r=>({nameAr:r.querySelector(".v-name-ar").value,nameEn:r.querySelector(".v-name-en").value,price:Number(r.querySelector(".v-price").value),durations:["شهر"]}));
  const item={id,nameAr:nameAr.value.trim(),nameEn:nameEn.value.trim(),category:category.value,basePrice:Number(basePrice.value),descriptionAr:descriptionAr.value.trim(),descriptionEn:descriptionEn.value.trim(),delivery:delivery.value,warranty:warranty.value,stock:Number(stock.value),published:published.checked,symbol:(nameEn.value||nameAr.value).slice(0,2).toUpperCase(),accent:"rgba(124,92,255,.9)",variants};
  const i=products.findIndex(p=>p.id===id);if(i>=0)products[i]=item;else products.unshift(item);
  save();closeModal();toast("تم حفظ المنتج");
};
document.getElementById("adminSearch").addEventListener("input",renderProducts);
document.getElementById("adminCategoryFilter").addEventListener("change",renderProducts);
renderProducts();updateStats();
